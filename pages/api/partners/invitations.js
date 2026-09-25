import { invitationHandler } from '../../../lib/server/partnerInvitations.mjs'
import { invitationDb } from '../../../lib/server/partnerInvitationDb'

export const config = { api: { bodyParser: { sizeLimit: '4kb' } } }
export default invitationHandler('manage', invitationDb)
