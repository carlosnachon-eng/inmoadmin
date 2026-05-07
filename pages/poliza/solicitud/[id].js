import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../../../lib/supabase'

const C = {
  bg: '#0F0F0F', card: '#161616', border: '#222', border2: '#2E2E2E',
  gold: '#C8973A', goldLight: '#C8973A20', goldText: '#E8B86D',
  green: '#2A5C3F', greenText: '#5EC98A', greenBg: '#1A2E20',
  red: '#8B3A3A', redText: '#E07070', redBg: '#2A1A1A',
  blue: '#1A3A5C', blueText: '#70A8E0', blueBg: '#1A2A3A',
  text: '#E8E8E8', muted: '#888', faint: '#444', white: '#FFFFFF',
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 12, borderBottom: `2px solid ${C.gold}` }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: C.gold, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
        {numero}
      </div>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.white, fontFamily: 'Georgia, serif' }}>{titulo}</h2>
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
    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</p>
    <p style={{ margin: '3px 0 0', fontSize: 14, color: highlight ? C.goldText : (value ? C.text : C.faint), fontWeight: highlight ? 700 : 400 }}>
      {value || '—'}
    </p>
  </div>
)

const Referencia = ({ num, tipo, nombre, rel, telefono }) => (
  <div style={{ background: '#111', borderRadius: 8, padding: '12px 16px', marginBottom: 10 }}>
    <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: C.goldText, textTransform: 'uppercase' }}>
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

  useEffect(() => {
    if (!id) return
    supabase.from('solicitudes_inquilino').select('*').eq('id', id).single()
      .then(({ data }) => {
        if (data) {
          setSol(data)
          setStatus(data.status || 'pendiente')
          setNotas(data.notas_juridico || '')
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

  const handlePrint = () => window.print()

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontFamily: 'system-ui' }}>
      Cargando...
    </div>
  )

  if (!sol) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontFamily: 'system-ui' }}>
      Solicitud no encontrada.
    </div>
  )

  const nombre = sol.nombre_completo || sol.razon_social || '—'
  const sc = STATUS_CONFIG[status] || STATUS_CONFIG.pendiente

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

      <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'DM Sans', system-ui, sans-serif", color: C.text }}>

        {/* Header */}
        <div className="no-print" style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '14px 28px', display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 100 }}>
          <button onClick={() => router.back()} style={{ background: 'transparent', border: `1px solid ${C.border2}`, borderRadius: 8, padding: '6px 14px', color: C.muted, fontSize: 13, cursor: 'pointer' }}>
            ← Volver
          </button>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="" style={{ height: 28, objectFit: 'contain' }} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.white }}>{nombre}</p>
            <p style={{ margin: 0, fontSize: 11, color: C.muted }}>Ficha de investigación · {fmtDate(sol.created_at)}</p>
          </div>
          <button onClick={handlePrint} style={{ background: '#1A1A1A', border: `1px solid ${C.border2}`, borderRadius: 8, padding: '8px 16px', color: C.muted, fontSize: 13, cursor: 'pointer' }}>
            🖨️ Imprimir
          </button>
        </div>

        <div style={{ maxWidth: 960, margin: '0 auto', padding: '28px 20px' }}>

          {/* Status banner */}
          <div className="no-print" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px', marginBottom: 28, display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status de la investigación</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.entries(STATUS_CONFIG).map(([key, val]) => (
                  <button key={key} onClick={() => setStatus(key)} style={{
                    padding: '7px 16px', borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    background: status === key ? val.bg : '#1A1A1A',
                    color: status === key ? val.color : C.faint,
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
                style={{ width: '100%', background: '#1E1E1E', border: `1px solid ${C.border2}`, borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 20 }}>
              <button onClick={handleSave} disabled={saving} style={{ background: C.gold, color: '#000', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Guardando...' : saved ? '✓ Guardado' : 'Guardar'}
              </button>
            </div>
          </div>

          {/* Ficha */}
          <div className="print-card" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '32px 36px' }}>

            {/* Encabezado imprimible */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, paddingBottom: 20, borderBottom: `1px solid ${C.border}` }}>
              <div>
                <p style={{ margin: 0, fontSize: 11, color: C.gold, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Emporio Inmobiliario</p>
                <h1 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 700, color: C.white, fontFamily: 'Georgia, serif' }}>Solicitud de Investigación</h1>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: C.muted }}>{nombre} · {fmtDate(sol.created_at)}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ background: sc.bg, color: sc.color, padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                  {sc.label}
                </span>
                <p style={{ margin: '8px 0 0', fontSize: 11, color: C.muted }}>Folio: {id?.slice(0, 8).toUpperCase()}</p>
              </div>
            </div>

            {/* 1. Inmueble de interés */}
            <Seccion numero="1" titulo="Inmueble de interés">
              <Grid cols={2}>
                <Campo label="Dirección del inmueble" value={sol.inmueble_interes} highlight />
                <Campo label="Renta solicitada" value={fmt(sol.monto_renta_solicitada)} highlight />
              </Grid>
            </Seccion>

            {/* 2. Datos personales */}
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
              {sol.tipo_solicitante === 'Persona moral' && (
                <div style={{ marginTop: 16 }}>
                  <Grid cols={3}>
                    <Campo label="Giro de la empresa" value={sol.giro_empresa} />
                    <Campo label="Domicilio fiscal" value={sol.domicilio_fiscal} />
                    <Campo label="Representante legal" value={sol.nombre_representante} />
                  </Grid>
                </div>
              )}
            </Seccion>

            {/* 3. Información laboral e ingresos */}
            <Seccion numero="3" titulo="Información laboral e ingresos">
              <Grid cols={3}>
                <Campo label="Empresa donde labora" value={sol.empresa_labora || sol.razon_social} highlight />
                <Campo label="Giro de la empresa" value={sol.giro_empresa_labora || sol.giro_comercial} />
                <Campo label="Página web" value={sol.pagina_web_empresa || sol.pagina_web_empresa2} />
                <Campo label="Domicilio del trabajo" value={sol.domicilio_trabajo} />
                <Campo label="Teléfono del trabajo" value={sol.telefono_trabajo} />
                <Campo label="Nombre del jefe inmediato" value={sol.nombre_jefe} />
                <Campo label="Puesto del jefe" value={sol.puesto_jefe} />
                <Campo label="Teléfono/correo del jefe" value={sol.telefono_email_jefe} />
                <Campo label="Tipo de ingresos" value={sol.tipo_ingresos} />
                <Campo label="Ingresos mensuales" value={fmt(sol.ingresos_mensuales || sol.ingresos_empresa)} highlight />
                <Campo label="Comprobante presentado" value={sol.doc_comprobante_ingresos ? 'Sí (archivo adjunto)' : 'No adjuntado'} />
              </Grid>
              {sol.origen_recursos && (
                <div style={{ marginTop: 16 }}>
                  <Campo label="Origen de los recursos" value={sol.origen_recursos} />
                </div>
              )}
            </Seccion>

            {/* 4. Uso del inmueble */}
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

            {/* 5. Referencias familiares */}
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

            {/* 6. Referencias personales */}
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

            {/* 7. Ocupantes */}
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

            {/* 8. Documentos */}
            <Seccion numero="8" titulo="Documentos adjuntos">
              <Grid cols={2}>
                <div style={{ background: '#111', borderRadius: 8, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 24 }}>{sol.doc_identificacion_b64 || sol.doc_identificacion ? '✅' : '❌'}</span>
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.text }}>Identificación oficial</p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>{sol.doc_identificacion_b64 || sol.doc_identificacion ? 'Documento adjunto' : 'No adjuntado'}</p>
                  </div>
                  {(sol.doc_identificacion_b64 || sol.doc_identificacion) && (
                    <button
                      onClick={() => {
                        const src = sol.doc_identificacion_b64 || sol.doc_identificacion
                        if (src.startsWith('data:')) {
                          const a = document.createElement('a'); a.href = src; a.download = 'identificacion'; a.click()
                        } else {
                          supabase.storage.from('poliza-docs').createSignedUrl(src, 60)
                            .then(({ data }) => data?.signedUrl && window.open(data.signedUrl, '_blank'))
                        }
                      }}
                      style={{ marginLeft: 'auto', background: C.goldLight, border: `1px solid ${C.gold}`, color: C.goldText, borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}
                    >
                      Ver
                    </button>
                  )}
                </div>
                <div style={{ background: '#111', borderRadius: 8, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 24 }}>{sol.doc_comprobante_ingresos_b64 || sol.doc_comprobante_ingresos ? '✅' : '❌'}</span>
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.text }}>Comprobante de ingresos</p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>{sol.doc_comprobante_ingresos_b64 || sol.doc_comprobante_ingresos ? 'Documento adjunto' : 'No adjuntado'}</p>
                  </div>
                  {(sol.doc_comprobante_ingresos_b64 || sol.doc_comprobante_ingresos) && (
                    <button
                      onClick={() => {
                        const src = sol.doc_comprobante_ingresos_b64 || sol.doc_comprobante_ingresos
                        if (src.startsWith('data:')) {
                          const a = document.createElement('a'); a.href = src; a.download = 'comprobante_ingresos'; a.click()
                        } else {
                          supabase.storage.from('poliza-docs').createSignedUrl(src, 60)
                            .then(({ data }) => data?.signedUrl && window.open(data.signedUrl, '_blank'))
                        }
                      }}
                      style={{ marginLeft: 'auto', background: C.goldLight, border: `1px solid ${C.gold}`, color: C.goldText, borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}
                    >
                      Ver
                    </button>
                  )}
                </div>
              </Grid>
            </Seccion>

            {/* Notas jurídicas (visible en impresión) */}
            {notas && (
              <Seccion numero="9" titulo="Notas jurídicas">
                <div style={{ background: '#111', borderRadius: 8, padding: '16px 20px' }}>
                  <p style={{ margin: 0, fontSize: 14, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{notas}</p>
                </div>
              </Seccion>
            )}

          </div>
        </div>
      </div>
    </>
  )
}
