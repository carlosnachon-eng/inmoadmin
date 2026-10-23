// Only called with the disposable local PostgreSQL client. No real credentials/network.
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createBridgeWebReceiver} from '../lib/messaging/commentAgent/bridgeWebReceiver.js';
import {bridgeHeaders,BRIDGE_PATH,BRIDGE_BRANCH,DEV_URL} from '../lib/messaging/commentAgent/bridge.js';
import {businessConfig,SCOPES} from '../lib/messaging/instagram/business/config.js';
import * as crypto from '../lib/messaging/instagram/business/crypto.js';
export async function certifyDurableBridge(db){
 const connection=randomUUID(),actor=randomUUID(),keys=generateKeyPairSync('ed25519');
 const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:BRIDGE_BRANCH,NEXT_PUBLIC_SUPABASE_URL:DEV_URL,APP_ENV:'preview',
  COMMENT_REVIEW_BRIDGE_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}),COMMENT_REVIEW_BRIDGE_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'pem'}),
  SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',INSTAGRAM_BUSINESS_ENABLED:'true',INSTAGRAM_BUSINESS_MANUAL_SEND_ENABLED:'false',
  INSTAGRAM_BUSINESS_CONNECTION_ID:connection,INSTAGRAM_BUSINESS_APP_ID:'100',INSTAGRAM_BUSINESS_INSTAGRAM_APP_ID:'200',INSTAGRAM_BUSINESS_ACCOUNT_ID:'300',
  INSTAGRAM_BUSINESS_INSTAGRAM_APP_SECRET:'a'.repeat(32),INSTAGRAM_BUSINESS_VERIFY_TOKEN:'b'.repeat(32),INSTAGRAM_BUSINESS_INDEX_KEY:'c'.repeat(64),INSTAGRAM_BUSINESS_DATA_KEY:'d'.repeat(64),INSTAGRAM_BUSINESS_TOKEN_KEY:'e'.repeat(64),INSTAGRAM_BUSINESS_OAUTH_REDIRECT_URI:'https://example.test/setup'};
 const c=businessConfig(env),time=new Date(Date.now()-1000).toISOString(),auth='Bearer synthetic.user.token',propertyId=randomUUID();
 await db.query("insert into propiedades values($1,'EMP-QA256','published')",[propertyId]);
 const input={comment_ref:'a'.repeat(64),media_ref:'b'.repeat(64),event_ref:'c'.repeat(64),occurred_at:time};
 const binding=[input.comment_ref,input.media_ref,input.event_ref,time];
 input.content_box=crypto.seal(c,'comment-content',binding,{text:'precio',username:'QA sintética'});
 input.native_box=crypto.seal(c,'comment-native',binding,{comment_id:'123',media_id:'456'});
 const credential={provider:c.provider,connection_id:connection,app_id:c.app,instagram_app_id:c.instagramApp,account_id:c.account,generation:randomUUID(),issued_at:time,verified_at:time,expires_at:new Date(Date.now()+30*86400000).toISOString(),status:'healthy',scopes:[...SCOPES]};
 credential.token_box=crypto.seal(c,'token',[credential.generation,credential.issued_at,credential.expires_at],{access_token:'synthetic-token'});
 await db.query("insert into profiles values($1,true,'admin')",[actor]);
 await db.query("insert into commercial_comment_private.connections(platform,connection_id,active) values('instagram',$1,true)",[connection]);
 await db.query('create schema instagram_business_private;create table instagram_business_private.connections(id uuid primary key,active boolean);create table instagram_business_private.canary_operators(connection_id uuid,actor uuid,active boolean);');
 await db.query(await readFile(new URL('../supabase/migrations/20261018160000_instagram_comments_v1.sql',import.meta.url),'utf8'));
 await db.query(await readFile(new URL('../supabase/migrations/20261018183000_instagram_comment_automation_v1.sql',import.meta.url),'utf8'));
 await db.query('insert into instagram_business_private.connections values($1,true)',[connection]);
 await db.query('insert into instagram_business_private.canary_operators values($1,$2,true)',[connection,actor]);
 await db.query('select public.ig_business_comment_capture_v1($1,$2)',[connection,JSON.stringify([input])]);
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'public.ig_business_comments_v1(uuid,uuid)','execute') v",[role])).rows[0].v,false);
 assert.deepEqual((await db.query('select public.ig_business_comments_v1($1,$2) v',[connection,randomUUID()])).rows[0].v,[]);
 assert.equal((await db.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='instagram_business_private' and c.relname in ('comment_events','comment_actions','comment_automations') and relrowsecurity")).rows[0].n,3);
 let metaReads=0;
 const fetchImpl=async(raw,options={})=>{
  const url=new URL(raw);let data;
  if(url.origin==='https://graph.instagram.com'){
   assert.equal(options.method,'GET');metaReads++;
   data=url.pathname.endsWith('/456')?{id:'456',owner:{id:'300'},caption:'Publicación sintética sin referencia de propiedad'}:{id:'123',media:{id:'456'},from:{id:'789'},replies:{data:[]}};
  }else{
   assert.equal(url.origin,DEV_URL);
   if(url.pathname==='/auth/v1/user')data={id:actor};
   else if(url.pathname==='/rest/v1/profiles')data=[{id:actor,active:true,role_id:'admin'}];
   else if(url.pathname==='/rest/v1/propiedades')data=[{id:propertyId,public_id:'EMP-QA256',status:'published',operacion:'sale',precio:1000000,moneda:'MXN'}];
   else{
    const p=JSON.parse(options.body);
    if(url.pathname.endsWith('/ig_business_comments_v1'))data=(await db.query('select public.ig_business_comments_v1($1,$2) v',[p.p_connection,p.p_actor])).rows[0].v;
    else if(url.pathname.endsWith('/ig_business_token_v1')){assert.equal(p.p_op,'load');data=credential;}
    else if(url.pathname.endsWith('/comment_property_link_v1')){assert.ok(['read','bind'].includes(p.p_op));data=(await db.query('select public.comment_property_link_v1($1,$2,$3,$4,$5) v',[p.p_platform,p.p_connection,p.p_actor,p.p_op,p.p_data])).rows[0].v;}
    else if(url.pathname.endsWith('/comment_bridge_request_v1'))data=(await db.query('select public.comment_bridge_request_v1($1,$2,$3,$4) v',[p.p_connection,p.p_actor,p.p_nonce,p.p_timestamp])).rows[0].v;
    else{assert.ok(url.pathname.endsWith('/comment_review_v1'));assert.ok(['capture','evaluate','list','approve'].includes(p.p_op));data=(await db.query('select public.comment_review_v1($1,$2,$3,$4,$5) v',[p.p_platform,p.p_connection,p.p_actor,p.p_op,p.p_data])).rows[0].v;}
   }
  }
  return {ok:true,json:async()=>data};
 };
 const handler=createBridgeWebReceiver({env,fetchImpl});
 const request=body=>{const raw=body?JSON.stringify(body):'',method=body?'POST':'GET';return new Request('https://example.test'+BRIDGE_PATH,{method,headers:{...bridgeHeaders(env,auth,Date.now(),method,raw,body?randomUUID():''),...(body?{'content-type':'application/json'}:{})},...(body?{body:raw}:{})});};
 const evaluated=await handler(request({op:'evaluate'}));assert.equal(evaluated.status,200);assert.equal((await evaluated.json()).processed,1);
 let listed=await (await handler(request())).json();assert.equal(listed.rows[0].status,'escalated');
 const bind={op:'bind_property',comment:listed.rows[0].comment_ref,revision:listed.rows[0].revision,confirmed:true,property_public_id:'EMP-QA256'};
 assert.equal((await (await handler(request({...bind,revision:'f'.repeat(64)}))).json()).status,'association_target_denied');
 assert.equal((await (await handler(request({...bind,property_public_id:'EMP-MISSING'}))).json()).status,'property_unavailable');
 const bindReq=request(bind),bindReplay=bindReq.clone();
 assert.equal((await (await handler(bindReq)).json()).status,'bound');
 assert.equal((await handler(bindReplay)).status,409);
 assert.equal((await (await handler(request(bind))).json()).status,'unchanged');
 assert.equal((await db.query("select count(*)::int n from commercial_comment_private.property_links where platform='instagram' and connection_id=$1",[connection])).rows[0].n,1);
 assert.equal((await db.query("select count(*)::int n from commercial_comment_private.audit where connection_id=$1 and kind='property_bind'",[connection])).rows[0].n,1);
 assert.equal((await handler(request({...bind,confirmed:false}))).status,403);
 assert.equal((await handler(request({...bind,platform:'facebook'}))).status,403);
 assert.equal((await (await handler(request({op:'evaluate'}))).json()).processed,1);
 listed=await (await handler(request())).json();assert.equal(listed.rows[0].status,'proposed');
 const proposal=listed.rows[0],approve={op:'approve',comment:proposal.comment_ref,revision:proposal.revision,text:'QA sintética: información aprobada, sin publicación.'};
 const signed=request(approve),replay=signed.clone();
 assert.equal((await (await handler(signed)).json()).status,'approved_not_sent');
 assert.equal((await handler(replay)).status,409);
 // New operation for the same revision must also never approve twice.
 assert.equal((await (await handler(request(approve))).json()).status,'blocked');
 listed=await (await handler(request())).json();assert.equal(listed.rows[0].status,'approved');assert.equal(listed.rows[0].approved_text,approve.text);
 const audit=(await db.query("select kind,count(*)::int n from commercial_comment_private.audit where connection_id=$1 group by kind",[connection])).rows;
 assert.equal(audit.find(x=>x.kind==='approve')?.n,1);
 assert.equal((await db.query('select count(*)::int n from commercial_comment_private.actions where connection_id=$1',[connection])).rows[0].n,0);
 assert.equal(metaReads,10);
 console.log(JSON.stringify({durable_bridge:'PASS',association:'persisted_once',evaluation:2,approval:1,replay:'rejected',refresh:'approved_retained',meta:'read-only mocked fixtures',real_network:0,claims:0,dispatches:0}));
 // Same disposable database is destroyed by the caller's finally block.
}
