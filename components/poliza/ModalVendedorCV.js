import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { generarContratoPromocion } from '../../lib/generarContratoPromocion'
import { generarPromesaCompraventa } from '../../lib/generarPromesaCompraventa'
import { C, st, InfoRow, fmt } from '../../lib/polizaUtils'
import ModalPromesaCV from './ModalPromesaCV'

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

export default function ModalVendedorCV({ vendedor: v, onClose, onSaved, compradores = [] }) {
  const [generando, setGenerando] = useState(false)
  const [showPromesaForm, setShowPromesaForm] = React.useState(false)
  const [detalle, setDetalle] = useState(null)
  const [cargandoDocs, setCargandoDocs] = useState(true)
  const [buscarPropiedad, setBuscarPropiedad] = useState('')
  const [resultadosPropiedad, setResultadosPropiedad] = useState([])
  const [propiedadVinculada, setPropiedadVinculada] = useState(null)
  const [vinculando, setVinculando] = useState(false)

  useEffect(() => {
    const cargarDetalle = async () => {
      setCargandoDocs(true)
      const { data } = await supabase
        .from('propietarios_inmuebles')
        .select('*')
        .eq('id', v.id)
        .single()
      setDetalle(data)
      setCargandoDocs(false)
      if (data?.propiedad_id) {
        const { data: prop } = await supabase.from('propiedades').select('id, titulo, direccion, public_id').eq('id', data.propiedad_id).maybeSingle()
        setPropiedadVinculada(prop)
      }
    }
    cargarDetalle()
  }, [v.id])

  useEffect(() => {
    const buscar = async () => {
      if (!buscarPropiedad || buscarPropiedad.length < 3) { setResultadosPropiedad([]); return }
      const { data } = await supabase
        .from('propiedades')
        .select('id, titulo, direccion, colonia, ciudad, public_id')
        .or(`titulo.ilike.%${buscarPropiedad}%,direccion.ilike.%${buscarPropiedad}%`)
        .limit(8)
      setResultadosPropiedad(data || [])
    }
    const timeout = setTimeout(buscar, 350)
    return () => clearTimeout(timeout)
  }, [buscarPropiedad])

  const vincularPropiedad = async (propiedad) => {
    setVinculando(true)
    await supabase.from('propietarios_inmuebles').update({ propiedad_id: propiedad.id }).eq('id', v.id)
    setPropiedadVinculada(propiedad)
    setBuscarPropiedad('')
    setResultadosPropiedad([])
    setVinculando(false)
  }

  const desvincularPropiedad = async () => {
    setVinculando(true)
    await supabase.from('propietarios_inmuebles').update({ propiedad_id: null }).eq('id', v.id)
    setPropiedadVinculada(null)
    setVinculando(false)
  }

  const vend = detalle || v

  const handleGenerarPromocion = async () => {
    setGenerando('promocion')
    try {
      await generarContratoPromocion({
        nombre_arrendador: vend.nombre_propietario,
        domicilio_arrendador: vend.domicilio_propietario,
        telefono_arrendador: vend.telefono_propietario,
        direccion_inmueble: vend.direccion_inmueble,
        renta_mensual: vend.precio_venta
      })
      // Registra cuándo se generó el contrato — el sistema lo toma como
      // fecha de inicio de la promoción de esta propiedad. Se actualiza
      // cada vez que se vuelva a generar el contrato (ej. al corregir un
      // error), no se conserva la primera fecha.
      await supabase.from('propietarios_inmuebles').update({ fecha_inicio_promocion: new Date().toISOString() }).eq('id', v.id)
    } catch(e) { alert('Error: ' + e.message) }
    setGenerando(false)
  }

  const generarPromesaFinal = async (formData) => {
    setGenerando('promesacv')
    setShowPromesaForm(false)
    try {
      await generarPromesaCompraventa({
        nombre_vendedor: vend.nombre_propietario, domicilio_vendedor: vend.domicilio_propietario,
        telefono_vendedor: vend.telefono_propietario, curp_vendedor: formData.curp_vendedor,
        rfc_vendedor: vend.rfc_propietario, credencial_vendedor: formData.credencial_vendedor,
        nombre_comprador: formData.nombre_comprador, domicilio_comprador: formData.domicilio_comprador,
        curp_comprador: formData.curp_comprador, rfc_comprador: formData.rfc_comprador,
        credencial_comprador: formData.credencial_comprador, direccion_inmueble: vend.direccion_inmueble,
        superficie: formData.superficie, volumen_escritura: formData.volumen_escritura,
        instrumento_escritura: formData.instrumento_escritura, fecha_escritura: formData.fecha_escritura,
        notario: formData.notario, notaria: formData.notaria, cuenta_predial: formData.cuenta_predial,
        precio_total: vend.precio_venta, precio_total_letras: formData.precio_total_letras,
        tipo_credito: formData.tipo_credito, nombre_banco: formData.nombre_banco,
        pago1_monto: formData.pago1_monto, pago1_letras: formData.pago1_letras, pago1_fecha: formData.pago1_fecha,
        pago2_monto: formData.tiene_pago2 ? formData.pago2_monto : null, pago2_letras: formData.pago2_letras, pago2_fecha: formData.pago2_fecha,
        pago3_monto: formData.pago3_monto, pago3_letras: formData.pago3_letras, pago3_fecha: formData.pago3_fecha,
        pena_convencional: formData.pena_convencional, pena_letras: formData.pena_letras,
        gravamen: vend.libre_gravamen ? '' : (vend.institucion_gravamen || 'hipoteca'),
        fecha_firma: formData.fecha_firma,
      })
    } catch(e) { alert('Error: ' + e.message) }
    setGenerando(false)
  }

  // URL para Veridada con datos prellenados (solo Emporio)
  const urlVeridada = `https://veridada.mx/inmobiliaria?source=emporio&key=emporio2026&direccion=${encodeURIComponent(vend.direccion_inmueble || '')}&municipio=${encodeURIComponent(vend.municipio || '')}&precio=${vend.precio_venta || ''}&operacion=venta&tipo=casa`

  const tieneDocs = vend.doc_identificacion_b64 || vend.doc_comprobante_domicilio_b64 || vend.doc_predial_b64 || vend.doc_escritura_b64

  return (
    <div style={st.modal} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={st.modalCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text, fontFamily: 'Georgia, serif' }}>{vend.nombre_propietario}</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: C.muted }}>{vend.tipo_persona_propietario === 'moral' ? `Persona moral — ${vend.razon_social_propietario}` : 'Persona física'}</p>
          </div>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>✕</button>
        </div>

        <div style={st.grid2}>
          <InfoRow label="Teléfono" value={vend.telefono_propietario} />
          <InfoRow label="Correo" value={vend.correo_propietario} />
          <InfoRow label="RFC" value={vend.rfc_propietario} />
          <InfoRow label="Precio de venta" value={fmt(vend.precio_venta)} />
        </div>
        <InfoRow label="Dirección del inmueble" value={vend.direccion_inmueble} />
        <InfoRow label="Domicilio del propietario" value={vend.domicilio_propietario} />

        {/* Vinculación con propiedad del catálogo (para el reporte mensual) */}
        <div style={{ ...st.divider, margin: '16px 0' }} />
        <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
          Propiedad vinculada en catálogo (para reporte mensual)
        </p>
        {propiedadVinculada ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px' }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.text }}>{propiedadVinculada.titulo}</p>
              <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{propiedadVinculada.direccion} · ID: {propiedadVinculada.public_id}</p>
            </div>
            <button onClick={desvincularPropiedad} disabled={vinculando} style={{ ...st.btn, ...st.btnGhost, fontSize: 11, padding: '6px 10px' }}>
              Quitar
            </button>
          </div>
        ) : (
          <div>
            <input
              value={buscarPropiedad}
              onChange={e => setBuscarPropiedad(e.target.value)}
              placeholder="Buscar propiedad por título o dirección…"
              style={st.input}
            />
            {resultadosPropiedad.length > 0 && (
              <div style={{ marginTop: 8, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                {resultadosPropiedad.map(rp => (
                  <button key={rp.id} onClick={() => vincularPropiedad(rp)} disabled={vinculando}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: '#fff', border: 'none', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 12 }}>
                    <strong>{rp.titulo}</strong><br />
                    <span style={{ color: C.muted }}>{[rp.direccion, rp.colonia, rp.ciudad].filter(Boolean).join(', ')} · {rp.public_id}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {vend.descripcion_inmueble && <InfoRow label="Descripción del inmueble" value={vend.descripcion_inmueble} />}

        <div style={{ ...st.divider, margin: '16px 0' }} />

        <div style={st.grid2}>
          <InfoRow label="Libre de gravamen" value={vend.libre_gravamen ? 'Sí' : 'No'} />
          {!vend.libre_gravamen && <InfoRow label="Institución" value={vend.institucion_gravamen} />}
        </div>

        {vend.tipo_copropiedad && vend.tipo_copropiedad !== 'no' && (
          <>
            <div style={{ ...st.divider, margin: '16px 0' }} />
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>Copropietarios</p>
            {vend.copropietario_1_nombre && (
              <div style={st.grid2}>
                <InfoRow label="Copropietario 1" value={vend.copropietario_1_nombre} />
                <InfoRow label="Teléfono" value={vend.copropietario_1_telefono} />
                <InfoRow label="RFC" value={vend.copropietario_1_rfc} />
                <InfoRow label="Correo" value={vend.copropietario_1_correo} />
              </div>
            )}
            {vend.copropietario_2_nombre && (
              <div style={st.grid2}>
                <InfoRow label="Copropietario 2" value={vend.copropietario_2_nombre} />
                <InfoRow label="Teléfono" value={vend.copropietario_2_telefono} />
              </div>
            )}
          </>
        )}

        <div style={{ ...st.divider, margin: '16px 0' }} />
        <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.3px' }}>Documentos</p>
        {cargandoDocs ? (
          <p style={{ fontSize: 12, color: C.muted }}>Cargando documentos...</p>
        ) : tieneDocs ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {vend.doc_identificacion_b64 && <DocChip label="Identificación" data={vend.doc_identificacion_b64.startsWith('data:') ? vend.doc_identificacion_b64 : null} path={!vend.doc_identificacion_b64.startsWith('data:') ? vend.doc_identificacion_b64 : null} />}
            {vend.doc_comprobante_domicilio_b64 && <DocChip label="Comprobante domicilio" data={vend.doc_comprobante_domicilio_b64.startsWith('data:') ? vend.doc_comprobante_domicilio_b64 : null} path={!vend.doc_comprobante_domicilio_b64.startsWith('data:') ? vend.doc_comprobante_domicilio_b64 : null} />}
            {vend.doc_predial_b64 && <DocChip label="Predial" data={vend.doc_predial_b64.startsWith('data:') ? vend.doc_predial_b64 : null} path={!vend.doc_predial_b64.startsWith('data:') ? vend.doc_predial_b64 : null} />}
            {vend.doc_escritura_b64 && <DocChip label={vend.tipo_persona_propietario === 'moral' ? 'Documentos persona moral' : 'Escritura'} data={vend.doc_escritura_b64.startsWith('data:') ? vend.doc_escritura_b64 : null} path={!vend.doc_escritura_b64.startsWith('data:') ? vend.doc_escritura_b64 : null} />}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: C.faint }}>Sin documentos adjuntos</p>
        )}

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
          <a
            href={urlVeridada}
            target="_blank"
            rel="noreferrer"
            style={{ ...st.btn, background: '#1a1a2e', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            🛡️ Enviar a Veridada
          </a>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>Cerrar</button>
        </div>
      </div>
      {showPromesaForm && <ModalPromesaCV vendedor={vend} compradores={compradores} onClose={() => setShowPromesaForm(false)} onGenerar={generarPromesaFinal} />}
    </div>
  )
}
