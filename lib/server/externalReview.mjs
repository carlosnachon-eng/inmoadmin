import { checked } from './externalPayment.mjs'
import { polizaInternalAuth } from './polizaInternalAuth.mjs'
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const caseFields = 'id,folio,origin_type,initiated_by_role,status,created_at'
const paymentFields = 'id,amount,payer_role,payer_name,status,proof_original_name,proof_submitted_at,validated_at,rejected_at,rejection_reason'

export function externalReviewHandler(kind, getDb, enabled = () => process.env.NEXT_PUBLIC_BLINDAJE_EXTERNAL_REVIEW_I2B_ENABLED === 'true') {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (!enabled()) return res.status(404).json({ error: 'No disponible' })
    const method = kind === 'list' ? 'GET' : 'POST'
    if (req.method !== method) { res.setHeader('Allow', method); return res.status(405).json({ error: 'Método no permitido' }) }
    try {
      const db = getDb()
      if (!db) return res.status(503).json({ error: 'Servicio temporalmente no disponible' })
      const auth = await polizaInternalAuth(db, req, kind === 'review')
      if (auth.error) return res.status(auth.status).json({ error: auth.error })
      if (kind === 'list') {
        const rows = checked(await db.from('blindaje_external_cases').select(`${caseFields},payment:blindaje_investigation_payments(${paymentFields}),tenant:solicitudes_inquilino(id,nombre_completo,razon_social,inmueble_interes,pre_viabilidad),owner:propietarios_inmuebles(nombre_propietario,direccion_inmueble),operation:partner_operations(direccion_inmueble,agency:partner_agencies(nombre_comercial))`).order('created_at', { ascending: false }))
        const items = (rows || []).map(row => {
          const payment = Array.isArray(row.payment) ? row.payment[0] : row.payment
          return { case: Object.fromEntries(caseFields.split(',').map(key => [key, row[key]])), payment,
            context: { solicitud_id: row.tenant?.id || null, nombre_inquilino: row.tenant?.nombre_completo || row.tenant?.razon_social || null,
              nombre_propietario: row.owner?.nombre_propietario || null, direccion_inmueble: row.operation?.direccion_inmueble || row.owner?.direccion_inmueble || row.tenant?.inmueble_interes || null,
              agencia: row.operation?.agency?.nombre_comercial || null, pre_viabilidad: row.tenant?.pre_viabilidad ?? null } }
        }).filter(item => item.payment)
        items.sort((a,b) => Number(b.payment.status === 'proof_received') - Number(a.payment.status === 'proof_received') || new Date(b.payment.proof_submitted_at || b.case.created_at) - new Date(a.payment.proof_submitted_at || a.case.created_at))
        return res.status(200).json({ items })
      }
      const body = req.body || {}
      if (!uuid(body.payment_id)) return res.status(400).json({ error: 'Datos inválidos' })
      if (kind === 'proof') {
        if (Object.keys(body).some(key => key !== 'payment_id')) return res.status(400).json({ error: 'Datos inválidos' })
        const p = checked(await db.from('blindaje_investigation_payments').select('id,case_id,proof_storage_path,proof_original_name,proof_content_type').eq('id', body.payment_id).maybeSingle())
        const prefix = p && `cases/${p.case_id}/investigation/${p.id}/`
        const suffix = p?.proof_storage_path?.startsWith(prefix) ? p.proof_storage_path.slice(prefix.length) : ''
        if (!/^[0-9a-f-]+\.(pdf|jpg|png)$/.test(suffix)) return res.status(404).json({ error: 'Comprobante no disponible' })
        const signed = checked(await db.storage.from('blindaje-payment-proofs').createSignedUrl(p.proof_storage_path, 60))
        return res.status(200).json({ url: signed.signedUrl, original_name: p.proof_original_name, content_type: p.proof_content_type })
      }
      if (Object.keys(body).some(key => !['payment_id','action','rejection_reason'].includes(key)) || !['validate','reject'].includes(body.action)) return res.status(400).json({ error: 'Datos inválidos' })
      const reason = typeof body.rejection_reason === 'string' ? body.rejection_reason.trim() : ''
      if (body.action === 'reject' && (reason.length < 3 || reason.length > 300)) return res.status(400).json({ error: 'Escribe un motivo de 3 a 300 caracteres' })
      const status = checked(await db.rpc('blindaje_review_investigation_payment', { p_payment_id: body.payment_id, p_action: body.action, p_actor_id: auth.actorId, p_actor_label: auth.actorLabel, p_rejection_reason: body.action === 'reject' ? reason : null }))
      if (!status) return res.status(409).json({ error: 'El pago cambió o no permite esta acción. Actualiza la lista.' })
      return res.status(200).json({ status })
    } catch (_) { return res.status(503).json({ error: 'No se pudo completar la operación' }) }
  }
}
