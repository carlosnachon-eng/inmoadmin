// Explicit LOCAL PostgreSQL certification. Never accepts a DB URL, hosted
// credentials, or project ref. Dependencies stay outside application packages.
// META_OBSERVER_TEST_DEPS=/absolute/node_modules node tests/metaObserverPostgres.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createMetaObserverHandler } from "../lib/messaging/metaObserver/receiver.js";
import { fixtures, scope, syntheticEnv, payload, change, inbound } from "./fixtures/metaObserver.mjs";

assert.ok(path.isAbsolute(process.env.META_OBSERVER_TEST_DEPS || ""), "explicit local dependency directory required");
const require = createRequire(path.join(process.env.META_OBSERVER_TEST_DEPS,"local-test.cjs"));
const EmbeddedPostgres = require("embedded-postgres").default;
const { Client } = require("pg");
const directory = await mkdtemp(path.join(tmpdir(),"meta-observer-pg-"));
const port = await new Promise((resolve,reject)=>{
  const server=net.createServer();server.once("error",reject);
  server.listen(0,"127.0.0.1",()=>{const p=server.address().port;server.close(()=>resolve(p));});
});
const password = randomBytes(24).toString("hex");
const server = new EmbeddedPostgres({databaseDir:path.join(directory,"db"),port,user:"postgres",password,
  persistent:false,postgresFlags:["-h","127.0.0.1","-k",directory],onLog(){},onError(){}});
const clients=[];const results=[];const started=performance.now();
let lastDatabaseError = null;
const fetchBefore=globalThis.fetch;
globalThis.fetch=()=>assert.fail("external traffic forbidden");
let root, cleaned=false;
async function connection(role){
  const client=new Client({host:"127.0.0.1",port,user:"postgres",password,database:"postgres"});
  await client.connect();clients.push(client);if(role)await client.query(`set role ${role}`);return client;
}
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},
  json(b){this.body=b;return this;},send(b){this.body=b;return this;}});
const request=(b=fixtures.inbound)=>{const raw=Buffer.from(JSON.stringify(b));return {method:"POST",headers:{"content-type":"application/json",
  "x-hub-signature-256":"sha256="+createHmac("sha256",syntheticEnv.META_OBSERVER_APP_SECRET).update(raw).digest("hex")},
  async *[Symbol.asyncIterator](){yield raw;}};};
