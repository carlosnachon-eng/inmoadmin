// Focused LOCAL database test only. No remote URL, model or sender accepted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { createShadowOnceSupabaseStore } from '../lib/messaging/metaAdminCapture/shadowOnceSupabase.js';
import { runMetaAdminShadowOnce } from '../lib/messaging/metaAdminCapture/shadowOnce.js';

assert.ok(path.isAbsolute(process.env.META_CAPTURE_TEST_DEPS || ''));
const require=createRequire(path.join(process.env.META_CAPTURE_TEST_DEPS,'once-test.cjs'));
const EmbeddedPostgres=require('embedded-postgres').default,{Client}=require('pg');
const directory=await mkdtemp(path.join(tmpdir(),'meta-admin-once-pg-'));
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const password=randomBytes(24).toString('hex');
const server=new EmbeddedPostgres({databaseDir:path.join(directory,'db'),port,user:'postgres',password,persistent:false,
  postgresFlags:['-h','127.0.0.1','-k',directory],onLog(){},onError(){}});
const clients=[],results=[];let root,modelCalls=0,cleaned=false;
globalThis.fetch=()=>assert.fail('No network/model/transport');
async function connection(role){const c=new Client({host:'127.0.0.1',port,user:'postgres',password,database:'postgres'});await c.connect();clients.push(c);if(role)await c.query(`set role ${role}`);return c;}
async function scenario(name,fn){const start=performance.now();await fn();results.push({name,result:'PASS',ms:Math.round(performance.now()-start)});}
const env={OPENAI_ADMIN_AGENT_MODEL:'gpt-6-luna'};
const proposal=async()=>{modelCalls++;return{provider:'openai',model:env.OPENAI_ADMIN_AGENT_MODEL,run_id:'resp_synthetic',proposed_response:'¿En qué puedo orientarte?'};};
// Synthetic health evidence ONLY for the disposable local SQL harness.
const health=async()=>({status:'healthy',checked_at:new Date().toISOString(),
 waba_id:'1297760461811288',phone_number_id:'1198305790026665',receiver_ready:true,subscription_active:true,
 coverage_complete:true,known_pending:0,in_flight:0,unresolved_failures:0,
 covered_from:'2020-01-01T00:00:00.000Z',covered_through:new Date().toISOString(),evidence_refs:['synthetic-local-only']});
let first,second;
async function fixture(){const id=randomUUID(),event=randomUUID();await root.query(`insert into public.meta_observer_events
 (id,waba_id,phone_number_id,occurred_at,received_at,category,observer_only,state,error_codes)
 values($1,'1297760461811288','1198305790026665',clock_timestamp(),clock_timestamp(),'inbound',true,'observed','{}')`,[event]);
 await root.query(`insert into meta_admin_private.inbound_inputs values($1::uuid,$2,'wamid.SYNTHETIC_'||($1::uuid)::text,
 '1297760461811288','1198305790026665',clock_timestamp(),clock_timestamp(),'Consulta sintética.','captured','text',repeat('a',64))`,[id,event]);return id;}
