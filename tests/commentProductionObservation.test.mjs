import test from 'node:test';
import assert from 'node:assert/strict';
import {observationConfig,observationFetch,runProductionObservation,snapshot,PRODUCTION_DB} from '../lib/messaging/commentAgent/productionObservation.js';
import * as crypto from '../lib/messaging/commentAgent/observationCrypto.js';
import {commentObservationAllowed,commentReviewAllowed} from '../lib/messaging/commentAgent/api.js';
const env={VERCEL_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:PRODUCTION_DB,COMMENT_OBSERVATION_MODE:'human_review_only'};
const values={MODE:'human_review_only',SEND_ENABLED:'false',CONNECTION_ID:'00000000-0000-4000-8000-000000000001',APP_ID:'100',ACCOUNT_ID:'200',INDEX_KEY:'a'.repeat(64),DATA_KEY:'b'.repeat(64),READ_TOKEN:'synthetic_only_token_123',TOKEN_EXPIRES_AT:'0',POST_IDS:'["200_400"]'};
for(const [k,v] of Object.entries(values))env['COMMENT_OBSERVATION_FACEBOOK_'+k]=v;
const actor={active:true,role_id:'admin',id:'00000000-0000-4000-8000-000000000002'};
const c=observationConfig(env,'facebook');
test('production observation opt-in never enables DEV webhook or legacy reader',()=>{
 assert.equal(commentReviewAllowed(env),true);assert.equal(commentObservationAllowed(env),false);
 assert.equal(commentReviewAllowed({...env,COMMENT_OBSERVATION_MODE:undefined}),false);
});
test('explicit production-only configuration; no transport fallback',()=>{
 for(const patch of [{VERCEL_ENV:'preview'},{COMMENT_OBSERVATION_MODE:undefined},{COMMENT_OBSERVATION_FACEBOOK_SEND_ENABLED:'true'},{COMMENT_OBSERVATION_FACEBOOK_TOKEN_EXPIRES_AT:''},{INSTAGRAM_BUSINESS_CONNECTION_ID:c.connection},{COMMENT_OBSERVATION_FACEBOOK_DATA_KEY:c.indexKey}])assert.throws(()=>observationConfig({...env,...patch},'facebook'));
 assert.equal(c.senderEnabled,false);
});
test('ciphertext binds provider/platform/account/connection and purpose',()=>{
 const box=crypto.seal(c,'purpose',['binding'],{text:'synthetic'});
 assert.equal(crypto.open(c,'purpose',['binding'],box).text,'synthetic');
 for(const patch of [{connection:actor.id},{platform:'instagram'},{account:'201'}])assert.throws(()=>crypto.open({...c,...patch},'purpose',['binding'],box));
 assert.throws(()=>crypto.open(c,'other',['binding'],box));
 assert.throws(()=>crypto.open(c,'purpose',['binding'],{...box,provider:'instagram_login_business'}));
 assert.throws(()=>crypto.open(c,'purpose',['binding'],{...box,tag:'0'.repeat(32)}));
});
test('Meta firewall allows only fixed-host GET; rejects writes and arbitrary URLs',async()=>{
 let calls=0;const read=observationFetch(c,async(u,o)=>{calls++;assert.equal(o.method,'GET');assert.equal(o.redirect,'error');return{ok:true};});
 await read('https://graph.facebook.com/v26.0/200_400?fields=id',{method:'GET'});
 for(const [url,method] of [['https://graph.facebook.com/v26.0/200_400','POST'],['https://example.com/v26.0/me','GET'],['https://graph.facebook.com/v26.0/me?access_token=bad','GET'],['https://graph.facebook.com/v26.0/me/messages','GET']])await assert.rejects(read(url,{method}));
 assert.equal(calls,1);
});
test('unauthorized actors and unsupported operations fail before DB/Meta',async()=>{
 const db={rpc(){throw Error('unexpected_db');}},fetchImpl=()=>{throw Error('unexpected_meta');};
 await assert.rejects(runProductionObservation({env,platform:'facebook',actor:{...actor,role_id:'asesor'},db,fetchImpl}),/forbidden/);
 for(const op of ['publish','send','claim','start','import_history'])await assert.rejects(runProductionObservation({env,platform:'facebook',actor,body:{op},db,fetchImpl}),/operation/);
});
test('list requires scoped journal; no Meta access',async()=>{
 const db={rpc:async(name,args)=>{assert.equal(name,'comment_observation_v1');assert.equal(args.p_op,'list');return{data:[]};}};
 const r=await runProductionObservation({env,platform:'facebook',actor,db,fetchImpl:()=>{throw Error('unexpected_meta');}});
 assert.equal(r.sender,false);assert.equal(r.source,'production_observation');
 await assert.rejects(runProductionObservation({env,platform:'facebook',actor,db:{rpc:async()=>({data:[{platform:'instagram',connection_id:c.connection}]})}}),/scope/);
});
test('synthetic evaluation captures encrypted snapshots and reviews, never dispatches',async()=>{
 const calls=[],events=new Set();
 const db={rpc:async(name,a)=>{calls.push(a.p_op);assert.equal(name,'comment_observation_v1');if(a.p_op==='list')return{data:[]};if(a.p_op==='capture'){assert.equal(a.p_data.content_box.provider,'commercial_comments_observation_v1');const inserted=events.has(a.p_data.event_ref)?0:1;events.add(a.p_data.event_ref);return{data:{inserted}};}if(a.p_op==='read_property')return{data:null};if(a.p_op==='evaluate')return{data:{status:'recorded'}};throw Error('unexpected_rpc');}};
 const fetchImpl=async(u,o)=>{assert.equal(o.method,'GET');let d;
  if(u.pathname.endsWith('/me'))d={id:'200'};
  else if(u.pathname.endsWith('/200_300/comments'))d={data:[]};
  else if(u.pathname.endsWith('/200_400/comments'))d={data:[{id:'200_300',message:'Precio?',created_time:new Date().toISOString()}]};
  else if(u.pathname.endsWith('/200_400'))d={id:'200_400',from:{id:'200'},message:'Sin referencia de inventario'};
  else d={id:'200_300',from:{id:'500'}};
  return{ok:true,json:async()=>d};};
 const r=await runProductionObservation({env,platform:'facebook',actor,body:{op:'evaluate'},db,fetchImpl});
 assert.equal(r.processed,1);assert.equal(r.webhook_verified,false);assert.deepEqual(calls,['list','capture','read_property','evaluate']);
});
test('snapshot rejects imprecise numeric IDs and invalid timestamps',()=>{
 assert.throws(()=>snapshot(c,'200_400',{id:123,message:'synthetic',created_time:new Date().toISOString()}));
 assert.throws(()=>snapshot(c,'200_400',{id:'123',message:'synthetic',created_time:'invalid'}));
 const n={id:'123',message:'synthetic',created_time:'2026-10-26T00:00:00Z'};
 assert.equal(snapshot(c,'200_400',n).event_ref,snapshot(c,'200_400',n).event_ref);
});
