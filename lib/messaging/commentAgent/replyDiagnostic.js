import {inspectMetaComment} from './verifiedPublication.js';

// Runs the unchanged reader; records structure only, never Graph values or errors.
export async function diagnoseReplyRead({account,comment,post,token,fetchImpl=fetch}){
 const steps=[];let stage='publication';
 const read=async(url,options)=>{
  stage=steps.length===0?'publication':steps.length===1?'membership':'comment_replies';
  const r=await fetchImpl(url,options);
  let d;try{d=await r.json();}catch{steps.push({stage,http_status:r.status,json_valid:false});throw Error('json_invalid');}
  const step={stage,http_status:r.status,code:Number.isSafeInteger(d?.error?.code)?d.error.code:null,subcode:Number.isSafeInteger(d?.error?.error_subcode)?d.error.error_subcode:null};
  if(stage==='publication')Object.assign(step,{id_matches:d?.id===post,owner_matches:d?.from?.id===account});
  if(stage==='membership')Object.assign(step,{data_array:Array.isArray(d?.data),count:Array.isArray(d?.data)?d.data.length:null,exact_matches:Array.isArray(d?.data)?d.data.filter(x=>x?.id===comment).length:null,has_next:!!d?.paging?.next});
  if(stage==='comment_replies')Object.assign(step,{id_matches:d?.id===comment,parent_present:d?.parent!=null,replies_array:Array.isArray(d?.comments?.data),reply_count:Array.isArray(d?.comments?.data)?d.comments.data.length:null,has_next:!!d?.comments?.paging?.next,missing_authors:Array.isArray(d?.comments?.data)?d.comments.data.filter(x=>typeof x?.from?.id!=='string').length:null});
  steps.push(step);return {ok:r.ok,json:async()=>d};
 };
 try{
  const proof=await inspectMetaComment({platform:'facebook',account,comment,post,token,fetchImpl:read});
  if(!proof.replies_verified){
   // Separate read-only edge, exact authenticated comment already bound above.
   // Diagnostic only: does not change evaluation or treat omitted expansion as empty.
   stage='replies_edge';
   const u=new URL(`https://graph.facebook.com/v26.0/${comment}/comments`);
   u.searchParams.set('fields','id,from');u.searchParams.set('limit','100');
   const r=await fetchImpl(u,{method:'GET',headers:{Authorization:`Bearer ${token}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
   const d=await r.json();
   const data=Array.isArray(d?.data)?d.data:null;
   const native=x=>typeof x==='string'&&/^\d{1,32}(?:_\d{1,32})?$/.test(x);
   const complete=r.ok&&!d?.error&&data!==null&&data.length<=100&&!d?.paging?.next&&data.every(x=>native(x?.id)&&native(x?.from?.id));
   steps.push({stage,http_status:r.status,code:Number.isSafeInteger(d?.error?.code)?d.error.code:null,subcode:Number.isSafeInteger(d?.error?.error_subcode)?d.error.error_subcode:null,data_array:data!==null,reply_count:data?.length??null,has_next:!!d?.paging?.next,missing_authors:data?.filter(x=>!native(x?.from?.id)).length??null});
   return {status:complete?'verified_separate_edge':'unverified',steps,original_reader_verified:false,replies_verified:complete,page_replied:complete?data.some(x=>x.from.id===account):null,hidden:proof.deleted};
  }
  return {status:proof.replies_verified?'verified':'unverified',steps,replies_verified:proof.replies_verified,page_replied:proof.replies_verified?proof.replied:null,hidden:proof.deleted};
 }catch(e){
  const safe=['reference_denied','meta_read_unavailable','publication_owner_denied','comment_post_denied','json_invalid'];
  return {status:'unverified',stage,validation:safe.includes(e?.message)?e.message:'transport_or_shape',steps,replies_verified:false,page_replied:null};
 }
}
