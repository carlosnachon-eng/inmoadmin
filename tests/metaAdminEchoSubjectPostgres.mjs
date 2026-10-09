// LOCAL disposable PostgreSQL only; signed synthetic fixtures, no external IO.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { createMetaObserverHandler } from '../lib/messaging/metaObserver/receiver.js';
import { createShadowOncePostgresStore } from '../lib/messaging/metaAdminCapture/shadowOncePostgres.js';
import { shadowOnceGate, runMetaAdminShadowOnce } from '../lib/messaging/metaAdminCapture/shadowOnce.js';

assert.ok(path.isAbsolute(process.env.META_CAPTURE_TEST_DEPS||''));
const require=createRequire(path.join(process.env.META_CAPTURE_TEST_DEPS,'echo-test.cjs'));
const EmbeddedPostgres=require('embedded-postgres').default,{Client}=require('pg');
const directory=await mkdtemp(path.join(tmpdir(),'meta-echo-subject-pg-'));
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const password=randomBytes(24).toString('hex');
const server=new EmbeddedPostgres({databaseDir:path.join(directory,'db'),port,user:'postgres',password,persistent:false,
 postgresFlags:['-h','127.0.0.1','-k',directory],onLog(){},onError(){}});
const clients=[],results=[];let root,service,other,env,cleaned=false,intercepted=0;
globalThis.fetch=()=>assert.fail('external network/model/transport forbidden');
const scope=['1297760461811288','1198305790026665'];
async function conn(role){const c=new Client({host:'127.0.0.1',port,user:'postgres',password,database:'postgres'});await c.connect();clients.push(c);if(role)await c.query(`set role ${role}`);return c;}
async function scenario(name,fn){const t=performance.now();await fn();results.push({name,result:'PASS',ms:Math.round(performance.now()-t)});}
const migration=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const body=(items,field='messages')=>({object:'whatsapp_business_account',entry:[{id:scope[0],changes:[{field,
 value:{messaging_product:'whatsapp',metadata:{phone_number_id:scope[1]},[field==='messages'?'messages':'message_echoes']:items}}]}]});
// One second ahead avoids rounding a native seconds timestamp below the epoch.
const message=(extra={})=>({id:'wamid.SYNTHETIC_'+randomUUID().replaceAll('-',''),from:'522221234567',
 timestamp:String(Math.ceil(Date.now()/1000)),type:'text',text:{body:'Consulta sintética.'},...extra});
const echo=extra=>message({from:'522220000000',to:'522221234568',...extra});
async function receive(b,{client=service,mutate=a=>a,vars=env}={}){
 const raw=Buffer.from(JSON.stringify(b));let argsSeen,errorCode;
 const req={method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256',env.META_OBSERVER_APP_SECRET).update(raw).digest('hex')},async *[Symbol.asyncIterator](){yield raw;}};
 const res={setHeader(){},status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;}};
 await createMetaObserverHandler({env:()=>vars,log(){},getDb:()=>({async rpc(name,args){
  const a=mutate(args);argsSeen=a;
  try {
   const params=[a.p_waba_id,a.p_phone_number_id,a.p_body_sha256,JSON.stringify(a.p_events)];
   let sql='select public.observe_meta_admin_events_v1($1,$2,$3,$4::jsonb) r';
   if(name==='capture_meta_admin_shadow_subject_v1'){
    params.push(a.p_not_before,JSON.stringify(a.p_inputs),JSON.stringify(a.p_subjects));
    sql='select public.capture_meta_admin_shadow_subject_v1($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb) r';
   }else assert.equal(name,'observe_meta_admin_events_v1');
   return {data:(await client.query(sql,params)).rows[0].r};
  }catch(e){errorCode=e.code+':'+e.message;return {error:{code:e.code}};}
 }})})(req,res);
 return {...res,argsSeen,errorCode};
}
const count=async table=>(await root.query(`select count(*)::int n from ${table}`)).rows[0].n;
async function input(m=message()){
 const r=await receive(body([m]));assert.equal(r.statusCode,200,r.errorCode);
 return (await root.query('select * from meta_admin_private.inbound_inputs where native_message_id=$1',[m.id])).rows[0];
}
// Synthetic health evidence ONLY for the disposable local SQL harness.
const health=async()=>({status:'healthy',checked_at:new Date().toISOString(),
 waba_id:'1297760461811288',phone_number_id:'1198305790026665',receiver_ready:true,subscription_active:true,
 coverage_complete:true,known_pending:0,in_flight:0,unresolved_failures:0,
 covered_from:'2020-01-01T00:00:00.000Z',covered_through:new Date().toISOString(),evidence_refs:['synthetic-local-only']});
const defs=async()=>(await root.query(`select c.oid,c.relacl,c.relrowsecurity,
 (select jsonb_agg(pg_get_triggerdef(t.oid) order by t.oid) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal) triggers
 from pg_class c where c.oid in ('public.meta_observer_events'::regclass,'meta_admin_private.inbound_inputs'::regclass) order by c.oid`)).rows;
