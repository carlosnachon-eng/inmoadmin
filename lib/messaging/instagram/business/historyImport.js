import {createHash} from 'node:crypto';
import {PROVIDER} from './config.js';
import {ref,seal,eventBinding} from './crypto.js';
import {sanitizeReviewText} from './content.js';
import {tokenForSend} from './tokenLifecycle.js';

const DAY=86400000;
const hash=x=>createHash('sha256').update(x).digest('hex');
const native=x=>typeof x==='string'&&/^\d{1,32}$/.test(x);

async function graphJson(url,token,fetchImpl,stage){
 const r=await fetchImpl(url,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(15000)});
 let b;try{b=await r.json();}catch{throw Error(`history_${stage}_invalid_json`);}
 if(!r.ok||b?.error)throw Error(`history_${stage}_unavailable`);
 return b;
}

function recipientId(to,account){
 const list=Array.isArray(to?.data)?to.data:Array.isArray(to)?to:[];
 const hit=list.find(x=>native(x?.id)&&x.id!==account);
 return hit?.id||null;
}

export async function importRecentBusinessHistory({config:c,actor,store,fetchImpl=fetch,now=Date.now()}){
 let internalStage='credential';
 try{
 const credential=await store.loadCredential(c.connection);
 const token=tokenForSend(c,credential,now);
 const cutoff=now-7*DAY;
 const u=new URL(`https://graph.instagram.com/${c.version}/me/conversations`);
 u.searchParams.set('platform','instagram');
 u.searchParams.set('fields','id');
 u.searchParams.set('limit','50');
 internalStage='list';
 const list=await graphJson(u,token,fetchImpl,'list');
 const rawConversations=Array.isArray(list.data)?list.data:[];
 const conversations=rawConversations.slice(0,100);
 let imported=0,duplicates=0,scanned=0,truncated=false;
 for(const conv of conversations){
  if(typeof conv.id!=='string'||!conv.id)continue;
  const d=new URL(`https://graph.instagram.com/${c.version}/${conv.id}`);
  d.searchParams.set('fields','messages');
  internalStage='detail';
  const detail=await graphJson(d,token,fetchImpl,'detail');
  const messageRefs=Array.isArray(detail?.messages?.data)?detail.messages.data.slice(0,20):[];
  if(messageRefs.length===20)truncated=true;
  const rows=[];
  for(const item of messageRefs){
   if(typeof item?.id!=='string'||!item.id)continue;
   const mu=new URL(`https://graph.instagram.com/${c.version}/${item.id}`);
   mu.searchParams.set('fields','id,created_time,from,to,message');
   internalStage='message';
   const m=await graphJson(mu,token,fetchImpl,'message');
   const when=Date.parse(m.created_time);
   if(!Number.isFinite(when)||when<cutoff||when>now+300000||typeof m.id!=='string')continue;
   const from=native(m.from?.id)?m.from.id:null;
   const subject=from===c.account?recipientId(m.to,c.account):from;
   if(!native(subject)||subject===c.account)continue;
   const kind=from===c.account?'echo':'inbound';
   const row={provider:PROVIDER,connection_id:c.connection,thread_type:'instagram_dm',kind,
    subject_ref:ref(c,'subject',subject),thread_ref:ref(c,'thread',subject),message_ref:ref(c,'message',m.id),
    event_ref:ref(c,'event','history',m.id,m.created_time,from||''),occurred_at:new Date(when).toISOString()};
   row.content_box=seal(c,'content',eventBinding(row),{text:sanitizeReviewText(m.message),media:[],unsupported:false});
   row.recipient_box=kind==='inbound'?seal(c,'recipient',eventBinding(row),{sender:subject,mid:m.id}):null;
   row.receipt_ref=hash(`${c.connection}:history:${conv.id}:${m.id}`);
   rows.push(row);scanned++;
  }
  if(rows.length){
   internalStage='persist';
   const r=await store.importHistory(actor.id,rows);
   if(r?.durable!==true)throw Error('history_not_durable');
   imported+=Number(r.inserted||0);duplicates+=Number(r.duplicates||0);
  }
 }
 return {status:'ok',days:7,conversation_candidates:rawConversations.length,conversations:conversations.length,scanned,inserted:imported,duplicates,truncated_to_recent_20:truncated};
 }catch(e){
  if(/^history_(?:list|detail|message)_(?:invalid_json|unavailable)$/.test(String(e?.message||''))||e?.message==='history_not_durable')throw e;
  throw Error('history_internal_'+internalStage);
 }
}
