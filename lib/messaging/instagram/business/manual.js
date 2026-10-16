import {randomUUID} from 'node:crypto';
import {instagramManualText} from '../manualSender.js';
import {sanitizeManualMetaHttpError} from '../../metaAdminInbox/metaHttpError.js';
import {isRef,isUuid,isNative} from './config.js';
import {openRecipient,seal,ref} from './crypto.js';
import {tokenForSend} from './tokenLifecycle.js';
// Same durable reserve -> pause -> start -> single dispatch -> outcome pattern.
// No legacy token, sender, historical ciphertext or recipient fallback.
export async function sendBusinessTextOnce({config:c,recipient,text,token,fetchImpl=fetch}){
 if(!/^\d{1,32}$/.test(recipient||'')||recipient===c.account||!instagramManualText(text)||!token)throw Error('send_denied');
 try{
  const r=await fetchImpl(`https://graph.instagram.com/${c.version}/${c.account}/messages`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({recipient:{id:recipient},message:{text}})});
  let b;try{b=await r.json();}catch{return {status:'uncertain',http_status:r.status};}
  if(!r.ok)return {status:r.status>=400&&r.status<500?'failed':'uncertain',http_status:r.status,http_error:sanitizeManualMetaHttpError(r.status,b,[token,recipient,text])};
  if(b.error||b.recipient_id!==recipient||!isNative(b.message_id))return {status:'uncertain',http_status:r.status};
  return {status:'accepted',http_status:r.status,message_id:b.message_id};
 }catch{return {status:'uncertain',http_status:null};}
}
export async function runBusinessReply({config:c,actor,body,store,fetchImpl=fetch,now=Date.now,diagnostics=false}){
 let reserved=false,validation='sender_enabled';
 const mark=name=>{validation=name;};
 const blocked=()=>({status:'blocked',...(diagnostics?{diagnostic:{stage:'pre_claim',validation}}:{})});
 const check=(name,ok)=>{mark(name);if(!ok)throw Error('reply_validation_failed');};
 try{
  if(!c?.senderEnabled)return {status:'disabled'};
  check('actor_active',actor?.active===true);
  check('actor_role',['admin','coord_operaciones'].includes(actor.role_id));
  check('actor_id_shape',isUuid(actor.id));
  check('request_fields',!!body&&Object.keys(body).sort().join(',')==='action,input,text');
  check('input_reference_shape',isRef(body.input));check('action_shape',isUuid(body.action));check('manual_text',!!instagramManualText(body.text));
  mark('input_lookup');const e=await store.loadInput(c.connection,body.input,actor.id),age=now()-Date.parse(e?.occurred_at);
  check('input_present',!!e);check('input_reference_match',e.event_ref===body.input);
  check('input_unambiguous',e.ambiguous===false);check('input_not_deleted',e.deleted===false);
  check('input_timestamp',Number.isFinite(age)&&age>=0);check('input_window',age<23*3600000);
  const recipient=openRecipient(c,e,mark).sender;
  mark('credential_lookup');const credential=await store.loadCredential(c.connection),token=tokenForSend(c,credential,now(),mark);
  mark('manual_text_encryption');
  const a={connection_id:c.connection,actor:actor.id,input:body.input,action:body.action,lease:randomUUID(),credential_generation:credential.generation,
   text_box:seal(c,'manual-text',[body.action,body.input,actor.id],body.text)};
  mark('reserve_and_pause');reserved=await store.reserveAndPause(a)===true;if(!reserved)return {status:'already_consumed_or_blocked',...(diagnostics?{diagnostic:{stage:'pre_claim',validation}}:{})};
  // Atomic start rechecks tombstones, profile, credential generation/freshness,
  // sender configuration and human pause. No lease reset or reclaim exists.
  if(!await store.start(a))return {status:'blocked',paused:true};
  const r=await sendBusinessTextOnce({config:c,recipient,text:body.text,token,fetchImpl});
  const outcome={status:r.status,http_status:r.http_status,http_error:r.http_error||null,
   outbound_ref:r.message_id?ref(c,'message',r.message_id):null,
   outbound_box:r.message_id?seal(c,'outbound',[a.action,a.input],r.message_id):null};
  if(!await store.finish(a,outcome))return {status:'uncertain',paused:true};
  return {status:r.status,http_status:r.http_status,paused:true};
 }catch{return reserved?{status:'uncertain',paused:true}:blocked();}
}
