import {randomUUID} from 'node:crypto';
import {sanitizeShadowText} from '../../shadow/coordinator.js';
import {decryptAccreditedRecipient} from '../metaAdminCapture/accreditedRecipient.js';
import {sendMetaTextOnce} from '../metaAdminCapture/metaTextTransport.js';
import {sanitizeManualMetaHttpError} from './metaHttpError.js';

export const manualUuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
export function validManualText(text) {
  return typeof text==='string'&&text.length>0&&text.length<=2000&&text===text.trim()
    &&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069<>]/.test(text)
    &&sanitizeShadowText(text).text===text&&!sanitizeShadowText(text).rejected;
}
export function createManualStore(db) {
  const rpc=async(name,args)=>{const {data,error}=await db.rpc(name,args);if(error)throw Error('manual_journal_unavailable');return data;};
  return {
    load:(inputId,actorId)=>rpc('meta_admin_manual_load_v1',{p_input_id:inputId,p_actor_id:actorId}),
    reserve:a=>rpc('meta_admin_manual_reserve_v1',{p_input_id:a.inputId,p_actor_id:a.actorId,p_action_id:a.actionId,p_token:a.token,p_text:a.text}),
    start:a=>rpc('meta_admin_manual_start_v1',{p_action_id:a.actionId,p_token:a.token}),
    finish:(a,result)=>result.http_error
      ?rpc('meta_admin_manual_finish_http_error_v1',{p_action_id:a.actionId,p_token:a.token,p_status:result.status,p_http_error:result.http_error})
      :rpc('meta_admin_manual_finish_v1',{p_action_id:a.actionId,p_token:a.token,p_status:result.status,p_wamid:result.wamid}),
    status:(inputId,actorId)=>rpc('meta_admin_manual_status_v1',{p_input_id:inputId,p_actor_id:actorId})
  };
}
// Caller supplies ONLY the authenticated actor, explicit input, action key and text.
// The database reauthorizes before reservation AND dispatch. Never accepts a recipient.
export async function runManualReply({inputId,actionId,text,actor,store,env=process.env,fetchImpl=fetch}) {
  if(!actor?.active||!['admin','coord_operaciones'].includes(actor.role_id)||!manualUuid(actor.id))return {status:'blocked'};
  if(!manualUuid(inputId)||!manualUuid(actionId)||!validManualText(text))return {status:'blocked'};
  if(env.META_ADMIN_MANUAL_REPLY_ENABLED!=='true')return {status:'disabled'};
  if(!env.META_ADMIN_OUTBOUND_ACCESS_TOKEN)return {status:'blocked'};
  const a={inputId,actionId,text,actorId:actor.id,token:randomUUID()};
  let reserved=false,started=false;
  try {
    const e=await store.load(inputId,actor.id);
    if(!e?.input) return {status:'blocked'};
    const to=decryptAccreditedRecipient(e,e.input,env);
    reserved=await store.reserve(a)===true;
    if(!reserved)return {status:'already_consumed_or_blocked'};
    // Paused durably already. A crash from here can never reclaim this action.
    started=await store.start(a)===true;
    if(!started)return {status:'blocked',paused:true};
    const result=await sendMetaTextOnce({phoneNumberId:e.input.phone_number_id,to,text,
      replyTo:e.input.native_message_id,accessToken:env.META_ADMIN_OUTBOUND_ACCESS_TOKEN,fetchImpl,
      httpErrorProjection:(status,body)=>sanitizeManualMetaHttpError(status,body,[to,text,e.input.native_message_id,env.META_ADMIN_OUTBOUND_ACCESS_TOKEN])});
    if(await store.finish(a,result)!==true)return {status:'uncertain',paused:true};
    return {status:result.status,paused:true};
  } catch {return {status:reserved||started?'uncertain':'blocked',...(reserved?{paused:true}:{})};}
}
