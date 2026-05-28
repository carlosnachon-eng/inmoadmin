import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { C, st, InfoRow, fmt, Badge } from '../../lib/polizaUtils'

export default function ModalSolicitud({ solicitud: sol, onClose, onSaved, onNuevoExp }) {
  const [status, setStatus] = useState(sol.status || 'pendiente')
  const [notas, setNotas] = useState(sol.notas_juridico || '')
  const [saving, setSaving] = useState(false)
  const [cobrando, setCobrando] = useState(false)
  const [metodoInv, setMetodoInv] = useState('efectivo')

  const handleSave = async () => {
    setSaving(true)
    await supabase.from('solicitudes_inquilino').update({ status, notas_juridico: notas }).eq('id', sol.id)
    setSaving(false)
    onSaved()
  }

  const handleCobrarInvestigacion = async () => {
    setCobrando(true)
    const monto = 1000
    await supabase.from('poliza_caja').insert({ tipo: 'ingreso', concepto: 'investigacion', descripcion: `Cobro de investigación — ${sol.nombre_completo || sol.razon_social}`, monto, metodo_pago: metodoInv, solicitud_id: sol.id, nombre_cliente: sol.nombre_completo || sol.razon_social, fecha: new Date().toISOString().split('T')[0] })
    await supabase.from('solicitudes_inquilino').update({ cobro_investigacion: true, fecha_cobro_investigacion: new Date().toISOString().split('T')[0], monto_investigacion: monto, metodo_cobro_investigacion: metodoInv }).eq('id', sol.id)
    setCobrando(false)
    onSaved()
  }

  return (
    <div style={st.modal} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={st.modalCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text, fontFamily: 'Georgia, serif' }}>{sol.nombre_completo || sol.razon_social}</h2>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>✕</button>
        </div>
        <div style={st.grid2}>
          <InfoRow label="Teléfono" value={sol.telefono} />
          <InfoRow label="Correo" value={sol.correo} />
          <InfoRow label="Ingresos mensuales" value={fmt(sol.ingresos_mensuales || sol.ingresos_empresa)} />
          <InfoRow label="Tipo de ingresos" value={sol.tipo_ingresos} />
        </div>
        <InfoRow label="Inmueble de interés" value={sol.inmueble_interes} />
        <button onClick={() => window.open(`/poliza/solicitud/${sol.id}`, '_blank')} style={{ ...st.btn, width: '100%', background: C.blueBg, color: C.blueText, border: '1px solid #93c5fd', marginBottom: 16, marginTop: 8 }}>🔍 Ver ficha completa del solicitante →</button>
        <div style={{ ...st.divider, margin: '16px 0' }} />
        <div style={st.grid2}>
          <div>
            <label style={st.label}>Status de la solicitud</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={st.input}>
              <option value="pendiente">Pendiente</option>
              <option value="en_revision">En revisión</option>
              <option value="aprobado">Aprobado</option>
              <option value="rechazado">Rechazado</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <label style={st.label}>Notas jurídicas internas</label>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={3} style={{ ...st.input, resize: 'vertical' }} />
        </div>
        {status === 'rechazado' && !sol.cobro_investigacion && (
          <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '14px 16px', marginTop: 16 }}>
            <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: C.redText }}>💰 Cobrar investigación ($1,000)</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={metodoInv} onChange={e => setMetodoInv(e.target.value)} style={{ ...st.input, width: 'auto', fontSize: 12, padding: '6px 10px' }}>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
              </select>
              <button onClick={handleCobrarInvestigacion} disabled={cobrando} style={{ ...st.btn, background: C.red, color: '#fff', opacity: cobrando ? 0.6 : 1 }}>
                {cobrando ? 'Registrando...' : 'Registrar cobro $1,000'}
              </button>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24, flexWrap: 'wrap' }}>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{ ...st.btn, ...st.btnGreen }}>
            {saving ? 'Guardando...' : 'Guardar notas'}
          </button>
          {status === 'aprobado' && (
            <button onClick={onNuevoExp} style={{ ...st.btn, ...st.btnGold }}>+ Crear expediente</button>
          )}
        </div>
      </div>
    </div>
  )
}
