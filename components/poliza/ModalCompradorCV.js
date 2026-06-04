import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
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

export default function ModalCompradorCV({ comprador: comp, onClose, onSaved }) {
  const [detalle, setDetalle] = useState(null)
  const [cargandoDocs, setCargandoDocs] = useState(true)

  useEffect(() => {
    const cargarDetalle = async () => {
      setCargandoDocs(true)
      const { data } = await supabase
        .from('compradores')
        .select('*')
        .eq('id', comp.id)
        .single()
      setDetalle(data)
      setCargandoDocs(false)
    }
    cargarDetalle()
  }, [comp.id])

  const c = detalle || comp

  const tieneDocs =
    c.doc_identificacion_b64 || c.doc_identificacion ||
    c.doc_comprobante_ingresos_b64 || c.doc_comprobante_ingresos

  return (
    <div style={st.modal} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={st.modalCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text, fontFamily: 'Georgia, serif' }}>{c.nombre_comprador}</h2>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>✕</button>
        </div>

        <div style={st.grid2}>
          <InfoRow label="Celular" value={c.celular_comprador} />
          <InfoRow label="Correo" value={c.correo_comprador} />
          <InfoRow label="RFC" value={c.rfc_comprador} />
          <InfoRow label="CURP" value={c.curp_comprador} />
          <InfoRow label="Inmueble de interés" value={c.inmueble_interes} />
          <InfoRow label="Precio pactado" value={fmt(c.precio_pactado)} />
        </div>

        <div style={{ ...st.divider, margin: '16px 0' }} />
        <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.3px' }}>Documentos</p>

        {cargandoDocs ? (
          <p style={{ fontSize: 12, color: C.muted }}>Cargando documentos...</p>
        ) : tieneDocs ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(c.doc_identificacion_b64 || c.doc_identificacion) && (
              <DocChip
                label="Identificación"
                data={c.doc_identificacion_b64?.startsWith('data:') ? c.doc_identificacion_b64 : null}
                path={!c.doc_identificacion_b64?.startsWith('data:') ? (c.doc_identificacion_b64 || c.doc_identificacion) : null}
              />
            )}
            {(c.doc_comprobante_ingresos_b64 || c.doc_comprobante_ingresos) && (
              <DocChip
                label="Comprobante de ingresos"
                data={c.doc_comprobante_ingresos_b64?.startsWith('data:') ? c.doc_comprobante_ingresos_b64 : null}
                path={!c.doc_comprobante_ingresos_b64?.startsWith('data:') ? (c.doc_comprobante_ingresos_b64 || c.doc_comprobante_ingresos) : null}
              />
            )}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: C.faint }}>Sin documentos adjuntos</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}
