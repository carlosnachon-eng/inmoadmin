import test from 'node:test';import assert from 'node:assert/strict';
import {createFacebookDevHealth,DEV} from '../lib/messaging/commentAgent/facebookDevHealth.js';
const app='2220237475209417',page='119960324707764',uid='11111111-1111-4111-8111-111111111111',now=1800000000000;
const env={SUPABASE_URL:DEV,SUPABASE_SERVICE_ROLE_KEY:'service-test',FACEBOOK_COMMENTS_DEV_APP_ID:app,FACEBOOK_COMMENTS_DEV_PAGE_ID:page,FACEBOOK_COMMENTS_DEV_CONNECTION_ID:'74c3f858-c4f6-40af-a068-6ef159819a87',FACEBOOK_COMMENTS_DEV_MANUAL_SEND_ENABLED:'false',FACEBOOK_COMMENTS_DEV_PAGE_ACCESS_TOKEN:'TOKEN_PRIVATE_FIXTURE_12345',FACEBOOK_COMMENTS_DEV_APP_SECRET:'a'.repeat(32)};
const metadata={app_id:app,profile_id:page,type:'PAGE',is_valid:true,scopes:['pages_show_list','pages_manage_metadata','pages_read_engagement','pages_read_user_content'],expires_at:0,data_access_expires_at:1800100000};
async function run({patch={},meta={},role='admin',active=true,auth=true,identity=page,fields=['feed'],error=false,method='GET'}={}){
 const calls=[];const handler=createFacebookDevHealth({env:()=>({...env,...patch}),now:()=>now,fetchImpl:async(url,options)=>{
  const u=new URL(url);calls.push(u.pathname);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  if(u.pathname==='/auth/v1/user')return Response.json({id:uid});
  if(u.pathname==='/rest/v1/profiles')return Response.json([{id:uid,active,role_id:role}]);
  assert.equal(u.hostname,'graph.facebook.com');
  if(error)throw Error(env.FACEBOOK_COMMENTS_DEV_PAGE_ACCESS_TOKEN);
  if(u.pathname.endsWith('/debug_token'))return Response.json({data:{...metadata,...meta}});
  if(u.pathname.endsWith('/me'))return Response.json({id:identity});
  if(u.pathname.endsWith('/subscribed_apps'))return Response.json({data:[{id:app,subscribed_fields:fields}]});
  throw Error('unexpected path');
 }});
 const r=await handler(new Request('https://example.test/health',{method,headers:auth?{Authorization:'Bearer synthetic-session-123456789'}:{}}));const body=await r.json();
 const serialized=JSON.stringify(body);for(const secret of [env.FACEBOOK_COMMENTS_DEV_PAGE_ACCESS_TOKEN,env.FACEBOOK_COMMENTS_DEV_APP_SECRET,uid,page,app])assert.ok(!serialized.includes(secret));
 assert.equal(body.sender,false);assert.equal(body.dispatches,0);return {body,calls,http:r.status};
}
test('valid Page token, comments scopes, identity, expiry and only feed',async()=>{const r=await run();assert.equal(r.body.status,'PASS');assert.equal(r.calls.length,5);assert.equal(r.body.meta_non_expiring,true);});
test('no auth, role denied, inactive and production fail before Meta',async()=>{for(const p of [{auth:false},{role:'asesor'},{active:false},{patch:{SUPABASE_URL:'https://production.invalid'}}]){const r=await run(p);assert.equal(r.body.status,'FAIL');assert.ok(!r.calls.some(x=>x.startsWith('/v26.0')));}});
test('no writes accepted',async()=>{const r=await run({method:'POST'});assert.equal(r.http,405);assert.equal(r.calls.length,0);});
test('wrong app/Page, invalid token and type fail closed',async()=>{for(const meta of [{app_id:'wrong'},{profile_id:'wrong'},{is_valid:false},{type:'USER'}])assert.equal((await run({meta})).body.status,'FAIL');});
test('missing read scope and wrong granular target fail',async()=>{for(const meta of [{scopes:['pages_messaging']},{granular_scopes:[{scope:'pages_read_user_content',target_ids:['wrong']}]},{scopes:null}])assert.equal((await run({meta})).body.status,'FAIL');});
test('expired, unknown and invalid expiry fail',async()=>{for(const meta of [{expires_at:1},{expires_at:null},{data_access_expires_at:-1},{expires_at:1800000050}])assert.equal((await run({meta})).body.stage,'expiry');});
test('sender ON/missing credential/wrong config fail before Meta',async()=>{for(const patch of [{FACEBOOK_COMMENTS_DEV_MANUAL_SEND_ENABLED:'true'},{FACEBOOK_COMMENTS_DEV_PAGE_ACCESS_TOKEN:''},{FACEBOOK_COMMENTS_DEV_APP_ID:'wrong'}]){const r=await run({patch});assert.equal(r.body.status,'FAIL');assert.equal(r.calls.length,2);}});
test('functional identity and field isolation enforced',async()=>{for(const p of [{identity:'wrong'},{fields:['feed','messages']},{fields:[]}])assert.equal((await run(p)).body.status,'FAIL');});
test('transport exceptions cannot disclose credentials',async()=>{const r=await run({error:true});assert.equal(r.body.status,'FAIL');assert.equal(r.body.stage,'introspection');});
