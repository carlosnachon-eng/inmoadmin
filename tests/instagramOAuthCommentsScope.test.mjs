import test from 'node:test';
import assert from 'node:assert/strict';
import {beginBusinessOAuth,businessOAuthPreflight,completeBusinessOAuth,businessOAuthSafeDiagnostic,tokenForSend,tokenForComments} from '../lib/messaging/instagram/business/tokenLifecycle.js';
import {seal} from '../lib/messaging/instagram/business/crypto.js';
import {SCOPES,MESSAGE_SCOPES} from '../lib/messaging/instagram/business/config.js';
import {projectOAuthScopeDiagnostic} from '../lib/messaging/instagram/business/diagnosticDisplay.js';
const c={connection:'fixture',app:'100',instagramApp:'200',account:'300',secret:'PRIVATE',tokenKey:'e'.repeat(64),redirect:'https://example.invalid/callback',version:'v26.0'};
test('actual begin URL and read-only preflight share exact three scopes',async()=>{
 let creates=0;
 const p=businessOAuthPreflight(c);assert.equal(p.state_created,false);assert.equal(creates,0);
 const u=new URL(await beginBusinessOAuth({config:c,actor:'operator',sessionBinding:'PRIVATE',store:{createState:async()=>{creates++;}}}));
 assert.equal(creates,1);assert.equal(u.origin,'https://www.instagram.com');assert.equal(u.pathname,'/oauth/authorize');
 assert.deepEqual(u.searchParams.get('scope').split(','),['instagram_business_basic','instagram_business_manage_messages','instagram_business_manage_comments']);
 assert.equal(u.searchParams.get('client_id'),c.instagramApp);assert.equal(u.searchParams.get('redirect_uri'),c.redirect);
 assert.equal(u.searchParams.get('enable_fb_login'),'false');assert.equal(u.searchParams.get('state').length,43);
 u.searchParams.delete('state');assert.equal(u.href,p.authorization_url_without_state);assert.ok(!u.href.includes('PRIVATE'));
});
for(const scenario of ['three_granted','comments_omitted','unexpected_scope','save_failed','bad_shape'])test(scenario,async()=>{
 let calls=0,saves=0,row;
 const permissions=scenario==='comments_omitted'?[...MESSAGE_SCOPES]:scenario==='unexpected_scope'?[...SCOPES,'private_unknown_scope']:[...SCOPES];
 const args={config:c,actor:'operator',sessionBinding:'PRIVATE',state:'a'.repeat(43),code:'PRIVATE',store:{consumeState:async()=>true,saveCredential:async r=>{saves++;if(scenario==='save_failed')throw Error('PRIVATE');row=r;}},fetchImpl:async()=>{
  calls++;const body=calls===1?(scenario==='bad_shape'?{PRIVATE:'PRIVATE'}:{access_token:'PRIVATE',user_id:'400',permissions}):calls===3?{access_token:'PRIVATE',token_type:'bearer',expires_in:5184000}:{user_id:c.account};
  return {ok:true,status:200,text:async()=>JSON.stringify(body),json:async()=>body};
 }};
 if(scenario==='three_granted'){
  const result=await completeBusinessOAuth(args);assert.equal(result.status,'healthy');assert.deepEqual(row.scopes,SCOPES);assert.deepEqual(result.oauth_scopes.granted_scopes,SCOPES);assert.equal(saves,1);assert.ok(row.token_box);assert.ok(!JSON.stringify(row).includes('PRIVATE'));return;
 }
 await assert.rejects(()=>completeBusinessOAuth(args),e=>{
  const d=businessOAuthSafeDiagnostic(e);assert.ok(!JSON.stringify(d).includes('PRIVATE'));assert.ok(!JSON.stringify(d).includes('private_unknown_scope'));assert.equal(d.short_token_response_shape,undefined);
  assert.equal(d.stage,scenario==='save_failed'?'credential_persistence':scenario==='bad_shape'?'short_token_shape':'granted_scopes');
  assert.deepEqual(d.requested_scopes,SCOPES);
  if(scenario==='comments_omitted'){assert.deepEqual(d.granted_scopes,MESSAGE_SCOPES);assert.deepEqual(d.missing_scopes,['instagram_business_manage_comments']);}
  if(scenario==='unexpected_scope')assert.equal(d.unexpected_scope_count,1);
  if(scenario==='save_failed')assert.deepEqual(d.granted_scopes,SCOPES);
  if(scenario==='bad_shape')assert.equal(d.granted_scopes,null);
  return true;
 });
 assert.equal(saves,scenario==='save_failed'?1:0);assert.equal(row,undefined);assert.equal(calls,scenario==='save_failed'?4:1);
});
test('UI scope projection rejects arbitrary provider strings',()=>{
 const v=projectOAuthScopeDiagnostic({requested_scopes:[...SCOPES,'PRIVATE'],granted_scopes:['PRIVATE'],missing_scopes:['PRIVATE'],unexpected_scope_count:'PRIVATE',access_token:'PRIVATE'});
 assert.ok(!JSON.stringify(v).includes('PRIVATE'));assert.deepEqual(v.requested_scopes,SCOPES);
});
test('existing two-scope credential still decrypts for DM, never for comments',()=>{
 const now=Date.now(),r={provider:'instagram_login_business',connection_id:c.connection,app_id:c.app,instagram_app_id:c.instagramApp,account_id:c.account,generation:'fixture',issued_at:new Date(now-1000).toISOString(),expires_at:new Date(now+86400000).toISOString(),verified_at:new Date(now).toISOString(),status:'healthy',scopes:MESSAGE_SCOPES};
 r.token_box=seal(c,'token',[r.generation,r.issued_at,r.expires_at],{access_token:'PRIVATE'});
 assert.equal(tokenForSend(c,r,now),'PRIVATE');assert.throws(()=>tokenForComments(c,r,now));
});