try{
 await server.initialise();await server.start();root=await conn();
 await root.query(`create role anon;create role authenticated;create role service_role bypassrls;
 grant usage on schema public to service_role;
 alter default privileges grant all on tables to anon,authenticated,service_role;
 alter default privileges grant execute on functions to anon,authenticated,service_role;
 create table public.client_identities(id uuid primary key,phone_digest text,status text,revoked_at timestamptz);
 create table public.client_source_links(client_identity_id uuid,link_status text,confirmed_by uuid,confirmed_at timestamptz,revoked_at timestamptz);`);
 await root.query(await migration('20261008162624_meta_admin_observer.sql'));
 await root.query(await migration('20261008203257_meta_admin_secure_capture.sql'));
 const defaults=(await root.query('select * from pg_default_acl order by oid')).rows,sourceDefs=await defs();
 await root.query(await migration('20261008224646_meta_admin_echo_subject_evidence.sql'));
 await root.query(await readFile(new URL('../scripts/sql/meta-admin-shadow-once-journal.sql',import.meta.url),'utf8'));
 const cutoff=new Date(Date.now()-1000).toISOString();
 env={META_ADMIN_OBSERVER_ENABLED:'true',META_ADMIN_WABA_ID:scope[0],META_ADMIN_PHONE_NUMBER_ID:scope[1],
 META_OBSERVER_APP_SECRET:'synthetic-secret-local-only-00000000',META_OBSERVER_VERIFY_TOKEN:'synthetic-token-local-only-00000000',
 META_ADMIN_SHADOW_CAPTURE_ENABLED:'true',META_ADMIN_SHADOW_CAPTURE_NOT_BEFORE:cutoff,
 META_ADMIN_CAPTURE_ENCRYPTION_KEY:'a1'.repeat(32),META_ADMIN_CAPTURE_HMAC_KEY:'b2'.repeat(32),OPENAI_ADMIN_AGENT_MODEL:'gpt-6-luna'};
 await root.query("insert into public.meta_observer_admin_scope(waba_id,phone_number_id,enabled) values($1,$2,true)",scope);
 await root.query("insert into meta_admin_private.capture_config(waba_id,phone_number_id,enabled,installed_at,not_before) values($1,$2,true,$3::timestamptz-interval '1 second',$3)",[...scope,cutoff]);
 service=await conn('service_role');other=await conn('service_role');
 const store=createShadowOncePostgresStore(service,{readTransportHealth:health});
 await scenario('restrictive ACL/RLS; defaults and source journals definitions unchanged',async()=>{
  assert.deepEqual(await defs(),sourceDefs);assert.deepEqual((await root.query('select * from pg_default_acl order by oid')).rows,defaults);
  for(const table of ['native_subject_evidence','subject_evidence_epoch']){
   assert.equal((await root.query('select relrowsecurity from pg_class where oid=$1::regclass',['meta_admin_private.'+table])).rows[0].relrowsecurity,true);
   for(const role of ['anon','authenticated'])for(const p of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])
    assert.equal((await root.query('select has_table_privilege($1,$2,$3) ok',[role,'meta_admin_private.'+table,p])).rows[0].ok,false);
   for(const p of ['UPDATE','DELETE','TRUNCATE'])assert.equal((await root.query('select has_table_privilege($1,$2,$3) ok',['service_role','meta_admin_private.'+table,p])).rows[0].ok,false);
  }
  for(const role of ['anon','authenticated'])assert.equal((await root.query("select has_function_privilege($1,'public.capture_meta_admin_shadow_subject_v1(text,text,text,jsonb,timestamptz,jsonb,jsonb)','EXECUTE') ok",[role])).rows[0].ok,false);
 });
 let candidate;
 await scenario('future inbound + echo atomic evidence, no clear address; SQL gate other_subject allows',async()=>{
  candidate=await input();assert.ok(candidate);
  assert.equal((await receive(body([echo()], 'smb_message_echoes'))).statusCode,200);
  const rows=(await root.query('select * from meta_admin_private.native_subject_evidence')).rows;
  assert.equal(rows.length,2);for(const p of ['522221234567','522221234568','522220000000'])assert.equal(JSON.stringify(rows).includes(p),false);
  const snap=await store.snapshot(candidate.id);assert.equal(snap.echo_assessments[0].state,'other_subject');assert.equal(shadowOnceGate(snap).allowed,true);
 });
 await scenario('concurrent duplicate deliveries produce one observer + evidence',async()=>{
  const m=echo(),b=body([m],'smb_message_echoes'),before=await count('meta_admin_private.native_subject_evidence');
  const r=await Promise.all([receive(b),receive(b,{client:other})]);assert.deepEqual(r.map(x=>x.statusCode),[200,200]);
  assert.equal(await count('meta_admin_private.native_subject_evidence'),before+1);
  assert.equal((await root.query('select count(*)::int n from public.meta_observer_events where native_message_id=$1',[m.id])).rows[0].n,1);
  assert.equal((await receive(body([{...m,to:'522221234569'}],'smb_message_echoes'))).statusCode,503);
 });
 await scenario('missing evidence or corrupt evidence rolls observer back; no false 200',async()=>{
  for(const mutate of [a=>({...a,p_subjects:[]}),a=>({...a,p_subjects:a.p_subjects.map(s=>({...s,key_tag:'bad'}))})]){
   const before=await count('public.meta_observer_events'),inputs=await count('meta_admin_private.inbound_inputs');
   assert.equal((await receive(body([message()]),{mutate})).statusCode,503);
   assert.equal(await count('public.meta_observer_events'),before);
   assert.equal(await count('meta_admin_private.inbound_inputs'),inputs);
  }
 });
 await scenario('same recipient after claim invalidates intercepted proposal; no sender',async()=>{
  const result=await runMetaAdminShadowOnce({inputId:candidate.id,authorizedInputId:candidate.id,store,env,propose:async()=>{
   intercepted++;assert.equal((await receive(body([echo({to:'522221234567'})],'smb_message_echoes'))).statusCode,200);
   return {provider:'openai',model:env.OPENAI_ADMIN_AGENT_MODEL,run_id:'resp_synthetic',proposed_response:'Propuesta sintética interceptada.'};
  }});
  assert.equal(result.status,'invalidated');assert.equal(result.send_calls,0);
 });
 await scenario('exact context vs recipient conflict; mutations resolve original',async()=>{
  const base=echo({to:'522221234567'});await receive(body([base],'smb_message_echoes'));
  const edit=echo({type:'edit',to:undefined,edit:{original_message_id:base.id}});
  const conflicting=echo({context:{id:candidate.native_message_id}});
  assert.equal((await receive(body([edit,conflicting],'smb_message_echoes'))).statusCode,200);
  const snap=await store.snapshot(candidate.id),states=snap.echo_assessments.map(x=>x.state);
  assert.ok(states.includes('conflict'));assert.ok(states.includes('same_subject'));assert.equal(shadowOnceGate(snap).allowed,false);
 });
 await scenario('status is observed without subject evidence or another input',async()=>{
  const b=body([]),value=b.entry[0].changes[0].value;
  delete value.messages;value.statuses=[{id:'wamid.SYNTHETIC_STATUS',status:'read',timestamp:String(Math.ceil(Date.now()/1000)),recipient_id:'522221234567'}];
  const before=await count('meta_admin_private.native_subject_evidence');assert.equal((await receive(b)).statusCode,200);
  assert.equal(await count('meta_admin_private.native_subject_evidence'),before);
 });
 await scenario('unknown historical echo cannot be hydrated on retry',async()=>{
  const m=echo(),b=body([m],'smb_message_echoes');assert.equal((await receive(b,{vars:{...env,META_ADMIN_SHADOW_CAPTURE_ENABLED:'false'}})).statusCode,200);
  const before=await count('meta_admin_private.native_subject_evidence');assert.equal((await receive(b)).statusCode,200);
  assert.equal(await count('meta_admin_private.native_subject_evidence'),before);
  const snap=await store.snapshot(candidate.id);assert.ok(snap.echo_assessments.some(x=>x.state==='unknown'));
 });
 await scenario('old occurred_at newly delivered not backfilled',async()=>{
  const before=await count('meta_admin_private.native_subject_evidence');
  assert.equal((await receive(body([echo({timestamp:'1700000000'})],'smb_message_echoes'))).statusCode,200);
  assert.equal(await count('meta_admin_private.native_subject_evidence'),before);
 });
 await scenario('direct historical sidecar INSERT denied by trigger',async()=>{
  const id=(await root.query("select id from public.meta_observer_events where category='app_echo' limit 1")).rows[0].id;
  await assert.rejects(service.query("insert into meta_admin_private.native_subject_evidence(meta_observer_event_id,key_tag,evidence_state,evidence_source) values($1,$2,'unknown','no_recipient')",[id,'a'.repeat(64)]),e=>e.code==='23514');
 });
 await scenario('cleanup all synthetic records = 0',async()=>{
  for(const table of ['meta_admin_private.shadow_once_runs','meta_admin_private.native_subject_evidence','meta_admin_private.shadow_preflights',
   'meta_admin_private.inbound_inputs','meta_admin_private.capture_config','meta_admin_private.subject_evidence_epoch',
   'public.meta_observer_events','public.meta_observer_admin_scope','public.client_source_links','public.client_identities']){
    await root.query(`delete from ${table}`);assert.equal(await count(table),0);
  }cleaned=true;
 });
 console.log(JSON.stringify({result:'PASS',local_only:true,scenarios:results,intercepted_model_calls:intercepted,real_model_calls:0,send_calls:0,cleanup_residues:0},null,2));
}finally{for(const c of clients)await c.end().catch(()=>{});await server.stop().catch(()=>{});if(!cleaned)process.exitCode=1;}
