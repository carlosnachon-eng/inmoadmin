import {DEV,createFacebookDevHealth} from './facebookDevHealth.js';
import {facebookCommentDevConfig} from './facebookDevConfig.js';
import {bridgeOperation} from './bridge.js';
import * as crypto from '../facebook/messenger/crypto.js';
import {projectFacebookComment} from './facebook.js';
import {reviewStore,recordReview,approveReview} from './review.js';
import {projectReviews} from './reviewProjection.js';
import {inspectMetaComment,publicationFacts} from './verifiedPublication.js';
import {reviewDiagnostic} from './diagnostics.js';
import {facebookReviewOperation,importFacebookHistory} from './facebookHistory.js';
import {observeFacebookCopies} from './copyObservation.js';
import {diagnoseReplyRead,certifiedOrganicTarget} from './replyDiagnostic.js';
import {recordConfirmedDevProposal,confirmedEvaluationResult} from './confirmedDevProposal.js';

const CONNECTION='74c3f858-c4f6-40af-a068-6ef159819a87';
// Only the isolated Comments DEV connection. No sender, credential refresh or capture API.
export function createFacebookDevReview({env,makeDb,fetchImpl=fetch}){
 return async req=>{
  let stage='authorization';
  const reply=(body,status=200)=>Response.json({...body,sender:false,private_replies:false,read_only:false,source:'facebook_comments_dev'},{status,headers:{'Cache-Control':'private,no-store'}});
  try{
   const e=env();
   if(e.SUPABASE_URL!==DEV)return reply({status:'disabled'},404);
   if(!['GET','POST'].includes(req.method)||new URL(req.url).search)return reply({status:'operation_denied'},405);
   const auth=req.headers.get('authorization');
   if(!/^Bearer [A-Za-z0-9._~-]{20,8192}$/.test(auth||'')||!e.SUPABASE_SERVICE_ROLE_KEY)return reply({status:'forbidden'},403);
   const read=async path=>{
    const r=await fetchImpl(DEV+path,{method:'GET',headers:{Authorization:auth,apikey:e.SUPABASE_SERVICE_ROLE_KEY},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw Error('authorization');return r.json();
   };
   const user=await read('/auth/v1/user');
   if(!/^[a-f0-9-]{36}$/i.test(user?.id||''))return reply({status:'forbidden'},403);
   const profiles=await read('/rest/v1/profiles?select=id,role_id,active&id=eq.'+user.id);
   const actor=profiles?.[0];
   if(!Array.isArray(profiles)||profiles.length!==1||actor?.id!==user.id||actor.active!==true||!['admin','gerente_ventas'].includes(actor.role_id))return reply({status:'forbidden'},403);
   stage='configuration';
   const c=facebookCommentDevConfig({...e,VERCEL_ENV:'development',NEXT_PUBLIC_SUPABASE_URL:e.SUPABASE_URL});
   if(!c||c.connection!==CONNECTION||c.app!=='2220237475209417'||c.page!=='119960324707764'||c.senderEnabled)throw Error('configuration');
   let operation=null;
   if(req.method==='POST'){
    stage='operation';
    if(req.headers.get('content-type')!=='application/json')return reply({status:'operation_denied'},400);
    const raw=await req.text();if(new TextEncoder().encode(raw).length>8192)return reply({status:'operation_denied'},413);
    operation=facebookReviewOperation(JSON.parse(raw));
   }
   const db=makeDb(e),store=reviewStore(db,'facebook',c,actor);
   const isolated=rows=>{
    if(!Array.isArray(rows)||rows.length>200||rows.some(r=>r.platform!=='facebook'||r.connection_id!==c.connection))throw Error('connection_binding');
    return rows;
   };
   stage='journal_read';
   const rows=isolated(await store('list'));
   if(!operation){stage='projection';return reply(projectReviews(rows,crypto,c));}
   if(operation.op==='approve'){
    stage='approval';
    return reply(await approveReview({row:rows.find(r=>r.comment_ref===operation.comment&&r.revision===operation.revision),text:operation.text,actor,store,crypto,c}));
   }
   stage='token_health';
   const health=await createFacebookDevHealth({env,fetchImpl})(new Request(req.url,{headers:{authorization:auth}}));
   if(!health.ok||(await health.json()).status!=='PASS')throw Error('token_health');
   if(operation.op==='diagnose_organic_reply'){
    const organic=certifiedOrganicTarget(isolated(await store('events')));
    if(organic.length!==1)return reply({status:'organic_target_ambiguous',writes:0});
    const input=projectFacebookComment(c,organic[0]);
    return reply({...await diagnoseReplyRead({account:c.page,comment:input.native.comment_id,post:input.native.post_id,token:e.FACEBOOK_COMMENTS_DEV_PAGE_ACCESS_TOKEN,fetchImpl,includePublication:true}),binding:true,writes:0});
   }
   if(operation.op==='observe_copies'){
    stage='copy_observation';
    return reply(await observeFacebookCopies({c,token:e.FACEBOOK_COMMENTS_DEV_PAGE_ACCESS_TOKEN,db,fetchImpl}));
   }
   if(['import_history','find_history_proposal'].includes(operation.op)){
    stage='history_import';
    return reply(await importFacebookHistory({c,token:e.FACEBOOK_COMMENTS_DEV_PAGE_ACCESS_TOKEN,store,fetchImpl,db,proposalOnly:operation.op==='find_history_proposal'}));
   }
   stage='evaluation';
   // This DEV certification is limited to the exact user-confirmed organic event.
   if(operation.op==='evaluate'){
    const targets=certifiedOrganicTarget(isolated(await store('events')));
    if(targets.length!==1)return reply({status:'confirmed_target_unavailable',writes:0});
    const input=projectFacebookComment(c,targets[0]);
    const proof=await inspectMetaComment({platform:'facebook',account:c.page,comment:input.native.comment_id,post:input.native.post_id,token:e.FACEBOOK_COMMENTS_DEV_PAGE_ACCESS_TOKEN,fetchImpl});
    const event={...input.event,replies_verified:proof.replies_verified,own_author:proof.own_author,deleted:input.event.deleted||proof.deleted};
    if(proof.replied)event.reply_status='external_reply';
    return reply(confirmedEvaluationResult(await recordConfirmedDevProposal({event,c,actor,store,crypto})));
   }
   const inputs=isolated(await store('events')).slice(0,20).map(r=>projectFacebookComment(c,r));
   let processed=0;
   for(const input of inputs){
    const event={...input.event,replies_verified:false};let facts=null;
    try{
     const proof=await inspectMetaComment({platform:'facebook',account:c.page,comment:input.native.comment_id,post:input.native.post_id,token:e.FACEBOOK_COMMENTS_DEV_PAGE_ACCESS_TOKEN,fetchImpl});
     Object.assign(event,{replies_verified:proof.replies_verified,own_author:proof.own_author,deleted:event.deleted||proof.deleted});
     if(proof.replied)event.reply_status='external_reply';
     facts=await publicationFacts({publication:{verified:true,platform:'facebook',connection_ref:event.connection_ref,post_ref:event.post_ref,text:proof.publicationText},event,db,reference:id=>crypto.ref(c,'property',id)});
    }catch{/* Unknown Meta/inventory state escalates; never interpreted as no response. */}
    await recordReview({event,facts,store,crypto,c});processed++;
   }
   return reply({status:'evaluated',processed});
  }catch(error){return reply({status:'review_unavailable',diagnostic:reviewDiagnostic(stage,error)},stage==='authorization'?403:stage==='operation'?400:503);}
 };
}
