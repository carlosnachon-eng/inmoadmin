import {createHmac} from 'node:crypto';
import {ref,seal} from '../facebook/messenger/crypto.js';
import {commentBinding} from './facebook.js';
import {bridgeOperation} from './bridge.js';
import {inspectMetaComment,publicationFacts} from './verifiedPublication.js';
import {decideComment} from './decision.js';
export const HISTORY_ORIGIN='meta_history_v1';
const CUTOFF=Date.parse('2026-10-21T23:24:06Z');
export const facebookReviewOperation=body=>['import_history','find_history_proposal'].includes(body?.op)&&Object.keys(body).join(',')==='op'?body:bridgeOperation(body);
// One immutable slot for this explicitly authorized sample, even across concurrent clicks.
export const historicalSampleRef=c=>ref(c,'historical-sample','pr256-20261021-single-v1');
export async function importFacebookHistory({c,token,store,fetchImpl=fetch,db,proposalOnly=false}){
 const slot=proposalOnly?ref(c,'historical-sample','pr256-20261021-property-proposal-v1'):historicalSampleRef(c);
 const base={historical:true,origin:HISTORY_ORIGIN,webhook_verified:false,max_sample:1};
 const existing=await store('events');
 if(!Array.isArray(existing)||existing.some(r=>r.platform!=='facebook'||r.connection_id!==c.connection))throw Error('connection_binding');
 if(existing.some(r=>r.event_ref===slot))return {...base,status:'history_already_imported',inserted:0};
 const get=async(path,params)=>{
  const u=new URL('https://graph.facebook.com/v26.0/'+path);
  for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);
  u.searchParams.set('appsecret_proof',createHmac('sha256',c.secret).update(token).digest('hex'));
  const r=await fetchImpl(u,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
  const d=await r.json();if(!r.ok||d?.error)throw Error('history_meta_read');return d;
 };
 const posts=await get(c.page+'/posts',{fields:proposalOnly?'id,from,message':'id,from',limit:'10'});
 if(!Array.isArray(posts.data)||posts.data.length>10)throw Error('history_shape');
 const native=x=>typeof x==='string'&&/^\d{1,32}(?:_\d{1,32})?$/.test(x);
 let postsChecked=0;
 const exclusions={missing_author:0,own_author:0,hidden:0,invalid_time:0,after_cutoff:0,empty_or_oversize:0,already_captured:0};let commentsSeen=0;
 const proposalExclusions={property_unverified:0,reply_unverified:0,already_replied:0,not_proposable:0};
 for(const p of posts.data){
  if(!native(p.id)||!p.id.startsWith(c.page+'_')||p.from?.id!==c.page)throw Error('history_binding');
  postsChecked++;
  const scope={platform:'facebook',connection_ref:ref(c,'review-connection',c.connection),post_ref:ref(c,'public-post',p.id)};
  if(proposalOnly){
   const facts=await publicationFacts({publication:{...scope,verified:true,text:p.message},event:scope,db,reference:id=>ref(c,'property',id)});
   if(!facts){proposalExclusions.property_unverified++;continue;}
  }
  const edge=await get(p.id+'/comments',{fields:'id,parent,from{id},message,created_time,is_hidden',filter:'toplevel',limit:'10'});
  if(!Array.isArray(edge.data)||edge.data.length>10)throw Error('history_shape');
  for(const m of edge.data){
   commentsSeen++;
   if(!native(m.id)||m.parent!=null)throw Error('history_binding');
   const time=Date.parse(m.created_time);
   const authorVerified=native(m.from?.id);
   const excluded=!Number.isFinite(time)||time<=0?'invalid_time':time>=CUTOFF?'after_cutoff':typeof m.message!=='string'||!m.message.trim()||m.message.length>8000?'empty_or_oversize':m.from?.id===c.page?'own_author':m.is_hidden===true?'hidden':null;
   if(excluded){exclusions[excluded]++;continue;}
   const row={platform:'facebook',connection_id:c.connection,comment_ref:ref(c,'public-comment',m.id),post_ref:scope.post_ref,event_ref:slot,occurred_at:new Date(time).toISOString(),deleted:false};
   if(existing.some(r=>r.comment_ref===row.comment_ref)){exclusions.already_captured++;continue;}
   if(proposalOnly){
    if(!authorVerified){exclusions.missing_author++;continue;}
    const proof=await inspectMetaComment({platform:'facebook',account:c.page,comment:m.id,post:p.id,token,fetchImpl});
    if(!proof.replies_verified){proposalExclusions.reply_unverified++;continue;}
    if(proof.replied){proposalExclusions.already_replied++;continue;}
    const event={...row,...scope,text:m.message,owned:true,author_verified:true,own_author:proof.own_author,deleted:proof.deleted,replies_verified:true};
    const facts=await publicationFacts({publication:{...scope,verified:true,text:proof.publicationText},event,db,reference:id=>ref(c,'property',id)});
    if(decideComment({event,facts}).status!=='proposed'){proposalExclusions.not_proposable++;continue;}
   }
   row.content_box={...seal(c,'public-comment-content',commentBinding(row),{text:m.message,own_author:authorVerified?false:null,author_verified:authorVerified,nested:false,origin:HISTORY_ORIGIN,historical:true}),origin:HISTORY_ORIGIN};
   row.native_box=seal(c,'public-comment-native',commentBinding(row),{comment_id:m.id,post_id:p.id});
   const saved=await store('capture',row);
   if(![0,1].includes(saved?.inserted))throw Error('history_persistence');
   return {...base,status:saved.inserted?'history_imported':'history_already_imported',inserted:saved.inserted,posts_checked:postsChecked,comments_seen:commentsSeen,author_verified:authorVerified,exclusions};
  }
 }
 return {...base,status:'no_eligible_history_in_sample',inserted:0,posts_checked:postsChecked,comments_seen:commentsSeen,exclusions,...(proposalOnly?{proposal_exclusions:proposalExclusions}:{})};
}
