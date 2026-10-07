import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { hasAnyValue } from '../../lib/poliza/contactoLocalizacion'
import { C, st } from '../../lib/polizaUtils'

const Value = ({ label, value }) => value ? (
  <div style={{ minWidth: 0 }}>
    <p style={{ ...st.label, margin: '0 0 3px' }}>{label}</p>
    <p style={{ margin: 0, color: C.text, fontSize: 13, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{value}</p>
  </div>
) : null

const Source = ({ children }) => (
  <span style={{ display: 'inline-flex', marginTop: 8, borderRadius: 999, padding: '3px 8px', background: '#f3f4f6', color: C.muted, fontSize: 10, fontWeight: 700 }}>
    Fuente: {children}
  </span>
)

const Group = ({ title, children }) => (
  <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, background: '#fff' }}>
    <p style={{ margin: '0 0 10px', color: C.goldText, fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>{title}</p>
    {children}
  </div>
)

export default function ContactoLocalizacion({ expedienteId }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)

  const load = async () => {
    if (data || loading) return
    setLoading(true)
    setError('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData?.session?.access_token || !expedienteId) throw new Error('Acceso no disponible')
      const response = await fetch(`/api/poliza/contacto-localizacion?expedienteId=${encodeURIComponent(expedienteId)}`, {
        headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('Fuente no disponible')
      setData(await response.json())
    } catch {
      setError('No fue posible consultar la información vinculada. Las demás funciones del expediente siguen disponibles.')
    } finally {
      setLoading(false)
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) load()
  }

  const location = data?.location

  return (
    <div style={{ margin: '18px 0', border: '1px solid #fecaca', borderRadius: 10, background: '#fffafa', overflow: 'hidden' }}>
      <button type="button" onClick={toggle} aria-expanded={open} style={{ width: '100%', border: 0, background: 'transparent', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer', textAlign: 'left' }}>
        <span>
          <strong style={{ color: C.text, fontSize: 14 }}>Contacto y localización</strong>
          <span style={{ display: 'block', color: C.muted, fontSize: 11, marginTop: 3 }}>Datos existentes; no implican vigencia ni verificación.</span>
        </span>
        <span aria-hidden="true" style={{ color: C.goldText, fontWeight: 900 }}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid #fecaca', padding: 16 }}>
          {loading && <p style={{ margin: 0, color: C.muted, fontSize: 13 }}>Consultando vínculos por ID...</p>}
          {error && <p role="alert" style={{ margin: 0, color: C.redText, fontSize: 13 }}>No se pudo cargar: {error}</p>}
          {data?.pending?.length > 0 && (
            <div role="status" style={{ marginBottom: 12 }}>
              {data.pending.map(message => <p key={message} style={{ margin: '5px 0', color: C.muted, fontSize: 12 }}>{message}</p>)}
            </div>
          )}
          {location && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: 10 }}>
                {hasAnyValue(location.principal) && (
                  <Group title="Contacto declarado">
                    <div style={{ display: 'grid', gap: 9 }}>
                      <Value label="Teléfono principal" value={location.principal.telefono} />
                      <Value label="Correo" value={location.principal.correo} />
                      <Value label="Domicilio actual declarado" value={location.principal.domicilioDeclarado} />
                    </div>
                    <Source>Solicitud original</Source>
                  </Group>
                )}
                {hasAnyValue(location.laboral) && (
                  <Group title="Información laboral">
                    <div style={{ display: 'grid', gap: 9 }}>
                      <Value label="Empleador o actividad" value={[location.laboral.empleador, location.laboral.actividad].filter(Boolean).join(' · ')} />
                      <Value label="Domicilio laboral" value={location.laboral.domicilio} />
                      <Value label="Teléfono laboral" value={location.laboral.telefono} />
                      <Value label="Contacto laboral" value={[location.laboral.contacto, location.laboral.puesto].filter(Boolean).join(' · ')} />
                      <Value label="Teléfono/correo del contacto" value={location.laboral.telefonoCorreoContacto} />
                    </div>
                    <Source>Solicitud original</Source>
                  </Group>
                )}
                {hasAnyValue(location.conyuge) && (
                  <Group title="Cónyuge / contacto proporcionado">
                    <div style={{ display: 'grid', gap: 9 }}>
                      <Value label="Nombre" value={location.conyuge.nombre} />
                      <Value label="Teléfono" value={location.conyuge.telefono} />
                    </div>
                    <Source>Solicitud original</Source>
                  </Group>
                )}
                {hasAnyValue(location.arrendadorAnterior) && (
                  <Group title="Arrendador anterior declarado">
                    <div style={{ display: 'grid', gap: 9 }}>
                      <Value label="Nombre" value={location.arrendadorAnterior.nombre} />
                      <Value label="Teléfono" value={location.arrendadorAnterior.telefono} />
                    </div>
                    <Source>Solicitud original</Source>
                  </Group>
                )}
              </div>

              {location.referencias.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <Group title={`Referencias (${location.referencias.length})`}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: 8 }}>
                      {location.referencias.map(reference => (
                        <div key={reference.id} style={{ background: '#f9fafb', borderRadius: 7, padding: 9 }}>
                          <p style={{ margin: 0, color: C.text, fontSize: 12, fontWeight: 800 }}>{reference.nombre || 'Nombre no capturado'}</p>
                          <p style={{ margin: '3px 0 0', color: C.muted, fontSize: 11 }}>{[reference.tipo, reference.relacion].filter(Boolean).join(' · ')}</p>
                          {reference.telefono && <p style={{ margin: '4px 0 0', color: C.text, fontSize: 12 }}>{reference.telefono}</p>}
                        </div>
                      ))}
                    </div>
                    <Source>Solicitud original</Source>
                  </Group>
                </div>
              )}

              <div style={{ marginTop: 10 }}>
                <Group title="Aval / participantes vinculados">
                  {location.obligados.length ? location.obligados.map(obligado => (
                    <div key={obligado.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
                      <p style={{ margin: '0 0 8px', color: C.text, fontSize: 12, fontWeight: 700 }}>{obligado.denominacion}</p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 8 }}>
                        <Value label="Nombre" value={obligado.nombre} />
                        <Value label="Teléfono" value={obligado.telefono} />
                        <Value label="Correo" value={obligado.correo} />
                        <Value label="Domicilio" value={obligado.domicilio} />
                        <Value label="Ocupación" value={obligado.ocupacion} />
                        <Value label="Relación" value={obligado.relacion} />
                      </div>
                      <Source>{obligado.fuente}</Source>
                    </div>
                  )) : <p style={{ margin: 0, color: C.muted, fontSize: 12 }}>Información no disponible / vínculo pendiente.</p>}
                </Group>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                <p style={{ margin: 0, color: C.muted, fontSize: 11 }}>Sin verificación registrada. Los documentos no se cargaron al abrir este panel.</p>
                {data.solicitud?.id && <button type="button" onClick={() => window.open(`/poliza/solicitud/${data.solicitud.id}`, '_blank', 'noopener,noreferrer')} style={{ ...st.btn, background: C.blueBg, color: C.blueText, border: '1px solid #93c5fd', fontSize: 11 }}>
                  Consultar ficha y documentos
                </button>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
