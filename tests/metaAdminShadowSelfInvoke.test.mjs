import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createShadowOnceSelfInvoke} from '../lib/messaging/metaAdminCapture/shadowOnceSelfInvoke.js';
import {createShadowOnceOperator} from '../lib/messaging/metaAdminCapture/shadowOnceOperator.js';
import {runMetaAdminShadowOnce} from '../lib/messaging/metaAdminCapture/shadowOnce.js';
const id='11111111-1111-4111-8111-111111111111';
const secret='synthetic-only-not-a-real-secret-12345';
function harness({profile={active:true,role_id:'admin'},fail=false,prior=false,change=()=>{}}={}){
 const env={VERCEL_ENV:'production',META_ADMIN_SHADOW_AUTHORIZED_INPUT_ID:id,META_ADMIN_SHADOW_OPERATOR_SECRET:secret,
 OPENAI_API_KEY:'synthetic',OPENAI_ADMIN_AGENT_MODEL:'gpt-6-luna',SUPABASE_SERVICE_ROLE_KEY:'synthetic',NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid'};
 let claimed=prior,calls=0,invocations=0,reads=0;
 const store={async snapshot(){const s={input:{id,waba_id:'1297760461811288',phone_number_id:'1198305790026665',
 native_message_id:'wamid.synthetic',capture_reason:'captured',message_type:'text',observer_only:true,observer_state:'observed',sanitized_text:'Hola'},
 enabled:true,scope_channel:'544519',checked_at:new Date().toISOString(),mutated:false,later_scope_echoes:0,echo_assessments:[],later_scope_uncertain:0,
 identity:{state:'unmatched',reason:'no_exact_identity',candidate_count:0,authorizes_business:false}};change(s,++reads);return s;},
 async claim(){if(claimed)return false;claimed=true;return true;},async start(){return true;},async finish(){}};
 const original=createShadowOnceOperator({env,makeStore:()=>store,run:a=>runMetaAdminShadowOnce({...a,propose:async()=>{
 calls++;if(fail)throw Error(secret);return {provider:'openai',model:env.OPENAI_ADMIN_AGENT_MODEL,run_id:'synthetic',proposed_response:'¿Cómo puedo orientarte?'};}})});
 const handler=createShadowOnceSelfInvoke({env,authorize:async()=>profile,operator:async(req,res)=>{
 invocations++;assert.deepEqual(req.body,{input_id:id});assert.equal(req.headers.authorization,`Bearer ${secret}`);return original(req,res);}});
 return {env,get calls(){return calls;},get invocations(){return invocations;},async invoke(overrides={}){
 const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
 await handler({method:'POST',headers:{origin:'https://app.emporioinmobiliario.com.mx','content-type':'application/json'},body:{},...overrides},res);
 assert.ok(!JSON.stringify(res).includes(secret));return res;}};
}
test('one self-invocation uses only env input and existing handler; replay blocks',async()=>{
 const h=harness();assert.equal((await h.invoke()).body.status,'complete');assert.equal(h.calls,1);
 assert.equal((await h.invoke()).body.status,'blocked');assert.equal(h.calls,1);
});
for(const profile of [null,{active:false,role_id:'admin'},{active:true,role_id:'coord_operaciones'},{active:true,role_id:'client'}])
 test(`unauthorized profile ${JSON.stringify(profile)}`,async()=>{const h=harness({profile});assert.equal((await h.invoke()).code,403);assert.equal(h.invocations,0);});
for(const [name,request] of [['GET',{method:'GET'}],['client input',{body:{input_id:id}}],['array',{body:[]}],['no origin',{headers:{}}],
 ['cross origin',{headers:{origin:'https://other.invalid','content-type':'application/json'}}]])
 test(name,async()=>{const h=harness();assert.ok((await h.invoke(request)).code>=400);assert.equal(h.invocations,0);});
test('preview cannot execute',async()=>{const h=harness();h.env.VERCEL_ENV='preview';assert.equal((await h.invoke()).code,403);assert.equal(h.invocations,0);});
for(const key of ['META_ADMIN_SHADOW_OPERATOR_SECRET','META_ADMIN_SHADOW_AUTHORIZED_INPUT_ID'])
 test(`missing ${key}`,async()=>{const h=harness();delete h.env[key];assert.equal((await h.invoke()).code,503);assert.equal(h.invocations,0);});
test('prior claim consumes input, no alternative',async()=>{const h=harness({prior:true});assert.equal((await h.invoke()).body.status,'blocked');assert.equal(h.calls,0);});
test('concurrency one model call',async()=>{const h=harness();const r=await Promise.all([h.invoke(),h.invoke()]);assert.deepEqual(r.map(x=>x.code).sort(),[200,409]);assert.equal(h.calls,1);});
test('uncertain no retry',async()=>{const h=harness({fail:true});assert.equal((await h.invoke()).body.status,'uncertain');assert.equal(h.calls,1);assert.equal(h.invocations,1);});
test('post gate preserved',async()=>{const h=harness({change(s,n){if(n===4){s.later_scope_echoes=1;s.echo_assessments=[{state:'same_subject'}];}}});
 const r=await h.invoke();assert.equal(r.body.status,'invalidated');assert.equal(r.body.proposed_response,null);assert.equal(h.calls,1);});
test('page manual-only, no operator secret, no automatic caller',()=>{
 const page=readFileSync(new URL('../pages/meta-admin-shadow-once.js',import.meta.url),'utf8');
 assert.ok(!page.includes('useEffect'));assert.ok(!page.includes('OPERATOR_SECRET'));assert.ok(!page.includes('input_id'));
 assert.equal((page.match(/await fetch\(/g)||[]).length,1);
});
