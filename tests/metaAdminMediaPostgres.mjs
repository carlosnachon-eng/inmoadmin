// Isolated LOCAL PostgreSQL only. Never accepts a DB URL or remote credential.
// META_CAPTURE_TEST_DEPS=/absolute/node_modules node tests/metaAdminCapturePostgres.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createMetaObserverHandler } from "../lib/messaging/metaObserver/receiver.js";
import { prepareMetaAdminShadow, resolveMetaAdminIdentity } from "../lib/messaging/metaAdminCapture/preflight.js";
import { syntheticEnv as observerEnv, inbound as observerInbound, change, payload as observerPayload } from "./fixtures/metaObserver.mjs";
import { normalizeIdentityPhone } from "../lib/shadow/identityBridge.js";

const inbound = (...args) => ({ ...observerInbound(...args), from: "522221234567" });
const scope={wabaId:'1297760461811288',phoneNumberId:'1198305790026665'};
const syntheticEnv={...observerEnv,META_ADMIN_WABA_ID:scope.wabaId,META_ADMIN_PHONE_NUMBER_ID:scope.phoneNumberId};
const payload=(...changes)=>{const b=observerPayload(...changes);b.entry[0].id=scope.wabaId;
  for(const c of b.entry[0].changes)c.value.metadata.phone_number_id=scope.phoneNumberId;return b;};
const phoneDigestOnly = process.argv.includes("--phone-digest-only");

assert.ok(path.isAbsolute(process.env.META_CAPTURE_TEST_DEPS || ""),"explicit local dependency directory required");
const require=createRequire(path.join(process.env.META_CAPTURE_TEST_DEPS,"capture-test.cjs"));
const EmbeddedPostgres=require("embedded-postgres").default; const {Client}=require("pg");
const directory=await mkdtemp(path.join(tmpdir(),"meta-admin-capture-pg-"));
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once("error",reject);
  s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const password=randomBytes(24).toString("hex");
const server=new EmbeddedPostgres({databaseDir:path.join(directory,"db"),port,user:"postgres",password,persistent:false,
  postgresFlags:["-h","127.0.0.1","-k",directory],onLog(){},onError(){}});
const clients=[], results=[], started=performance.now(), beforeFetch=globalThis.fetch;
globalThis.fetch=()=>assert.fail("external requests, models and messages forbidden");
let root,service,env,cleaned=false,lastError=null;
const migration=await readFile(new URL("../supabase/migrations/20261008203257_meta_admin_secure_capture.sql",import.meta.url),"utf8");
const hash=s=>createHash("sha256").update(s).digest("hex");
async function connection(role){const c=new Client({host:"127.0.0.1",port,user:"postgres",password,database:"postgres"});
  await c.connect();clients.push(c);if(role)await c.query(`set role ${role}`);return c;}
async function scenario(name,fn){const begin=performance.now();await fn();results.push({scenario:name,result:"PASS",ms:Math.round(performance.now()-begin)});}
function db(client=service,mutate=a=>a){return{async rpc(name,args){
  try {
    if(name==="capture_meta_admin_shadow_subject_v1") {const a=mutate(args);return{data:(await client.query(
      "select public.capture_meta_admin_shadow_subject_v1($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb) r",
      [a.p_waba_id,a.p_phone_number_id,a.p_body_sha256,JSON.stringify(a.p_events),a.p_not_before,JSON.stringify(a.p_inputs),JSON.stringify(a.p_subjects)])).rows[0].r};}
    if(name==="observe_meta_admin_events_v1")return{data:(await client.query("select public.observe_meta_admin_events_v1($1,$2,$3,$4::jsonb) r",
      [args.p_waba_id,args.p_phone_number_id,args.p_body_sha256,JSON.stringify(args.p_events)])).rows[0].r};
    assert.ok(["resolve_meta_admin_identity_v1","prepare_meta_admin_shadow_v1"].includes(name));
    return{data:(await client.query(`select public.${name}($1) r`,[args.p_input_id])).rows[0].r};
  }catch(e){lastError={code:e.code,message:e.message};return{error:{code:e.code}};}
}};}
function fresh(overrides={}) {return payload(change({messages:[{...inbound(`wamid.SYNTHETIC_${randomUUID().replaceAll("-","")}`),
  timestamp:String(Math.floor(Date.now()/1000)),text:{body:"Consulta sintética de mantenimiento; test@example.invalid"},...overrides}]}));}
