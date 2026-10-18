import {seal,open,ref} from './crypto.js';
import {isRef,isUuid,isNative} from './config.js';
import {businessManualText} from './manual.js';
import {tokenForComments,health} from './tokenLifecycle.js';

const binding=row=>[
 row.comment_ref,
 row.media_ref,
 row.event_ref,
 new Date(row.occurred_at).toISOString()
];

export function projectBusinessComments({config:c,rows=[]}){
 return rows.map(row=>{
  const b=binding(row);
  const content=open(c,'comment-content',b,row.content_box);
  return {
   id:row.id,
   comment_ref:row.comment_ref,
   media_ref:row.media_ref,
   occurred_at:new Date(row.occurred_at).toISOString(),
   text:typeof content?.text==='string'?content.text:'',
   username:typeof content?.username==='string'?content.username:null,
   parent_id:typeof content?.parent_id==='string'?content.parent_id:null,
   media_product_type:typeof content?.media_product_type==='string'?content.media_product_type:null,
   reply_status:row.reply_status||null
  };
 });
}

export async function sendBusinessCommentReplyOnce({config:c,commentId,text,token,fetchImpl=fetch}){
 if(!/^\d{1,32}$/.test(commentId||'')||!businessManualText(text)||!token)throw Error('comment_send_denied');
 try{
  const r=await fetchImpl(`https://graph.instagram.com/${c.version}/${commentId}/replies`,{
   method:'POST',
   redirect:'error',
   signal:AbortSignal.timeout(15000),
   headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
   body:JSON.stringify({message:text})
  });
  let body;try{body=await r.json();}catch{return{status:'uncertain',http_status:r.status};}
  if(!r.ok||body?.error)return{status:r.status>=400&&r.status<500?'failed':'uncertain',http_status:r.status};
  if(!isNative(String(body?.id||'')))return{status:'uncertain',http_status:r.status};
  return{status:'accepted',http_status:r.status,id:String(body.id)};
 }catch{return{status:'uncertain',http_status:null};}
}

export async function runBusinessCommentReply({config:c,actor,body,store,fetchImpl=fetch,now=Date.now}){
 const blocked=reason=>({status:'blocked',reason});
 try{
  if(!c?.senderEnabled)return{status:'disabled'};
  if(!actor?.active||!['admin','gerente_ventas'].includes(actor.role_id))return blocked('actor_role');
  if(!body||Object.keys(body).sort().join(',')!=='action,comment,text')return blocked('request_fields');
  if(!isUuid(body.action)||!isRef(body.comment)||!businessManualText(body.text))return blocked('request_shape');

  const row=await store.comment(actor.id,body.comment);
  if(!row)return blocked('comment_missing');

  const native=open(c,'comment-native',binding(row),row.native_box);
  if(!/^\d{1,32}$/.test(native?.comment_id||''))return blocked('comment_binding');

  const credential=await store.loadCredential(c.connection);
  const h=health(credential,now());
  if(!h.comments_allowed)return{status:'comments_permission_required'};
  const token=tokenForComments(c,credential,now());

  const textBox=seal(c,'comment-reply',[body.action,body.comment,actor.id],body.text);
  if(!await store.reserveComment(actor.id,body.comment,body.action,textBox))return{status:'already_reserved'};

  const sent=await sendBusinessCommentReplyOnce({config:c,commentId:native.comment_id,text:body.text,token,fetchImpl});
  const outboundRef=sent.id?ref(c,'comment-reply',sent.id):null;
  if(!await store.finishComment(body.action,sent.status,sent.http_status,outboundRef))return{status:'uncertain'};
  return{status:sent.status,http_status:sent.http_status};
 }catch{return{status:'blocked',reason:'comment_unavailable'};}
}
