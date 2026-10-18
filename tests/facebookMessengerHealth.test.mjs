import test from 'node:test';
import assert from 'node:assert/strict';
import {runMessengerHealth,createMessengerHealthApi} from '../lib/messaging/facebook/messenger/health.js';
import {seal,open} from '../lib/messaging/facebook/messenger/crypto.js';
const c={connection:'11111111-1111-4111-8111-111111111111',app:'101',page:'202',version:'v26.0',secret:'a'.repeat(32),indexKey:'b'.repeat(64),dataKey:'c'.repeat(64),tokenKey:'d'.repeat(64)};
const token='synthetic-page-token-123456789',now=Date.now(),until=new Date(now+3600000).toISOString();
const previous=()=>({app_id:c.app,page_id:c.page,generation:1,valid_until:until,token_box:seal(c,'token',[1,until],token)});
function fixture(prior=previous(),patch={}){
 let saved,calls=0;
 return {db:{rpc:async(name,args)=>name.endsWith('begin_v1')?{data:prior}:(saved=args.p_args,{data:true})},
 fetchImpl:async(u,o)=>{calls++;assert.equal(o.method,'GET');assert.equal(u.hostname,'graph.facebook.com');assert.equal(o.redirect,'error');
  return {ok:true,status:200,json:async()=>u.pathname.endsWith('debug_token')?{data:{is_valid:true,app_id:c.app,profile_id:c.page,type:'PAGE',expires_at:0,data_access_expires_at:0,scopes:['pages_messaging','pages_manage_metadata'],...patch}}:u.pathname.endsWith('/me')?{id:c.page}:{data:[{id:c.app,subscribed_fields:['messages','message_echoes']}]}};},
 get saved(){return saved;},get calls(){return calls;},now:()=>now};
}
test('health reads Meta only; refreshes local encrypted lease without sender/actor grants',async()=>{
 const f=fixture(),r=await runMessengerHealth(c,f);assert.equal(r.status,'healthy');assert.equal(f.calls,3);
 assert.equal(open(c,'token',[2,f.saved.valid_until],f.saved.token_box),token);
 assert.equal(f.saved.generation,2);assert.ok(!('actor' in f.saved));assert.ok(!JSON.stringify(r).includes(token));
});
test('invalid, foreign and expired token fail without refresh and sanitized failure is persisted',async()=>{
 for(const patch of [{is_valid:false},{app_id:'999'},{profile_id:'999'},{expires_at:1},{scopes:[]}]){
  const f=fixture(previous(),patch),r=await runMessengerHealth(c,f);assert.equal(r.ok,false);assert.equal(f.saved.ok,false);assert.equal(f.saved.token_box,undefined);assert.equal(f.calls,1);
 }
});
test('corrupt ciphertext and wrong credential binding never reach Meta',async()=>{
 for(const p of [{...previous(),token_box:{}},{...previous(),app_id:'999'}]){
  const f=fixture(p);assert.equal((await runMessengerHealth(c,f)).stage,'credential_binding');assert.equal(f.calls,0);
 }
});
test('not due, concurrent run and missing credential do not call Meta',async()=>{
 for(const p of [null,{health_error:'credential_missing'}]){const f=fixture(p);await runMessengerHealth(c,f);assert.equal(f.calls,0);assert.equal(f.saved,undefined);}
});
test('transport errors and missing subscription fail closed; no sensitive diagnostics',async()=>{
 const f=fixture();f.fetchImpl=async()=>{throw Error(token);};const r=await runMessengerHealth(c,f);assert.equal(r.ok,false);assert.ok(!JSON.stringify(r).includes(token));
 const g=fixture(),base=g.fetchImpl;g.fetchImpl=async(u,o)=>u.pathname.endsWith('subscribed_apps')?{ok:true,status:200,json:async()=>({data:[]})}:base(u,o);
 assert.equal((await runMessengerHealth(c,g)).stage,'subscriptions_missing');
});
test('CAS conflict is terminal for this health run, never retried',async()=>{
 const f=fixture();let writes=0;f.db.rpc=async(n)=>n.endsWith('begin_v1')?{data:previous()}:(writes++,{data:false});
 assert.equal((await runMessengerHealth(c,f)).status,'health_conflict');assert.equal(writes,1);
});
test('cron rejects wrong auth/method before DB or Meta; disabled by default',async()=>{
 const api=createMessengerHealthApi({env:()=>({CRON_SECRET:'cron-only-synthetic-secret'}),getDb:()=>{throw Error('must not access');}});
 for(const [method,auth,status] of [['POST','Bearer cron-only-synthetic-secret',405],['GET',undefined,401],['GET','wrong',401],['GET','Bearer cron-only-synthetic-secret',200]]){
  const res={setHeader(){},status(s){this.s=s;return this;},json(b){this.body=b;return this;}};
  await api({method,headers:{authorization:auth}},res);assert.equal(res.s,status);
 }
});