async function receive(body=fresh(),{client=service,vars=env,mutate,signature}={}){
  const raw=Buffer.from(JSON.stringify(body));const logs=[];
  const req={method:"POST",headers:{"content-type":"application/json","x-hub-signature-256":signature||
    "sha256="+createHmac("sha256",syntheticEnv.META_OBSERVER_APP_SECRET).update(raw).digest("hex")},async *[Symbol.asyncIterator](){yield raw;}};
  const res={setHeader(){},status(n){this.statusCode=n;return this;},json(data){this.body=data;return this;}};
  await createMetaObserverHandler({getDb:()=>db(client,mutate),env:()=>vars,log:c=>logs.push(c)})(req,res);
  return{...res,logs};
}
async function one(body){return(await root.query("select i.* from meta_admin_private.inbound_inputs i where native_message_id=$1",[body.entry[0].changes[0].value.messages[0].id])).rows[0];}
const identity=id=>resolveMetaAdminIdentity({db:db(),inputId:id});
const preflight=(id,c=service)=>prepareMetaAdminShadow({db:db(c),inputId:id});
async function confirmed(digest){const id=randomUUID(),actor=randomUUID();
  await root.query("insert into public.profiles(id) values($1)",[actor]);
  await root.query("insert into public.client_identities(id,phone_digest) values($1,$2)",[id,digest]);
  await root.query("insert into public.client_source_links(client_identity_id,source_type,source_id,role_kind,link_status,match_method,confirmed_by,confirmed_at) values($1,'active_contract_tenant',$2,'tenant','confirmed','exact_full_phone_human_confirmed',$3,now())",[id,randomUUID(),actor]);
  return id;
}
async function sourceDefinitions(){return(await root.query(`select c.relname,c.relacl,c.relrowsecurity,
  (select jsonb_agg(pg_get_constraintdef(oid) order by oid) from pg_constraint where conrelid=c.oid) constraints,
  (select jsonb_agg(pg_get_triggerdef(oid) order by oid) from pg_trigger where tgrelid=c.oid and not tgisinternal) triggers
  from pg_class c where c.oid in ('public.meta_observer_events'::regclass,'public.meta_observer_admin_scope'::regclass,
  'public.client_identities'::regclass,'public.client_source_links'::regclass) order by c.relname`)).rows;}
