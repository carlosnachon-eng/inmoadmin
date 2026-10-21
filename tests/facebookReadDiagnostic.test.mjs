import test from 'node:test';
import assert from 'node:assert/strict';
import {seal} from '../lib/messaging/facebook/messenger/crypto.js';
import {diagnoseFacebookRead} from '../lib/messaging/commentAgent/facebookReadDiagnostic.js';
const now=Date.now(),token='synthetic-only-token-not-real';
const c={connection:'11111111-1111-4111-8111-111111111111',app:'101',page:'202',version:'v26.0',secret:'a'.repeat(32),indexKey:'b'.repeat(64),dataKey:'c'.repeat(64),tokenKey:'d'.repeat(64),senderEnabled:false};
const scopes=['pages_messaging','pages_manage_metadata','pages_read_engagement','pages_read_user_content'];
const credential=()=>{const row={app_id:c.app,page_id:c.page,token_type:'PAGE',generation:1,valid_until:new Date(now-1000).toISOString(),verified_at:new Date(now-86401000).toISOString()};return {...row,token_box:seal(c,'token',[row.generation,row.valid_until],token)};};
function mock({permissions=scopes,posts={data:[{id:'202_303',from:{id:'202'}}]},comments={data:[{id:'303_404',parent:{id:'202_303'}}]},errorAt=null}={}){
 const calls=[];
 const fetchImpl=async(u,i)=>{calls.push(u.pathname);assert.equal(i.method,'GET');assert.equal(i.redirect,'error');assert.equal(u.hostname,'graph.facebook.com');
 if(u.pathname.endsWith(errorAt||'never'))return {ok:false,status:403,json:async()=>({error:{code:200,error_subcode:42,message:token}})};
 const body=u.pathname.endsWith('debug_token')?{data:{is_valid:true,app_id:c.app,profile_id:c.page,type:'PAGE',scopes:permissions,expires_at:0,data_access_expires_at:0}}:u.pathname.endsWith('/me')?{id:c.page}:u.pathname.endsWith('/subscribed_apps')?{data:[{id:c.app,subscribed_fields:['messages','message_echoes']}]}:u.pathname.endsWith('/posts')?posts:comments;
 return {ok:true,status:200,json:async()=>body};};return {calls,fetchImpl};
}
test('bounded GET-only diagnostic decrypts existing credential without renewal or exposing IDs/content/token',async()=>{
 const m=mock(),row=credential(),before=JSON.stringify(row),r=await diagnoseFacebookRead({c,credential:row,...m,now});
 assert.equal(r.status,'read_pass');assert.equal(r.stored_lease_fresh,false);assert.equal(r.sender,false);assert.equal(r.dispatches,0);assert.equal(r.credential_saved,false);assert.equal(m.calls.length,5);assert.equal(JSON.stringify(row),before);
 for(const sensitive of [token,'202_303','303_404',c.secret])assert.ok(!JSON.stringify(r).includes(sensitive));
});
test('missing credential, sender ON, foreign binding and damaged ciphertext block before network',async()=>{
 for(const [config,row] of [[c,null],[{...c,senderEnabled:true},credential()],[c,{...credential(),page_id:'999'}],[c,{...credential(),token_box:{}}]]){
 const m=mock(),r=await diagnoseFacebookRead({c:config,credential:row,...m,now});assert.equal(r.status,'blocked');assert.equal(m.calls.length,0);
 }
});
test('missing read scopes stops at exact permission stage without attempting unauthorized edge',async()=>{
 for(const [permissions,stage,count] of [[scopes.slice(0,2),'read_permissions',3],[scopes.slice(0,3),'comment_read_permissions',4]]){
 const m=mock({permissions}),r=await diagnoseFacebookRead({c,credential:credential(),...m,now});assert.equal(r.stage,stage);assert.equal(m.calls.length,count);
 }
});
test('Meta rejection is sanitized and never retried',async()=>{
 const m=mock({errorAt:'/posts'}),r=await diagnoseFacebookRead({c,credential:credential(),...m,now});assert.equal(r.stage,'page_posts');assert.equal(r.http_status,403);assert.equal(r.code,200);assert.equal(r.subcode,42);assert.equal(m.calls.length,4);assert.ok(!JSON.stringify(r).includes(token));
});
test('empty samples are not proof of no comments or PASS',async()=>{
 for(const [patch,status] of [[{posts:{data:[]}},'no_post_in_sample'],[{comments:{data:[]}},'no_comment_in_sample']]){
 const m=mock(patch),r=await diagnoseFacebookRead({c,credential:credential(),...m,now});assert.equal(r.status,status);
 }
});
test('unexpected shapes and wrong owner/parent fail closed',async()=>{
 for(const patch of [{posts:{}},{posts:{data:[{id:'999_303',from:{id:'999'}}]}},{comments:{}},{comments:{data:[{id:'303_404',parent:{id:'999_303'}}]}}]){
 const m=mock(patch),r=await diagnoseFacebookRead({c,credential:credential(),...m,now});assert.equal(r.status,'blocked');
 }
});
test('thrown provider errors never reveal URL/token',async()=>{
 const r=await diagnoseFacebookRead({c,credential:credential(),now,fetchImpl:async()=>{throw Error(token);}});assert.equal(r.status,'blocked');assert.ok(!JSON.stringify(r).includes(token));
});
