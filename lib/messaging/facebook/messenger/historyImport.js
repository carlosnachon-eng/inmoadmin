import {PROVIDER,CHANNEL,isId,isMid} from './config.js';
import {ref,seal,binding} from './crypto.js';
import {pageToken} from './manual.js';

const DAY=86400000;
const list=xs=>Array.isArray(xs?.data)?xs.data:Array.isArray(xs)?xs:[];
const person=(obj,page)=>list(obj).map(x=>x?.id).find(id=>isId(id)&&id!==page)||null;
async function graph(url,token,fetchImpl){
 const response=await fetchImpl(url,{method:'GET',cache:'no-store',redirect:'error',
  signal:AbortSignal.timeout(14000),headers:{Authorization:`Bearer ${token}`}});
 const data=await response.json().catch(()=>null);
 if(!response.ok||!data||data.error)throw Error('facebook_history_meta_unavailable');
 return data;
}
export async function importMessengerHistory({config:c,actor,store,db,fetchImpl=fetch,now=Date.now()}){
 if(!actor?.active||actor.role_id!=='admin')throw Error('history_denied');
 const credential=await store.credential();
 const token=pageToken(c,credential,now);
 const cutoff=now-7*DAY;
 const u=new URL(`https://graph.facebook.com/${c.version}/${c.page}/conversations`);
 u.searchParams.set('platform','MESSENGER');
 u.searchParams.set('fields','id,updated_time,participants');
 u.searchParams.set('limit','30');
 const index=await graph(u,token,fetchImpl);
 const conversations=list(index).slice(0,30);
 let inserted=0,duplicates=0,scanned=0,eligible=0,truncated=list(index).length===30;
 for(const conv of conversations){
  if(typeof conv?.id!=='string'||!/^[A-Za-z0-9_:-]{1,150}$/.test(conv.id))continue;
  if(Number.isFinite(Date.parse(conv.updated_time))&&Date.parse(conv.updated_time)<cutoff)continue;
  const participants=person(conv.participants,c.page);
  const murl=new URL(`https://graph.facebook.com/${c.version}/${conv.id}/messages`);
  murl.searchParams.set('fields','id,created_time,from,to,message');
  murl.searchParams.set('limit','25');
  const messages=await graph(murl,token,fetchImpl);
  const rows=[];
  if(list(messages).length===25)truncated=true;
  for(const m of list(messages).slice(0,25)){
   const occurred=Date.parse(m?.created_time);
   if(!Number.isFinite(occurred)||occurred<cutoff||occurred>now+300000||!isMid(m.id))continue;
   const from=m.from?.id;
   const to=person(m.to,c.page);
   const psid=from===c.page?(to||participants):from;
   if(!isId(psid)||psid===c.page)continue;
   const body=typeof m.message==='string'&&Buffer.byteLength(m.message,'utf8')<=16000?m.message:null;
   const kind=body===null?'unsupported':from===c.page?'echo':'inbound';
   const row={provider:PROVIDER,channel:CHANNEL,connection_id:c.connection,
    kind,thread_ref:ref(c,'thread',psid),message_ref:ref(c,'message',m.id),
    event_ref:ref(c,'event',kind,m.id),occurred_at:new Date(occurred).toISOString()};
   row.content_box=seal(c,'content',binding(row),{text:body,attachment_types:[]});
   row.recipient_box=kind==='inbound'?seal(c,'recipient',binding(row),{psid,mid:m.id}):null;
   rows.push(row);
  }
  if(!rows.length)continue;
  eligible++;
  const {data,error}=await db.rpc('fb_messenger_import_history_v1',
   {p_connection:c.connection,p_actor:actor.id,p_rows:rows});
  if(error||data?.received!==rows.length)throw Error('facebook_history_persistence_unavailable');
  inserted+=data.inserted||0;duplicates+=data.duplicates||0;scanned+=rows.length;
 }
 return {status:'ok',days:7,conversations_checked:conversations.length,
  conversations_with_messages:eligible,scanned,inserted,duplicates,truncated};
}