async function cleanup(){
  for(const table of ["meta_admin_private.native_subject_evidence","meta_admin_private.subject_evidence_epoch","meta_admin_private.shadow_preflights","meta_admin_private.inbound_inputs","meta_admin_private.capture_config",
    "public.meta_observer_events","public.meta_observer_admin_scope","public.client_source_links","public.client_identities","public.profiles"])
    {await root.query(`delete from ${table}`);assert.equal((await root.query(`select count(*)::int n from ${table}`)).rows[0].n,0);}
  cleaned=true;
}
try{
  await server.initialise();await server.start();root=await connection();
  await root.query(`create role anon;create role authenticated;create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges grant all on tables to anon,authenticated,service_role;
    alter default privileges grant execute on functions to anon,authenticated,service_role;
    create schema auth;create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key);`);
  const canonical=await readFile(new URL("../supabase/migrations/202608260002_fase_3a_canonical_client_model.sql",import.meta.url),"utf8");
  await root.query(canonical.slice(canonical.indexOf("create table public.client_identities"),canonical.indexOf("create table public.client_identity_roles")));
  await root.query(canonical.slice(canonical.indexOf("create table public.client_source_links"),canonical.indexOf("create table public.client_reconciliation_candidates")));
  await root.query(await readFile(new URL("../supabase/migrations/20261008162624_meta_admin_observer.sql",import.meta.url),"utf8"));
  const defaults=(await root.query("select * from pg_default_acl order by oid")).rows;
  const definitions=await sourceDefinitions();
  await root.query(migration);service=await connection("service_role");
  await root.query(await readFile(new URL('../supabase/migrations/20261008224646_meta_admin_echo_subject_evidence.sql',import.meta.url),'utf8'));

  await root.query("alter table public.profiles add column role text,add column telefono text");
  await root.query(canonical.slice(canonical.indexOf("create table public.client_identity_roles"),canonical.indexOf("create table public.client_source_links")));
  await root.query("create function public.identity_phone_digest(text) returns text language sql immutable as $$select null::text$$");
  for(const file of ['scripts/sql/meta-admin-shadow-once-journal.sql','scripts/sql/meta-admin-shadow-once-runtime.sql','supabase/migrations/20261009130447_meta_admin_conversation_memory.sql','supabase/migrations/20261009131426_meta_admin_memory_provenance.sql'])
    await root.query(await readFile(new URL('../'+file,import.meta.url),'utf8'));
  const mediaMigration=await readFile(new URL('../supabase/migrations/20261009135000_meta_admin_media_capture.sql',import.meta.url),'utf8');
  await root.query(mediaMigration);
  const cutoff=new Date(Date.now()-2000).toISOString();
  env={...syntheticEnv,META_ADMIN_SHADOW_CAPTURE_ENABLED:'true',META_ADMIN_SHADOW_CAPTURE_NOT_BEFORE:cutoff,META_ADMIN_CAPTURE_ENCRYPTION_KEY:'a1'.repeat(32),META_ADMIN_CAPTURE_HMAC_KEY:'b2'.repeat(32)};
  await root.query("insert into public.meta_observer_admin_scope(waba_id,phone_number_id,enabled) values($1,$2,true)",[scope.wabaId,scope.phoneNumberId]);
  await root.query("insert into meta_admin_private.capture_config(waba_id,phone_number_id,enabled,installed_at,not_before) values($1,$2,true,$3::timestamptz-interval '1 second',$3)",[scope.wabaId,scope.phoneNumberId,cutoff]);
  // Move only the disposable fixture epoch backward to avoid sub-second rounding.
  await root.query("update meta_admin_private.media_capture_epoch set installed_at=clock_timestamp()-interval '1 second'");
  await root.query("update meta_admin_private.subject_evidence_epoch set not_before=clock_timestamp()-interval '1 second'");
  let input;
  await scenario('future media durable encrypted; duplicate unchanged',async()=>{
    const body=fresh({type:'image',text:undefined,image:{id:'900000000000003'}});
    assert.equal((await receive(body)).statusCode,200);input=await one(body);
    assert.equal(input.capture_reason,'media_captured');assert.ok(input.media_ciphertext);
    assert.equal(JSON.stringify(input).includes('900000000000003'),false);
    assert.equal((await receive(body)).statusCode,200);assert.deepEqual(await one(body),input);
  });
  await scenario('snapshot marks recoverable reference; history placeholder',async()=>{
    const canonicalId=await confirmed(input.exact_phone_digest);
    await root.query("insert into public.client_identity_roles(client_identity_id,role_kind) values($1,'tenant')",[canonicalId]);
    const s=(await service.query('select public.meta_admin_shadow_snapshot_v1($1) x',[input.id])).rows[0].x;
    assert.equal(s.input.media_reference_present,true);
    const h=(await service.query('select public.meta_admin_memory_history_v1($1) x',[input.id])).rows[0].x;
    assert.ok(JSON.stringify(h).includes('[IMAGEN]'));
  });
  await scenario('ACL RLS and defaults',async()=>{
    assert.deepEqual((await root.query('select * from pg_default_acl order by oid')).rows,defaults);
    for(const role of ['anon','authenticated','service_role']){
      assert.equal((await root.query("select has_table_privilege($1,'meta_admin_private.media_shadow_attempts','SELECT') x",[role])).rows[0].x,false);
      assert.equal((await root.query("select has_function_privilege($1,'public.meta_admin_shadow_media_claim_v1(uuid,uuid)','EXECUTE') x",[role])).rows[0].x,role==='service_role');
    }
  });
  await scenario('claim needs started token; concurrent media claim only one; replay denied',async()=>{
    const token=randomUUID();
    await assert.rejects(service.query('select public.meta_admin_shadow_media_claim_v1($1,$2)',[input.id,token]));
    await root.query("insert into meta_admin_private.shadow_once_runs(input_id,claim_token,input_fingerprint,identity_state,provider,model,status,model_calls,model_started_at) values($1,$2,repeat('a',64),'unmatched','openai','gpt-4.1-mini','model_started',1,clock_timestamp())",[input.id,token]);
    const second=await connection('service_role');
    const results=await Promise.allSettled([service,second].map(c=>c.query('select public.meta_admin_shadow_media_claim_v1($1,$2)',[input.id,token])));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    await assert.rejects(service.query('select public.meta_admin_shadow_media_claim_v1($1,$2)',[input.id,token]),/consumed/);
    await assert.rejects(root.query('delete from meta_admin_private.media_shadow_attempts'),/append_only/);
  });
  await scenario('historical no backfill even if provider retries',async()=>{
    await root.query("update meta_admin_private.media_capture_epoch set installed_at=clock_timestamp()+interval '1 minute'");
    const body=fresh({type:'image',text:undefined,image:{id:'900000000000004'}});
    assert.equal((await receive(body)).statusCode,200);const row=await one(body);
    assert.equal(row.capture_reason,'unsupported_message_type');assert.equal(row.media_ciphertext,null);
  });
  console.log(JSON.stringify({status:'PASS',sha256:hash(mediaMigration),results,models:0,sends:0,remoteWrites:0}));
}finally{
  // Entire disposable database removed by embedded-postgres; never a remote cleanup.
  await Promise.all(clients.map(c=>c.end().catch(()=>{})));await server.stop();globalThis.fetch=beforeFetch;
}