const run=(id,store=first,propose=proposal)=>runMetaAdminShadowOnce({inputId:id,authorizedInputId:id,store,env,propose});
try{
 await server.initialise();await server.start();root=await connection();
 await root.query(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema meta_admin_private;grant usage on schema public,meta_admin_private to service_role;
 alter default privileges grant all on tables to anon,authenticated,service_role;
 create table public.meta_observer_events(id uuid primary key,waba_id text,phone_number_id text,occurred_at timestamptz,
 received_at timestamptz,category text,observer_only boolean,state text,error_codes integer[],original_message_id text,native_message_id text);
 create table meta_admin_private.inbound_inputs(id uuid primary key,meta_observer_event_id uuid,native_message_id text,
 waba_id text,phone_number_id text,occurred_at timestamptz,captured_at timestamptz,sanitized_text text,capture_reason text,message_type text,sender_ref text);
 create table meta_admin_private.native_subject_evidence(meta_observer_event_id uuid,subject_ref text,key_tag text,context_id text,evidence_state text);
 create table meta_admin_private.capture_config(waba_id text,phone_number_id text,enabled boolean,not_before timestamptz);
 create table public.meta_observer_admin_scope(waba_id text,phone_number_id text,enabled boolean,respond_channel_id text);
 insert into meta_admin_private.capture_config values('1297760461811288','1198305790026665',true,clock_timestamp()-interval '1 minute');
 insert into public.meta_observer_admin_scope values('1297760461811288','1198305790026665',true,'544519');
 create function public.resolve_meta_admin_identity_v1(uuid) returns jsonb language sql stable as
 $$select '{"state":"unmatched","reason":"no_exact_identity","candidate_count":0,"authorizes_business":false}'::jsonb$$;`);
 const defaults=(await root.query('select * from pg_default_acl order by oid')).rows;
 await root.query(await readFile(new URL('../scripts/sql/meta-admin-shadow-once-journal.sql',import.meta.url),'utf8'));
 await root.query(await readFile(new URL('../scripts/sql/meta-admin-shadow-once-runtime.sql',import.meta.url),'utf8'));
 function adapter(client){return createShadowOnceSupabaseStore({async rpc(name,args){
 const keys=Object.keys(args),r=await client.query('select public.'+name+'('+keys.map((k,i)=>k+'=> $'+(i+1)).join(',')+') data',Object.values(args));return {data:r.rows[0].data,error:null};}});}
 first=adapter(await connection('service_role'));
 second=adapter(await connection('service_role'));
 await scenario('ACL and defaults unchanged',async()=>{
   assert.deepEqual((await root.query('select * from pg_default_acl order by oid')).rows,defaults);
   const r=(await root.query(`select relrowsecurity from pg_class where oid='meta_admin_private.shadow_once_runs'::regclass`)).rows[0];assert.equal(r.relrowsecurity,true);
   for(const role of ['anon','authenticated'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])
    assert.equal((await root.query("select has_table_privilege($1,'meta_admin_private.shadow_once_runs',$2) ok",[role,privilege])).rows[0].ok,false);
   for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal((await root.query("select has_table_privilege('service_role','meta_admin_private.shadow_once_runs',$1) ok",[privilege])).rows[0].ok,false);
   assert.equal((await root.query("select has_column_privilege('service_role','meta_admin_private.shadow_once_runs','claim_token','UPDATE') ok")).rows[0].ok,false);
 });
 await scenario('real SQL snapshot + concurrent UNIQUE claim: one model/proposal',async()=>{
   const id=await fixture(),before=modelCalls;const rows=await Promise.all([run(id,first),run(id,second)]);
   assert.deepEqual(rows.map(x=>x.status).sort(),['already_claimed','complete']);assert.equal(modelCalls-before,1);
   const j=(await root.query('select status,model_calls,send_calls,proposed_response from meta_admin_private.shadow_once_runs where input_id=$1',[id])).rows[0];
   assert.equal(j.status,'complete');assert.equal(j.model_calls,1);assert.equal(j.send_calls,0);assert.ok(j.proposed_response);
   assert.equal((await run(id)).status,'already_claimed');
 });
 await scenario('crash after claim cannot be reclaimed and wrong token cannot start',async()=>{
   const id=await fixture(),token=randomUUID();assert.equal(await first.claim({inputId:id,token,fingerprint:'a'.repeat(64),identityState:'unmatched',provider:'openai',model:env.OPENAI_ADMIN_AGENT_MODEL}),true);
   assert.equal(await second.start({inputId:id,token:randomUUID()}),false);
   assert.equal((await run(id)).status,'already_claimed');
 });
 await scenario('uncertain request consumes attempt; zero retry',async()=>{
   const id=await fixture();const r=await run(id,first,async()=>{modelCalls++;throw Error('timeout');});assert.equal(r.status,'uncertain');
   assert.equal((await run(id)).status,'already_claimed');
 });
 await scenario('echo after claim blocks before model',async()=>{
   const id=await fixture(),before=modelCalls;const base=first;
   const injecting={...base,async claim(a){const won=await base.claim(a);await root.query(`insert into public.meta_observer_events(id,waba_id,phone_number_id,occurred_at,received_at,category,observer_only,state,error_codes)
     values($1,'1297760461811288','1198305790026665',clock_timestamp(),clock_timestamp(),'app_echo',true,'observed','{}')`,[randomUUID()]);return won;}};
   assert.equal((await run(id,injecting)).status,'blocked');assert.equal(modelCalls,before);
   assert.equal((await root.query('select status from meta_admin_private.shadow_once_runs where input_id=$1',[id])).rows[0].status,'blocked');
 });
 await scenario('RPC ACL, direct access denied, invalid transitions and replay',async()=>{
   const funcs=(await root.query("select oid::regprocedure::text sig,prosecdef from pg_proc where proname like 'meta_admin_shadow_%_v1'")).rows;
   assert.equal(funcs.length,4);
   for(const f of funcs){assert.equal(f.prosecdef,true);for(const role of ['anon','authenticated'])
     assert.equal((await root.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,f.sig])).rows[0].ok,false);}
   const c=await connection('service_role'),id=await fixture(),token=randomUUID();
   for(const query of ['select * from meta_admin_private.shadow_once_runs',"update meta_admin_private.shadow_once_runs set status='claimed'",'delete from meta_admin_private.shadow_once_runs'])
     await assert.rejects(c.query(query),e=>e.code==='42501');
   await first.claim({inputId:id,token,fingerprint:'a'.repeat(64),identityState:'unmatched',provider:'openai',model:env.OPENAI_ADMIN_AGENT_MODEL});
   for(const status of ['claimed','model_started','complete','invalidated','uncertain'])
     await assert.rejects(first.finish({inputId:id,token,status,reason:'test'}));
   assert.equal(await first.start({inputId:id,token}),true);
   assert.equal(await first.start({inputId:id,token}),false);
   await assert.rejects(first.finish({inputId:id,token,status:'complete',reason:'test'}));
   await first.finish({inputId:id,token,status:'uncertain',reason:'test'});
   await assert.rejects(first.finish({inputId:id,token,status:'uncertain',reason:'test'}));
   assert.equal(await first.start({inputId:id,token}),false);
 });
 await scenario('cleanup fixtures + journals = 0',async()=>{
   for(const table of ['meta_admin_private.shadow_once_runs','meta_admin_private.inbound_inputs','public.meta_observer_events','meta_admin_private.capture_config','public.meta_observer_admin_scope']){
    await root.query(`delete from ${table}`);assert.equal((await root.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
   }cleaned=true;
 });
 console.log(JSON.stringify({result:'PASS',local_only:true,scenarios:results,intercepted_model_calls:modelCalls,real_model_calls:0,send_calls:0,cleanup_residues:0},null,2));
}finally{for(const c of clients)await c.end().catch(()=>{});await server.stop().catch(()=>{});if(!cleaned)process.exitCode=1;}
