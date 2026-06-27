import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { C, st, fmt, fmtDate, calcularPagares, calcularFechaVigencia, numeroALetra } from '../../lib/polizaUtils'
import { calcCommission, COMMISSION_RATE } from '../../lib/partners'

export default function ModalNuevoExpediente({ propietarios, solicitudes, prefill, onClose, onSaved }) {
  const [propId, setPropId] = useState('')
  const [solId, setSolId] = useState(prefill?.id || '')
  const [form, setForm] = useState({
    tipo_contrato: 'habitacional_sin_muebles',
    incluye_administracion: false,
    nombre_arrendador: '', domicilio_arrendador: '', rfc_arrendador: '',
    clave_elector_arrendador: '', telefono_arrendador: '', correo_arrendador: '',
    nombre_arrendatario: '', domicilio_arrendatario: '', rfc_arrendatario: '',
    clave_elector_arrendatario: '', telefono_arrendatario: '', correo_arrendatario: '',
    ocupacion_arrendatario: '', comprobante_ingresos: '',
    direccion_inmueble: '', ciudad_estado_inmueble: 'San Andrés Cholula, Puebla',
    renta_mensual: '', cuota_mantenimiento: '', deposito_garantia: '', forma_pago: 'efectivo',
    banco_receptor: '', clabe_interbancaria: '', dia_limite_pago: '5',
    fecha_inicio: '', fecha_firma: '', fecha_entrega_posesion: '',
    mascotas_permitidas: 'no', detalle_mascotas: '',
    monto_poliza: '',
    duracion_contrato_meses: 12,
    status: 'borrador',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const formRef = useRef(null)

  const getFormValues = () => {
    if (!formRef.current) return {}
    const inputs = formRef.current.querySelectorAll('[data-field]')
    const vals = {}
    inputs.forEach(el => { vals[el.dataset.field] = el.value })
    return vals
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!propId) return
    const p = propietarios.find(x => x.id === propId)
    if (!p) return
    setForm(f => ({ ...f, nombre_arrendador: p.nombre_propietario || '', domicilio_arrendador: p.domicilio_propietario || '', rfc_arrendador: p.rfc_propietario || '', telefono_arrendador: p.telefono_propietario || '', correo_arrendador: p.correo_propietario || '', clave_elector_arrendador: p.clave_elector_propietario || '', direccion_inmueble: p.direccion_inmueble || '', renta_mensual: p.monto_renta || '', forma_pago: p.forma_pago || 'efectivo', banco_receptor: p.banco || '', clabe_interbancaria: p.clabe || '', mascotas_permitidas: p.mascotas_permitidas || 'no', detalle_mascotas: p.detalle_mascotas || '', incluye_administracion: p.contrato_administracion || false }))
  }, [propId])

  useEffect(() => {
    if (!solId) return
    const sol = solicitudes.find(x => x.id === solId)
    if (!sol) return
    setForm(f => ({ ...f, nombre_arrendatario: sol.nombre_completo || sol.razon_social || '', domicilio_arrendatario: sol.domicilio_actual || '', rfc_arrendatario: sol.rfc || sol.rfc_empresa || '', telefono_arrendatario: sol.telefono || '', correo_arrendatario: sol.correo || '', clave_elector_arrendatario: sol.clave_elector || '', ocupacion_arrendatario: sol.empresa_labora || sol.giro_empresa || '', comprobante_ingresos: sol.tipo_ingresos || '' }))
  }, [solId])

  useEffect(() => {
    const r = parseFloat(form.renta_mensual)
    if (!r) return
    setForm(f => ({ ...f, deposito_garantia: r, mora_diaria: (r * 0.01).toFixed(2) }))
  }, [form.renta_mensual])

  const fechaTermino = form.fecha_inicio
    ? (() => { const d = new Date(form.fecha_inicio + 'T12:00:00'); d.setFullYear(d.getFullYear() + 1); return d.toISOString().split('T')[0] })()
    : ''

  const fechaVigenciaCalc = form.fecha_inicio
    ? calcularFechaVigencia(form.fecha_inicio, form.duracion_contrato_meses)
    : ''

  const handleSave = async () => {
    const domVals = getFormValues()
    const merged = { ...form, ...domVals }
    if (!merged.nombre_arrendador || !merged.nombre_arrendatario || !merged.fecha_inicio) {
      setMsg('Completa al menos: arrendador, arrendatario y fecha de inicio')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      const r = parseFloat(merged.renta_mensual) || 0
      const dep = parseFloat(merged.deposito_garantia) || 0
      const mora = parseFloat((r * 0.01).toFixed(2))
      const pagares = calcularPagares(merged.fecha_inicio)
      const meses = parseInt(merged.duracion_contrato_meses) || 12
      const fechaVigencia = calcularFechaVigencia(merged.fecha_inicio, meses)

      const payload = {
        ...merged,
        propietario_id: propId || null,
        inquilino_id: solId || null,
        renta_mensual: r,
        cuota_mantenimiento: parseFloat(merged.cuota_mantenimiento) || 0,
        renta_mensual_letra: numeroALetra(r),
        deposito_garantia: dep,
        deposito_garantia_letra: numeroALetra(dep),
        mora_diaria: mora,
        mora_diaria_letra: numeroALetra(mora),
        monto_poliza: parseFloat(merged.monto_poliza) || null,
        monto_poliza_letra: merged.monto_poliza ? numeroALetra(parseFloat(merged.monto_poliza)) : null,
        dia_limite_pago: parseInt(form.dia_limite_pago) || 5,
        fecha_termino: fechaTermino || null,
        duracion_contrato_meses: meses,
        fecha_vigencia: fechaVigencia || null,
        recordatorio_30_enviado: false,
        recordatorio_60_enviado: false,
        ...pagares,
      }

      const { data: nuevoExpediente, error } = await supabase.from('poliza_expedientes').insert(payload).select('id, monto_poliza, status, saldo_pagado').single()
      if (error) throw error

      if (solId || propId) {
        const partnerUpdate = {
          poliza_expediente_id: nuevoExpediente.id,
          monto_poliza_final: nuevoExpediente.monto_poliza || null,
          updated_at: new Date().toISOString(),
        }
        if (nuevoExpediente.status === 'activo' && nuevoExpediente.saldo_pagado && nuevoExpediente.monto_poliza) {
          partnerUpdate.status_partner = 'activa'
          partnerUpdate.commission_generated = calcCommission(nuevoExpediente.monto_poliza, COMMISSION_RATE)
          partnerUpdate.commission_generated_at = new Date().toISOString()
          partnerUpdate.observaciones_publicas = 'Poliza activa. Fechas de firma y vigencia disponibles para seguimiento y renovacion.'
        } else {
          partnerUpdate.status_partner = 'contrato_en_proceso'
          partnerUpdate.observaciones_publicas = 'Expediente juridico creado. Emporio continua con contrato, firma y activacion.'
        }

        let query = supabase.from('partner_operations').update(partnerUpdate)
        if (solId && propId) query = query.or(`solicitud_inquilino_id.eq.${solId},propietario_id.eq.${propId}`)
        else if (solId) query = query.eq('solicitud_inquilino_id', solId)
        else query = query.eq('propietario_id', propId)
        await query
      }
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
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text, fontFamily: 'Georgia, serif' }}>Nuevo expediente</h2>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>✕</button>
        </div>

        <div style={st.grid2}>
          <div>
            <label style={st.label}>Propietario registrado</label>
            <select value={propId} onChange={e => setPropId(e.target.value)} style={st.input}>
              <option value="">— Seleccionar o capturar abajo —</option>
              {propietarios.map(p => <option key={p.id} value={p.id}>{p.nombre_propietario} · {p.direccion_inmueble?.slice(0, 30)}...</option>)}
            </select>
          </div>
          <div>
            <label style={st.label}>Solicitud de inquilino</label>
            <select value={solId} onChange={e => setSolId(e.target.value)} style={st.input}>
              <option value="">— Seleccionar o capturar abajo —</option>
              {solicitudes.map(sol => <option key={sol.id} value={sol.id}>{sol.nombre_completo || sol.razon_social} · {sol.status}</option>)}
            </select>
          </div>
        </div>

        <div style={{ ...st.divider, margin: '20px 0' }} />

        <div style={{ marginBottom: 20 }}>
          <label style={st.label}>Tipo de contrato</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[{ v: 'habitacional_sin_muebles', l: 'Casa sin muebles' }, { v: 'habitacional_amueblada', l: 'Casa amueblada' }, { v: 'comercial', l: 'Comercial' }].map(opt => (
              <button key={opt.v} type="button" onClick={() => set('tipo_contrato', opt.v)}
                style={{ ...st.btn, ...(form.tipo_contrato === opt.v ? st.btnGold : st.btnGhost), padding: '7px 14px', fontSize: 12 }}>
                {opt.l}
              </button>
            ))}
          </div>
        </div>

        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Arrendador (Dueño)</p>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Nombre completo</label><input type="text" defaultValue={form.nombre_arrendador || ''} data-field='nombre_arrendador' style={st.input} /></div>
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

        <div style={{ ...st.divider, margin: '16px 0' }} />

        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Arrendatario (Inquilino)</p>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Nombre completo</label><input type="text" defaultValue={form.nombre_arrendatario || ''} data-field='nombre_arrendatario' style={st.input} /></div>
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

        <div style={{ ...st.divider, margin: '16px 0' }} />

        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inmueble</p>
        <div style={{ marginBottom: 14 }}><label style={st.label}>Dirección completa</label><input type="text" defaultValue={form.direccion_inmueble || ''} data-field='direccion_inmueble' style={st.input} /></div>
        <div style={{ marginBottom: 14 }}><label style={st.label}>Ciudad y estado</label><input type="text" defaultValue={form.ciudad_estado_inmueble || ''} data-field='ciudad_estado_inmueble' style={st.input} /></div>

        <div style={{ ...st.divider, margin: '16px 0' }} />

        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Condiciones económicas</p>
        <div style={st.grid3}>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Renta mensual $</label><input type="number" defaultValue={form.renta_mensual || ''} data-field='renta_mensual' style={st.input} /></div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Cuota mantenimiento $</label><input type="number" defaultValue={form.cuota_mantenimiento || ''} data-field='cuota_mantenimiento' style={st.input} /></div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Depósito en garantía $</label><input type="number" defaultValue={form.deposito_garantia || ''} data-field='deposito_garantia' style={st.input} /></div>
        </div>
        <div style={st.grid3}>
          <div style={{ marginBottom: 14 }}>
            <label style={st.label}>Mora diaria 1% $</label>
            <input type="number" value={form.mora_diaria || (parseFloat(form.renta_mensual) * 0.01).toFixed(2) || ''} onChange={e => set('mora_diaria', e.target.value)} style={st.input} />
          </div>
          <div>
            <label style={st.label}>Forma de pago</label>
            <select value={form.forma_pago} onChange={e => set('forma_pago', e.target.value)} style={st.input}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="deposito">Depósito</option>
            </select>
          </div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Banco receptor</label><input type="text" defaultValue={form.banco_receptor || ''} data-field='banco_receptor' style={st.input} /></div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Día límite de pago</label><input type="number" defaultValue={form.dia_limite_pago || ''} data-field='dia_limite_pago' style={st.input} /></div>
        </div>
        {(form.forma_pago === 'transferencia' || form.forma_pago === 'deposito') && (
          <div style={{ marginBottom: 14 }}><label style={st.label}>CLABE interbancaria</label><input type="text" defaultValue={form.clabe_interbancaria || ''} data-field='clabe_interbancaria' style={st.input} /></div>
        )}
        <div style={{ marginBottom: 14 }}><label style={st.label}>Monto de póliza $</label><input type="number" defaultValue={form.monto_poliza || ''} data-field='monto_poliza' style={st.input} /></div>

        <div style={{ ...st.divider, margin: '16px 0' }} />

        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Fechas</p>
        <div style={st.grid3}>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Fecha de inicio</label><input type="date" defaultValue={form.fecha_inicio || ''} data-field='fecha_inicio' onChange={e => set('fecha_inicio', e.target.value)} style={st.input} /></div>
          <div>
            <label style={st.label}>Fecha de término (1 año)</label>
            <input value={fechaTermino} readOnly style={{ ...st.input, color: C.muted, cursor: 'not-allowed' }} />
          </div>
          <div style={{ marginBottom: 14 }}><label style={st.label}>Entrega de posesión</label><input type="date" defaultValue={form.fecha_entrega_posesion || ''} data-field='fecha_entrega_posesion' style={st.input} /></div>
        </div>
        <div style={{ marginBottom: 14 }}><label style={st.label}>Fecha de firma del contrato</label><input type="date" defaultValue={form.fecha_firma || ''} data-field='fecha_firma' style={st.input} /></div>

        <div style={{ ...st.divider, margin: '16px 0' }} />
        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>⏰ Vigencia del contrato</p>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
            <label style={st.label}>Duración del contrato</label>
            <select value={form.duracion_contrato_meses} onChange={e => set('duracion_contrato_meses', parseInt(e.target.value))} style={st.input}>
              <option value={6}>6 meses</option>
              <option value={12}>12 meses (1 año)</option>
              <option value={24}>24 meses (2 años)</option>
              <option value={36}>36 meses (3 años)</option>
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={st.label}>Fecha de vencimiento (calculada)</label>
            <input value={fechaVigenciaCalc ? fmtDate(fechaVigenciaCalc) : '— Selecciona fecha de inicio —'} readOnly
              style={{ ...st.input, color: fechaVigenciaCalc ? C.goldText : C.faint, cursor: 'not-allowed', fontWeight: fechaVigenciaCalc ? 700 : 400 }} />
            <p style={{ margin: '4px 0 0', fontSize: 10, color: C.faint }}>Recordatorios automáticos 60 y 30 días antes</p>
          </div>
        </div>

        {form.fecha_inicio && (
          <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 16px', marginTop: 8, marginBottom: 16 }}>
            <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.muted }}>PAGARÉS — 12 fechas calculadas automáticamente</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Object.entries(calcularPagares(form.fecha_inicio)).map(([k, v]) => (
                <span key={k} style={{ background: '#f3f4f6', border: `1px solid ${C.border}`, borderRadius: 6, padding: '3px 10px', fontSize: 11, color: C.muted }}>{fmtDate(v)}</span>
              ))}
            </div>
          </div>
        )}

        <div style={{ ...st.divider, margin: '16px 0' }} />

        <div style={st.grid2}>
          <div>
            <label style={st.label}>Mascotas permitidas</label>
            <select value={form.mascotas_permitidas} onChange={e => set('mascotas_permitidas', e.target.value)} style={st.input}>
              <option value="no">No</option>
              <option value="si">Sí</option>
              <option value="condicionado">Condicionado</option>
            </select>
          </div>
          {form.mascotas_permitidas !== 'no' && (
            <div style={{ marginBottom: 14 }}><label style={st.label}>Detalle mascotas</label><input type="text" defaultValue={form.detalle_mascotas || ''} data-field='detalle_mascotas' style={st.input} /></div>
          )}
        </div>

        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" id="admin" checked={form.incluye_administracion} onChange={e => set('incluye_administracion', e.target.checked)} style={{ accentColor: C.gold, width: 16, height: 16 }} />
          <label htmlFor="admin" style={{ fontSize: 13, color: C.muted, cursor: 'pointer' }}>Incluye contrato de administración</label>
        </div>

        {msg && <p style={{ color: C.redText, fontSize: 13, margin: '16px 0 0' }}>{msg}</p>}

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 28 }}>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{ ...st.btn, ...st.btnGold, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Guardando...' : 'Crear expediente'}
          </button>
        </div>
      </div>
    </div>
  )
}
