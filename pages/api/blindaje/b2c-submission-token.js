import { externalPaymentHandler } from '../../../lib/server/externalPayment.mjs'
import { invitationDb } from '../../../lib/server/partnerInvitationDb'
export const config = { api: { bodyParser: { sizeLimit: '4kb' } } }
export default externalPaymentHandler('claim', invitationDb)
