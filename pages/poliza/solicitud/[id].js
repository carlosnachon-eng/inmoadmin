import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../../../lib/supabase'

const C = {
  bg: '#f8f8f8', card: '#ffffff', border: '#e5e7eb', border2: '#e5e7eb',
  gold: '#b91c3c', goldLight: '#fff0f3', goldText: '#b91c3c',
  green: '#065f46', greenText: '#065f46', greenBg: '#f0fdf4',
  red: '#991b1b', redText: '#991b1b', redBg: '#fee2e2',
  blue: '#1e40af', blueText: '#1e40af', blueBg: '#dbeafe',
  text: '#374151', muted: '#9ca3af', faint: '#d1d5db', white: '#FFFFFF',
}

const STATUS_CONFIG = {
  pendiente:   { label: 'Pendiente',   color: C.goldText,  bg: C.goldLight },
  en_revision: { label: 'En revisión', color: C.blueText,  bg: C.blueBg },
  aprobado:    { label: 'Aprobado',    color: C.greenText, bg: C.greenBg },
  rechazado:   { label: 'Rechazado',   color: C.redText,   bg: C.redBg },
}

const fmt = (n) => n ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'

const Seccion = ({ titulo, numero, children }) => (
  <div style={{ marginBottom: 32 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 12, borderBottom: '2px solid #b91c3c' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#b91c3c', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
        {numero}
      </div>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#374151', fontFamily: 'Georgia, serif' }}>{titulo}</h2>
    </div>
    {children}
  </div>
)

const Grid = ({ children, cols = 3 }) => (
  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }}>
    {children}
  </div>
)

const Campo = ({ label, value, highlight }) => (
  <div style={{ marginBottom: 4 }}>
    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</p>
    <p style={{ margin: '3px 0 0', fontSize: 14, color: highlight ? '#b91c3c' : (value ? '#374151' : '#d1d5db'), fontWeight: highlight ? 700 : 400 }}>
      {value || '—'}
    </p>
  </div>
)

const Referencia = ({ num, tipo, nombre, rel, telefono }) => (
  <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 16px', marginBottom: 10 }}>
    <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#b91c3c', textTransform: 'uppercase' }}>
      {tipo} {num}
    </p>
    <Grid cols={3}>
      <Campo label="Nombre" value={nombre} />
      <Campo label={tipo === 'Familiar' ? 'Parentesco' : 'Relación'} value={rel} />
      <Campo label="Teléfono" value={telefono} />
    </Grid>
  </div>
)

