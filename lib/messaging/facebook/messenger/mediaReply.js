import {randomUUID} from 'node:crypto';
import {isRef,isUuid,isId,isMid} from './config.js';
import {recipient,seal,ref} from './crypto.js';
import {pageToken} from './manual.js';
import {detectMime} from '../../../shadow/media/network.js';
import {COMMERCIAL_INBOX_ROLES} from '../../shared/channelPermissions.js';

const MIME=new Set(['image/jpeg','image/png','image/webp','video/mp4','audio/mp4']);
const MAX_IMAGE=8*1024*1024,MAX_AV=25*1024*1024;
const BUCKET='facebook-messenger-outbound';
const extFor={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','audio/mp4':'m4a'};
export function validateMessengerUpload({actor,body,media}){
 if(!actor?.active||!COMMERCIAL_INBOX_ROLES.includes(actor.role_id)||!isUuid(actor.id)||
  !body||Object.keys(body).sort().join(',')!=='action,input,mime,path,size'||
  !isUuid(body.action)||!isRef(body.input)||!MIME.has(body.mime)||
  typeof body.path!=='string'||!new RegExp('^'+actor.id.replace(/-/g,'\\-')+'/[0-9a-f-]{36}\\.(jpg|png|webp|mp4|m4a)$').test(body.path)||
  !Number.isSafeInteger(body.size)||body.size<1||body.size>(body.mime.startsWith('image/')?MAX_IMAGE:MAX_AV)||
  !Buffer.isBuffer(media)||media.length!==body.size)return false;
 const detected=detectMime(media);
 return detected===body.mime||(body.mime==='audio/mp4'&&detected==='video/mp4');
}
export async function runMessengerMediaReply({config:c,actor,body,store,db,fetchImpl=fetch,now=Date.now}){
 let claimed=false;
 try{
  if(!c?.senderEnabled)return {status:'disabled'};
  if(!actor?.active||!COMMERCIAL_INBOX_ROLES.includes(actor.role_id)||!isUuid(actor.id)||
   !body||Object.keys(body).sort().join(',')!=='action,input,mime,path,size'||
   !isUuid(body.action)||!isRef(body.input)||!MIME.has(body.mime)||
   typeof body.path!=='string'||!body.path.startsWith(actor.id+'/')||
   !Number.isSafeInteger(body.size)||body.size<1||body.size>(body.mime.startsWith('image/')?MAX_IMAGE:MAX_AV))
   return {status:'blocked'};
  const e=await store.input(actor.id,body.input),age=now()-Date.parse(e?.occurred_at);
  if(!e||e.event_ref!==body.input||!Number.isFinite(age)||age<0||age>=23*3600000)return {status:'blocked'};
  const {data,error}=await db.storage.from(BUCKET).download(body.path);
  if(error||!data)return {status:'blocked'};
  const bytes=Buffer.from(await data.arrayBuffer());
  if(!validateMessengerUpload({actor,body,media:bytes}))return {status:'blocked'};
  const psid=recipient(c,e),credential=await store.credential(),token=pageToken(c,credential,now());
  const a={connection:c.connection,actor:actor.id,input:body.input,action:body.action,lease:randomUUID(),
   generation:credential.generation,text_box:seal(c,'manual-text',[body.action,body.input,actor.id],
    JSON.stringify({type:'media',mime:body.mime,path:body.path,size:body.size}))};
  claimed=await store.reserve(a)===true;
  if(!claimed)return {status:'already_consumed_or_blocked'};
  if(!await store.start(a))return {status:'blocked'};
  const kind=body.mime.startsWith('image/')?'image':body.mime==='audio/mp4'?'audio':'video';
  const form=new FormData();
  form.append('messaging_type','RESPONSE');
  form.append('recipient',JSON.stringify({id:psid}));
  form.append('message',JSON.stringify({attachment:{type:kind,payload:{is_reusable:false}}}));
  form.append('filedata',new Blob([bytes],{type:body.mime}), 'attachment.'+extFor[body.mime]);
  let outcome={status:'uncertain',http_status:null,code:null,subcode:null,outbound_ref:null,outbound_box:null};
  try{
   const response=await fetchImpl('https://graph.facebook.com/'+c.version+'/'+c.page+'/messages',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{Authorization:'Bearer '+token},body:form});
   const result=await response.json().catch(()=>null);
   outcome.http_status=response.status;
   if(!response.ok){
    outcome.status=response.status>=400&&response.status<500?'failed':'uncertain';
    outcome.code=Number.isSafeInteger(result?.error?.code)?result.error.code:null;
    outcome.subcode=Number.isSafeInteger(result?.error?.error_subcode)?result.error.error_subcode:null;
   }else if(result?.recipient_id===psid&&isId(result.recipient_id)&&isMid(result.message_id)){
    outcome.status='accepted';
    outcome.outbound_ref=ref(c,'message',result.message_id);
    outcome.outbound_box=seal(c,'outbound',[a.action,a.input],result.message_id);
   }
  }catch{}
  if(!await store.finish(a,outcome))return {status:'uncertain'};
  return {status:outcome.status,http_status:outcome.http_status,code:outcome.code,subcode:outcome.subcode};
 }catch{return {status:claimed?'uncertain':'blocked'};}
}
