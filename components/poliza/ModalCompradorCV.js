import { C, st, InfoRow, fmt } from '../../lib/polizaUtils'

export default function ModalCompradorCV({ comprador: comp, onClose, onSaved }) {
  return (
    <div style={st.modal} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={st.modalCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text, fontFamily: 'Georgia, serif' }}>{comp.nombre_comprador}</h2>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>✕</button>
        </div>
        <div style={st.grid2}>
          <InfoRow label="Celular" value={comp.celular_comprador} />
          <InfoRow label="Correo" value={comp.correo_comprador} />
          <InfoRow label="RFC" value={comp.rfc_comprador} />
          <InfoRow label="CURP" value={comp.curp_comprador} />
          <InfoRow label="Inmueble de interés" value={comp.inmueble_interes} />
          <InfoRow label="Precio pactado" value={fmt(comp.precio_pactado)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}
