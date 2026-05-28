import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { generarContratoPromocionArrendamiento } from '../../lib/generarContratoPromocionArrendamiento'
import { C, st, InfoRow, fmt, Badge } from '../../lib/polizaUtils'

export default function ModalPropietario({ propietario: p, onClose, onSaved, onNuevoExp }) {
  const [status, setStatus] = useState(p.status || 'activo')
  const [saving, setSaving] = useState(false)
  const [generando, setGenerando] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await supabase.from('propietarios_inmuebles').update({ status }).eq('id', p.id)
    setSaving(false)
    onSaved()
  }

  const handleGenerarPromocion = async () => {
    setGenerando(true)
    try {
      await generarContratoPromocionArrendamiento({ nombre_arrendador: p.nombre_propietario, domicilio_arrendador: p.domicilio_propietario, telefono_arrendador: p.telefono_propietario, direccion_inmueble: p.direccion_inmueble, renta_mensual: p.monto_renta, renta_mensual_letra: p.monto_renta_letra })
    } catch(e) { alert('Error: ' + e.message) }
    setGenerando(false)
  }

  return (
    <div style={st.modal} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={st.modalCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text, fontFamily: 'Georgia, serif' }}>{p.nombre_propietario}</h2>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>✕</button>
        </div>
        <div style={st.grid2}>
          <InfoRow label="Teléfono" value={p.telefono_propietario} />
          <InfoRow label="Correo" value={p.correo_propietario} />
          <InfoRow label="RFC" value={p.rfc_propietario} />
          <InfoRow label="Renta" value={fmt(p.monto_renta)} />
        </div>
        <InfoRow label="Inmueble" value={p.direccion_inmueble} />
        <div style={{ ...st.divider, margin: '16px 0' }} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <label style={st.label}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={st.input}>
              <option value="activo">Activo</option>
              <option value="rentado">Rentado</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </div>
          <div style={{ paddingTop: 18 }}>
            <button onClick={handleSave} disabled={saving} style={{ ...st.btn, ...st.btnGold }}>
              {saving ? 'Guardando...' : 'Actualizar'}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24, flexWrap: 'wrap' }}>
          <button onClick={handleGenerarPromocion} disabled={generando} style={{ ...st.btn, background: '#f5f3ff', color: '#7c3aed', border: '1px solid #c4b5fd', opacity: generando ? 0.6 : 1 }}>
            {generando ? 'Generando...' : '📄 Contrato promoción'}
          </button>
          <button onClick={onNuevoExp} style={{ ...st.btn, ...st.btnGold }}>+ Crear expediente</button>
        </div>
      </div>
    </div>
  )
}
