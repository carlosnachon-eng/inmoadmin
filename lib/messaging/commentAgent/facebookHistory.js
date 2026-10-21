import {createHmac} from 'node:crypto';
import {ref,seal} from '../facebook/messenger/crypto.js';
import {commentBinding} from './facebook.js';
import {bridgeOperation} from './bridge.js';
export const HISTORY_ORIGIN='meta_history_v1';
const CUTOFF=Date.parse('2026-10-21T23:24:06Z');
export const facebookReviewOperation=body=>body?.op==='import_history'&&Object.keys(body).join(',')==='op'?body:bridgeOperation(body);
// One immutable slot for this explicitly authorized sample, even across concurrent clicks.
export const historicalSampleRef=c=>ref(c,'historical-sample','pr256-20261021-single-v1');
export async function importFacebookHistory({c,token,store,fetchImpl=fetch}){
 const base={historical:true,origin:HISTORY_ORIGIN,webhook_verified:false,max_sample:1};
 const existing=await store('events');
 if(!Array.isArray(existing)||existing.some(r=>r.platform!=='facebook'||r.connection_id!==c.connection))throw Error('connection_binding');
 if(existing.some(r=>r.event_ref===historicalSampleRef(c)))return {...base,status:'history_already_imported',inserted:0};
 const get=async(path,params)=>{
  const u=new URL('https://graph.facebook.com/v26.0/'+path);
  for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);
  u.searchParams.set('appsecret_proof',createHmac('sha256',c.secret).update(token).digest('hex'));
  const r=await fetchImpl(u,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
  const d=await r.json();if(!r.ok||d?.error)throw Error('history_meta_read');return d;
 };
 const posts=await get(c.page+'/posts',{fields:'id,from',limit:'10'});
 if(!Array.isArray(posts.data)||posts.data.length>10)throw Error('history_shape');
 const native=x=>typeof x==='string'&&/^\d{1,32}(?:_\d{1,32})?$/.test(x);
 let postsChecked=0;
 for(const p of posts.data){
  if(!native(p.id)||!p.id.startsWith(c.page+'_')||p.from?.id!==c.page)throw Error('history_binding');
  postsChecked++;
  const edge=await get(p.id+'/comments',{fields:'id,parent,from{id},message,created_time,is_hidden',filter:'toplevel',limit:'10'});
  if(!Array.isArray(edge.data)||edge.data.length>10)throw Error('history_shape');
  for(const m of edge.data){
   if(!native(m.id)||m.parent!=null)throw Error('history_binding');
   const time=Date.parse(m.created_time);
   if(!Number.isFinite(time)||time<=0||time>=CUTOFF||typeof m.message!=='string'||!m.message.trim()||m.message.length>8000||!native(m.from?.id)||m.from.id===c.page||m.is_hidden===true)continue;
   const row={platform:'facebook',connection_id:c.connection,comment_ref:ref(c,'public-comment',m.id),post_ref:ref(c,'public-post',p.id),event_ref:historicalSampleRef(c),occurred_at:new Date(time).toISOString(),deleted:false};
   if(existing.some(r=>r.comment_ref===row.comment_ref))continue;
   row.content_box={...seal(c,'public-comment-content',commentBinding(row),{text:m.message,own_author:false,nested:false,origin:HISTORY_ORIGIN,historical:true}),origin:HISTORY_ORIGIN};
   row.native_box=seal(c,'public-comment-native',commentBinding(row),{comment_id:m.id,post_id:p.id});
   const saved=await store('capture',row);
   if(![0,1].includes(saved?.inserted))throw Error('history_persistence');
   return {...base,status:saved.inserted?'history_imported':'history_already_imported',inserted:saved.inserted,posts_checked:postsChecked};
  }
 }
 return {...base,status:'no_eligible_history_in_sample',inserted:0,posts_checked:postsChecked};
}
