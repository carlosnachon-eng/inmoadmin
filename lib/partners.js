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
    .select('id, auth_user_id, partner_agency_id, nombre, email, role, active, partner_agencies:partner_agency_id(id, nombre_comercial, razon_social, email_contacto, telefono, ciudad, website, logo_url, brand_color, commission_rate, status)')
    .eq('auth_user_id', session.user.id)
    .eq('active', true)
    .maybeSingle()

  if (error || !partnerUser) {
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
    .select('id, folio, status_partner, nombre_propietario, telefono_propietario, correo_propietario, nombre_inquilino, telefono_inquilino, correo_inquilino, direccion_inmueble, monto_renta, monto_poliza_estimado, monto_poliza_final, commission_rate, commission_estimated, commission_generated, commission_paid, observaciones_publicas, solicitud_inquilino_id, propietario_id, poliza_expediente_id, poliza_expedientes:poliza_expediente_id(id, status, fecha_firma, fecha_vigencia, fecha_inicio), created_at, updated_at')
    .eq('partner_agency_id', partnerAgencyId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export const partnerOperationLinks = (operation, agency, baseUrl = '') => {
  if (!operation?.id || !agency?.id) return { inquilino: '', propietario: '' }
  const params = `partner=${encodeURIComponent(agency.id)}&operacion=${encodeURIComponent(operation.id)}`
  const origin = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '')
  return {
    inquilino: `${origin}/solicitud-inquilino?${params}`,
    propietario: `${origin}/registro-propietario?${params}`,
  }
}

export const partnerParticipantLink = (operation, agency, participant, baseUrl = '') => {
  if (!operation?.id || !agency?.id || !participant?.id) return ''
  const params = `partner=${encodeURIComponent(agency.id)}&operacion=${encodeURIComponent(operation.id)}&participante=${encodeURIComponent(participant.id)}`
  const origin = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '')
  if (participant.role === 'propietario_adicional') return `${origin}/registro-propietario?${params}`
  if (participant.role === 'inquilino_adicional') return `${origin}/solicitud-inquilino?${params}`
  return `${origin}/solicitud-obligado?${params}`
}

export const calcCommission = (amount, rate = COMMISSION_RATE) => {
  const base = Number(amount) || 0
  return Math.round(base * Number(rate || COMMISSION_RATE) * 100) / 100
}

export const calcPolicyPrice = (rent) => {
  const amount = Number(rent) || 0
  if (!amount) return null
  if (amount <= 7000) return { label: 'Hasta $7,000', price: 2800, formula: null }
  if (amount <= 10000) return { label: '$7,001 a $10,000', price: 3200, formula: null }
  if (amount <= 15000) return { label: '$10,001 a $15,000', price: 3800, formula: null }
  if (amount <= 20000) return { label: '$15,001 a $20,000', price: 4500, formula: null }
  if (amount <= 25000) return { label: '$20,001 a $25,000', price: 5200, formula: null }
  if (amount <= 30000) return { label: '$25,001 a $30,000', price: 6100, formula: null }
  if (amount <= 40000) return { label: '$30,001 a $40,000', price: 9500, formula: null }
  if (amount <= 50000) return { label: '$40,001 a $50,000', price: 12500, formula: null }
  return { label: '$50,001 en adelante', price: Math.round(amount * 0.25 * 100) / 100, formula: '25% de una renta mensual' }
}
