import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { C, st, fmt } from '../../lib/polizaUtils'
import { PARTNER_STATUS, calcCommission, COMMISSION_RATE } from '../../lib/partners'

const statusOptions = Object.entries(PARTNER_STATUS)

export default function TabPartners({ operaciones, onReload }) {
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)

  const saveSelected = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const payload = {
        status_partner: selected.status_partner,
        observaciones_publicas: selected.observaciones_publicas || null,
        observaciones_internas: selected.observaciones_internas || null,
        monto_poliza_final: selected.monto_poliza_final === '' ? null : Number(selected.monto_poliza_final) || null,
        updated_at: new Date().toISOString(),
      }
      await supabase.from('partner_operations').update(payload).eq('id', selected.id)
      setSelected(null)
      onReload()
    } finally {
      setSaving(false)
    }
  }

  const generarComision = async (op) => {
    const base = Number(op.monto_poliza_final || op.monto_poliza_estimado) || 0
    if (!base) {
      alert('Captura monto final o estimado de poliza antes de generar comision.')
      return
    }
    const rate = Number(op.commission_rate || COMMISSION_RATE)
    const amount = calcCommission(base, rate)
    await supabase.from('partner_operations').update({
      status_partner: 'activa',
      monto_poliza_final: base,
      commission_generated: amount,
      commission_generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', op.id)
    onReload()
  }

  const marcarPagada = async (op) => {
    const amount = Number(op.commission_generated) || 0
    if (!amount) {
      alert('Primero genera la comision.')
      return
    }
    await supabase.from('partner_operations').update({
      commission_paid: amount,
      commission_paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', op.id)
    onReload()
  }

  if (!operaciones?.length) return (
    <div style={st.emptyState}>
      <p style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Sin operaciones de partners</p>
      <p>Cuando una inmobiliaria aliada envie una operacion aparecera aqui.</p>
    </div>
  )

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <p style={st.sectionTitle}>Operaciones de inmobiliarias aliadas</p>
        <p style={st.sectionSub}>Seguimiento operativo visible para partners. El trabajo juridico sigue en el flujo normal de Poliza.</p>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {operaciones.map(op => (
          <div key={op.id} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, color: C.text, fontSize: 15, fontWeight: 800 }}>{op.nombre_inquilino || 'Inquilino pendiente'}</p>
                <p style={{ margin: '3px 0 0', color: C.muted, fontSize: 12 }}>{op.direccion_inmueble || '-'} · {op.folio || op.id.slice(0, 8).toUpperCase()}</p>
                <p style={{ margin: '5px 0 0', color: C.muted, fontSize: 11 }}>
                  Partner: <strong>{op.partner_agencies?.nombre_comercial || 'Aliado'}</strong> · Propietario: {op.nombre_propietario || '-'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span style={{ background: '#f3f4f6', borderRadius: 999, padding: '5px 9px', fontSize: 11, fontWeight: 800, color: C.muted }}>
                  {PARTNER_STATUS[op.status_partner]?.label || op.status_partner}
                </span>
                <button onClick={() => setSelected(op)} style={{ ...st.btn, ...st.btnGhost, padding: '7px 12px', fontSize: 12 }}>Gestionar</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 14 }}>
              <Mini label="Poliza" value={fmt(op.monto_poliza_final || op.monto_poliza_estimado)} />
              <Mini label="Comision estimada" value={fmt(op.commission_estimated)} />
              <Mini label="Comision generada" value={fmt(op.commission_generated)} />
              <Mini label="Comision pagada" value={fmt(op.commission_paid)} />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {op.solicitud_inquilino_id && (
                <button onClick={() => window.open(`/poliza/solicitud/${op.solicitud_inquilino_id}`, '_blank')} style={{ ...st.btn, padding: '7px 12px', fontSize: 12, background: C.blueBg, color: C.blueText }}>
                  Ver solicitud
                </button>
              )}
              <button onClick={() => generarComision(op)} style={{ ...st.btn, padding: '7px 12px', fontSize: 12, ...st.btnGreen }}>
                Generar comision
              </button>
              <button onClick={() => marcarPagada(op)} style={{ ...st.btn, padding: '7px 12px', fontSize: 12, ...st.btnGold }}>
                Marcar pagada
              </button>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div style={st.modal} onClick={e => e.target === e.currentTarget && setSelected(null)}>
          <div style={{ ...st.modalCard, maxWidth: 720 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
              <div>
                <h2 style={{ margin: 0, color: C.text, fontSize: 20 }}>{selected.nombre_inquilino || 'Operacion partner'}</h2>
                <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 12 }}>{selected.partner_agencies?.nombre_comercial || 'Aliado'}</p>
              </div>
              <button onClick={() => setSelected(null)} style={{ ...st.btn, ...st.btnGhost }}>x</button>
            </div>

            <div style={st.grid2}>
              <div>
                <label style={st.label}>Status visible al partner</label>
                <select value={selected.status_partner || 'recibida'} onChange={e => setSelected(s => ({ ...s, status_partner: e.target.value }))} style={st.input}>
                  {statusOptions.map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
                </select>
              </div>
              <div>
                <label style={st.label}>Monto final poliza</label>
                <input type="number" value={selected.monto_poliza_final || ''} onChange={e => setSelected(s => ({ ...s, monto_poliza_final: e.target.value }))} style={st.input} />
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={st.label}>Observaciones visibles al partner</label>
              <textarea value={selected.observaciones_publicas || ''} onChange={e => setSelected(s => ({ ...s, observaciones_publicas: e.target.value }))} rows={4} style={{ ...st.input, resize: 'vertical' }} />
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={st.label}>Notas internas Emporio</label>
              <textarea value={selected.observaciones_internas || ''} onChange={e => setSelected(s => ({ ...s, observaciones_internas: e.target.value }))} rows={3} style={{ ...st.input, resize: 'vertical' }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setSelected(null)} style={{ ...st.btn, ...st.btnGhost }}>Cancelar</button>
              <button onClick={saveSelected} disabled={saving} style={{ ...st.btn, ...st.btnGold, opacity: saving ? .6 : 1 }}>{saving ? 'Guardando...' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Mini({ label, value }) {
  return (
    <div style={{ background: '#f9fafb', borderRadius: 8, padding: 10 }}>
      <p style={{ margin: '0 0 4px', color: C.muted, fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>{label}</p>
      <p style={{ margin: 0, color: C.text, fontSize: 14, fontWeight: 800 }}>{value}</p>
    </div>
  )
}
