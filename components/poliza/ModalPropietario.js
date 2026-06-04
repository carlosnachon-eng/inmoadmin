import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { generarContratoPromocionArrendamiento } from '../../lib/generarContratoPromocionArrendamiento'
import { C, st, InfoRow, fmt } from '../../lib/polizaUtils'

const DocChip = ({ label, data, path }) => {
  const handleView = async () => {
    if (data) {
      const win = window.open()
      win.document.write(`<iframe src="${data}" width="100%" height="100%" style="border:none"></iframe>`)
    } else if (path) {
      const { data: d } = await supabase.storage.from('poliza-docs').createSignedUrl(path, 60)
      if (d?.signedUrl) window.open(d.signedUrl, '_blank')
    }
  }
  return (
    <button onClick={handleView} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#f9fafb', color: C.text, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
      📄 {label}
    </button>
  )
}

export default function ModalPropietario({ propietario: p, onClose, onSaved, onNuevoExp }) {
  const [status, setStatus] = useState(p.status || 'activo')
  const [saving, setSaving] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [detalle, setDetalle] = useState(null)
  const [cargandoDocs, setCargandoDocs] = useState(true)

  useEffect(() => {
    const cargarDetalle = async () => {
      setCargandoDocs(true)
      const { data } = await supabase
        .from('propietarios_inmuebles')
        .select('*')
        .eq('id', p.id)
        .single()
      setDetalle(data)
      setCargandoDocs(false)
    }
    cargarDetalle()
  }, [p.id])

  const prop = detalle || p

  const handleSave = async () => {
    setSaving(true)
    await supabase.from('propietarios_inmuebles').update({ status }).eq('id', p.id)
    setSaving(false)
    onSaved()
  }

  const handleGenerarPromocion = async () => {
    setGenerando(true)
    try {
      await generarContratoPromocionArrendamiento({
        nombre_arrendador: prop.nombre_propietario,
        domicilio_arrendador: prop.domicilio_propietario,
        telefono_arrendador: prop.telefono_propietario,
        direccion_inmueble: prop.direccion_inmueble,
        renta_mensual: prop.monto_renta,
        renta_mensual_letra: prop.monto_renta_letra
      })
    } catch(e) { alert('Error: ' + e.message) }
    setGenerando(false)
  }

  // URL para Veridada con datos prellenados (solo Emporio)
  const urlVeridada = `https://veridada.mx/inmobiliaria?source=emporio&key=emporio2026&direccion=${encodeURIComponent(prop.direccion_inmueble || '')}&municipio=${encodeURIComponent(prop.municipio || '')}&precio=${prop.monto_renta || ''}&operacion=renta&tipo=${encodeURIComponent(prop.tipo_inmueble || 'casa')}`

  const tieneDocs = prop.doc_identificacion_b64 || prop.doc_comprobante_domicilio_b64 || prop.doc_predial_b64 || prop.doc_escritura_b64

  return (
    <div style={st.modal} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={st.modalCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text, fontFamily: 'Georgia, serif' }}>{prop.nombre_propietario}</h2>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>✕</button>
        </div>

        <div style={st.grid2}>
          <InfoRow label="Teléfono" value={prop.telefono_propietario} />
          <InfoRow label="Correo" value={prop.correo_propietario} />
          <InfoRow label="RFC" value={prop.rfc_propietario} />
          <InfoRow label="Renta" value={fmt(prop.monto_renta)} />
        </div>
        <InfoRow label="Inmueble" value={prop.direccion_inmueble} />
        <InfoRow label="Domicilio del propietario" value={prop.domicilio_propietario} />

        {prop.forma_pago && (
          <div style={st.grid2}>
            <InfoRow label="Forma de pago" value={prop.forma_pago} />
            <InfoRow label="Banco" value={prop.banco} />
          </div>
        )}
        {prop.clabe && <InfoRow label="CLABE" value={prop.clabe} />}

        {/* Documentos */}
        <div style={{ ...st.divider, margin: '16px 0' }} />
        <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.3px' }}>Documentos</p>
        {cargandoDocs ? (
          <p style={{ fontSize: 12, color: C.muted }}>Cargando documentos...</p>
        ) : tieneDocs ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {prop.doc_identificacion_b64 && <DocChip label="Identificación" data={prop.doc_identificacion_b64?.startsWith('data:') ? prop.doc_identificacion_b64 : null} path={!prop.doc_identificacion_b64?.startsWith('data:') ? prop.doc_identificacion_b64 : null} />}
            {prop.doc_comprobante_domicilio_b64 && <DocChip label="Comprobante domicilio" data={prop.doc_comprobante_domicilio_b64?.startsWith('data:') ? prop.doc_comprobante_domicilio_b64 : null} path={!prop.doc_comprobante_domicilio_b64?.startsWith('data:') ? prop.doc_comprobante_domicilio_b64 : null} />}
            {prop.doc_predial_b64 && <DocChip label="Predial" data={prop.doc_predial_b64?.startsWith('data:') ? prop.doc_predial_b64 : null} path={!prop.doc_predial_b64?.startsWith('data:') ? prop.doc_predial_b64 : null} />}
            {prop.doc_escritura_b64 && <DocChip label="Escritura" data={prop.doc_escritura_b64?.startsWith('data:') ? prop.doc_escritura_b64 : null} path={!prop.doc_escritura_b64?.startsWith('data:') ? prop.doc_escritura_b64 : null} />}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: C.faint }}>Sin documentos adjuntos</p>
        )}

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
          <button onClick={handleGenerarPromocion} disabled={generando}
            style={{ ...st.btn, background: '#f5f3ff', color: '#7c3aed', border: '1px solid #c4b5fd', opacity: generando ? 0.6 : 1 }}>
            {generando ? 'Generando...' : '📄 Contrato promoción'}
          </button>
          <button onClick={onNuevoExp} style={{ ...st.btn, ...st.btnGold }}>
            + Crear expediente
          </button>
          <a
            href={urlVeridada}
            target="_blank"
            rel="noreferrer"
            style={{ ...st.btn, background: '#1a1a2e', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            🛡️ Enviar a Veridada
          </a>
        </div>
      </div>
    </div>
  )
}
