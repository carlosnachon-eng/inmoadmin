import { supabase } from './supabase'

export const PARTNER_STATUS = {
  recibida: { label: 'Recibida', tone: 'blue' },
  en_revision: { label: 'En revision', tone: 'amber' },
  faltan_documentos: { label: 'Faltan documentos', tone: 'red' },
  aprobada: { label: 'Aprobada', tone: 'green' },
  contrato_en_proceso: { label: 'Contrato en proceso', tone: 'purple' },
  lista_para_firma: { label: 'Lista para firma', tone: 'purple' },
  activa: { label: 'Activa', tone: 'green' },
  rechazada: { label: 'Rechazada', tone: 'red' },
  cancelada: { label: 'Cancelada', tone: 'neutral' },
}

export const COMMISSION_RATE = 0.2

export const fmtMoney = (value) => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
}).format(Number(value) || 0)

export const getPartnerContext = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { session: null, user: null, partnerUser: null, agency: null }

  const { data: partnerUser, error } = await supabase
    .from('partner_users')
    .select('id, auth_user_id, partner_agency_id, nombre, email, role, active, partner_agencies:partner_agency_id(id, nombre_comercial, razon_social, email_contacto, telefono, commission_rate, status)')
    .eq('auth_user_id', session.user.id)
    .eq('active', true)
    .maybeSingle()

  if (error || !partnerUser || partnerUser.partner_agencies?.status !== 'activo') {
    return { session, user: session.user, partnerUser: null, agency: null, error }
  }

  return {
    session,
    user: session.user,
    partnerUser,
    agency: partnerUser.partner_agencies,
  }
}

export const loadPartnerOperations = async (partnerAgencyId) => {
  if (!partnerAgencyId) return []
  const { data, error } = await supabase
    .from('partner_operations')
    .select('id, folio, status_partner, nombre_propietario, nombre_inquilino, direccion_inmueble, monto_renta, monto_poliza_estimado, monto_poliza_final, commission_rate, commission_estimated, commission_generated, commission_paid, observaciones_publicas, solicitud_inquilino_id, propietario_id, poliza_expediente_id, created_at, updated_at')
    .eq('partner_agency_id', partnerAgencyId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export const calcCommission = (amount, rate = COMMISSION_RATE) => {
  const base = Number(amount) || 0
  return Math.round(base * Number(rate || COMMISSION_RATE) * 100) / 100
}
