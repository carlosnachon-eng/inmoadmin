// Disposable Preview harness. Never imported by the normal bridge entrypoint.
// Synthetic sources only; authentication and durable review RPCs remain real.
import {createBridgeWebReceiver} from '../../lib/messaging/commentAgent/bridgeWebReceiver.js';
import {businessConfig,SCOPES} from '../../lib/messaging/instagram/business/config.js';
import {DEV_URL} from '../../lib/messaging/commentAgent/bridge.js';
import * as crypto from '../../lib/messaging/instagram/business/crypto.js';
export const QA_CONNECTION='725e2e98-88ce-45f3-bb9f-576863a45f04';
export function syntheticQa({env,fetchImpl=fetch,expiresAt,now=Date.now}){
 if(env.VERCEL_ENV!=='preview'||env.NEXT_PUBLIC_SUPABASE_URL!==DEV_URL)throw Error('qa_environment');
 const start=now();
 if(!Number.isFinite(expiresAt)||expiresAt<=start||expiresAt-start>7200000)throw Error('qa_expiry');
 // Public fixture material, NOT real credentials. All real business keys overridden.
 const fixtureEnv={...env,APP_ENV:'preview',INSTAGRAM_BUSINESS_ENABLED:'true',INSTAGRAM_BUSINESS_MANUAL_SEND_ENABLED:'false',
  INSTAGRAM_BUSINESS_CONNECTION_ID:QA_CONNECTION,INSTAGRAM_BUSINESS_APP_ID:'100',INSTAGRAM_BUSINESS_INSTAGRAM_APP_ID:'200',INSTAGRAM_BUSINESS_ACCOUNT_ID:'300',
  INSTAGRAM_BUSINESS_INSTAGRAM_APP_SECRET:'synthetic-app-secret'.padEnd(32,'a'),INSTAGRAM_BUSINESS_VERIFY_TOKEN:'synthetic-verify-token'.padEnd(32,'b'),
  INSTAGRAM_BUSINESS_INDEX_KEY:'c'.repeat(64),INSTAGRAM_BUSINESS_DATA_KEY:'d'.repeat(64),INSTAGRAM_BUSINESS_TOKEN_KEY:'e'.repeat(64),INSTAGRAM_BUSINESS_OAUTH_REDIRECT_URI:'https://example.test/qa'};
 const c=businessConfig(fixtureEnv),time=new Date(start-1000).toISOString();
 const input={comment_ref:'a'.repeat(64),media_ref:'b'.repeat(64),event_ref:'c'.repeat(64),occurred_at:time};
 const binding=[input.comment_ref,input.media_ref,input.event_ref,time];
 input.content_box=crypto.seal(c,'comment-content',binding,{text:'precio',username:'QA-SINTETICA-NO-CLIENTE'});
 input.native_box=crypto.seal(c,'comment-native',binding,{comment_id:'123',media_id:'456'});
 const credential={provider:c.provider,connection_id:c.connection,app_id:c.app,instagram_app_id:c.instagramApp,account_id:c.account,generation:'33333333-3333-4333-8333-333333333333',issued_at:time,verified_at:time,expires_at:new Date(start+86400000*30).toISOString(),status:'healthy',scopes:[...SCOPES]};
 credential.token_box=crypto.seal(c,'token',[credential.generation,credential.issued_at,credential.expires_at],{access_token:'synthetic-not-a-meta-token'});
 const response=data=>({ok:true,json:async()=>data});
 const isolatedFetch=async(raw,options={})=>{
  if(now()>=expiresAt)throw Error('qa_expired');
  const u=new URL(raw),method=options.method||'GET';
  if(u.origin==='https://graph.instagram.com'){
   if(method!=='GET')throw Error('qa_send_denied');
   if(u.pathname==='/v26.0/456')return response({id:'456',owner:{id:'300'},caption:'QA SINTÉTICA https://emporioinmobiliario.com.mx/propiedades/EMP-QA256'});
   if(u.pathname==='/v26.0/123')return response({id:'123',media:{id:'456'},from:{id:'789'},replies:{data:[]}});
   throw Error('qa_meta_path_denied');
  }
  if(u.origin!==DEV_URL)throw Error('qa_destination_denied');
  if(method==='GET'&&(u.pathname==='/auth/v1/user'||u.pathname==='/rest/v1/profiles'))return fetchImpl(raw,options);
  if(method==='GET'&&u.pathname==='/rest/v1/propiedades')return response([{id:'44444444-4444-4444-8444-444444444444',public_id:'EMP-QA256',status:'published',operacion:'venta',precio:1000000,moneda:'MXN'}]);
  if(method!=='POST')throw Error('qa_method_denied');
  const p=JSON.parse(options.body);
  if(p.p_connection!==QA_CONNECTION)throw Error('qa_connection_denied');
  if(u.pathname==='/rest/v1/rpc/ig_business_comments_v1')return response([input]);
  if(u.pathname==='/rest/v1/rpc/ig_business_token_v1'&&p.p_op==='load')return response(credential);
  if(u.pathname==='/rest/v1/rpc/comment_bridge_request_v1')return fetchImpl(raw,options);
  if(u.pathname==='/rest/v1/rpc/comment_review_v1'&&p.p_platform==='instagram'&&['capture','evaluate','list','approve'].includes(p.p_op))return fetchImpl(raw,options);
  throw Error('qa_operation_denied');
 };
 const handler=createBridgeWebReceiver({env:fixtureEnv,fetchImpl:isolatedFetch});
 return request=>now()>=expiresAt?Response.json({status:'qa_expired'},{status:410}):handler(request);
}
