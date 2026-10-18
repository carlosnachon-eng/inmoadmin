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
   reply_status:row.reply_status||null,
   automation_status:row.automation_status||null,
   automation_classification:row.automation_classification||null,
   automation_rule:row.automation_rule||null
  };
 });
}


const AUTOMATION_DM='¡Hola! Gracias por escribirnos 😊 Te contactamos por inbox para darte la información y dar seguimiento a tu consulta.';

const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

export function classifyBusinessCommentAutomation({config:c,row,now=Date.now()}){
 const content=open(c,'comment-content',binding(row),row.content_box);
 const text=fold(content?.text);
 const age=now-new Date(row.occurred_at).getTime();
 if(!Number.isFinite(age)||age<0)return{classification:'review',rule:'invalid_time'};
 if(age>7*24*60*60*1000)return{classification:'expired',rule:'older_than_7d'};
 if(content?.parent_id)return{classification:'review',rule:'nested_reply'};
 if(!text)return{classification:'ignored',rule:'empty'};
 const sensitive=/\b(queja|fraude|estafa|denuncia|demanda|abogado|abogada|juridico|juridica|deposito|devolucion|reembolso|amenaza|amenazas|robo|pesimo|pesima|malo|mala|incumplimiento|profeco|problema|problemas|cobranza|cobro|insulto|caro|cara|abusivo|abusiva|engaño|mentira|mentiroso|mentirosa|discriminacion|acoso)\b|mal servicio|no contestan|no responden|no me han|no cumplen|no sirve|no funciona|me deben|me cobraron|me robaron/i;
 if(sensitive.test(text))return{classification:'review',rule:'sensitive'};
 // Admit only exact, low-risk intents: never classify long or mixed messages based on one keyword.
 const clean=text.replace(/[¿?¡!.,;:]+/g,' ').replace(/\s+/g,' ').trim();
 const commercial=/^(?:precio|info|informes|informacion|ubicacion|costo|cuanto cuesta|cuanto vale|me interesa|estoy interesado|estoy interesada|me das informacion|me pueden dar informacion|me mandas informacion|quiero informes|quiero informacion|donde esta|que precio tiene|cual es el precio)(?: por favor| porfa| gracias)?$/;
 if(commercial.test(clean))return{classification:'commercial',rule:'commercial_exact_v1'};
 const onlyReaction=/^[\s\p{Extended_Pictographic}¡!?.❤️🔥👏🙌😍🥰👍]+$/u;
 if(onlyReaction.test(String(content?.text||'')))return{classification:'ignored',rule:'reaction_only'};
 return{classification:'review',rule:'ambiguous'};
}

export async function sendBusinessPrivateCommentReplyOnce({config:c,commentId,text=AUTOMATION_DM,token,fetchImpl=fetch}){
 if(!/^\d{1,32}$/.test(commentId||'')||!businessManualText(text)||!token)throw Error('comment_private_send_denied');
 try{
  const r=await fetchImpl(`https://graph.instagram.com/${c.version}/${c.account}/messages`,{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
   headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
   body:JSON.stringify({recipient:{comment_id:commentId},message:{text}})
  });
  let body;try{body=await r.json();}catch{return{status:'uncertain',http_status:r.status};}
  if(!r.ok||body?.error)return{status:r.status>=400&&r.status<500?'failed':'uncertain',http_status:r.status};
  const messageId=String(body?.message_id||'');
  if(!isNative(messageId))return{status:'uncertain',http_status:r.status};
  return{status:'dm_sent',http_status:r.status,id:messageId};
 }catch{return{status:'uncertain',http_status:null};}
}

export async function automateBusinessComment({config:c,row,store,fetchImpl=fetch,now=Date.now}){
 try{
  const decision=classifyBusinessCommentAutomation({config:c,row,now:now()});
  const reserved=await store.reserveCommentAutomation(row.comment_ref,row.media_ref,row.event_ref,decision.classification,decision.rule);
  if(!reserved)return{status:'already_classified',...decision};
  if(decision.classification!=='commercial')return{status:decision.classification,...decision};\n  if(dryRun)return{status:'shadow_commercial',...decision};\n  if(!c?.senderEnabled)return{status:'disabled',...decision};

  const native=open(c,'comment-native',binding(row),row.native_box);
  if(!/^\d{1,32}$/.test(native?.comment_id||'')){
   await store.finishCommentAutomation(row.comment_ref,'failed',null,null);
   return{status:'failed',classification:'commercial',rule:'comment_binding'};
  }

  const credential=await store.loadCredential(c.connection);
  const h=health(credential,now());
  if(!h.comments_allowed){
   await store.finishCommentAutomation(row.comment_ref,'failed',null,null);
   return{status:'failed',classification:'commercial',rule:'permission_required'};
  }
  const token=tokenForComments(c,credential,now());
  const sent=await sendBusinessPrivateCommentReplyOnce({config:c,commentId:native.comment_id,token,fetchImpl});
  const outboundRef=sent.id?ref(c,'comment-private-reply',sent.id):null;
  await store.finishCommentAutomation(row.comment_ref,sent.status,sent.http_status,outboundRef);
  return{status:sent.status,classification:'commercial',rule:decision.rule};
 }catch{
  return{status:'uncertain',classification:'review',rule:'automation_unavailable'};
 }
}


export async function processBusinessCommentAutomations({config:c,store,fetchImpl=fetch,now=Date.now,limit=10,dryRun=false}){
 const rows=await store.commentAutomationCandidates(limit);
 const results=[];
 for(const row of rows||[]){
  const result=await automateBusinessComment({config:c,row,store,fetchImpl,now});
  results.push({comment_ref:row.comment_ref,status:result.status,classification:result.classification,rule:result.rule});
 }
 return{processed:results.length,results};
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
