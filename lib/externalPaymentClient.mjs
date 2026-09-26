export const externalPaymentEnabled = process.env.NEXT_PUBLIC_BLINDAJE_EXTERNAL_PAYMENT_I2A_ENABLED === 'true'
export const receivedFailure = 'Tu solicitud fue recibida correctamente. No pudimos preparar las instrucciones del anticipo. Comunícate con Emporio para continuar.'
export const legacyReceived = 'Recibimos tu información. Para continuar con el anticipo de investigación, solicita a tu inmobiliaria una liga actualizada.'
export const paymentHref = token => `/blindaje/anticipo#pay=${encodeURIComponent(token)}`
async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store', referrerPolicy: 'no-referrer' })
  if (!response.ok) throw new Error('Anticipo no disponible')
  return response.json()
}
export async function submissionClaim(ref, role) {
  if (!ref.current) ref.current = await post('/api/blindaje/b2c-submission-token', { role })
  return ref.current
}
export async function bootstrapPayment({ origin, role, claim, invitation, linked }) {
  try {
    if (origin === 'b2c') return await post('/api/blindaje/external-payment/bootstrap-b2c', { token: claim.token, role })
    if (!invitation) return { legacy: true }
    if (!linked) return { error: receivedFailure }
    return await post('/api/blindaje/external-payment/bootstrap-partner', { invitation_token: invitation.token })
  } catch (_) { return { error: receivedFailure } }
}
