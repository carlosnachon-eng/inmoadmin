import {randomUUID} from 'node:crypto';
import {manualUuid,validManualText} from '../metaAdminInbox/manualValidation.js';
import {sanitizeManualMetaHttpError} from '../metaAdminInbox/metaHttpError.js';
import {decryptInstagramRecipient} from './manualRecipient.js';

export const SOCIAL_PAGE='119960324707764';
export const SOCIAL_ACCOUNT='17841440384433670';
export const instagramInput=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const instagramManualText=x=>validManualText(x)&&!/[\u0000-\u001f\u007f]/.test(x)&&Array.from(x).length<1000&&Buffer.byteLength(x,'utf8')<=1000;
const actorOK=a=>a?.active===true&&manualUuid(a.id)&&['admin','coord_operaciones'].includes(a.role_id);
const nativeId=x=>typeof x==='string'&&/^[A-Za-z0-9_.:=-]{1,512}$/.test(x);

// A completely separate Instagram transport: no WhatsApp payload or fallback.
// A timeout, malformed response or 5xx consumes the attempt. Never retries.
export async function sendInstagramTextOnce({recipient,replyTo,text,accessToken,fetchImpl=fetch}) {
  if(!/^\d{1,32}$/.test(recipient)||recipient===SOCIAL_ACCOUNT||!nativeId(replyTo)
    ||!instagramManualText(text)||!accessToken)return {status:'blocked'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetchImpl(`https://graph.facebook.com/v26.0/${SOCIAL_PAGE}/messages`,{
      method:'POST',redirect:'error',signal:controller.signal,
      headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({recipient:{id:recipient},message:{text},reply_to:{mid:replyTo}}),
    });
    let body;try{body=await response.json();}catch{return {status:'uncertain'};}
    if(!response.ok)return {status:response.status>=400&&response.status<500?'failed':'uncertain',
      http_error:sanitizeManualMetaHttpError(response.status,body,[accessToken,recipient,replyTo,text])};
    if(body?.error||body?.recipient_id!==recipient||!nativeId(body?.message_id))return {status:'uncertain'};
    return {status:'accepted',message_id:body.message_id};
  }catch{return {status:'uncertain'};}finally{clearTimeout(timer);}
}

export function createInstagramManualStore(db) {
  const rpc=async(name,args)=>{const {data,error}=await db.rpc(name,args);if(error)throw Error('journal_unavailable');return data;};
  return {
    load:(input,actor)=>rpc('instagram_manual_load_dev_v1',{p_input:input,p_actor:actor}),
    reserve:a=>rpc('instagram_manual_reserve_dev_v1',{p_input:a.input,p_actor:a.actor,p_action:a.action,p_lease:a.lease,p_text:a.text}),
    start:a=>rpc('instagram_manual_start_dev_v1',{p_action:a.action,p_lease:a.lease}),
    finish:(a,result)=>rpc('instagram_manual_finish_dev_v1',{p_action:a.action,p_lease:a.lease,
      p_status:result.status,p_message_id:result.message_id||null,p_http_error:result.http_error||null}),
    status:(input,actor)=>rpc('instagram_manual_status_dev_v1',{p_input:input,p_actor:actor}),
  };
}

export async function runInstagramManualReply({input,action,text,actor,store,env=process.env,fetchImpl=fetch,now=Date.now}) {
  if(!actorOK(actor)||!instagramInput(input)||!manualUuid(action)||!instagramManualText(text))return {status:'blocked'};
  if(env.INSTAGRAM_MANUAL_REPLY_ENABLED!=='true')return {status:'disabled'};
  if(env.VERCEL_ENV==='production'||!['test','preview','development'].includes(env.APP_ENV)
    ||env.NEXT_PUBLIC_SUPABASE_URL!=='https://hjfwjnejbcpmknvfpdcq.supabase.co'
    ||env.INSTAGRAM_MANUAL_AUTHORIZED_INPUT!==input||!env.SOCIAL_INSTAGRAM_PAGE_ACCESS_TOKEN)
    return {status:'blocked'};
  // This DEV one-input allowlist is operator configured, never set from request body.
  const a={input,action,text,actor:actor.id,lease:randomUUID()};let reserved=false;
  try {
    const e=await store.load(input,actor.id);
    const age=now()-Date.parse(e?.occurred_at);
    if(e?.observation_key!==input||e?.account_id!==SOCIAL_ACCOUNT||e?.page_id!==SOCIAL_PAGE
      ||e?.kind!=='dm'||e?.provenance!=='customer_inbound'||e?.relation_state!=='exact_subject'
      ||!Number.isFinite(age)||age<0||age>=24*60*60*1000)return {status:'blocked'};
    const recipient=decryptInstagramRecipient(e,env);
    reserved=await store.reserve(a)===true;
    if(!reserved)return {status:'already_consumed_or_blocked'};
    if(await store.start(a)!==true)return {status:'blocked',paused:true};
    const result=await sendInstagramTextOnce({recipient,replyTo:e.native_id,text,
      accessToken:env.SOCIAL_INSTAGRAM_PAGE_ACCESS_TOKEN,fetchImpl});
    if(await store.finish(a,result)!==true)return {status:'uncertain',paused:true};
    return {status:result.status,paused:true};
  }catch{return {status:reserved?'uncertain':'blocked',...(reserved?{paused:true}:{})};}
}
