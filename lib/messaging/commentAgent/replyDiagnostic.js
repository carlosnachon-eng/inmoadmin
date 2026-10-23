import {inspectMetaComment} from './verifiedPublication.js';

// Exact first certified organic DEV event; never select a later event by timing/text.
export const certifiedOrganicTarget=rows=>rows.filter(r=>r.content_box?.origin!=='meta_history_v1'&&r.event_ref==='09082f812f5efd9360ef5e853a39929e24c4364b831e7a3c3ab24df00ba73736'&&!r.deleted);

// Runs the same reader as evaluation; records structure only, never Graph values.
export async function diagnoseReplyRead({account,comment,post,token,fetchImpl=fetch,includePublication=false}){
 const steps=[];let stage='publication';let publication=null;
 const read=async(url,options)=>{
  stage=steps.length===0?'publication':steps.length===1?'membership':steps.length===2?'comment_replies':'replies_edge';
  if(stage==='publication'&&includePublication){url=new URL(url);url.searchParams.set('fields',url.searchParams.get('fields')+',permalink_url,is_published');}
  const r=await fetchImpl(url,options);
  let d;try{d=await r.json();}catch{steps.push({stage,http_status:r.status,json_valid:false});throw Error('json_invalid');}
  const step={stage,http_status:r.status,code:Number.isSafeInteger(d?.error?.code)?d.error.code:null,subcode:Number.isSafeInteger(d?.error?.error_subcode)?d.error.error_subcode:null};
  if(stage==='publication'&&includePublication&&d?.is_published===true&&typeof d?.message==='string'&&d.message.length<=20000){
   try{const link=new URL(d.permalink_url);if(link.protocol==='https:'&&['facebook.com','www.facebook.com'].includes(link.hostname)&&!link.username&&!link.password&&!link.searchParams.has('access_token'))publication={copy:d.message,permalink:link.href};}catch{}
  }
  if(stage==='publication')Object.assign(step,{id_matches:d?.id===post,owner_matches:d?.from?.id===account});
  if(stage==='membership')Object.assign(step,{data_array:Array.isArray(d?.data),count:Array.isArray(d?.data)?d.data.length:null,exact_matches:Array.isArray(d?.data)?d.data.filter(x=>x?.id===comment).length:null,has_next:!!d?.paging?.next});
  if(stage==='comment_replies')Object.assign(step,{id_matches:d?.id===comment,parent_present:d?.parent!=null,replies_array:Array.isArray(d?.comments?.data),reply_count:Array.isArray(d?.comments?.data)?d.comments.data.length:null,has_next:!!d?.comments?.paging?.next,missing_authors:Array.isArray(d?.comments?.data)?d.comments.data.filter(x=>typeof x?.from?.id!=='string').length:null});
  if(stage==='replies_edge')Object.assign(step,{data_array:Array.isArray(d?.data),reply_count:Array.isArray(d?.data)?d.data.length:null,has_next:!!d?.paging?.next,missing_authors:Array.isArray(d?.data)?d.data.filter(x=>typeof x?.from?.id!=='string').length:null});
  steps.push(step);return {ok:r.ok,json:async()=>d};
 };
 try{
  const proof=await inspectMetaComment({platform:'facebook',account,comment,post,token,fetchImpl:read});
  return {status:proof.replies_verified?'verified':'unverified',steps,replies_verified:proof.replies_verified,page_replied:proof.replies_verified?proof.replied:null,hidden:proof.deleted,...(includePublication?{publication:proof.deleted?null:publication}:{})};
 }catch(e){
  const safe=['reference_denied','meta_read_unavailable','publication_owner_denied','comment_post_denied','json_invalid'];
  return {status:'unverified',stage,validation:safe.includes(e?.message)?e.message:'transport_or_shape',steps,replies_verified:false,page_replied:null};
 }
}
