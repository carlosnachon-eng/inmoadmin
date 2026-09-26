export const externalPaymentEnabled = process.env.NEXT_PUBLIC_BLINDAJE_EXTERNAL_PAYMENT_I2A_ENABLED === 'true'
export const receivedFailure = 'Tu solicitud fue recibida correctamente. No pudimos preparar las instrucciones del anticipo. Comunícate con Emporio para continuar.'
export const legacyReceived = 'Recibimos tu información. Para continuar con el anticipo de investigación, solicita a tu inmobiliaria una liga actualizada.'
export const paymentHref = token => `/blindaje/anticipo#pay=${encodeURIComponent(token)}`
async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store', referrerPolicy: 'no-referrer' })
  if (!response.ok) {
    const error = new Error('Anticipo no disponible')
    error.status = response.status
    throw error
  }
  return response.json()
}
export const claimStorageKey = role => `blindaje:b2c:submission:${role}`
function session() { return window.sessionStorage }
export function storedClaim(ref, role, storage = session()) {
  const key = claimStorageKey(role)
  const raw = storage.getItem(key)
  let value
  try { value = raw ? JSON.parse(raw) : null } catch (_) { value = null }
  if (!value || value.role !== role || !/^[A-Za-z0-9_-]{43}$/.test(value.token)
    || !/^[a-f0-9]{64}$/.test(value.claim_hash) || !(Date.parse(value.expires_at) > Date.now())) {
    if (raw) storage.removeItem(key)
    ref.current = null
    return null
  }
  ref.current = { token: value.token, claim_hash: value.claim_hash, expires_at: value.expires_at, role }
  return ref.current
}
export async function submissionClaim(ref, role, storage = session()) {
  const existing = storedClaim(ref, role, storage)
  if (existing) return existing
  const issued = await post('/api/blindaje/b2c-submission-token', { role })
  // Persist before INSERT. If session storage is unavailable, fail before sending the form.
  const claim = { token: issued.token, claim_hash: issued.claim_hash, expires_at: issued.expires_at, role }
  storage.setItem(claimStorageKey(role), JSON.stringify(claim))
  return storedClaim(ref, role, storage)
}
export function navigateToPayment(result) {
  if (!result?.payment_token) return false
  window.location.replace(paymentHref(result.payment_token))
  return true
}
export async function recoverPayment({ role, claim, invitationToken }) {
  try {
    return invitationToken
      ? await post('/api/blindaje/external-payment/bootstrap-partner', { invitation_token: invitationToken })
      : await post('/api/blindaje/external-payment/bootstrap-b2c', { token: claim.token, role })
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}
export async function bootstrapPayment({ origin, role, claim, invitation, linked }) {
  try {
    if (origin === 'b2c') return await post('/api/blindaje/external-payment/bootstrap-b2c', { token: claim.token, role })
    if (!invitation) return { legacy: true }
    if (!linked) return { error: receivedFailure }
    return await post('/api/blindaje/external-payment/bootstrap-partner', { invitation_token: invitation.token })
  } catch (_) { return { error: receivedFailure } }
}
