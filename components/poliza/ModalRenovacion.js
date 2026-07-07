import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { C, st, fmt, fmtDate, calcularPagares, calcularFechaVigencia, numeroALetra } from '../../lib/polizaUtils'

export default function ModalRenovacion({ expediente: e, onClose, onSaved }) {
  const rentaActual = parseFloat(e.renta_mensual) || 0
  const [porcentaje, setPorcentaje] = useState(5)
  const [fechaInicio, setFechaInicio] = useState(() => {
    if (!e.fecha_vigencia) return ''
    const d = new Date(e.fecha_vigencia + 'T12:00:00')
    d.setDate(d.getDate() + 1)
    return d.toISOString().split('T')[0]
  })
  const [duracion, setDuracion] = useState(e.duracion_contrato_meses || 12)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const nuevaRenta = Math.round(rentaActual * (1 + porcentaje / 100))
  const fechaVigencia = fechaInicio ? calcularFechaVigencia(fechaInicio, duracion) : ''

  const handleRenovar = async () => {
    if (!fechaInicio) { setMsg('Selecciona la fecha de inicio'); return }
    setSaving(true)
    setMsg('')
    try {
      // Verificar si ya existe una renovación activa para este arrendatario
      const { data: existing } = await supabase
        .from('poliza_expedientes')
        .select('id')
        .eq('nombre_arrendatario', e.nombre_arrendatario)
        .eq('status', 'activo')
        .neq('id', e.id)
      if (existing && existing.length > 0) {
        setMsg('Ya existe un expediente activo para este arrendatario. No se puede renovar dos veces.')
        setSaving(false)
        return
      }
      const pagares = calcularPagares(fechaInicio)
      const dep = nuevaRenta
      const mora = parseFloat((nuevaRenta * 0.01).toFixed(2))

      const { id, created_at, updated_at, diasRestantes, propietarios_inmuebles, ...resto } = e
      const nuevoExpediente = {
        ...resto,
        renta_mensual: nuevaRenta,
        renta_mensual_letra: numeroALetra(nuevaRenta),
        deposito_garantia: dep,
        deposito_garantia_letra: numeroALetra(dep),
        mora_diaria: mora,
        mora_diaria_letra: numeroALetra(mora),
        fecha_inicio: fechaInicio,
        fecha_vigencia: fechaVigencia,
        fecha_termino: fechaVigencia,
        duracion_contrato_meses: duracion,
        status: 'activo',
        status_expediente: 'borrador',
        anticipo_pagado: false,
        saldo_pagado: false,
        recordatorio_30_enviado: false,
        recordatorio_60_enviado: false,
        fecha_ultimo_recordatorio: null,
        expediente_anterior_id: e.id,
        ...pagares,
      }

      const { error: errorInsert } = await supabase
        .from('poliza_expedientes')
        .insert(nuevoExpediente)
      if (errorInsert) throw errorInsert

      await supabase
        .from('poliza_expedientes')
        .update({ status: 'vencido' })
        .eq('id', e.id)

      onSaved()
    } catch (err) {
      setMsg('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={st.modal} onClick={ev => ev.target === ev.currentTarget && onClose()}>
      <div style={{ ...st.modalCard, maxWidth: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text, fontFamily: 'Georgia, serif' }}>Renovar contrato</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: C.muted }}>{e.nombre_arrendatario} · {e.direccion_inmueble}</p>
          </div>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>✕</button>
        </div>

        <div style={{ background: '#f9fafb', border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 18px', marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase' }}>Renta actual</p>
          <p style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800, color: C.text }}>{fmt(rentaActual)}</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>Vigencia actual: {fmtDate(e.fecha_vigencia)}</p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={st.label}>% de incremento</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {[0, 3, 4, 5, 6, 8, 10].map(p => (
              <button key={p} onClick={() => setPorcentaje(p)}
                style={{ flex: 1, padding: '7px 4px', borderRadius: 8, border: `1px solid ${porcentaje === p ? C.gold : C.border}`, background: porcentaje === p ? C.goldLight : '#f9fafb', color: porcentaje === p ? C.goldText : C.muted, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                {p}%
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="number" value={porcentaje} onChange={e => setPorcentaje(parseFloat(e.target.value) || 0)}
              style={{ ...st.input, width: 80 }} min={0} max={50} step={0.1} />
            <span style={{ fontSize: 12, color: C.muted }}>% personalizado</span>
          </div>
        </div>

        <div style={{ background: C.goldLight, border: `1px solid #fecdd3`, borderRadius: 10, padding: '14px 18px', marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 11, color: C.goldText, fontWeight: 700, textTransform: 'uppercase' }}>Nueva renta</p>
          <p style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 800, color: C.goldText }}>{fmt(nuevaRenta)}</p>
          {porcentaje > 0 && (
            <p style={{ margin: '2px 0 0', fontSize: 11, color: C.goldText }}>
              +{fmt(nuevaRenta - rentaActual)} respecto a renta actual
            </p>
          )}
        </div>

        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
            <label style={st.label}>Nueva fecha de inicio</label>
            <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} style={st.input} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={st.label}>Duración</label>
            <select value={duracion} onChange={e => setDuracion(parseInt(e.target.value))} style={st.input}>
              <option value={6}>6 meses</option>
              <option value={12}>12 meses (1 año)</option>
              <option value={24}>24 meses (2 años)</option>
              <option value={36}>36 meses (3 años)</option>
            </select>
          </div>
        </div>

        {fechaVigencia && (
          <div style={{ background: C.greenBg, border: `1px solid #6ee7b7`, borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 12, color: C.greenText }}>
              ✅ Nuevo vencimiento: <strong>{fmtDate(fechaVigencia)}</strong>
            </p>
          </div>
        )}

        {msg && <p style={{ color: C.redText, fontSize: 13, margin: '12px 0' }}>{msg}</p>}

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>Cancelar</button>
          <button onClick={handleRenovar} disabled={saving}
            style={{ ...st.btn, ...st.btnGold, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Renovando...' : '🔄 Confirmar renovación'}
          </button>
        </div>
      </div>
    </div>
  )
}
