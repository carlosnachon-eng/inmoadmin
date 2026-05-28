import React, { useState } from 'react'
import { generarContratoPromocion } from '../../lib/generarContratoPromocion'
import { generarPromesaCompraventa } from '../../lib/generarPromesaCompraventa'
import { C, st, InfoRow, fmt } from '../../lib/polizaUtils'
import ModalPromesaCV from './ModalPromesaCV'

export default function ModalVendedorCV({ vendedor: v, onClose, onSaved, compradores = [] }) {
  const [generando, setGenerando] = useState(false)
  const [showPromesaForm, setShowPromesaForm] = React.useState(false)

  const handleGenerarPromocion = async () => {
    setGenerando('promocion')
    try {
      await generarContratoPromocion({ nombre_arrendador: v.nombre_propietario, domicilio_arrendador: v.domicilio_propietario, telefono_arrendador: v.telefono_propietario, direccion_inmueble: v.direccion_inmueble, renta_mensual: v.precio_venta })
    } catch(e) { alert('Error: ' + e.message) }
    setGenerando(false)
  }

  const generarPromesaFinal = async (formData) => {
    setGenerando('promesacv')
    setShowPromesaForm(false)
    try {
      await generarPromesaCompraventa({
        nombre_vendedor: v.nombre_propietario, domicilio_vendedor: v.domicilio_propietario,
        telefono_vendedor: v.telefono_propietario, curp_vendedor: formData.curp_vendedor,
        rfc_vendedor: v.rfc_propietario, credencial_vendedor: formData.credencial_vendedor,
        nombre_comprador: formData.nombre_comprador, domicilio_comprador: formData.domicilio_comprador,
        curp_comprador: formData.curp_comprador, rfc_comprador: formData.rfc_comprador,
        credencial_comprador: formData.credencial_comprador, direccion_inmueble: v.direccion_inmueble,
        superficie: formData.superficie, volumen_escritura: formData.volumen_escritura,
        instrumento_escritura: formData.instrumento_escritura, fecha_escritura: formData.fecha_escritura,
        notario: formData.notario, notaria: formData.notaria, cuenta_predial: formData.cuenta_predial,
        precio_total: v.precio_venta, precio_total_letras: formData.precio_total_letras,
        tipo_credito: formData.tipo_credito, nombre_banco: formData.nombre_banco,
        pago1_monto: formData.pago1_monto, pago1_letras: formData.pago1_letras, pago1_fecha: formData.pago1_fecha,
        pago2_monto: formData.tiene_pago2 ? formData.pago2_monto : null, pago2_letras: formData.pago2_letras, pago2_fecha: formData.pago2_fecha,
        pago3_monto: formData.pago3_monto, pago3_letras: formData.pago3_letras, pago3_fecha: formData.pago3_fecha,
        pena_convencional: formData.pena_convencional, pena_letras: formData.pena_letras,
        gravamen: v.libre_gravamen ? '' : (v.institucion_gravamen || 'hipoteca'),
        fecha_firma: formData.fecha_firma,
      })
    } catch(e) { alert('Error: ' + e.message) }
    setGenerando(false)
  }

  return (
    <div style={st.modal} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={st.modalCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text, fontFamily: 'Georgia, serif' }}>{v.nombre_propietario}</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: C.muted }}>{v.tipo_persona_propietario === 'moral' ? `Persona moral — ${v.razon_social_propietario}` : 'Persona física'}</p>
          </div>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>✕</button>
        </div>
        <div style={st.grid2}>
          <InfoRow label="Teléfono" value={v.telefono_propietario} />
          <InfoRow label="Correo" value={v.correo_propietario} />
          <InfoRow label="RFC" value={v.rfc_propietario} />
          <InfoRow label="Precio de venta" value={fmt(v.precio_venta)} />
        </div>
        <InfoRow label="Dirección del inmueble" value={v.direccion_inmueble} />
        <InfoRow label="Domicilio del propietario" value={v.domicilio_propietario} />
        <div style={{ ...st.divider, margin: '16px 0' }} />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={handleGenerarPromocion} disabled={!!generando}
            style={{ ...st.btn, background: '#f5f3ff', color: '#7c3aed', border: '1px solid #c4b5fd', opacity: generando ? 0.6 : 1 }}>
            {generando === 'promocion' ? 'Generando...' : '📄 Contrato de promoción'}
          </button>
          <button onClick={() => setShowPromesaForm(true)} disabled={!!generando}
            style={{ ...st.btn, background: '#f0fdf4', color: C.greenText, border: `1px solid #6ee7b7`, opacity: generando ? 0.6 : 1 }}>
            {generando === 'promesacv' ? 'Generando...' : '🖹 Promesa de compraventa'}
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>Cerrar</button>
        </div>
      </div>
      {showPromesaForm && <ModalPromesaCV vendedor={v} compradores={compradores} onClose={() => setShowPromesaForm(false)} onGenerar={generarPromesaFinal} />}
    </div>
  )
}