export default function FichaSolicitud() {
  const router = useRouter()
  const { id } = router.query
  const [sol, setSol] = useState(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [docBuro, setDocBuro] = useState(null)
  const [subiendoBuro, setSubiendoBuro] = useState(false)
  const [buroOk, setBuroOk] = useState(false)
  const [solicitandoDocs, setSolicitandoDocs] = useState(false)
  const [docsOk, setDocsOk] = useState(false)
  const [modalSolicitar, setModalSolicitar] = useState(false)
  const [docsSolicitados, setDocsSolicitados] = useState([])
  const [notasSolicitud, setNotasSolicitud] = useState('')
  const [reanalizing, setReanalizing] = useState(false)
  const [reanalizadoOk, setReanalizadoOk] = useState(false)

  // Upload manual de documentos por jurídico
  const [subiendoDoc, setSubiendoDoc] = useState(null)

  useEffect(() => {
    if (!id) return
    supabase.from('solicitudes_inquilino').select('*').eq('id', id).single()
      .then(({ data }) => {
        if (data) {
          setSol(data)
          setStatus(data.status || 'pendiente')
          setNotas(data.notas_juridico || '')
          setDocBuro(data.doc_buro_mexico || null)
        }
        setLoading(false)
      })
  }, [id])

  const handleSave = async () => {
    setSaving(true)
    await supabase.from('solicitudes_inquilino')
      .update({ status, notas_juridico: notas })
      .eq('id', id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const handleSubirBuro = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !id) return
    setSubiendoBuro(true)
    const ext = file.name.split('.').pop()
    const path = `buro/${id}.${ext}`
    const { error } = await supabase.storage.from('poliza-docs').upload(path, file, { upsert: true })
    if (!error) {
      await supabase.from('solicitudes_inquilino').update({ doc_buro_mexico: path }).eq('id', id)
      setDocBuro(path)
      setBuroOk(true)
      setTimeout(() => setBuroOk(false), 3000)
    }
    setSubiendoBuro(false)
  }

  // ── Subida manual de documentos del solicitante por jurídico ──
  const handleSubirDocManual = async (campo, file) => {
    if (!file || !id) return
    setSubiendoDoc(campo)
    try {
      const fileToBase64 = (f) => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(f)
      })
      const b64 = await fileToBase64(file)
      await supabase.from('solicitudes_inquilino').update({ [campo]: b64 }).eq('id', id)
      // Refrescar datos
      const { data } = await supabase.from('solicitudes_inquilino').select('*').eq('id', id).single()
      if (data) setSol(data)
    } catch (e) {
      console.error('Error subiendo doc:', e)
    }
    setSubiendoDoc(null)
  }

  // ── Re-correr análisis de IA ──
  const handleReanalizar = async () => {
    const motivo = window.prompt('Motivo del reanálisis (obligatorio):')
    if (!motivo?.trim()) return
    setReanalizing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Sesión no disponible')
      const res = await fetch('/api/analizar-solicitud', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ solicitud_id: id, tipo_ejecucion: 'reanalisis', motivo: motivo.trim() }),
      })
      if (res.ok) {
        const resultado = await res.json()
        await supabase.from('solicitudes_inquilino').update({
          pre_viabilidad: resultado.resultado,
          pre_viabilidad_detalle: resultado.mensaje,
          pre_viabilidad_detalle_interno: resultado.mensajeInterno,
          ingreso_detectado_ia: resultado.detalles?.ingresoDetectado,
          ingreso_total_ia: resultado.detalles?.analisisIA?.ingreso_mensual_total,
          curp_validada: resultado.validacionCurp?.valido,
          curp_nombre_renapo: resultado.validacionCurp?.nombre_en_renapo,
          curp_status: resultado.validacionCurp?.curp_status,
        }).eq('id', id)
        // Refrescar
        const { data } = await supabase.from('solicitudes_inquilino').select('*').eq('id', id).single()
        if (data) { setSol(data) }
        setReanalizadoOk(true)
        setTimeout(() => setReanalizadoOk(false), 4000)
      } else {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'No se pudo reanalizar')
      }
    } catch (e) {
      console.error(e)
      alert('Error al reanalizar: ' + e.message)
    }
    setReanalizing(false)
  }

  const handleSolicitarDocs = async () => {
    if (!docsSolicitados.length) return
    setSolicitandoDocs(true)
    await fetch('/api/solicitar-documentos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        solicitud_id: id,
        correo: sol.correo,
        nombre: sol.nombre_completo || sol.razon_social,
        documentos_solicitados: docsSolicitados,
        notas: notasSolicitud,
      }),
    })
    setSolicitandoDocs(false)
    setModalSolicitar(false)
    setDocsOk(true)
    setTimeout(() => setDocsOk(false), 4000)
  }

  const handleVerDoc = async (path) => {
    const { data } = await supabase.storage.from('poliza-docs').createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const handlePrint = () => window.print()

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontFamily: 'system-ui' }}>
      Cargando...
    </div>
  )

  if (!sol) return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontFamily: 'system-ui' }}>
      Solicitud no encontrada.
    </div>
  )

  const nombre = sol.nombre_completo || sol.razon_social || '—'
  const sc = STATUS_CONFIG[status] || STATUS_CONFIG.pendiente
  let analisisDocumental = sol.ia_analisis_documental || null
  if (typeof analisisDocumental === 'string') {
    try { analisisDocumental = JSON.parse(analisisDocumental) } catch { analisisDocumental = null }
  }

  // Helper para botón de subida manual de un documento
  const BotonSubirManual = ({ campo, label }) => (
    <label style={{ background: '#eff6ff', border: '1px solid #93c5fd', color: '#1e40af', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 700 }}>
      {subiendoDoc === campo ? '⏳ Subiendo...' : `📁 Subir ${label}`}
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
        onChange={e => e.target.files[0] && handleSubirDocManual(campo, e.target.files[0])}
        disabled={subiendoDoc === campo}
      />
    </label>
  )

  return (
    <>
      <Head>
        <title>Ficha — {nombre}</title>
        <style>{`
          @media print {
            .no-print { display: none !important; }
            body { background: white !important; color: black !important; }
            .print-card { background: white !important; border: none !important; box-shadow: none !important; }
            * { color: black !important; background: white !important; border-color: #ccc !important; }
          }
        `}</style>
      </Head>

      <div style={{ minHeight: '100vh', background: '#f8f8f8', fontFamily: "system-ui, sans-serif", color: '#374151' }}>

        {/* Header */}
        <div className="no-print" style={{ background: '#ffffff', borderBottom: '1px solid #e5e7eb', padding: '14px 28px', display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 100, flexWrap: 'wrap' }}>
          <button onClick={() => router.back()} style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 14px', color: '#9ca3af', fontSize: 13, cursor: 'pointer' }}>
            ← Volver
          </button>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="" style={{ height: 28, objectFit: 'contain' }} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#374151' }}>{nombre}</p>
            <p style={{ margin: 0, fontSize: 11, color: C.muted }}>Ficha de investigación · {fmtDate(sol.created_at)}</p>
          </div>
          <button onClick={handlePrint} style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 16px', color: '#9ca3af', fontSize: 13, cursor: 'pointer' }}>
            🖨️ Imprimir
          </button>
          <button
            onClick={() => window.open(`/dictamen?solicitud_id=${id}`, '_blank')}
            style={{ background: '#fff0f3', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 16px', color: '#b91c3c', fontSize: 13, cursor: 'pointer', fontWeight: 700 }}
          >
            📋 Generar dictamen
          </button>
          <button onClick={handleReanalizar} disabled={reanalizing}
            style={{ background: reanalizing ? '#f3f4f6' : '#faf5ff', border: '1px solid #a78bfa', borderRadius: 8, padding: '8px 16px', color: reanalizing ? '#9ca3af' : '#7c3aed', fontSize: 13, cursor: reanalizing ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
            {reanalizing ? '⏳ Analizando...' : reanalizadoOk ? '✅ Reanalizadó' : '🤖 Re-analizar IA'}
          </button>
          <button onClick={() => setModalSolicitar(true)}
            style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 8, padding: '8px 16px', color: '#1e40af', fontSize: 13, cursor: 'pointer', fontWeight: 700 }}>
            📧 Solicitar documentos
          </button>
          {docsOk && <span style={{ fontSize: 12, color: '#065f46', fontWeight: 700 }}>✅ Correo enviado</span>}
        </div>

        {/* Modal solicitar documentos */}
        {modalSolicitar && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800, color: '#374151' }}>📧 Solicitar documentos adicionales</h3>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: '#6b7280' }}>Se enviará un correo a <strong>{sol?.correo}</strong> con un link para subir los documentos.</p>
              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#374151' }}>¿Qué documentos necesitas?</p>
              {['Carta laboral', 'Constancia de situación fiscal', 'Estados de cuenta adicionales', 'Identificación oficial', 'Comprobante de domicilio'].map(doc => (
                <label key={doc} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer', fontSize: 13, color: '#374151' }}>
                  <input type="checkbox" checked={docsSolicitados.includes(doc)} onChange={e => setDocsSolicitados(prev => e.target.checked ? [...prev, doc] : prev.filter(d => d !== doc))} />
                  {doc}
                </label>
              ))}
              <div style={{ marginTop: 12 }}>
                <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: '#374151' }}>Notas adicionales (opcional)</p>
                <textarea value={notasSolicitud} onChange={e => setNotasSolicitud(e.target.value)} rows={3}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                  placeholder="Instrucciones específicas para el solicitante..." />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                <button onClick={() => setModalSolicitar(false)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Cancelar</button>
                <button onClick={handleSolicitarDocs} disabled={solicitandoDocs || !docsSolicitados.length}
                  style={{ background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: solicitandoDocs || !docsSolicitados.length ? 0.6 : 1 }}>
                  {solicitandoDocs ? 'Enviando...' : '📧 Enviar correo'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ maxWidth: 960, margin: '0 auto', padding: '28px 20px' }}>

          {/* Status banner */}
          <div className="no-print" style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px', marginBottom: 28, display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status de la investigación</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.entries(STATUS_CONFIG).map(([key, val]) => (
                  <button key={key} onClick={() => setStatus(key)} style={{
                    padding: '7px 16px', borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    background: status === key ? val.bg : '#f3f4f6',
                    color: status === key ? val.color : C.muted,
                    outline: status === key ? `2px solid ${val.color}` : 'none',
                  }}>
                    {val.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 2 }}>
              <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Notas jurídicas internas</p>
              <textarea
                value={notas}
                onChange={e => setNotas(e.target.value)}
                rows={3}
                placeholder="Observaciones del dictamen, verificación de referencias, notas de investigación..."
                style={{ width: '100%', background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', color: '#374151', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 20 }}>
              <button onClick={handleSave} disabled={saving} style={{ background: '#b91c3c', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Guardando...' : saved ? '✓ Guardado' : 'Guardar'}
              </button>
            </div>
          </div>

          {/* Ficha */}
          <div className="print-card" style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '32px 36px' }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, paddingBottom: 20, borderBottom: `1px solid ${C.border}` }}>
              <div>
                <p style={{ margin: 0, fontSize: 11, color: '#b91c3c', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Emporio Inmobiliario</p>
                <h1 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 700, color: '#374151', fontFamily: 'Georgia, serif' }}>Solicitud de Investigación</h1>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: C.muted }}>{nombre} · {fmtDate(sol.created_at)}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ background: sc.bg, color: sc.color, padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                  {sc.label}
                </span>
                <p style={{ margin: '8px 0 0', fontSize: 11, color: C.muted }}>Folio: {id?.slice(0, 8).toUpperCase()}</p>
              </div>
            </div>

            <Seccion numero="1" titulo="Inmueble de interés">
              <Grid cols={2}>
                <Campo label="Dirección del inmueble" value={sol.inmueble_interes} highlight />
                <Campo label="Renta solicitada" value={fmt(sol.monto_renta_solicitada)} highlight />
              </Grid>
            </Seccion>

            <Seccion numero="2" titulo="Datos personales del solicitante">
              <Grid cols={3}>
                <Campo label="Tipo de solicitante" value={sol.tipo_solicitante} />
                <Campo label="Nombre completo / Razón social" value={sol.nombre_completo || sol.razon_social} highlight />
                <Campo label="Teléfono" value={sol.telefono || sol.telefono_representante} />
                <Campo label="Correo electrónico" value={sol.correo || sol.email_representante} />
                <Campo label="RFC" value={sol.rfc || sol.rfc_empresa} />
                <Campo label="CURP" value={sol.curp} />
                <Campo label="Nacionalidad" value={sol.nacionalidad} />
                <Campo label="¿Extranjero?" value={sol.es_extranjero} />
                <Campo label="Estatus migratorio" value={sol.estatus_migratorio} />
                <Campo label="Estado civil" value={sol.estado_civil} />
                <Campo label="Nombre del cónyuge" value={sol.nombre_conyuge} />
                <Campo label="Teléfono del cónyuge" value={sol.telefono_conyuge} />
              </Grid>
              <div style={{ marginTop: 16 }}>
                <Campo label="Domicilio actual" value={sol.domicilio_actual} />
              </div>
            </Seccion>

            <Seccion numero="3" titulo="Información laboral e ingresos">
              <Grid cols={3}>
                <Campo label="Empresa donde labora" value={sol.empresa_labora || sol.razon_social} highlight />
                <Campo label="Giro de la empresa" value={sol.giro_empresa_labora || sol.giro_comercial} />
                <Campo label="Tipo de ingresos" value={sol.tipo_ingresos} />
                <Campo label="Ingresos mensuales (declarados)" value={fmt(sol.ingresos_mensuales || sol.ingresos_empresa)} highlight />
                <Campo label="Domicilio del trabajo" value={sol.domicilio_trabajo} />
                <Campo label="Nombre del jefe" value={sol.nombre_jefe} />
              </Grid>
            </Seccion>

            <Seccion numero="4" titulo="Uso del inmueble y situación actual">
              <Grid cols={3}>
                <Campo label="Uso del inmueble" value={sol.uso_inmueble} highlight />
                <Campo label="Descripción del uso" value={sol.descripcion_uso} />
                <Campo label="¿Subarrendamiento?" value={sol.subarrendamiento} />
                <Campo label="Arrendador actual" value={sol.nombre_arrendador_actual} />
                <Campo label="Teléfono arrendador actual" value={sol.telefono_arrendador_actual} />
                <Campo label="Renta actual" value={fmt(sol.monto_renta_actual)} />
                <Campo label="Motivo del cambio" value={sol.motivo_cambio} />
              </Grid>
            </Seccion>

            <Seccion numero="5" titulo="Referencias familiares">
              {[1, 2, 3].map(n => (
                (sol[`ref_fam${n}_nombre`] || sol[`ref_fam${n}_telefono`]) && (
                  <Referencia key={n} num={n} tipo="Familiar"
                    nombre={sol[`ref_fam${n}_nombre`]}
                    rel={sol[`ref_fam${n}_parentesco`]}
                    telefono={sol[`ref_fam${n}_telefono`]}
                  />
                )
              ))}
              {![1,2,3].some(n => sol[`ref_fam${n}_nombre`]) && (
                <p style={{ color: C.faint, fontSize: 13 }}>No se capturaron referencias familiares.</p>
              )}
            </Seccion>

            <Seccion numero="6" titulo="Referencias personales">
              {[1, 2, 3].map(n => (
                (sol[`ref_per${n}_nombre`] || sol[`ref_per${n}_telefono`]) && (
                  <Referencia key={n} num={n} tipo="Personal"
                    nombre={sol[`ref_per${n}_nombre`]}
                    rel={sol[`ref_per${n}_relacion`]}
                    telefono={sol[`ref_per${n}_telefono`]}
                  />
                )
              ))}
              {![1,2,3].some(n => sol[`ref_per${n}_nombre`]) && (
                <p style={{ color: C.faint, fontSize: 13 }}>No se capturaron referencias personales.</p>
              )}
            </Seccion>

            <Seccion numero="7" titulo="Ocupantes del inmueble">
              <Grid cols={3}>
                <Campo label="Número de personas" value={sol.num_habitantes} highlight />
                <Campo label="¿Mascotas?" value={sol.tiene_mascotas ? 'Sí' : 'No'} />
                <Campo label="Detalle mascotas" value={sol.detalle_mascotas} />
                <Campo label="Personal de servicio" value={sol.personal_servicio ? 'Sí' : 'No'} />
                <Campo label="Detalle servicio" value={sol.personal_servicio_detalle} />
              </Grid>
              {sol.detalle_habitantes && (
                <div style={{ marginTop: 16 }}>
                  <Campo label="Detalle de personas que habitarán" value={sol.detalle_habitantes} />
                </div>
              )}
            </Seccion>

            {/* Análisis IA */}
            {sol.pre_viabilidad && (
              <div style={{ marginBottom: 32, background: sol.pre_viabilidad === 'viable' ? '#f0fdf4' : '#fffbeb', border: `1px solid ${sol.pre_viabilidad === 'viable' ? '#6ee7b7' : '#fcd34d'}`, borderRadius: 12, padding: 20 }}>
                <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: 1 }}>🤖 Análisis de pre-viabilidad (IA)</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
                  <div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px' }}>
                    <p style={{ margin: '0 0 2px', fontSize: 10, color: '#9ca3af', textTransform: 'uppercase' }}>Resultado</p>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: sol.pre_viabilidad === 'viable' ? '#065f46' : sol.pre_viabilidad === 'no_viable' ? '#991b1b' : '#92400e' }}>
                      {sol.pre_viabilidad === 'viable' ? '✅ Viable' : sol.pre_viabilidad === 'no_viable' ? '❌ No viable' : '⚠️ Revisar'}
                    </p>
                  </div>
                  {sol.ingreso_detectado_ia && (
                    <div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px' }}>
                      <p style={{ margin: '0 0 2px', fontSize: 10, color: '#9ca3af', textTransform: 'uppercase' }}>Ingreso detectado</p>
                      <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#374151' }}>${Number(sol.ingreso_detectado_ia).toLocaleString('es-MX')}/mes</p>
                    </div>
                  )}
                  {sol.curp_validada !== null && sol.curp_validada !== undefined && (
                    <div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px' }}>
                      <p style={{ margin: '0 0 2px', fontSize: 10, color: '#9ca3af', textTransform: 'uppercase' }}>CURP (RENAPO)</p>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: sol.curp_validada ? '#065f46' : '#991b1b' }}>
                        {sol.curp_validada ? '✅ Válida' : '❌ No válida'}{sol.curp_status ? ` — ${sol.curp_status}` : ''}
                      </p>
                      {sol.curp_nombre_renapo && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6b7280' }}>RENAPO: {sol.curp_nombre_renapo}</p>}
                    </div>
                  )}
                </div>
                {sol.pre_viabilidad_detalle_interno && (
                  <div style={{ background: '#fff', borderRadius: 8, padding: '12px 14px' }}>
                    <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>Notas internas</p>
                    <p style={{ margin: 0, fontSize: 13, color: '#374151' }}>{sol.pre_viabilidad_detalle_interno}</p>
                  </div>
                )}
                {analisisDocumental && (
                  <div style={{ marginTop: 12, background: '#fff', borderRadius: 8, padding: '14px' }}>
                    <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase' }}>Resumen documental para jurídico</p>
                    <Grid cols={2}>
                      <Campo
                        label="Identidad detectada"
                        value={analisisDocumental.identidad_detectada?.nombre}
                      />
                      <Campo
                        label="CURP visible en INE"
                        value={analisisDocumental.identidad_detectada?.curp}
                      />
                      <Campo
                        label="Clave de elector"
                        value={analisisDocumental.identidad_detectada?.clave_elector}
                      />
                      <Campo
                        label="Vigencia INE"
                        value={analisisDocumental.identidad_detectada?.vigencia}
                      />
                      <Campo
                        label="Ingreso y fuente"
                        value={analisisDocumental.ingresos_detectados?.ingreso_mensual_verificable
                          ? `${fmt(analisisDocumental.ingresos_detectados.ingreso_mensual_verificable)}/mes — ${analisisDocumental.ingresos_detectados.fuente_ingreso === 'carta_laboral' ? 'carta laboral' : 'comprobantes'}`
                          : 'No calculable'}
                      />
                      <Campo
                        label="Revisión manual"
                        value={analisisDocumental.revision_manual ? 'Sí' : 'No'}
                      />
                    </Grid>

                    {!!analisisDocumental.documentos_analizados?.length && (
                      <div style={{ marginTop: 12 }}>
                        <Campo label="Documentos analizados" value={analisisDocumental.documentos_analizados.map(d => d.etiqueta).join(', ')} />
                      </div>
                    )}
                    {!!analisisDocumental.documentos_fallidos?.length && (
                      <div style={{ marginTop: 10, padding: '10px 12px', background: '#fef2f2', borderRadius: 6 }}>
                        <Campo label="Documentos con fallo" value={analisisDocumental.documentos_fallidos.map(d => `${d.etiqueta}: ${d.error}`).join(' | ')} />
                      </div>
                    )}
                    {!!analisisDocumental.inconsistencias?.length && <div style={{ marginTop: 10 }}><Campo label="Inconsistencias" value={analisisDocumental.inconsistencias.join(' | ')} /></div>}
                    {!!analisisDocumental.informacion_faltante?.length && <div style={{ marginTop: 10 }}><Campo label="Información faltante" value={analisisDocumental.informacion_faltante.join(' | ')} /></div>}
                    {!!analisisDocumental.riesgos_observados?.length && <div style={{ marginTop: 10 }}><Campo label="Riesgos observados" value={analisisDocumental.riesgos_observados.join(' | ')} /></div>}
                    {!!analisisDocumental.preguntas_revision_humana?.length && <div style={{ marginTop: 10 }}><Campo label="Preguntas para revisión humana" value={analisisDocumental.preguntas_revision_humana.join(' | ')} /></div>}
                    {sol.ia_ultimo_analisis_en && (
                      <p style={{ margin: '12px 0 0', fontSize: 10, color: '#9ca3af' }}>
                        Último análisis: {new Date(sol.ia_ultimo_analisis_en).toLocaleString('es-MX')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 8. Documentos */}
            <Seccion numero="8" titulo="Documentos del análisis">
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                <p style={{ margin: 0, fontSize: 12, color: '#1e40af', fontWeight: 600 }}>
                  ℹ️ Jurídico puede subir documentos manualmente. Después usa el botón <strong>"Re-analizar IA"</strong> para actualizar el dictamen.
                </p>
              </div>
              <Grid cols={1}>

                {/* Identificación oficial */}
                {(() => {
                  const tiene = !!(sol.doc_identificacion_url || sol.doc_identificacion_b64 || sol.doc_identificacion)
                  const src   = sol.doc_identificacion_url || sol.doc_identificacion_b64 || sol.doc_identificacion
                  return (
                    <div style={{ background: tiene ? '#f9fafb' : '#fff5f5', borderRadius: 8, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, border: tiene ? 'none' : '1px dashed #fca5a5' }}>
                      <span style={{ fontSize: 24 }}>{tiene ? '✅' : '❌'}</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.text }}>Identificación oficial</p>
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>{tiene ? 'Documento adjunto' : 'No adjuntado'}</p>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {tiene && (
                          <button onClick={() => { if (src.startsWith('data:')) { const a = document.createElement('a'); a.href = src; a.download = 'identificacion'; a.click() } else { handleVerDoc(src) } }}
                            style={{ background: '#fff0f3', border: '1px solid #fca5a5', color: '#b91c3c', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>
                            Ver
                          </button>
                        )}
                        <BotonSubirManual campo="doc_identificacion_b64" label="INE/Pasaporte" />
                      </div>
                    </div>
                  )
                })()}

                {/* Comprobantes de ingresos */}
                {[
                  { campo: 'doc_comprobante_ingresos_b64', url: sol.doc_comprobante_ingresos_b64 || sol.doc_ingresos_url_1 || sol.doc_comprobante_ingresos, label: 'Comprobante de ingresos — Mes 1' },
                  { campo: 'doc_ingresos_b64_2', url: sol.doc_ingresos_b64_2 || sol.doc_ingresos_url_2, label: 'Comprobante de ingresos — Mes 2' },
                  { campo: 'doc_ingresos_b64_3', url: sol.doc_ingresos_b64_3 || sol.doc_ingresos_url_3, label: 'Comprobante de ingresos — Mes 3' },
                ].map((doc, i) => (
                  <div key={i} style={{ background: doc.url ? '#f9fafb' : '#fff5f5', borderRadius: 8, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, border: doc.url ? 'none' : '1px dashed #fca5a5' }}>
                    <span style={{ fontSize: 24 }}>{doc.url ? '✅' : '❌'}</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.text }}>{doc.label}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>{doc.url ? 'Documento adjunto' : 'No adjuntado'}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {doc.url && (
                        <button onClick={() => { if (doc.url.startsWith('data:')) { const a = document.createElement('a'); a.href = doc.url; a.download = `comprobante_${i+1}`; a.click() } else { window.open(doc.url, '_blank') } }}
                          style={{ background: '#fff0f3', border: '1px solid #fca5a5', color: '#b91c3c', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>
                          Ver
                        </button>
                      )}
                      <BotonSubirManual campo={doc.campo} label={`Mes ${i + 1}`} />
                    </div>
                  </div>
                ))}

                {/* Documentos opcionales ya subidos */}
                {[
                  { url: sol.doc_carta_laboral_b64, campo: 'doc_carta_laboral_b64', label: 'Carta laboral' },
                  { url: sol.doc_constancia_fiscal_b64, campo: 'doc_constancia_fiscal_b64', label: 'Constancia de situación fiscal' },
                  { url: sol.doc_extra_1_b64, campo: 'doc_extra_1_b64', label: 'Documento adicional 1' },
                  { url: sol.doc_extra_2_b64, campo: 'doc_extra_2_b64', label: 'Documento adicional 2' },
                ].map((doc, i) => (
                  <div key={i} style={{ background: doc.url ? '#f0fdf4' : '#f9fafb', borderRadius: 8, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 24 }}>{doc.url ? '✅' : '➕'}</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.text }}>{doc.label}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>{doc.url ? 'Documento adjunto' : 'No subido'}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {doc.url && (
                        <button onClick={() => { const a = document.createElement('a'); a.href = doc.url; a.download = doc.label; a.click() }}
                          style={{ background: '#fff0f3', border: '1px solid #fca5a5', color: '#b91c3c', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>
                          Ver
                        </button>
                      )}
                      <BotonSubirManual campo={doc.campo} label={doc.label} />
                    </div>
                  </div>
                ))}

                {/* Reporte Buró México */}
                <div style={{ background: docBuro ? '#f0fdf4' : '#fffbeb', border: `1px solid ${docBuro ? '#6ee7b7' : '#fde68a'}`, borderRadius: 8, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 24 }}>{docBuro ? '✅' : '📋'}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.text }}>Reporte Buró México</p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>
                      {docBuro ? 'Reporte subido por el área jurídica' : 'Pendiente — subir reporte generado por la abogada'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {docBuro && (
                      <button onClick={() => handleVerDoc(docBuro)}
                        style={{ background: '#f0fdf4', border: '1px solid #6ee7b7', color: '#065f46', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>
                        Ver
                      </button>
                    )}
                    <label style={{ background: '#fff0f3', border: '1px solid #fca5a5', color: '#b91c3c', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {subiendoBuro ? 'Subiendo...' : buroOk ? '✓ Guardado' : docBuro ? 'Reemplazar' : '+ Subir PDF'}
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleSubirBuro} style={{ display: 'none' }} />
                    </label>
                  </div>
                </div>

              </Grid>
            </Seccion>

            {notas && (
              <Seccion numero="9" titulo="Notas jurídicas">
                <div style={{ background: '#f9fafb', borderRadius: 8, padding: '16px 20px' }}>
                  <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{notas}</p>
                </div>
              </Seccion>
            )}

          </div>
        </div>
      </div>
    </>
  )
}
