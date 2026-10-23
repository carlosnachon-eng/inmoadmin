import {decideComment} from './decision.js';
import {revisionOf} from './review.js';

// One user-authorized DEV observation. Not an inventory record or production association.
export const CONFIRMED_EVENT='09082f812f5efd9360ef5e853a39929e24c4364b831e7a3c3ab24df00ba73736';
export const confirmedEvaluationResult=result=>['recorded','unchanged'].includes(result?.status)
 ?{status:'evaluated',processed:1,persistence:result.status}:result;
export async function recordConfirmedDevProposal({event,c,actor,store,crypto,now=Date.now()}){
 if(c.connection!=='74c3f858-c4f6-40af-a068-6ef159819a87'||c.app!=='2220237475209417'||c.page!=='119960324707764'||c.senderEnabled
  ||event.platform!=='facebook'||event.connection_id!==c.connection||event.event_ref!==CONFIRMED_EVENT
  ||event.connection_ref!==crypto.ref(c,'review-connection',c.connection)||!actor?.id||!['admin','gerente_ventas'].includes(actor.role_id))return {status:'confirmed_target_denied',writes:0};
 if(now>=Date.parse('2026-10-24T06:00:00Z'))return {status:'confirmation_expired',writes:0};
 // Existing classification/ownership/reply gates must pass. Do not forge fresh inventory facts.
 const base=decideComment({event,facts:null,now});
 if(base.reason!=='property_binding_or_freshness'||base.intent!=='price')return {status:'blocked',reason:base.reason,writes:0};
 const evidence={source:'user_confirmed_dev_observation',property_public_id:'EB-UW8871',price:6700000,currency:'MXN',
  association:'explicit_user_confirmation',price_basis:'previous_authorized_inmoadmin_read_and_user_confirmation',
  inventory_live_read:false,availability_verified:false,confirmed_on:'2026-10-23',actor:actor.id,
  platform:event.platform,connection_ref:event.connection_ref,post_ref:event.post_ref,event_ref:event.event_ref};
 const decision={...base,status:'proposed',reason:'user_confirmed_dev_price',public_proposal:'El precio de venta es $6,700,000 MXN.',
  property_public_id:evidence.property_public_id,evidence,source_fingerprint:revisionOf(evidence)};
 const revision=revisionOf([event.event_ref,decision.reason,decision.public_proposal,evidence]);
 const box=crypto.seal(c,'commercial-review',[event.comment_ref,revision],decision);
 return store('evaluate',{comment_ref:event.comment_ref,event_ref:event.event_ref,revision,status:decision.status,
  reason:decision.reason,decision_box:box,opportunity:decision.opportunity_candidate});
}
