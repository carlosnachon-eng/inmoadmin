// Loopback PostgreSQL only; no .env, Supabase project, Respond or model requests.
import assert from "node:assert/strict";
import { readFile, mkdtemp, access, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import net from "node:net";

const runtime=process.env.OWNER_MATERIALS_LOCAL_PG_RUNTIME;
let certified=false;
process.on("exit",()=>{if(!certified)process.exitCode=1;});
if(!runtime)throw new Error("OWNER_MATERIALS_LOCAL_PG_RUNTIME required (embedded-postgres/pg only)");
const {default:EmbeddedPostgres}=await import(pathToFileURL(resolve(runtime,"node_modules/embedded-postgres/dist/index.js")));
const {default:pg}=await import(pathToFileURL(resolve(runtime,"node_modules/pg/lib/index.js")));
const dir=await mkdtemp(join(tmpdir(),"owner-materials-pg-"));
const socket=net.createServer();await new Promise(ok=>socket.listen(0,"127.0.0.1",ok));const port=socket.address().port;await new Promise(ok=>socket.close(ok));
const cluster=new EmbeddedPostgres({databaseDir:join(dir,"data"),user:"postgres",password:"synthetic-only",port,persistent:false,postgresFlags:["-c","listen_addresses=127.0.0.1","-c",`unix_socket_directories=${dir}`],onLog(){},onError(){}});
const clients=[],checks=[];
const check=(label,fn)=>{fn();checks.push(label);};
const reject=async(label,fn,re)=>{await assert.rejects(fn,re);checks.push(label);};
const id=n=>`aa000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const connect=async(role)=>{const c=new pg.Client({host:"127.0.0.1",port,user:"postgres",password:"synthetic-only",database:"postgres"});await c.connect();clients.push(c);if(role)await c.query(`set role ${role}`);return c;};
const file=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8");
const rent="OWNER_RENT_ADMIN_PRESENTATION";
try{
  await cluster.initialise();await cluster.start();const db=await connect();
  await db.query(`create role service_role bypassrls; create role anon; create role authenticated;
    create table public.profiles(id uuid primary key,role_id text,active boolean);
    create table public.gv_respond_contact_snapshots(respond_contact_id text primary key,respond_last_human_outbound_at timestamptz);
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text);alter table storage.objects enable row level security;
    grant usage on schema public,storage to anon,authenticated,service_role;grant select on storage.objects to anon,authenticated;
    create policy legacy_allow on storage.objects for select to anon,authenticated using(true);`);
  await db.query(await file("202610010008_owner_agent_v1_base.sql"));
  await db.query("grant select,insert,update on public.profiles,public.gv_respond_contact_snapshots,public.owner_agent_v1_inbound_messages,public.owner_agent_v1_runs,public.owner_agent_v1_auto_outbound to service_role");
  await db.query(await file("20261002044903_owner_approved_materials_v1.sql"));
  const a=await connect("service_role"),b=await connect("service_role"),anon=await connect("anon"),auth=await connect("authenticated");
  await db.query("insert into public.profiles values($1,'admin',true),($2,'asesor',true)",[id(1),id(2)]);
  const addVersion=async(n,actor=id(1),until="2099-01-01")=>a.query("insert into public.owner_approved_material_versions(id,material_code,version,filename,sha256,byte_size,object_path,approved_by,valid_until) values($1,$2,$3,'synthetic.pdf',$4,100,$5,$6,$7)",[id(n),rent,`v${n}`,String(n).padStart(64,"0"),`${rent}/${String(n).padStart(64,"0")}.pdf`,actor,until]);
  await reject("non-admin cannot approve library",()=>addVersion(11,id(2)),/material_admin_approval_required/);
  await addVersion(10);await a.query("select public.activate_owner_material_version($1)",[id(10)]);
  const seed=async(n,contact=String(900000+n),channel="498219")=>{
    await a.query("insert into public.owner_agent_v1_inbound_messages(id,event_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status) values($1,$2,$3,$4,now(),'Synthetic owner rent request','processing')",[id(n),`synthetic-${n}`,contact,channel]);
    await a.query("insert into public.owner_agent_v1_runs(id,inbound_message_id,session_id,status) values($1,$1,'synthetic','idle')",[id(n)]);
    await a.query("insert into public.owner_agent_v1_auto_outbound(inbound_message_id,run_id,respond_contact_id,channel_id,status,proposed_message,provider_message_id) values($1,$1,$2,$3,'sent','Synthetic','9001')",[id(n),contact,channel]);
  };
  const reserve=(c,n,mode="document")=>c.query("select public.reserve_owner_material_delivery($1,$1,$2,$3) value",[id(n),rent,mode]).then(r=>r.rows[0].value);
  const claim=(c,d)=>c.query("select public.claim_owner_material_delivery($1) value",[d]).then(r=>r.rows[0].value);
  await seed(20);
  await a.query("begin");const first=await reserve(a,20);let done=false;
  const pending=reserve(b,20).then(r=>{done=true;return r;});let blocked=false;
  for(let i=0;i<80;i++){const r=await db.query("select $1::int=any(pg_blocking_pids($2::int)) blocked",[a.processID,b.processID]);if(r.rows[0].blocked){blocked=true;break;}await new Promise(ok=>setTimeout(ok,10));}
  check("real concurrent reservation blocks until first transaction commits",()=>{assert.equal(blocked,true);assert.equal(done,false);});
  await a.query("commit");const second=await pending;
  check("one reservation, duplicate suppressed",()=>{assert.equal(first.created,true);assert.equal(second.created,false);assert.equal(first.id,second.id);});
  const claims=await Promise.all([claim(a,first.id),claim(b,first.id)]);
  check("concurrent claims yield exactly one dispatch right",()=>assert.equal(claims.filter(Boolean).length,1));
  await a.query("update public.owner_material_deliveries set status='sent',provider_message_id='9002',sent_at=now(),completed_at=now() where id=$1",[first.id]);
  await reject("terminal evidence cannot reset",()=>a.query("update public.owner_material_deliveries set status='reserved' where id=$1",[first.id]),/material_delivery_immutable/);
  await reject("service cannot delete audit",()=>a.query("delete from public.owner_material_deliveries where id=$1",[first.id]),/permission denied/);
  await reject("service cannot rewrite contact/case",()=>a.query("update public.owner_material_deliveries set respond_contact_id='1' where id=$1",[first.id]),/permission denied/);
  await reject("immutable version/hash",()=>a.query("update public.owner_approved_material_versions set sha256=$1 where id=$2",["f".repeat(64),id(10)]),/permission denied/);
  await addVersion(12);await a.query("select public.activate_owner_material_version($1)",[id(12)]);
  const active=await a.query("select id from public.owner_approved_material_versions where active");
  check("one active version after transactional replacement",()=>assert.deepEqual(active.rows,[{id:id(12)}]));
  await seed(21);const newer=await reserve(a,21);check("new contact uses current version",()=>assert.equal(newer.version_id,id(12)));
  await seed(22,"900020");
  const repeated=await reserve(a,22);check("durable dedup independent of inbound/version",()=>assert.equal(repeated.id,first.id));
  await seed(23);const stale=await reserve(a,23);await addVersion(13);await a.query("select public.activate_owner_material_version($1)",[id(13)]);
  check("retired version blocked immediately before dispatch",()=>assert.ok(stale.id));assert.equal(await claim(a,stale.id),null);
  await seed(24);const human=await reserve(a,24);await db.query("insert into public.gv_respond_contact_snapshots values('900024',now()+interval '1 second')");assert.equal(await claim(a,human.id),null);checks.push("human reply since inbound blocks material");
  await seed(25);const superseded=await reserve(a,25);await seed(26,"900025");assert.equal(await claim(a,superseded.id),null);checks.push("new inbound blocks stale material");
  await seed(27,"900027","544519");await reject("Admin excluded by database channel constraint",()=>reserve(a,27),/check constraint/);
  await seed(28);await a.query("update public.owner_agent_v1_auto_outbound set status='processing' where inbound_message_id=$1",[id(28)]);await reject("no delivery without text receipt",()=>reserve(a,28),/material_delivery_context_invalid/);
  await seed(29);const uncertain=await reserve(a,29);await claim(a,uncertain.id);await a.query("update public.owner_material_deliveries set status='uncertain',error_code='material_delivery_uncertain_requires_review',completed_at=now() where id=$1",[uncertain.id]);assert.equal(await claim(a,uncertain.id),null);checks.push("uncertain transmission cannot be consumed again");
  for(const [label,c] of [["anon",anon],["authenticated",auth]]){
    await reject(`${label}: library inaccessible`,()=>c.query("select * from public.owner_approved_material_versions"),/permission denied/);
    await reject(`${label}: audit inaccessible`,()=>c.query("select * from public.owner_material_deliveries"),/permission denied/);
    await reject(`${label}: cannot reserve`,()=>reserve(c,20),/permission denied/);
    await reject(`${label}: cannot activate`,()=>c.query("select public.activate_owner_material_version($1)",[id(10)]),/permission denied/);
  }
  await db.query("insert into storage.objects(bucket_id) values('owner-approved-materials'),('legacy-public-test')");
  assert.deepEqual((await anon.query("select bucket_id from storage.objects")).rows,[{bucket_id:"legacy-public-test"}]);
  checks.push("restrictive policy overrides broad legacy Storage SELECT");
  const rows=(await db.query("select relname,relrowsecurity from pg_class where relname in ('owner_approved_material_versions','owner_material_deliveries')")).rows;
  check("RLS enabled on both tables",()=>assert.equal(rows.filter(r=>r.relrowsecurity).length,2));
  console.log(JSON.stringify({scope:"loopback PostgreSQL only; synthetic fixtures; no providers",status:"PASS",groups:checks.length,checks},null,2));
}finally{
  for(const c of clients){try{await c.query("rollback");}catch{}await c.end();}
  await cluster.stop();await assert.rejects(access(join(dir,"data")),{code:"ENOENT"});await rmdir(dir);
  console.log("LOCAL_OWNER_MATERIALS_CLUSTER_REMOVED");
}
certified=true;
