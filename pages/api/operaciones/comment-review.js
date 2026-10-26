import {createClient} from '@supabase/supabase-js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {commentReviewAllowed} from '../../../lib/messaging/commentAgent/api.js';
import {businessConfig} from '../../../lib/messaging/instagram/business/config.js';
import {messengerConfig} from '../../../lib/messaging/facebook/messenger/config.js';
import * as igCrypto from '../../../lib/messaging/instagram/business/crypto.js';
import * as fbCrypto from '../../../lib/messaging/facebook/messenger/crypto.js';
import {messengerStore} from '../../../lib/messaging/facebook/messenger/store.js';
import {pageToken} from '../../../lib/messaging/facebook/messenger/manual.js';
import {projectFacebookComment} from '../../../lib/messaging/commentAgent/facebook.js';
import {inspectMetaComment,publicationFacts} from '../../../lib/messaging/commentAgent/verifiedPublication.js';
import {reviewStore,recordReview,approveReview} from '../../../lib/messaging/commentAgent/review.js';
import {reviewDiagnostic} from '../../../lib/messaging/commentAgent/diagnostics.js';
import {readThroughBridge,writeThroughBridge} from '../../../lib/messaging/commentAgent/bridge.js';
import {evaluateInstagram} from '../../../lib/messaging/commentAgent/evaluateInstagram.js';
import {bindInstagramProperty} from '../../../lib/messaging/commentAgent/bindInstagramProperty.js';
import {projectReviews} from '../../../lib/messaging/commentAgent/reviewProjection.js';
import {bridgeDiagnostic,safeBridgeDiagnostic} from '../../../lib/messaging/commentAgent/bridgeDiagnostic.js';
import {diagnoseFacebookRead} from '../../../lib/messaging/commentAgent/facebookReadDiagnostic.js';
import {facebookDevPanel} from '../../../lib/messaging/commentAgent/facebookDevPanel.js';
import {productionObservationEnabled,runProductionObservation} from '../../../lib/messaging/commentAgent/productionObservation.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','private,no-store');
 if(!commentReviewAllowed(process.env))return res.status(404).end();
 if(!['GET','POST'].includes(req.method))return res.status(405).end();
 let stage='authorization';
 try{
  const actor=await authorizeInboxStaff(req);if(!actor?.active||!['admin','gerente_ventas'].includes(actor.role_id))return res.status(403).end();
  if(req.method==='POST'&&new URL(req.headers.origin||'https://invalid').host!==req.headers.host)return res.status(403).end();
  const platform=req.query.platform;if(!['instagram','facebook'].includes(platform))return res.status(400).end();
  if(productionObservationEnabled(process.env)){
   stage='production_observation';
   const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
   return res.status(200).json(await runProductionObservation({env:process.env,platform,actor,body:req.method==='POST'?req.body:null,db}));
  }
  if(req.method==='POST'&&platform==='facebook'&&req.body?.op==='diagnose_isolated_dev'){
   if(process.env.VERCEL_ENV!=='preview'||process.env.NEXT_PUBLIC_SUPABASE_URL!=='https://hjfwjnejbcpmknvfpdcq.supabase.co'||Object.keys(req.body).join(',')!=='op')return res.status(403).end();
   stage='isolated_dev_health';
   const r=await fetch('https://hjfwjnejbcpmknvfpdcq.supabase.co/functions/v1/facebook-comments-dev-health',{method:'GET',headers:{Authorization:req.headers.authorization,apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(45000)});
   const d=await r.json();
   if(!r.ok||!['PASS','FAIL'].includes(d?.status))throw Error('health_unavailable');
   return res.status(200).json(d);
  }
  if(platform==='facebook'){
   stage='isolated_dev_review';
   return res.status(200).json(await facebookDevPanel(process.env,req.headers.authorization,req.method==='POST'?req.body:null));
  }
  if(platform==='instagram'&&process.env.COMMENT_REVIEW_BRIDGE_URL){
   try{return res.status(200).json(req.method==='GET'?await readThroughBridge(process.env,req.headers.authorization,fetch,req.headers['x-vercel-oidc-token']):await writeThroughBridge(process.env,req.headers.authorization,req.body,fetch,req.headers['x-vercel-oidc-token']));}
   catch(error){return res.status(503).json({status:'review_unavailable',diagnostic:safeBridgeDiagnostic(error?.diagnostic)||bridgeDiagnostic('bridge_transport',error)});}
  }
  stage='configuration';
  const c=platform==='instagram'?businessConfig(process.env):messengerConfig(process.env);if(!c)return res.status(503).json({status:'configuration_missing',diagnostic:{stage,code:'platform_disabled'}});
  // Observation must fail closed, including the non-bridge DEV path.
  if(c.senderEnabled)return res.status(503).json({status:'configuration_missing',diagnostic:{stage,code:'sender_not_closed'}});
  const crypto=platform==='instagram'?igCrypto:fbCrypto;
  stage='database_client';
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),store=reviewStore(db,platform,c,actor);
  if(req.method==='POST'&&platform==='facebook'&&req.body?.op==='diagnose_read'){
   if(Object.keys(req.body).join(',')!=='op'||c.senderEnabled)return res.status(403).end();
   return res.status(200).json(await diagnoseFacebookRead({c,credential:await messengerStore(db,c.connection,c).credential()}));
  }
  stage='journal_read';
  const rows=await store('list');if(!Array.isArray(rows))throw Error('shape');
  if(req.method==='GET'){
   stage='projection';
   return res.status(200).json(projectReviews(rows,crypto,c));
  }
  const body=req.body||{};
  if(platform==='instagram'&&body.op==='bind_property')return res.status(200).json(await bindInstagramProperty({db,c,actor,store,operation:body}));
  stage=body.op==='approve'?'approval':'evaluation';
  if(body.op==='approve'){
   const row=rows.find(r=>r.comment_ref===body.comment&&r.revision===body.revision);
   return res.status(200).json(await approveReview({row,text:body.text,actor,store,crypto,c}));
  }
  if(body.op!=='evaluate')return res.status(400).json({status:'operation_denied'});
  if(platform==='instagram')return res.status(200).json(await evaluateInstagram({db,c,actor,store}));
  const legacy=messengerStore(db,c.connection,c);
  const inputs=(await store('events')).slice(0,20).map(r=>projectFacebookComment(c,r));
  let token=null;
  try{
   const credential=await legacy.credential();
   // Observation needs read scopes, never a publishing permission.
   if(platform==='facebook'&&!['pages_read_engagement','pages_read_user_content'].every(s=>credential?.scopes?.includes(s)))throw Error('permissions');
   token=pageToken(c,credential);
  }catch{/* Missing permissions never trigger OAuth or a scope change. */}
  let processed=0;
  for(const input of inputs){
   const event={...input.event,replies_verified:false};let facts=null;
   if(token)try{
    const proof=await inspectMetaComment({platform,account:c.account||c.page,comment:input.native.comment_id,post:input.native.post_id,token});
    Object.assign(event,{replies_verified:proof.replies_verified,own_author:proof.own_author,deleted:event.deleted||proof.deleted});
    if(proof.replied)event.reply_status='external_reply';
    facts=await publicationFacts({publication:{verified:true,platform,connection_ref:event.connection_ref,post_ref:event.post_ref,text:proof.publicationText},event,db,reference:id=>crypto.ref(c,'property',id)});
   }catch{/* API error => unknown reply state and no proposal, not absence of reply. */}
   await recordReview({event,facts,store,crypto,c});processed++;
  }
  return res.status(200).json({status:'evaluated',processed,sender:false});
 }catch(error){return res.status(503).json({status:'review_unavailable',diagnostic:reviewDiagnostic(stage,error)});}
}
