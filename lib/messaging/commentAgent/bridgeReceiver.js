import {verifyBridge,DEV_URL} from './bridge.js';
import {businessConfig} from '../instagram/business/config.js';
import * as crypto from '../instagram/business/crypto.js';
import {projectReviews} from './reviewProjection.js';
import {reviewStore,approveReview} from './review.js';
import {evaluateInstagram} from './evaluateInstagram.js';
import {bindInstagramProperty} from './bindInstagramProperty.js';
import {bridgeDiagnostic} from './bridgeDiagnostic.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Fixed DEV reads and review-only writes; no sender, claim or publication capability.
export function createBridgeReceiver({env=process.env,fetchImpl=fetch}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private,no-store');
  let stage='bridge_authorization';
  try{
   if(req.method==='POST'&&req.rawBody===undefined){
    stage='body_read';
    // Refuse parsed/reconstructed bodies. Web entrypoint supplies the original stream.
    if(req.body!==undefined)throw Error('parsed_body');
    const chunks=[];let bytes=0;
    for await(const chunk of req){bytes+=chunk.length;if(bytes>8192)throw Error('body_size');chunks.push(Buffer.from(chunk));}
    try{req.rawBody=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw Error('body_encoding');}
   }
   stage='bridge_authorization';const token=verifyBridge(req,env);
   if(!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('configuration');
   const read=async(path,options={})=>{
    const r=await fetchImpl(DEV_URL+path,{...options,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...options.headers},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('upstream');return r.json();
   };
   // Network-verified Supabase identity, never decoded JWT/user_metadata authorization.
   stage='identity';const user=await read('/auth/v1/user');
   if(!UUID.test(user?.id||''))throw Error('identity');
   stage='role';const profiles=await read('/rest/v1/profiles?select=id,role_id,active&id=eq.'+user.id);
   const actor=Array.isArray(profiles)&&profiles.length===1?profiles[0]:null;
   if(actor?.id!==user.id||actor.active!==true||!['admin','gerente_ventas'].includes(actor.role_id))throw Error('role');
   stage='configuration';const c=businessConfig(env);
   if(!c||c.senderEnabled)throw Error('configuration');
   const service={Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`};
   const db={rpc:async(name,args)=>{
    if(!['comment_review_v1','comment_bridge_request_v1','ig_business_comments_v1','ig_business_token_v1','comment_property_link_v1'].includes(name))throw Error('rpc_denied');
    if(name==='comment_property_link_v1'&&(!['read','bind'].includes(args.p_op)||args.p_platform!=='instagram'||args.p_connection!==c.connection||args.p_actor!==actor.id))throw Error('rpc_denied');
    if(name==='ig_business_token_v1'&&args.p_op!=='load')throw Error('token_operation_denied');
    return {data:await read('/rest/v1/rpc/'+name,{method:'POST',headers:service,body:JSON.stringify(args)}),error:null};
   },from:table=>{
    if(table!=='propiedades')throw Error('table_denied');
    const filters=new URLSearchParams();
    const query={select:columns=>{if(columns!=='id,public_id,status,operacion,precio,moneda,colonia,ciudad')throw Error('fields_denied');filters.set('select',columns);return query;},eq:(key,value)=>{if(!['id','public_id','status'].includes(key))throw Error('filter_denied');filters.set(key,'eq.'+value);return query;},limit:async n=>{if(n!==2)throw Error('limit_denied');filters.set('limit','2');return {data:await read('/rest/v1/propiedades?'+filters,{headers:service}),error:null};}};
    return query;
   }};
   const store=reviewStore(db,'instagram',c,actor);
   if(req.method==='POST'){
    stage='request_once';
    const consumed=await db.rpc('comment_bridge_request_v1',{p_connection:c.connection,p_actor:actor.id,p_nonce:req.headers['x-review-nonce'],p_timestamp:Number(req.headers['x-review-time'])});
    if(consumed.data!==true)return res.status(409).json({status:'review_unavailable',diagnostic:{stage,code:'replay_or_gate_denied'}});
    const body=JSON.parse(req.rawBody);stage=body.op==='bind_property'?'association':body.op==='approve'?'approval':'evaluation';
    const result=body.op==='bind_property'?await bindInstagramProperty({db,c,actor,store,operation:body,fetchImpl}):body.op==='evaluate'?await evaluateInstagram({db,c,actor,store,fetchImpl}):await approveReview({row:(await store('list')).find(r=>r.comment_ref===body.comment&&r.revision===body.revision),text:body.text,actor,store,crypto,c});
    return res.status(200).json({...result,sender:false,private_replies:false});
   }
   stage='journal_read';
   const rows=await read('/rest/v1/rpc/comment_review_v1',{method:'POST',headers:{Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`},body:JSON.stringify({p_platform:'instagram',p_connection:c.connection,p_actor:actor.id,p_op:'list',p_data:{}})});
   stage='projection';
   return res.status(200).json({...projectReviews(rows,crypto,c),read_only:false,bridge:true});
  }catch(error){
   return res.status(['bridge_authorization','identity','role','body_read'].includes(stage)?403:503).json({status:'review_unavailable',diagnostic:bridgeDiagnostic(stage,error)});
  }
 };
}