function db(client,override={}) {return {async rpc(name,a){
  assert.equal(name,"observe_meta_admin_events_v1");
  const args={...a,...override};
  try{return {data:(await client.query("select public.observe_meta_admin_events_v1($1,$2,$3,$4::jsonb) result",
    [args.p_waba_id,args.p_phone_number_id,args.p_body_sha256,JSON.stringify(args.p_events)])).rows[0].result};}
  catch(e){lastDatabaseError={code:e.code,message:e.message,constraint:e.constraint};return {error:{code:e.code}};}
}};}
async function deliver(client,body=fixtures.inbound,override={}){
  const res=response();await createMetaObserverHandler({getDb:()=>db(client,override),env:()=>syntheticEnv,log(){}})(request(body),res);return res;
}
async function scenario(name,fn){const start=performance.now();await fn();results.push({scenario:name,result:"PASS",ms:Math.round(performance.now()-start)});}
try {
  await server.initialise();await server.start();root=await connection();
  // Fresh isolated cluster emulates broad Supabase defaults; never modifies a
  // project's defaults. The migration must revoke these grants per object.
  await root.query(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    create table public.unrelated_acl_sentinel(id integer);
    create function public.unrelated_acl_sentinel_fn() returns integer language sql as 'select 1';`);
  const defaultsBefore=(await root.query("select defaclobjtype,defaclacl::text from pg_default_acl order by defaclobjtype")).rows;
  const sentinelBefore=(await root.query("select relacl::text from pg_class where oid='public.unrelated_acl_sentinel'::regclass")).rows;
  const migration=await readFile(new URL("../supabase/migrations/20261008162624_meta_admin_observer.sql",import.meta.url),"utf8");
  await root.query(migration);
  const service=await connection("service_role");
  await scenario("empty scope blocks persistence; migration does not activate anything",async()=>{
    assert.equal((await deliver(service)).statusCode,503);
    assert.equal((await root.query("select count(*)::int n from public.meta_observer_admin_scope")).rows[0].n,0);
  });
  // Only fixtures in this newly-created local cluster. No Respond/Meta contact.
  await root.query("insert into public.meta_observer_admin_scope(waba_id,phone_number_id,enabled) values($1,$2,true)",[scope.wabaId,scope.phoneNumberId]);
  await scenario("effective ACL, PUBLIC EXECUTE, defaults and unrelated objects",async()=>{
    for(const role of ["anon","authenticated","service_role"]){
      for(const table of ["meta_observer_admin_scope","meta_observer_events"]){
        for(const privilege of ["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER"]){
          const actual=(await root.query("select has_table_privilege($1,$2,$3) allowed",[role,`public.${table}`,privilege])).rows[0].allowed;
          const expected=role==="service_role"&&(privilege==="SELECT"||(table==="meta_observer_events"&&privilege==="INSERT"));
          assert.equal(actual,expected,`${role}/${table}/${privilege}`);
        }
      }
      const actual=(await root.query("select has_function_privilege($1,'public.observe_meta_admin_events_v1(text,text,text,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed;
      assert.equal(actual,role==="service_role");
    }
    const publicExecute=(await root.query(`select count(*)::int n from pg_proc p,
      lateral aclexplode(p.proacl) a where p.oid='public.observe_meta_admin_events_v1(text,text,text,jsonb)'::regprocedure and a.grantee=0`)).rows[0].n;
    assert.equal(publicExecute,0);
    assert.deepEqual((await root.query("select defaclobjtype,defaclacl::text from pg_default_acl order by defaclobjtype")).rows,defaultsBefore);
    assert.deepEqual((await root.query("select relacl::text from pg_class where oid='public.unrelated_acl_sentinel'::regclass")).rows,sentinelBefore);
    const rls=(await root.query("select relrowsecurity from pg_class where relname in ('meta_observer_admin_scope','meta_observer_events')")).rows;
    assert.equal(rls.length,2);assert.ok(rls.every(r=>r.relrowsecurity));
    assert.equal((await root.query("select prosecdef from pg_proc where oid='public.observe_meta_admin_events_v1(text,text,text,jsonb)'::regprocedure")).rows[0].prosecdef,false);
    const anon=await connection("anon"),auth=await connection("authenticated");
    for(const client of [anon,auth]){
      await assert.rejects(client.query("select * from public.meta_observer_events"),e=>e.code==="42501");
      assert.equal((await deliver(client)).statusCode,503);
    }
    await assert.rejects(service.query("update public.meta_observer_admin_scope set enabled=false"),e=>e.code==="42501");
  });
  await scenario("real RPC: inbound/media/statuses/app-echo/edit/revoke",async()=>{
    for(const [name,body] of Object.entries(fixtures)){const r=await deliver(service,body);assert.equal(r.statusCode,200,JSON.stringify({name,...lastDatabaseError}));assert.ok(r.body.observed>0);}
    const rows=(await root.query("select category,status,author_evidence,state,observer_only from public.meta_observer_events")).rows;
    assert.equal(rows.length,9);assert.ok(rows.every(r=>r.state==="observed"&&r.observer_only));
    assert.deepEqual(rows.filter(r=>r.category==="status").map(r=>r.status).sort(),["delivered","failed","read","sent"]);
  });
  await scenario("concurrent batches use a single native-key insert",async()=>{
    const sessions=await Promise.all(Array.from({length:6},()=>connection("service_role")));
    const body=payload(change({messages:[inbound("wamid.SYNTHETIC_CONCURRENT")]}));
    const rs=await Promise.all(sessions.map(c=>deliver(c,body)));
    assert.ok(rs.every(r=>r.statusCode===200));assert.equal(rs.reduce((n,r)=>n+r.body.observed,0),1);
    assert.equal(rs.reduce((n,r)=>n+r.body.duplicates,0),5);
  });
  await scenario("lost ACK retry reuses immutable observation (no second work)",async()=>{
    const before=(await root.query("select * from public.meta_observer_events where native_message_id=$1",["wamid.SYNTHETIC_INBOUND"])).rows[0];
    const body=structuredClone(fixtures.inbound);body.entry[0].changes[0].value.messages[0].timestamp="1791479999";
    const r=await deliver(service,body);assert.equal(r.body.duplicates,1);
    const after=(await root.query("select * from public.meta_observer_events where native_message_id=$1",["wamid.SYNTHETIC_INBOUND"])).rows[0];
    assert.deepEqual(after,before);
    await assert.rejects(service.query("delete from public.meta_observer_events"),e=>e.code==="42501");
    await assert.rejects(service.query("update public.meta_observer_events set state='observed'"),e=>e.code==="42501");
    await assert.rejects(service.query("truncate public.meta_observer_events"),e=>e.code==="42501");
  });
  await scenario("mixed invalid DB batch rolls back prior inserts; no false 200",async()=>{
    const calls=[];const res=response();
    await createMetaObserverHandler({env:()=>syntheticEnv,log(){},getDb:()=>({async rpc(name,args){calls.push(args);return {error:{code:"test"}};}})})(request(),res);
    const valid={...calls[0].p_events[0],native_message_id:"wamid.SYNTHETIC_ATOMIC",event_key:"message.received:wamid.SYNTHETIC_ATOMIC"};
    const invalid={...valid,event_key:"z-invalid",native_message_id:"no-native-id"};
    assert.equal((await deliver(service,fixtures.inbound,{p_events:[valid,invalid]})).statusCode,503);
    assert.equal((await root.query("select count(*)::int n from public.meta_observer_events where native_message_id='wamid.SYNTHETIC_ATOMIC'")).rows[0].n,0);
  });
  await scenario("DB scope mismatch/disabled blocks even if environment says enabled",async()=>{
    assert.equal((await deliver(service,fixtures.inbound,{p_phone_number_id:"999999999999999"})).statusCode,503);
    await root.query("update public.meta_observer_admin_scope set enabled=false");
    assert.equal((await deliver(service)).statusCode,503);
    await root.query("update public.meta_observer_admin_scope set enabled=true");
  });
  await scenario("no commercial objects, consumers or triggers",async()=>{
    assert.equal((await root.query("select count(*)::int n from pg_trigger where tgrelid='public.meta_observer_events'::regclass and not tgisinternal")).rows[0].n,0);
    const tables=(await root.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r=>r.tablename);
    assert.deepEqual(tables,["meta_observer_admin_scope","meta_observer_events","unrelated_acl_sentinel"]);
  });
  await root.query("delete from public.meta_observer_events; delete from public.meta_observer_admin_scope;");
  assert.equal((await root.query("select (select count(*) from public.meta_observer_events)+(select count(*) from public.meta_observer_admin_scope) n")).rows[0].n,"0");
  cleaned=true;
  console.log(JSON.stringify({verdict:"PASS",database:"isolated_local_postgresql",results,
    migration_sha256:createHash("sha256").update(migration).digest("hex"),elapsed_ms:Math.round(performance.now()-started),
    cleanup_rows:0,remote_fixtures:0,models:0,sends:0,remote_database_connections:0},null,2));
} finally {
  if(root&&!cleaned)await root.query("delete from public.meta_observer_events; delete from public.meta_observer_admin_scope;").catch(()=>{});
  await Promise.all(clients.map(c=>c.end().catch(()=>{})));
  await server.stop();globalThis.fetch=fetchBefore;
}
