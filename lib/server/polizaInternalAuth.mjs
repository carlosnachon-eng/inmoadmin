import { checked } from './externalPayment.mjs'

export async function polizaInternalAuth(db, req, edit = false) {
  const match = /^Bearer (\S+)$/i.exec(req.headers?.authorization || '')
  if (!match) return { status: 401, error: 'Sesión requerida' }
  try {
    const { data, error } = await db.auth.getUser(match[1])
    if (error || !data?.user) return { status: 401, error: 'Sesión no válida' }
    const profile = checked(await db.from('profiles').select('id,full_name,email,role_id,active,roles:role_id(es_externo)').eq('id', data.user.id).maybeSingle())
    if (!profile || profile.active === false || profile.roles?.es_externo !== false) return { status: 403, error: 'Acceso no permitido' }
    if (profile.role_id !== 'admin') {
      const permission = checked(await db.from('permisos_modulo').select('puede_ver,puede_editar').eq('role_id', profile.role_id).eq('modulo', 'poliza').maybeSingle())
      if (permission?.[edit ? 'puede_editar' : 'puede_ver'] !== true) return { status: 403, error: 'Acceso no permitido' }
    }
    return { actorId: profile.id, actorLabel: profile.full_name || profile.email || 'Equipo Emporio' }
  } catch (_) { return { status: 403, error: 'Acceso no permitido' } }
}

// This gate is deliberately independent of the review UI feature flag.
export async function externalInvestigationGate(db, req, solicitudId) {
  const auth = await polizaInternalAuth(db, req, true)
  if (auth.error) return { status: 403, error: 'Investigación no autorizada' }
  try {
    const c = checked(await db.from('blindaje_external_cases').select('id,status').eq('solicitud_inquilino_id', solicitudId).maybeSingle())
    if (c?.status !== 'payment_validated') return { status: 409, error: 'Anticipo pendiente de validación' }
    const payment = checked(await db.from('blindaje_investigation_payments').select('id,status').eq('case_id', c.id).maybeSingle())
    if (payment?.status !== 'validated') return { status: 409, error: 'Anticipo pendiente de validación' }
    const ledger = checked(await db.from('blindaje_investigation_ledger_entries').select('poliza_caja_id').eq('payment_id', payment.id).maybeSingle())
    if (!ledger?.poliza_caja_id) return { status: 409, error: 'Anticipo pendiente de validación' }
    const income = checked(await db.from('poliza_caja').select('id,tipo,concepto,monto').eq('id', ledger.poliza_caja_id).maybeSingle())
    if (income?.tipo !== 'ingreso' || income.concepto !== 'investigacion' || Number(income.monto) !== 1000) return { status: 409, error: 'Anticipo pendiente de validación' }
    return auth
  } catch (_) { return { status: 409, error: 'No se pudo verificar el anticipo' } }
}
