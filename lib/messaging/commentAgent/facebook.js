import {createHmac,timingSafeEqual} from 'node:crypto';
import {ref,seal,open} from '../facebook/messenger/crypto.js';
const native=x=>typeof x==='string'&&/^\d{1,32}(?:_\d{1,32})?$/.test(x);
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const commentBinding=e=>[e.comment_ref,e.post_ref,e.event_ref,e.occurred_at];
// Separate from captureMessenger: feed events must NEVER become DMs.
export function captureFacebookComments(raw,signature,c){
 if(!Buffer.isBuffer(raw)||!raw.length||raw.length>262144||!/^sha256=[a-f0-9]{64}$/.test(signature||'')
  ||!timingSafeEqual(createHmac('sha256',c.secret).update(raw).digest(),Buffer.from(signature.slice(7),'hex')))throw Error('signature_denied');
 const payload=JSON.parse(raw.toString('utf8'));
 if(payload.object!=='page'||!Array.isArray(payload.entry)||payload.entry.length>100)throw Error('envelope_denied');
 const rows=[];
 for(const entry of payload.entry){
  if(entry.id!==c.page)throw Error('account_denied');
  if(entry.changes!==undefined&&!Array.isArray(entry.changes))throw Error('changes_denied');
  for(const change of entry.changes||[]){
   const v=change.value;if(change.field!=='feed'||v?.item!=='comment')continue;
   if(!['add','edited','remove','hide','unhide'].includes(v.verb))throw Error('verb_unverified');
   if(!native(v.comment_id)||!native(v.post_id)||!v.post_id.startsWith(c.page+'_')||rows.length>=100)throw Error('scope_denied');
   const seconds=v.created_time??entry.time;
   if(!Number.isSafeInteger(seconds)||seconds<=0)throw Error('timestamp_denied');
   const e={platform:'facebook',connection_id:c.connection,comment_ref:ref(c,'public-comment',v.comment_id),post_ref:ref(c,'public-post',v.post_id),event_ref:ref(c,'public-comment-event',canonical(change)),occurred_at:new Date(seconds*1000).toISOString(),deleted:['remove','hide'].includes(v.verb)};
   e.content_box=seal(c,'public-comment-content',commentBinding(e),{text:typeof v.message==='string'?v.message.slice(0,8000):'',own_author:v.from?.id===c.page,nested:!!v.parent_id&&v.parent_id!==v.post_id});
   e.native_box=seal(c,'public-comment-native',commentBinding(e),{comment_id:v.comment_id,post_id:v.post_id});rows.push(e);
  }
 }
 return rows;
}
export function projectFacebookComment(c,e){
 const n=open(c,'public-comment-native',commentBinding(e),e.native_box),content=open(c,'public-comment-content',commentBinding(e),e.content_box);
 if(!native(n.comment_id)||!native(n.post_id)||ref(c,'public-comment',n.comment_id)!==e.comment_ref||ref(c,'public-post',n.post_id)!==e.post_ref)throw Error('binding_denied');
 return {event:{...e,connection_ref:ref(c,'review-connection',c.connection),owned:true,...content},native:n};
}
