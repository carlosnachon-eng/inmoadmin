import { invitationDb } from '../../../../lib/server/partnerInvitationDb.js'
import { externalReviewHandler } from '../../../../lib/server/externalReview.mjs'
export default externalReviewHandler('list', invitationDb)
