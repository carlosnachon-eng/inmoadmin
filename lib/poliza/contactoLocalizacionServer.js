import { loadContactLocation, PARTICIPANT_FIELDS } from './contactoLocalizacion.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const denied = (status, error) => ({ status, body: { error } })

export async function readInternalContactLocation({ scoped, service, token, expedienteId }) {
  if (!token) return denied(401, 'Sesion requerida')
  const { data: auth, error: authError } = await scoped.auth.getUser(token)
  if (authError || !auth?.user) return denied(401, 'Sesion invalida')
  const { data: profile, error: profileError } = await service.from('profiles')
    .select('id, role_id, active, roles:role_id(es_externo)').eq('id', auth.user.id).maybeSingle()
  if (profileError) return denied(503, 'No fue posible verificar el acceso')
  if (!profile || profile.active !== true || profile.roles?.es_externo !== false) {
    return denied(403, 'Acceso interno no autorizado')
  }
  if (profile.role_id !== 'admin') {
    const { data: permission, error } = await service.from('permisos_modulo')
      .select('puede_ver, alcance').eq('role_id', profile.role_id).eq('modulo', 'poliza').maybeSingle()
    if (error) return denied(503, 'No fue posible verificar el acceso')
    // Expedientes have no internal owner relation: never reinterpret "propio" as global access.
    if (permission?.puede_ver !== true || permission.alcance !== 'todos') {
      return denied(403, 'Permiso de poliza requerido')
    }
  }
  if (typeof expedienteId !== 'string' || !UUID.test(expedienteId)) return denied(400, 'Expediente invalido')
  const { data: expediente, error } = await scoped.from('poliza_expedientes')
    .select('id, inquilino_id').eq('id', expedienteId).maybeSingle()
  if (error) return denied(503, 'No fue posible verificar el expediente')
  if (!expediente) return denied(404, 'Expediente no disponible')

  // Only participants need the private backend reader. All other reads retain the user's RLS.
  const result = await loadContactLocation(scoped, {
    expedienteId: expediente.id,
    solicitudId: expediente.inquilino_id,
    readParticipants: async operation => {
      const { data: agency, error: agencyError } = await service.from('partner_agencies')
        .select('id').eq('id', operation.partner_agency_id).maybeSingle()
      if (agencyError || !agency) return { data: null, error: agencyError || new Error('Agency unavailable') }
      return service.from('partner_participants').select(PARTICIPANT_FIELDS)
        .eq('partner_operation_id', operation.id).eq('partner_agency_id', agency.id)
        .eq('role', 'obligado_solidario').neq('status', 'cancelado')
    },
  })
  return { status: 200, body: {
    location: result.location, pending: result.pending,
    solicitud: result.solicitud ? { id: result.solicitud.id } : null,
  } }
}
