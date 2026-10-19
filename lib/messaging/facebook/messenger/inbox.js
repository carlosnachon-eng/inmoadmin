import {messengerConfig,isRef,isUuid,PROVIDER,CHANNEL} from './config.js';
import {open,binding} from './crypto.js';
import {COMMERCIAL_INBOX_ROLES} from '../../shared/channelPermissions.js';

const roles=new Set(COMMERCIAL_INBOX_ROLES);
export function presentMessengerHistory(c,thread,rows){
 if(!Array.isArray(rows)||rows.length>200)throw Error('history_denied');
 const seen=new Set();
 return rows.map(e=>{
  if(e.connection_id!==c.connection||e.thread_ref!==thread||!isRef(e.event_ref)||!isRef(e.message_ref)
   ||!['inbound','echo','unsupported','deleted'].includes(e.kind)||seen.has(e.event_ref))throw Error('history_denied');
  seen.add(e.event_ref);
  const content=e.deleted?null:open(c,'content',binding(e),e.content_box);
  if(content&&!(content.text===null||typeof content.text==='string'))throw Error('history_denied');
  return {input:e.event_ref,channel:CHANNEL,kind:e.kind,occurred_at:e.occurred_at,
   text:e.deleted?'Mensaje anulado':content?.text||null,unsupported:e.kind==='unsupported',
   attachment_types:Array.isArray(content?.attachment_types)?content.attachment_types.filter(t=>['image','audio','video','file'].includes(t)).slice(0,20):[],
   can_reply:e.reply_allowed===true&&!e.deleted&&e.kind==='inbound',
   outcome:e.action_state||null};
 });
}

export function createMessengerInboxApi({authorize,getDb,env=()=>process.env}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  try{
   const c=messengerConfig(env());if(!c)return res.status(404).end();
   const actor=await authorize(req);
   if(!actor?.active||!isUuid(actor.id)||!roles.has(actor.role_id))return res.status(403).json({status:'forbidden'});
   const op=req.query?.op||'threads',thread=req.query?.thread;
   if(req.method!=='GET'||!['threads','history'].includes(op))return res.status(405).end();
   if(op==='history'&&!isRef(thread))return res.status(400).json({status:'invalid_thread'});
   const db=await getDb();
   const {data,error}=await db.rpc('fb_messenger_inbox_v1',{p_connection:c.connection,p_actor:actor.id,p_thread:op==='history'?thread:null});
   if(error)throw Error('store_unavailable');
   if(!data)return res.status(403).json({status:'forbidden'});
   let previewMap=new Map();
   if(op==='threads'&&Array.isArray(data.rows)&&data.rows.length){
    const {data:previews,error:previewError}=await db.rpc('fb_messenger_thread_previews_v1',
     {p_connection:c.connection,p_actor:actor.id});
    if(!previewError&&Array.isArray(previews)){
     for(const e of previews){
      if(e.connection_id!==c.connection||!isRef(e.thread_ref)||!isRef(e.event_ref)||!isRef(e.message_ref))continue;
      try{
       const payload=open(c,'content',binding(e),e.content_box);
       if(typeof payload?.text==='string')previewMap.set(e.thread_ref,payload.text.trim().slice(0,90));
      }catch{}
     }
    }
   }
   return res.status(200).json({provider:PROVIDER,channel:CHANNEL,sender_enabled:actor.role_id==='admin'&&c.senderEnabled&&data.sender_enabled===true,
    rows:op==='history'?presentMessengerHistory(c,thread,data.rows):data.rows.map(t=>({thread_ref:t.thread_ref,channel:CHANNEL,occurred_at:t.occurred_at,preview:previewMap.get(t.thread_ref)||null}))});
  }catch{return res.status(503).json({status:'messenger_inbox_unavailable'});}
 };
}
