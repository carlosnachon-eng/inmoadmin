// Isolated LOCAL PostgreSQL only. Never accepts a DB URL or remote credential.
// META_CAPTURE_TEST_DEPS=/absolute/node_modules node tests/metaAdminCapturePostgres.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createMetaObserverHandler } from "../lib/messaging/metaObserver/receiver.js";
import { prepareMetaAdminShadow, resolveMetaAdminIdentity } from "../lib/messaging/metaAdminCapture/preflight.js";
import { scope, syntheticEnv, inbound, change, payload } from "./fixtures/metaObserver.mjs";

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
    if(name==="capture_meta_admin_shadow_v1") {const a=mutate(args);return{data:(await client.query(
      "select public.capture_meta_admin_shadow_v1($1,$2,$3,$4::jsonb,$5,$6::jsonb) r",
      [a.p_waba_id,a.p_phone_number_id,a.p_body_sha256,JSON.stringify(a.p_events),a.p_not_before,JSON.stringify(a.p_inputs)])).rows[0].r};}
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
  for(const table of ["meta_admin_private.shadow_preflights","meta_admin_private.inbound_inputs","meta_admin_private.capture_config",
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
  const cutoff=new Date(Date.now()-1000).toISOString();
  env={...syntheticEnv,META_ADMIN_SHADOW_CAPTURE_ENABLED:"true",META_ADMIN_SHADOW_CAPTURE_NOT_BEFORE:cutoff,
    META_ADMIN_CAPTURE_ENCRYPTION_KEY:"a1".repeat(32),META_ADMIN_CAPTURE_HMAC_KEY:"b2".repeat(32)};
  await root.query("insert into public.meta_observer_admin_scope(waba_id,phone_number_id,enabled) values($1,$2,true)",[scope.wabaId,scope.phoneNumberId]);
  await scenario("empty capture config fails closed; no observation or input committed",async()=>{
    assert.equal((await receive()).statusCode,503);assert.equal((await root.query("select count(*)::int n from public.meta_observer_events")).rows[0].n,0);
  });
  const prior=fresh();
  await scenario("OFF preserves original observer; no restricted capture",async()=>{
    assert.equal((await receive(prior,{vars:syntheticEnv})).statusCode,200);assert.equal(await one(prior),undefined);
  });
  await root.query("insert into meta_admin_private.capture_config(waba_id,phone_number_id,enabled,installed_at,not_before) values($1,$2,true,$3::timestamptz-interval '1 second',$3)",[scope.wabaId,scope.phoneNumberId,cutoff]);
  await scenario("effective RLS/ACL under global production-like inherited grants",async()=>{
    for(const table of ["capture_config","inbound_inputs","shadow_preflights"]){
      for(const role of ["anon","authenticated","service_role"])for(const privilege of ["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER","MAINTAIN"]){
        const expected=role==="service_role"&&(privilege==="SELECT"||(privilege==="INSERT"&&table!=="capture_config"));
        assert.equal((await root.query("select has_table_privilege($1,$2,$3) ok",[role,`meta_admin_private.${table}`,privilege])).rows[0].ok,expected,`${role}/${table}/${privilege}`);
      }
    }
    const names=["capture_meta_admin_shadow_v1","resolve_meta_admin_identity_v1","prepare_meta_admin_shadow_v1","guard_input_v1"];
    assert.equal((await root.query("select count(*)::int n from pg_proc p,lateral aclexplode(p.proacl) a where p.proname=any($1) and a.grantee=0",[names])).rows[0].n,0);
    assert.equal((await root.query("select count(*)::int n from pg_proc where proname=any($1) and prosecdef",[names])).rows[0].n,0);
    assert.equal((await root.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='meta_admin_private' and c.relkind='r' and c.relrowsecurity")).rows[0].n,3);
    for(const role of ["anon","authenticated"]){const c=await connection(role);
      await assert.rejects(c.query("select * from meta_admin_private.inbound_inputs"),e=>e.code==="42501");
      for(const fn of ["resolve_meta_admin_identity_v1","prepare_meta_admin_shadow_v1"])
        await assert.rejects(c.query(`select public.${fn}($1)`,[randomUUID()]),e=>e.code==="42501");
      await assert.rejects(c.query("select public.capture_meta_admin_shadow_v1('x','x','x','[]',now(),'[]')"),e=>e.code==="42501");
    }
    assert.deepEqual((await root.query("select * from pg_default_acl order by oid")).rows,defaults);
  });
  await scenario("retry cannot hydrate pre-existing observer receipt / no backfill",async()=>{
    assert.equal((await receive(prior)).statusCode,200);assert.equal(await one(prior),undefined);
  });
  const freshBody=fresh();let first;
  await scenario("real RPC commits minimal sanitized input and original observer atomically",async()=>{
    assert.equal((await receive(freshBody)).statusCode,200,JSON.stringify(lastError));first=await one(freshBody);
    assert.ok(first?.meta_observer_event_id);assert.match(first.sanitized_text,/\[EMAIL\]/);
    assert.equal(JSON.stringify(first).includes("test@example.invalid"),false);
    assert.equal(JSON.stringify(first).includes(inbound().from),false);
    assert.equal(first.capture_reason,"captured");
  });
  await scenario("lost ACK duplicate preserves original encrypted content and ID",async()=>{
    assert.equal((await receive(freshBody)).statusCode,200);assert.deepEqual(await one(freshBody),first);
  });
  await scenario("direct INSERT cannot hydrate an earlier observer receipt",async()=>{
    const observer=(await root.query("select * from public.meta_observer_events where native_message_id=$1",[prior.entry[0].changes[0].value.messages[0].id])).rows[0];
    await assert.rejects(service.query(`insert into meta_admin_private.inbound_inputs(meta_observer_event_id,waba_id,phone_number_id,
      native_message_id,occurred_at,message_type,sender_ref,sender_ciphertext,exact_phone_digest,sender_evidence,sanitized_text,capture_reason)
      values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)`,[observer.id,observer.waba_id,observer.phone_number_id,observer.native_message_id,
      observer.occurred_at,observer.message_type,first.sender_ref,JSON.stringify(first.sender_ciphertext),first.exact_phone_digest,
      first.sender_evidence,first.sanitized_text,first.capture_reason]),e=>e.code==="23514");
    assert.equal(await one(prior),undefined);
  });
  await scenario("six concurrent deliveries capture exactly one input",async()=>{
    const b=fresh();const cs=await Promise.all(Array.from({length:6},()=>connection("service_role")));
    const responses=await Promise.all(cs.map(client=>receive(b,{client})));assert.ok(responses.every(r=>r.statusCode===200),JSON.stringify(lastError));
    assert.equal((await root.query("select count(*)::int n from meta_admin_private.inbound_inputs where native_message_id=$1",[b.entry[0].changes[0].value.messages[0].id])).rows[0].n,1);
  });
  await scenario("concurrent old OFF receiver wins: never hydrate its observation",async()=>{
    const b=fresh(),old=await connection("service_role"),next=await connection("service_role");
    const pid=(await next.query("select pg_backend_pid() pid")).rows[0].pid;
    await old.query("begin");
    try {
      assert.equal((await receive(b,{client:old,vars:syntheticEnv})).statusCode,200);
      const pending=receive(b,{client:next});
      let blocked=false;
      for(let n=0;n<100;n++) {
        blocked=(await root.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[pid])).rows[0]?.blocked;
        if(blocked)break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      await old.query("commit");assert.equal((await pending).statusCode,200);
      assert.equal(blocked,true,"exercised insert conflict after snapshot read");assert.equal(await one(b),undefined);
    } finally {await old.query("rollback");}
  });
  await scenario("provider timestamp before cutover is observed but never captured",async()=>{
    const b=fresh({timestamp:"1000000000"});assert.equal((await receive(b)).statusCode,200);assert.equal(await one(b),undefined);
  });
  await scenario("bad HMAC leaves both stores untouched",async()=>{
    const b=fresh();assert.equal((await receive(b,{signature:"sha256="+"0".repeat(64)})).statusCode,401);assert.equal(await one(b),undefined);
  });
  await scenario("input constraint failure rolls back observer too; no false 200",async()=>{
    const b=fresh();assert.equal((await receive(b,{mutate:a=>({...a,p_inputs:a.p_inputs.map(i=>({...i,sender_ciphertext:{}}))})})).statusCode,503);
    assert.equal((await root.query("select count(*)::int n from public.meta_observer_events where native_message_id=$1",[b.entry[0].changes[0].value.messages[0].id])).rows[0].n,0);
  });
  await scenario("cutover mismatch or disabled DB config fails closed",async()=>{
    assert.equal((await receive(fresh(),{vars:{...env,META_ADMIN_SHADOW_CAPTURE_NOT_BEFORE:"2026-01-01T00:00:00.000Z"}})).statusCode,503);
    await root.query("update meta_admin_private.capture_config set enabled=false");assert.equal((await receive()).statusCode,503);
    await root.query("update meta_admin_private.capture_config set enabled=true");
  });
  const initialIdentities=(await root.query("select * from public.client_identities")).rows;
  await scenario("exact bridge unmatched is read-only; preflight never calls model",async()=>{
    assert.equal((await identity(first.id)).state,"unmatched");const a=await preflight(first.id);
    assert.equal(a.reason,"identity_unmatched");assert.equal(a.run_id,null);assert.equal(a.model_calls,0);assert.equal(a.send_calls,0);
    assert.deepEqual((await root.query("select * from public.client_identities")).rows,initialIdentities);
  });
  const canonicalId=await confirmed(first.exact_phone_digest);
  await scenario("unique exact active confirmed canonical identity => matched, no link write",async()=>{
    const before=(await root.query("select * from public.client_source_links")).rows;
    const a=await identity(first.id);assert.equal(a.state,"matched");assert.equal(a.client_identity_id,canonicalId);assert.equal(a.authorizes_business,false);
    assert.deepEqual((await root.query("select * from public.client_source_links")).rows,before);
  });
  await scenario("matched still blocks before model: native human attention unverified",async()=>{
    const b=fresh();assert.equal((await receive(b)).statusCode,200);const i=await one(b);
    const cs=await Promise.all(Array.from({length:4},()=>connection("service_role")));
    const attempts=await Promise.all(cs.map(c=>preflight(i.id,c)));
    assert.equal(new Set(attempts.map(a=>a.id)).size,1);
    for(const a of attempts){assert.equal(a.reason,"meta_human_attention_unverified");assert.equal(a.identity_state,"matched");
      assert.equal(a.run_id,null);assert.equal(a.proposed_response,null);assert.equal(a.model_calls,0);assert.equal(a.send_calls,0);}
    assert.equal(attempts.filter(a=>!a.reused).length,1);
  });
  await scenario("duplicate exact canonical identities => ambiguous, not first-match",async()=>{
    const other=await confirmed(first.exact_phone_digest);assert.equal((await identity(first.id)).state,"ambiguous");
    await root.query("delete from public.client_source_links where client_identity_id=$1",[other]);await root.query("delete from public.client_identities where id=$1",[other]);
  });
  await scenario("revoked identity and unconfirmed source cannot match",async()=>{
    await root.query("update public.client_identities set status='revoked',revoked_at=now() where id=$1",[canonicalId]);
    assert.equal((await identity(first.id)).state,"unmatched");await root.query("update public.client_identities set status='active',revoked_at=null where id=$1",[canonicalId]);
    await root.query("update public.client_source_links set link_status='revoked',revoked_at=now() where client_identity_id=$1",[canonicalId]);
    assert.equal((await identity(first.id)).state,"unmatched");await root.query("update public.client_source_links set link_status='confirmed',revoked_at=null where client_identity_id=$1",[canonicalId]);
  });
  await scenario("exact address only: suffix, added prefix and similar phone stay unmatched",async()=>{
    const b=fresh({from:"15555550102"});assert.equal((await receive(b)).statusCode,200);assert.equal((await identity((await one(b)).id)).state,"unmatched");
  });
  await scenario("edit and revoke never rewrite input or permit a model",async()=>{
    for(const type of ["edit","revoke"]){
      const b=fresh();assert.equal((await receive(b)).statusCode,200);const i=await one(b);
      const event=fresh({type,[type]:{original_message_id:i.native_message_id}});
      assert.equal((await receive(event)).statusCode,200);assert.equal(await one(event),undefined);
      const p=await preflight(i.id);assert.equal(p.reason,"event_mutated");assert.equal(p.model_calls,0);
      assert.deepEqual(await one(b),i);
    }
  });
  await scenario("service cannot activate config, mutate input or invent completed run",async()=>{
    for(const sql of ["update meta_admin_private.capture_config set enabled=true","delete from meta_admin_private.inbound_inputs","truncate meta_admin_private.inbound_inputs",
      "update meta_admin_private.shadow_preflights set status='blocked'"])await assert.rejects(service.query(sql),e=>e.code==="42501");
    const b=fresh();await receive(b);const i=await one(b);
    await assert.rejects(service.query("insert into meta_admin_private.shadow_preflights(input_id,identity_state,reason,run_id) values($1,'matched','meta_human_attention_unverified','invented')",[i.id]),e=>e.code==="23514");
  });
  await scenario("source definitions and defaults unchanged; no hidden callers",async()=>{
    assert.deepEqual(await sourceDefinitions(),definitions);assert.deepEqual((await root.query("select * from pg_default_acl order by oid")).rows,defaults);
    const sources=(await root.query("select prosrc from pg_proc where proname in ('capture_meta_admin_shadow_v1','resolve_meta_admin_identity_v1','prepare_meta_admin_shadow_v1')")).rows.map(r=>r.prosrc).join("\n");
    assert.equal(/respond_identity|gv_respond|assess_messaging|http_post|net\./i.test(sources),false);
  });
  await scenario("cleanup all local fixtures = 0",cleanup);
  console.log(JSON.stringify({verdict:"PASS_LOCAL_CAPTURE_AND_FAIL_CLOSED",postgres_version:(await root.query("show server_version")).rows[0].server_version,
    migration_sha256:hash(migration),results,elapsed_ms:Math.round(performance.now()-started),cleanup_rows:0,
    models:0,sends:0,hosted_connections:0,production_connections:0,agent_execution:"BLOCKED_NATIVE_ATTENTION_UNVERIFIED"},null,2));
}finally{if(root&&!cleaned)await cleanup().catch(()=>{});await Promise.all(clients.map(c=>c.end().catch(()=>{})));await server.stop();globalThis.fetch=beforeFetch;}
