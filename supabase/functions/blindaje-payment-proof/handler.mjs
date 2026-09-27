export const MAX_PROOF_BYTES = 5 * 1024 * 1024
export const BUCKET = 'blindaje-payment-proofs'
const unavailable = 'Esta liga de pago no está disponible.'
const checked = result => { if (result.error) throw new Error('storage-or-database'); return result.data }
const hash = async token => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b => b.toString(16).padStart(2, '0')).join('')
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-payer-role, x-payer-name, x-file-name',
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Type': 'application/json' }
const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: cors })
export function proofExtension(bytes, mime) {
  if (!bytes?.length || bytes.length > MAX_PROOF_BYTES) return null
  if (mime === 'application/pdf' && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') return 'pdf'
  if (mime === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (mime === 'image/png' && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)) return 'png'
  return null
}
async function limitedBody(req) {
  const declaredTooLarge = Number(req.headers.get('content-length')) > MAX_PROOF_BYTES
  const reader = req.body?.getReader()
  if (!reader) return null
  const parts = []; let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    // Drain rejected bodies without retaining them: early cancellation can stall the Edge gateway response.
    if (size > MAX_PROOF_BYTES || declaredTooLarge) parts.length = 0
    else parts.push(value)
  }
  if (size > MAX_PROOF_BYTES || declaredTooLarge) return null
  const buffer = new Uint8Array(size); let offset = 0
  for (const part of parts) { buffer.set(part, offset); offset += part.length }
  return buffer
}
export function proofHandler(getDb) {
  return async req => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (req.method !== 'POST') return reply(405, { error: 'Método no permitido' })
    try {
      const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '')
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return reply(404, { error: unavailable })
      const db = getDb(), tokenHash = await hash(token)
      const access = checked(await db.from('blindaje_case_access_tokens').select('case_id,expires_at,revoked_at').eq('token_hash', tokenHash).eq('purpose', 'payment').maybeSingle())
      if (!access || access.revoked_at || new Date(access.expires_at) <= new Date()) return reply(404, { error: unavailable })
      const externalCase = checked(await db.from('blindaje_external_cases').select('id,status').eq('id', access.case_id).maybeSingle())
      const payment = checked(await db.from('blindaje_investigation_payments').select('id,status,proof_storage_path').eq('case_id', access.case_id).maybeSingle())
      if (!externalCase || !['awaiting_payment','proof_received','payment_rejected'].includes(externalCase.status) || !payment || !['pending','proof_received','rejected'].includes(payment.status)) return reply(404, { error: unavailable })
      const payerRole = req.headers.get('x-payer-role')
      const payerName = decodeURIComponent(req.headers.get('x-payer-name') || '').trim()
      const originalName = decodeURIComponent(req.headers.get('x-file-name') || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255)
      if (!['inquilino','propietario','tercero'].includes(payerRole) || (payerRole === 'tercero' && (!payerName || payerName.length > 200))) return reply(400, { error: 'Indica quién realiza el pago.' })
      const mime = req.headers.get('content-type') || ''
      if (!['application/pdf','image/jpeg','image/png'].includes(mime)) return reply(400, { error: 'El comprobante debe ser PDF, JPG o PNG, de máximo 5 MB.' })
      const bytes = await limitedBody(req), extension = proofExtension(bytes, mime)
      if (!extension) return reply(400, { error: 'El comprobante debe ser PDF, JPG o PNG, de máximo 5 MB.' })
      const path = `cases/${access.case_id}/investigation/${payment.id}/${crypto.randomUUID()}.${extension}`
      const storage = db.storage.from(BUCKET)
      checked(await storage.upload(path, bytes, { contentType: mime, upsert: false }))
      const result = await db.rpc('blindaje_receive_payment_proof', { p_hash: tokenHash, p_expected_path: payment.proof_storage_path,
        p_path: path, p_mime: mime, p_name: originalName, p_payer_role: payerRole, p_payer_name: payerRole === 'tercero' ? payerName : null })
      let committed = result.data === true && !result.error
      if (result.error) {
        // A lost RPC response may still have committed: never remove a referenced proof.
        const current = checked(await db.from('blindaje_investigation_payments').select('proof_storage_path').eq('id', payment.id).single())
        committed = current.proof_storage_path === path
      }
      if (!committed) {
        checked(await storage.remove([path]))
        return reply(409, { error: 'No se pudo guardar este comprobante. Actualiza la página y vuelve a intentarlo.' })
      }
      if (payment.proof_storage_path) {
        const removed = await storage.remove([payment.proof_storage_path])
        if (removed.error) console.error('I2A proof cleanup requires retry') // no token, path or PII
      }
      return reply(200, { status: 'proof_received' })
    } catch (_) {
      return reply(503, { error: 'No pudimos recibir el comprobante. Intenta de nuevo.' })
    }
  }
}
