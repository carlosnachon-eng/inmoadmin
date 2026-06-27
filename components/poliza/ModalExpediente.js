import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { generarContratoArrendamiento } from '../../lib/generarContrato'
import { generarPagares } from '../../lib/generarPagares'
import { generarPolizaJuridica } from '../../lib/generarPoliza'
import { generarReciboPoliza } from '../../lib/generarRecibo'
import { generarContratoPromocion } from '../../lib/generarContratoPromocion'
import { generarContratoAdministracion } from '../../lib/generarContratoAdministracion'
import { C, st, fmt, fmtDate, calcularPagares, calcularFechaVigencia, numeroALetra } from '../../lib/polizaUtils'
import { calcCommission, COMMISSION_RATE } from '../../lib/partners'

export default function ModalExpediente({ expediente, propietarios, solicitudes, onClose, onSaved }) {
  const [form, setForm] = useState({ ...expediente })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const formRef = useRef(null)
  const [generando, setGenerando] = useState('')

  const getFormValues = () => {
    if (!formRef.current) return {}
    const inputs = formRef.current.querySelectorAll('[data-field]')
    const vals = {}
    inputs.forEach(el => { vals[el.dataset.field] = el.value })
    return vals
  }
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (form.fecha_inicio && form.duracion_contrato_meses) {
      const nuevaVigencia = calcularFechaVigencia(form.fecha_inicio, form.duracion_contrato_meses)
      setForm(f => ({ ...f, fecha_vigencia: nuevaVigencia }))
    }
  }, [form.duracion_contrato_meses])

  const handleGenerar = async (tipo) => {
    const domVals = getFormValues()
    const merged = { ...form, ...domVals }
    setGenerando(tipo)
    try {
      if (tipo === 'contrato') await generarContratoArrendamiento(merged)
      if (tipo === 'pagares') await generarPagares(merged)
      if (tipo === 'poliza') await generarPolizaJuridica(merged)
      if (tipo === 'recibo') await generarReciboPoliza(merged)
      if (tipo === 'promocion') await generarContratoPromocion(merged)
      if (tipo === 'administracion') await generarContratoAdministracion(merged)
    } catch(e) {
      alert('Error generando documento: ' + e.message)
    } finally {
      setGenerando('')
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setMsg('')
    try {
      const domVals = getFormValues()
      const merged = { ...form, ...domVals }
      const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n }
      const r = num(merged.renta_mensual) || 0
      const dep = num(merged.deposito_garantia) || 0
      const mora = parseFloat((r * 0.01).toFixed(2))
      const pagares = merged.fecha_inicio ? calcularPagares(merged.fecha_inicio) : {}
      const meses = parseInt(merged.duracion_contrato_meses) || 12
      const fechaVigencia = merged.fecha_inicio ? calcularFechaVigencia(merged.fecha_inicio, meses) : merged.fecha_vigencia || null

      const camposNumericos = ['cuota_mantenimiento', 'mora_diaria', 'monto_poliza', 'anticipo_poliza', 'deposito_garantia', 'renta_mensual', 'monto_adeudo']
      const cleanMerged = { ...merged }
      camposNumericos.forEach(k => {
        if (cleanMerged[k] === '' || cleanMerged[k] === undefined) cleanMerged[k] = null
        else if (cleanMerged[k] !== null) cleanMerged[k] = num(cleanMerged[k])
      })

      const { error } = await supabase.from('poliza_expedientes').update({
        ...cleanMerged,
        renta_mensual: r,
        renta_mensual_letra: numeroALetra(r),
        deposito_garantia: dep,
        deposito_garantia_letra: numeroALetra(dep),
        mora_diaria: mora,
        mora_diaria_letra: numeroALetra(mora),
        monto_poliza: num(merged.monto_poliza),
        monto_poliza_letra: num(merged.monto_poliza) ? numeroALetra(num(merged.monto_poliza)) : null,
        fecha_termino: fechaVigencia,
        duracion_contrato_meses: meses,
        fecha_vigencia: fechaVigencia,
        status_expediente: merged.status_expediente || 'borrador',
        anticipo_poliza: num(merged.anticipo_poliza),
        anticipo_pagado: merged.anticipo_pagado || false,
        saldo_pagado: merged.saldo_pagado || false,
        metodo_pago_completo: merged.metodo_pago_completo || 'efectivo',
        ...pagares,
      }).eq('id', expediente.id)
      if (error) throw error

      if (merged.anticipo_pagado && !expediente.anticipo_pagado && parseFloat(merged.anticipo_poliza) > 0) {
        await supabase.from('poliza_caja').insert({ tipo: 'ingreso', concepto: 'anticipo_poliza', descripcion: `Anticipo póliza — ${merged.nombre_arrendatario || ''}`, monto: parseFloat(merged.anticipo_poliza), metodo_pago: merged.metodo_pago_completo || 'efectivo', expediente_id: expediente.id, nombre_cliente: merged.nombre_arrendatario || '', fecha: new Date().toISOString().split('T')[0] })
      }
      if (merged.saldo_pagado && !expediente.saldo_pagado) {
        const montoPoliza = parseFloat(merged.monto_poliza) || 0
        const anticipo = parseFloat(merged.anticipo_poliza) || 0
        const saldo = montoPoliza - anticipo
        await supabase.from('poliza_caja').insert({ tipo: 'ingreso', concepto: anticipo > 0 ? 'saldo_poliza' : 'pago_poliza', descripcion: `${anticipo > 0 ? 'Saldo' : 'Pago'} póliza — ${merged.nombre_arrendatario || ''}`, monto: anticipo > 0 ? saldo : montoPoliza, metodo_pago: merged.metodo_pago_completo || 'efectivo', expediente_id: expediente.id, nombre_cliente: merged.nombre_arrendatario || '', fecha: new Date().toISOString().split('T')[0] })
      }

      const montoPolizaFinal = num(merged.monto_poliza)
      const partnerPayload = {
        monto_poliza_final: montoPolizaFinal,
        updated_at: new Date().toISOString(),
      }
      if (merged.status === 'activo' && merged.saldo_pagado && montoPolizaFinal) {
        partnerPayload.status_partner = 'activa'
        partnerPayload.commission_generated = calcCommission(montoPolizaFinal, COMMISSION_RATE)
        partnerPayload.commission_generated_at = new Date().toISOString()
        partnerPayload.observaciones_publicas = 'Poliza activa. Fechas de firma y vigencia disponibles para seguimiento y renovacion.'
      } else if (merged.fecha_firma) {
        partnerPayload.status_partner = 'lista_para_firma'
        partnerPayload.observaciones_publicas = 'Contrato preparado y fecha de firma registrada.'
      } else {
        partnerPayload.status_partner = 'contrato_en_proceso'
      }
      await supabase.from('partner_operations').update(partnerPayload).eq('poliza_expediente_id', expediente.id)

      onSaved()
    } catch (e) {
      setMsg('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={st.modal} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={st.modalCard} ref={formRef}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text, fontFamily: 'Georgia, serif' }}>{form.nombre_arrendatario || 'Expediente'}</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: C.muted }}>ID: {expediente.id.slice(0, 8).toUpperCase()}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={form.status} onChange={e => set('status', e.target.value)} style={{ ...st.input, width: 'auto', fontSize: 12 }}>
              {[['borrador','Borrador'], ['activo','Activo'], ['vencido','Vencido'], ['cancelado','Cancelado']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>✕</button>
          </div>
        </div>

        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase' }}>Arrendador</p>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Nombre</label><input type="text" defaultValue={form.nombre_arrendador || ''} data-field='nombre_arrendador' style={st.input} /></div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>RFC</label><input type="text" defaultValue={form.rfc_arrendador || ''} data-field='rfc_arrendador' style={st.input} /></div>
        </div>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Clave de elector</label><input type="text" defaultValue={form.clave_elector_arrendador || ''} data-field='clave_elector_arrendador' style={st.input} /></div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Teléfono</label><input type="text" defaultValue={form.telefono_arrendador || ''} data-field='telefono_arrendador' style={st.input} /></div>
        </div>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Correo</label><input type="text" defaultValue={form.correo_arrendador || ''} data-field='correo_arrendador' style={st.input} /></div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Domicilio</label><input type="text" defaultValue={form.domicilio_arrendador || ''} data-field='domicilio_arrendador' style={st.input} /></div>
        </div>

        <div style={st.divider} />
        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase' }}>Arrendatario</p>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Nombre</label><input type="text" defaultValue={form.nombre_arrendatario || ''} data-field='nombre_arrendatario' style={st.input} /></div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>RFC</label><input type="text" defaultValue={form.rfc_arrendatario || ''} data-field='rfc_arrendatario' style={st.input} /></div>
        </div>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Clave de elector</label><input type="text" defaultValue={form.clave_elector_arrendatario || ''} data-field='clave_elector_arrendatario' style={st.input} /></div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Teléfono</label><input type="text" defaultValue={form.telefono_arrendatario || ''} data-field='telefono_arrendatario' style={st.input} /></div>
        </div>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Correo</label><input type="text" defaultValue={form.correo_arrendatario || ''} data-field='correo_arrendatario' style={st.input} /></div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Ocupación</label><input type="text" defaultValue={form.ocupacion_arrendatario || ''} data-field='ocupacion_arrendatario' style={st.input} /></div>
        </div>
        <div style={{ marginBottom: 14 }}><label style={st.label}>Comprobante de ingresos</label><input type="text" defaultValue={form.comprobante_ingresos || ''} data-field='comprobante_ingresos' style={st.input} /></div>

        <div style={st.divider} />
        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase' }}>Inmueble y condiciones</p>
        <div style={{ marginBottom: 14 }}><label style={st.label}>Dirección</label><input type="text" defaultValue={form.direccion_inmueble || ''} data-field='direccion_inmueble' style={st.input} /></div>
        <div style={st.grid3}>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Renta mensual $</label><input type="number" defaultValue={form.renta_mensual || ''} data-field='renta_mensual' style={st.input} /></div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Cuota mantenimiento $</label><input type="number" defaultValue={form.cuota_mantenimiento || ''} data-field='cuota_mantenimiento' style={st.input} /></div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Depósito $</label><input type="number" defaultValue={form.deposito_garantia || ''} data-field='deposito_garantia' style={st.input} /></div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Monto póliza $</label><input type="number" defaultValue={form.monto_poliza || ''} data-field='monto_poliza' style={st.input} /></div>
        </div>
        <div style={st.grid3}>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Fecha inicio</label><input type="date" defaultValue={form.fecha_inicio || ''} data-field='fecha_inicio' onChange={e => set('fecha_inicio', e.target.value)} style={st.input} /></div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Fecha firma</label><input type="date" defaultValue={form.fecha_firma || ''} data-field='fecha_firma' style={st.input} /></div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Entrega posesión</label><input type="date" defaultValue={form.fecha_entrega_posesion || ''} data-field='fecha_entrega_posesion' style={st.input} /></div>
        </div>
        <div style={{ marginBottom: 14 }}><label style={st.label}>Notas</label><input type="text" defaultValue={form.notas || ''} data-field='notas' style={st.input} /></div>

        <div style={{ ...st.divider, margin: '16px 0' }} />
        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>⏰ Vigencia del contrato</p>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
            <label style={st.label}>Duración del contrato</label>
            <select value={form.duracion_contrato_meses || 12} onChange={e => set('duracion_contrato_meses', parseInt(e.target.value))} style={st.input}>
              <option value={6}>6 meses</option>
              <option value={12}>12 meses (1 año)</option>
              <option value={24}>24 meses (2 años)</option>
              <option value={36}>36 meses (3 años)</option>
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={st.label}>Fecha de vencimiento</label>
            <input
              type="date"
              value={form.fecha_vigencia || ''}
              onChange={e => set('fecha_vigencia', e.target.value)}
              style={{ ...st.input, color: C.goldText, fontWeight: 600 }}
            />
            <p style={{ margin: '4px 0 0', fontSize: 10, color: C.faint }}>Se recalcula al cambiar duración. Editable manualmente.</p>
          </div>
        </div>
        {form.fecha_vigencia && (() => {
          const dias = Math.ceil((new Date(form.fecha_vigencia + 'T12:00:00') - new Date()) / (1000 * 60 * 60 * 24))
          const vencido = dias < 0
          const urgente = dias <= 30 && dias >= 0
          const bg = vencido ? C.redBg : urgente ? '#fff7ed' : C.greenBg
          const color = vencido ? C.redText : urgente ? '#c2410c' : C.greenText
          return (
            <div style={{ background: bg, borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color }}>
                {vencido ? `⚠️ Contrato vencido hace ${Math.abs(dias)} días` : urgente ? `🔴 Vence en ${dias} días — urgente` : `✅ Vigente — vence en ${dias} días`}
              </p>
            </div>
          )
        })()}

        <div style={{ ...st.divider, margin: '16px 0' }} />
        <p style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px' }}>Tipo de contrato</p>
        <div style={st.grid3}>
          <div style={{ marginBottom: 14 }}>
            <label style={st.label}>Tipo de inmueble</label>
            <select value={form.tipo_contrato || 'habitacional'} onChange={e => set('tipo_contrato', e.target.value)} style={st.input}>
              <option value="habitacional">Habitacional</option>
              <option value="amueblado">Amueblado</option>
              <option value="comercial">Comercial</option>
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={st.label}>Tipo de arrendatario</label>
            <select value={form.tipo_arrendatario || 'fisica'} onChange={e => set('tipo_arrendatario', e.target.value)} style={st.input}>
              <option value="fisica">Persona física</option>
              <option value="moral">Persona moral</option>
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={st.label}>Giro comercial</label>
            <input type="text" value={form.giro_comercial || ''} onChange={e => set('giro_comercial', e.target.value)} style={st.input} />
          </div>
        </div>
        {form.tipo_arrendatario === 'moral' && (
          <div style={st.grid2}>
            <div style={{ marginBottom: 14 }}>
              <label style={st.label}>Razón social del arrendatario</label>
              <input type="text" value={form.razon_social_arrendatario || ''} onChange={e => set('razon_social_arrendatario', e.target.value)} style={st.input} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={st.label}>Representante legal</label>
              <input type="text" value={form.representante_legal_arrendatario || ''} onChange={e => set('representante_legal_arrendatario', e.target.value)} style={st.input} />
            </div>
          </div>
        )}

        <div style={{ ...st.divider, margin: '16px 0' }} />
        <p style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px' }}>Status y cobros</p>
        <div style={st.grid3}>
          <div style={{ marginBottom: 14 }}>
            <label style={st.label}>Anticipo póliza $</label>
            <input type="number" value={form.anticipo_poliza || ''} onChange={e => set('anticipo_poliza', e.target.value)} style={st.input} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={st.label}>¿Anticipo cobrado?</label>
            <select value={form.anticipo_pagado ? 'si' : 'no'} onChange={e => set('anticipo_pagado', e.target.value === 'si')} style={st.input}>
              <option value="no">No</option>
              <option value="si">Sí</option>
            </select>
          </div>
        </div>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
            <label style={st.label}>¿Póliza pagada completa?</label>
            <select value={form.saldo_pagado ? 'si' : 'no'} onChange={e => set('saldo_pagado', e.target.value === 'si')} style={st.input}>
              <option value="no">No</option>
              <option value="si">Sí — póliza liquidada</option>
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={st.label}>Método de pago póliza</label>
            <select value={form.metodo_pago_completo || 'efectivo'} onChange={e => set('metodo_pago_completo', e.target.value)} style={st.input}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
            </select>
          </div>
        </div>

        {form.saldo_pagado && !expediente.saldo_pagado && (
          <div style={{ background: C.greenBg, border: `1px solid ${C.green}`, borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 12, color: C.greenText }}>💰 Al guardar, se registrará el cobro en Caja Póliza automáticamente.</p>
          </div>
        )}

        {msg && <p style={{ color: C.redText, fontSize: 13, margin: '12px 0 0' }}>{msg}</p>}

        <div style={{ ...st.divider, margin: '20px 0' }} />
        <p style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px' }}>Generar documentos</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
          {[
            { tipo: 'contrato', label: '📄 Contrato de arrendamiento', bg: '#f0fdf4', color: '#065f46', border: '#6ee7b7' },
            { tipo: 'pagares', label: '📄 Pagarés (12)', bg: '#dbeafe', color: '#1e40af', border: '#93c5fd' },
            { tipo: 'poliza', label: '📄 Póliza jurídica', bg: '#f5f3ff', color: '#7c3aed', border: '#c4b5fd' },
            { tipo: 'recibo', label: '🧾 Recibo de póliza', bg: '#f0fdf4', color: '#065f46', border: '#6ee7b7' },
            { tipo: 'administracion', label: '📄 Contrato administración', bg: '#f0fdf4', color: '#065f46', border: '#86efac' },
          ].map(d => (
            <button key={d.tipo} onClick={() => handleGenerar(d.tipo)} disabled={!!generando}
              style={{ ...st.btn, background: d.bg, color: d.color, border: `1px solid ${d.border}`, opacity: generando ? 0.6 : 1 }}>
              {generando === d.tipo ? 'Generando...' : d.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{ ...st.btn, ...st.btnGold, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}
