import {createBusinessStore} from '../instagram/business/store.js';
import {tokenForComments} from '../instagram/business/tokenLifecycle.js';
import {projectBusinessComments} from '../instagram/business/comments.js';
import * as crypto from '../instagram/business/crypto.js';
import {inspectMetaComment,publicationFacts} from './verifiedPublication.js';
import {recordReview} from './review.js';

// Shared by the local API and authenticated DEV bridge. Meta reads only.
export async function evaluateInstagram({db,c,actor,store,fetchImpl=fetch}){
 const legacy=createBusinessStore(db,c.connection),raw=await legacy.comments(actor.id);
 if(!Array.isArray(raw)||raw.length>200)throw Error('batch');
 const inputs=raw.slice(0,20).map(r=>{
  const p=projectBusinessComments({config:c,rows:[r]})[0];
  const native=crypto.open(c,'comment-native',[r.comment_ref,r.media_ref,r.event_ref,new Date(r.occurred_at).toISOString()],r.native_box);
  return {stored:{...r,post_ref:r.media_ref},native,event:{...p,event_ref:r.event_ref,platform:'instagram',post_ref:r.media_ref,connection_ref:crypto.ref(c,'review-connection',c.connection),owned:true,nested:!!p.parent_id}};
 });
 for(const input of inputs)await store('capture',input.stored);
 let token=null;
 try{token=tokenForComments(c,await legacy.loadCredential(c.connection));}catch{/* Fail closed: no OAuth or renewal. */}
 for(const input of inputs){
  const event={...input.event,replies_verified:false};let facts=null;
  if(token)try{
   const proof=await inspectMetaComment({platform:'instagram',account:c.account,comment:input.native.comment_id,post:input.native.media_id,token,fetchImpl});
   Object.assign(event,{replies_verified:proof.replies_verified,own_author:proof.own_author,deleted:event.deleted||proof.deleted});
   if(proof.replied)event.reply_status='external_reply';
   facts=await publicationFacts({publication:{verified:true,platform:'instagram',connection_ref:event.connection_ref,post_ref:event.post_ref,text:proof.publicationText},event,db,reference:id=>crypto.ref(c,'property',id)});
  }catch{/* Unknown is not proof of no reply. No publication on any path. */}
  await recordReview({event,facts,store,crypto,c});
 }
 return {status:'evaluated',processed:inputs.length,sender:false,private_replies:false};
}
