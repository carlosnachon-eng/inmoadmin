import {createHash} from 'node:crypto';
import {decideComment} from './decision.js';
export const revisionOf=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function reviewStore(db,platform,c,actor){
 return async(op,data={})=>{const r=await db.rpc('comment_review_v1',{p_platform:platform,p_connection:c.connection,p_actor:actor?.id||null,p_op:op,p_data:data});if(r.error)throw Error('review_store_unavailable');return r.data;};
}
export async function recordReview({event,facts,store,crypto,c,now=Date.now()}){
 const decision=decideComment({event,facts,now});
 // Do not churn revisions just because a fresh read has a newer verified_at.
 const revision=revisionOf([event.event_ref,decision.status,decision.reason,decision.public_proposal,facts?.property_ref||null]);
 const box=crypto.seal(c,'commercial-review',[event.comment_ref,revision],decision);
 return store('evaluate',{comment_ref:event.comment_ref,event_ref:event.event_ref,revision,status:decision.status,reason:decision.reason,decision_box:box,opportunity:decision.opportunity_candidate});
}
export async function approveReview({row,text,actor,store,crypto,c}){
 if(!row||row.status!=='proposed'||typeof text!=='string'||!text.trim()||text.length>900||/[<>\u0000-\u001f]/.test(text))return {status:'blocked'};
 // Authenticate existing decision before accepting an edit; no arbitrary comment binding.
 crypto.open(c,'commercial-review',[row.comment_ref,row.revision],row.decision_box);
 return store('approve',{comment_ref:row.comment_ref,revision:row.revision,
  approval_box:crypto.seal(c,'commercial-approval',[row.comment_ref,row.revision,actor.id],{text:text.trim()})});
}
