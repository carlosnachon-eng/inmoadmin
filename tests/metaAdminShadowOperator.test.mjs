import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createShadowOnceOperator} from '../lib/messaging/metaAdminCapture/shadowOnceOperator.js';
import {runMetaAdminShadowOnce} from '../lib/messaging/metaAdminCapture/shadowOnce.js';
import {readFileSync} from 'node:fs';
import {SHADOW_ONCE_SNAPSHOT_SQL} from '../lib/messaging/metaAdminCapture/shadowOncePostgres.js';
import {createShadowOnceSupabaseStore} from '../lib/messaging/metaAdminCapture/shadowOnceSupabase.js';
const id=randomUUID(), secret='synthetic-operator-secret-not-real-123456';
function harness({change=()=>{},failure=false}={}){
 let record=null,calls=0,reads=0,stores=0;
 const env={META_ADMIN_SHADOW_OPERATOR_SECRET:secret,META_ADMIN_SHADOW_AUTHORIZED_INPUT_ID:id,
 OPENAI_API_KEY:'synthetic',OPENAI_ADMIN_AGENT_MODEL:'gpt-6-luna',SUPABASE_SERVICE_ROLE_KEY:'synthetic',NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid'};
 const store={async snapshot(){const s={input:{id,waba_id:'1297760461811288',phone_number_id:'1198305790026665',
 native_message_id:'wamid.synthetic',capture_reason:'captured',message_type:'text',observer_only:true,observer_state:'observed',sanitized_text:'Hola'},
 enabled:true,scope_channel:'544519',checked_at:new Date().toISOString(),mutated:false,later_scope_echoes:0,echo_assessments:[],later_scope_uncertain:0,
 identity:{state:'unmatched',reason:'no_exact_identity',candidate_count:0,authorizes_business:false}};change(s,++reads);return s;},
 async claim(a){if(record)return false;record={...a};return true;},async start(){return true;},async startAdminModel(){return true;},async finish(a){record={...record,...a};}};
 const handler=createShadowOnceOperator({env,makeStore(){stores++;return store;},run:a=>runMetaAdminShadowOnce({...a,propose:async()=>{
 calls++;if(failure)throw Error('SECRET');return{provider:'openai',model:env.OPENAI_ADMIN_AGENT_MODEL,run_id:'synthetic',proposed_response:'¿En qué puedo orientarte?'};}})});
 const invoke=async(overrides={})=>{const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
 await handler({method:'POST',headers:{authorization:`Bearer ${secret}`},body:{input_id:id},...overrides},res);return res;};
 return {invoke,env,get calls(){return calls;},get stores(){return stores;}};
}
test('authorized one-shot returns only status and sanitized proposal; duplicate blocked',async()=>{
 const h=harness();const r=await h.invoke();assert.equal(r.code,200);assert.deepEqual(Object.keys(r.body),['status','proposed_response']);
 assert.equal(r.body.proposed_response,'¿En qué puedo orientarte?');assert.equal((await h.invoke()).code,409);assert.equal(h.calls,1);
});
for(const [name,request] of [['GET',{method:'GET'}],['no auth',{headers:{}}],['wrong secret',{headers:{authorization:'Bearer wrong'}}],
 ['other input',{body:{input_id:randomUUID()}}],['extra fields',{body:{input_id:id,model:'other'}}]])test(name,async()=>{
 const h=harness();assert.ok((await h.invoke(request)).code>=400);assert.equal(h.calls,0);assert.equal(h.stores,0);
});
for(const key of ['OPENAI_API_KEY','OPENAI_ADMIN_AGENT_MODEL','SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_SUPABASE_URL','META_ADMIN_SHADOW_OPERATOR_SECRET','META_ADMIN_SHADOW_AUTHORIZED_INPUT_ID'])
 test(`missing ${key} fails before store`,async()=>{const h=harness();delete h.env[key];assert.ok((await h.invoke()).code>=400);assert.equal(h.stores,0);});
test('provider mismatch blocks',async()=>{const h=harness();h.env.META_ADMIN_SHADOW_MODEL_PROVIDER='anthropic';assert.equal((await h.invoke()).code,503);assert.equal(h.calls,0);});
test('concurrency one model',async()=>{const h=harness();const r=await Promise.all([h.invoke(),h.invoke()]);assert.deepEqual(r.map(x=>x.code).sort(),[200,409]);assert.equal(h.calls,1);});
test('post-gate invalidates and never returns invalid proposal',async()=>{const h=harness({change(s,n){if(n===4){s.later_scope_echoes=1;s.echo_assessments=[{state:'same_subject'}];}}});
 const r=await h.invoke();assert.equal(r.body.status,'invalidated');assert.equal(r.body.proposed_response,null);assert.equal(h.calls,1);});
test('uncertain consumes attempt without retry or secret output',async()=>{const h=harness({failure:true});const r=await h.invoke();assert.equal(r.body.status,'uncertain');assert.ok(!JSON.stringify(r).includes('SECRET'));await h.invoke();assert.equal(h.calls,1);});
test('snapshot RPC is exactly existing snapshot SQL, not a new gate implementation',()=>{
 const sql=readFileSync(new URL('../scripts/sql/meta-admin-shadow-once-runtime.sql',import.meta.url),'utf8');
 assert.equal(sql.split('$snapshot$')[1].trim().replace(/;$/,''),SHADOW_ONCE_SNAPSHOT_SQL.trim());
 assert.equal((sql.match(/security definer/g)||[]).length,4);
 assert.equal((sql.match(/revoke all on function public\.[^;]+from public,anon,authenticated,service_role/g)||[]).length,4);
 assert.ok(sql.includes('revoke update(status,reason,model_calls'));assert.ok(!sql.includes('alter default privileges'));
});
test('Supabase adapter only invokes scoped snapshot/journal RPCs',async()=>{
 const calls=[];
 const store=createShadowOnceSupabaseStore({async rpc(name,args){calls.push({name,args});return {data:name.includes('snapshot')?
 {input:{},subject_nodes:[],echo_roots:[]}:true,error:null};}});
 const s=await store.snapshot(id);assert.deepEqual(s.echo_assessments,[]);assert.equal(s.transport_health.status,'unknown');
 const a={inputId:id,token:randomUUID(),fingerprint:'a'.repeat(64),identityState:'unmatched',provider:'openai',model:'gpt-6-luna'};
 assert.equal(await store.claim(a),true);assert.equal(await store.start(a),true);
 assert.equal(await store.startAdminModel(a),true);
 await store.finish({...a,status:'blocked',reason:'synthetic'});
 assert.deepEqual(calls.map(c=>c.name),['meta_admin_shadow_snapshot_v1','meta_admin_shadow_claim_v1','meta_admin_shadow_start_v1','meta_admin_shadow_admin_model_start_v1','meta_admin_shadow_finish_v1']);
 assert.ok(calls.every(c=>c.args.p_input_id===id));assert.equal(calls[4].args.p_proposal,null);
});
test('RPC failure is sanitized and never retried',async()=>{
 let calls=0;const s=createShadowOnceSupabaseStore({async rpc(){calls++;return{error:{message:'SECRET'}};}});
 await assert.rejects(s.snapshot(id),/^Error: shadow_journal_unavailable$/);assert.equal(calls,1);
});
