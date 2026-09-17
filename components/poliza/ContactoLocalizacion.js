import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { buildContactLocation, hasAnyValue } from '../../lib/poliza/contactoLocalizacion'
import { C, st } from '../../lib/polizaUtils'

const SOLICITUD_FIELDS = [
  'id', 'telefono', 'correo', 'domicilio_actual', 'empresa_labora', 'razon_social',
  'giro_comercial', 'giro_empresa_labora', 'giro_empresa', 'ocupacion',
  'domicilio_trabajo', 'telefono_trabajo', 'nombre_jefe', 'puesto_jefe',
  'telefono_email_jefe', 'nombre_conyuge', 'telefono_conyuge',
  'nombre_arrendador_actual', 'telefono_arrendador_actual',
  'ref_fam1_nombre', 'ref_fam1_parentesco', 'ref_fam1_telefono',
  'ref_fam2_nombre', 'ref_fam2_parentesco', 'ref_fam2_telefono',
  'ref_fam3_nombre', 'ref_fam3_parentesco', 'ref_fam3_telefono',
  'ref_per1_nombre', 'ref_per1_relacion', 'ref_per1_telefono',
  'ref_per2_nombre', 'ref_per2_relacion', 'ref_per2_telefono',
  'ref_per3_nombre', 'ref_per3_relacion', 'ref_per3_telefono',
  'nombre_aval', 'telefono_aval', 'domicilio_aval', 'ocupacion_aval',
  'doc_identificacion_aval', 'doc_comprobante_aval',
].join(', ')

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

export default function ContactoLocalizacion({ expedienteId, solicitudId }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)

  const load = async () => {
    if (data || loading) return
    if (!solicitudId) {
      setData({ unavailable: true })
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data: solicitud, error: solicitudError } = await supabase
        .from('solicitudes_inquilino')
        .select(SOLICITUD_FIELDS)
        .eq('id', solicitudId)
        .maybeSingle()
      if (solicitudError) throw solicitudError
      if (!solicitud) {
        setData({ unavailable: true })
        return
      }

      const { data: operations, error: operationsError } = await supabase
        .from('partner_operations')
        .select('id')
        .or(`solicitud_inquilino_id.eq.${solicitudId},poliza_expediente_id.eq.${expedienteId}`)
      if (operationsError) throw operationsError

      let participants = []
      const operationIds = (operations || []).map(operation => operation.id)
      if (operationIds.length) {
        const { data: participantRows, error: participantError } = await supabase
          .from('partner_participants')
          .select('id, nombre, email, telefono, data_json, docs_json')
          .in('partner_operation_id', operationIds)
          .eq('role', 'obligado_solidario')
          .neq('status', 'cancelado')
        if (participantError) throw participantError
        participants = participantRows || []
      }
      setData({ solicitud, location: buildContactLocation(solicitud, participants) })
    } catch (loadError) {
      setError(loadError.message || 'No fue posible consultar la información vinculada.')
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
          {data?.unavailable && (
            <div>
              <p style={{ margin: 0, color: C.text, fontSize: 13, fontWeight: 700 }}>Información no disponible / vínculo pendiente.</p>
              <p style={{ margin: '5px 0 0', color: C.muted, fontSize: 11 }}>Este expediente no tiene una solicitud original vinculada por ID. No se realizaron búsquedas por nombre.</p>
            </div>
          )}
          {location && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
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
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
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
                <Group title="Obligado solidario">
                  {location.obligados.length ? location.obligados.map(obligado => (
                    <div key={obligado.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                        <Value label="Nombre" value={obligado.nombre} />
                        <Value label="Teléfono" value={obligado.telefono} />
                        <Value label="Correo" value={obligado.correo} />
                        <Value label="Domicilio" value={obligado.domicilio} />
                        <Value label="Ocupación" value={obligado.ocupacion} />
                        <Value label="Relación" value={obligado.relacion} />
                      </div>
                      <Source>{obligado.fuente}</Source>
                      {obligado.tieneDocumentos && <span style={{ marginLeft: 6, color: C.greenText, fontSize: 10, fontWeight: 700 }}>Documentos relacionados disponibles</span>}
                    </div>
                  )) : <p style={{ margin: 0, color: C.muted, fontSize: 12 }}>Información no disponible / vínculo pendiente.</p>}
                </Group>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                <p style={{ margin: 0, color: C.muted, fontSize: 11 }}>Sin verificación registrada. Los documentos no se cargaron al abrir este panel.</p>
                <button type="button" onClick={() => window.open(`/poliza/solicitud/${data.solicitud.id}`, '_blank', 'noopener,noreferrer')} style={{ ...st.btn, background: C.blueBg, color: C.blueText, border: '1px solid #93c5fd', fontSize: 11 }}>
                  Consultar ficha y documentos
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
