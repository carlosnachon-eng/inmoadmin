// Synthetic, loopback-only PostgreSQL certification. Never reads .env or a remote DB URL.
import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import net from "node:net";
import { reviewCondominiumIdentity, loadCondominiumIdentityBefore3A } from "../lib/shadow/condominiumIdentity.js";
import { invokeShadowPhase3A } from "../lib/shadow/ai/phase3AGateway.js";
import { buildShadowRunIdentityObservability } from "../lib/shadow/runIdentityObservability.js";
import { condominiumCases, condoActor, condoEnv, fixtureUuid as id, fixtureDigest } from "../tests/helpers/condominiumIdentityFixture.mjs";

const runtime = process.env.CONDOMINIUM_DEV_PG_RUNTIME;
if (!runtime) throw new Error("Set CONDOMINIUM_DEV_PG_RUNTIME to a local directory with embedded-postgres and pg installed");
const { default: EmbeddedPostgres } = await import(pathToFileURL(resolve(runtime, "node_modules/embedded-postgres/dist/index.js")));
const { default: pg } = await import(pathToFileURL(resolve(runtime, "node_modules/pg/lib/index.js")));
const directory = await mkdtemp(join(tmpdir(), "condo-identity-fixture-"));
const socket = net.createServer(); await new Promise((ok, fail) => { socket.once("error", fail); socket.listen(0, "127.0.0.1", ok); });
const port = socket.address().port; await new Promise((ok) => socket.close(ok));
const cluster = new EmbeddedPostgres({ databaseDir:join(directory,"data"), user:"postgres", password:"synthetic-local-only", port, persistent:true,
  postgresFlags:["-c","listen_addresses=127.0.0.1","-c",`unix_socket_directories=${directory}`], onLog(){}, onError(error){ console.error(String(error)); } });
const connection = { host:"127.0.0.1",port,user:"postgres",password:"synthetic-local-only",database:"postgres" };
const clients = []; let checks = 0; const report = [];
const connect = async () => { const c = new pg.Client(connection); await c.connect(); clients.push(c); return c; };
const file = async (name) => readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8");
const assertCheck = (condition, label) => { assert.ok(condition,label); checks++; };
const allowedTables = new Set(["client_identities","client_identity_roles","client_source_links","client_reconciliation_candidates","client_reconciliation_candidate_sources","respond_identity_links","unidades_condominio","condominios"]);
const adapter = (client) => ({ from(table) {
  assert.ok(allowedTables.has(table)); let fields="*",conditions=[],values=[],ordering="",count="";
  const q={select(v){assert.match(v,/^[a-z_,*]+$/);fields=v;return q;},eq(k,v){assert.match(k,/^[a-z_]+$/);values.push(v);conditions.push(`${k}=$${values.length}`);return q;},
    in(k,vs){assert.match(k,/^[a-z_]+$/);values.push(vs);conditions.push(`${k}=any($${values.length})`);return q;},order(k,opts){assert.match(k,/^[a-z_]+$/);ordering=` order by ${k} ${opts?.ascending===false?"desc":"asc"}`;return q;},limit(n){count=` limit ${Number(n)}`;return q;},
    then(ok,fail){return client.query(`select ${fields} from public.${table}${conditions.length?` where ${conditions.join(" and ")}`:""}${ordering}${count}`,values).then(r=>({data:r.rows,error:null}),error=>({data:null,error})).then(ok,fail);}};return q;
},async rpc(name,args){assert.equal(name,"review_condominium_owner_identity");try { const r=await client.query(`select public.${name}(${Object.keys(args).map((k,i)=>`${k} => $${i+1}`).join(",")}) result`,Object.values(args));return {data:r.rows[0].result,error:null}; }catch(error){return {data:null,error};}}});

try {
  await cluster.initialise(); await cluster.start(); const db=await connect();
  await db.query(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key);
    create table public.profiles(id uuid primary key,role_id text,active boolean);
    create table public.users(id uuid primary key);
    create table public.properties(id uuid primary key,owner_id uuid,status text);
    create table public.contracts(id uuid primary key,tenant_id uuid,tenant_phone text,property_id uuid references public.properties(id),status text,start_date date,end_date date);
    create table public.shadow_conversations(id uuid primary key,provider text,channel text);
    create table public.condominios(id uuid primary key,activo boolean);
    create table public.unidades_condominio(id uuid primary key,condominio_id uuid references public.condominios(id),activo boolean,propietario_telefono text,propietario_nombre text default 'Synthetic owner');
    grant usage on schema public,extensions to service_role,anon,authenticated;
    grant select on public.profiles,public.properties,public.contracts,public.unidades_condominio,public.condominios to service_role;`);
  for (const migration of ["202608250004_fase_3a_respond_identity_bridge.sql","202608260002_fase_3a_canonical_client_model.sql","202609090001_exact_phone_respond_identity_confirmation_7of7.sql"]) await db.query(await file(migration));
  const historicSql = `select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and proname in ('confirm_exact_phone_respond_identity_link','confirm_exact_phone_respond_identity_link_core') order by proname`;
  const historicalBefore=(await db.query(historicSql)).rows;
  await db.query(await file("202609180001_condominium_owner_canonical_identity.sql"));
  await db.query(await file("202609180001_condominium_owner_canonical_identity_checks.sql")); checks++;
  assert.deepEqual((await db.query(historicSql)).rows,historicalBefore); checks++;
  await db.query(`insert into profiles values($1,'admin',true),($2,'coord_operaciones',true),($3,'admin',false)`,[condoActor.id,id(2),id(3)]);
  await db.query(`insert into condominios values($1,true),($2,false)`,[id(20),id(21)]);
  for(const [i,c] of condominiumCases.entries()) await db.query("insert into unidades_condominio values($1,$2,true,$3)",[c.unitId,id(20), i===3?"525550100004":c.phone]);
  const service=await connect(); await service.query("set role service_role"); const admin=adapter(service);
  const fetchContact=async(contactId)=>{const c=condominiumCases.find(x=>x.contactId===contactId);return {id:contactId,phone:c?.phone||"525550100008"};};
  const operate=(body,clientAdmin=admin,fetcher=fetchContact,actor=condoActor)=>reviewCondominiumIdentity({admin:clientAdmin,actor,body,fetchContact:fetcher,env:condoEnv});
  const candidateFor=async(unit)=> (await db.query("select c.id from client_reconciliation_candidates c join client_reconciliation_candidate_sources s on s.candidate_id=c.id where s.source_id=$1",[unit])).rows[0]?.id;
  const prepare=async(c)=>{const result=await operate({action:"condominium_prepare",unitId:c.unitId,respondContactId:c.contactId});return {...result,candidateId:await candidateFor(c.unitId)};};
  const approve=(candidateId,clientAdmin=admin,fetcher=fetchContact)=>operate({action:"condominium_confirm",candidateId,ownershipReviewed:true},clientAdmin,fetcher);
  for(const c of condominiumCases.slice(0,3)){
    const prepared=await prepare(c); assert.equal(prepared.status,"requires_review");checks++;
    assert.equal(await loadCondominiumIdentityBefore3A(admin,c.contactId),null);checks++;
    assert.equal((await approve(prepared.candidateId)).status,"confirmed");checks++;
    assert.equal((await approve(prepared.candidateId)).status,"already_confirmed");checks++;
    const tools=[];let context;
    await invokeShadowPhase3A({admin,envelope:{sanitizedText:"Hola, gracias por la información.",providerMetadata:{respondContactId:c.contactId}},deterministic:{intent:"otro",requiresHuman:true},toolResults:tools,
      systemPrompt:"fixture",toolGuide:"fixture",modelCall:async(messages)=>{context=JSON.parse(messages[1].content);return {text:"{}"};}});
    assert.equal(context.tools[0].result[0].resolved,true);assert.equal(context.tools[0].result[1].unitId,c.unitId);checks++;
    const [observation]=buildShadowRunIdentityObservability({runs:[{id:c.runRef,tool_results_json:tools}]});
    assert.equal(observation.unitResolved,true);assert.equal(observation.propertyResolved,false);assert.equal(observation.inExactPhone7of7,false);checks++;
    report.push({run:c.runRef,source:c.sourceRef,candidate:"requires_review",syntheticApproval:"confirmed",before3A:"confirmed_owner_condominium",unitResolved:true});
  }
  const missing=await prepare(condominiumCases[3]);assert.equal(missing.reason,"source_phone_mismatch");assert.equal(missing.candidateId,undefined);checks++;
  report.push({run:condominiumCases[3].runRef,candidate:"not_created",blocker:missing.reason});
  // No change to rental/source identities, portal or any business data.
  assert.equal((await db.query("select count(*)::int n from contracts")).rows[0].n,0);assert.equal((await db.query("select count(*)::int n from properties")).rows[0].n,0);checks++;
  const audit=JSON.stringify((await db.query("select context_ids from client_identity_audit union all select context_ids from respond_identity_audit")).rows);
  for(const c of condominiumCases) assert.ok(!audit.includes(c.phone));assert.ok(!audit.includes("propietario_telefono"));checks++;
  // SQL roles cannot bypass the server; legacy routes cannot approve condo candidates.
  for(const role of ["anon","authenticated"]){await db.query(`set role ${role}`);await assert.rejects(db.query("select review_condominium_owner_identity('prepare',$1,'synthetic',$2,null,null,null,null)",[id(101),condoActor.id]),/permission denied/);await db.query("reset role");checks++;}
  for(const actor of [id(2),id(3),id(999)]) {await assert.rejects(service.query("select review_condominium_owner_identity('prepare',$1,'synthetic',$2,null,null,null,null)",[id(101),actor]),/actor_not_authorized/);checks++;}
  await assert.rejects(service.query("select review_condominium_owner_identity(null,$1,'synthetic',$2,null,null,null,null)",[id(101),condoActor.id]),/invalid_condominium_review/);checks++;
  const stale=(await service.query("select review_condominium_owner_identity('prepare',$1,$2,$3,$4,now()-interval '61 seconds',null,null) result",[id(101),condominiumCases[0].contactId,condoActor.id,fixtureDigest(condominiumCases[0].phone)])).rows[0].result;
  assert.equal(stale.reason,"fresh_respond_evidence_required");checks++;
  await assert.rejects(service.query("select confirm_client_reconciliation_candidate($1,$2,null)",[await candidateFor(id(101)),condoActor.id]),/condominium_review_required/);checks++;
  await assert.rejects(service.query("select confirm_rental_client_candidate_v1($1,$2,null)",[await candidateFor(id(101)),condoActor.id]),/permission denied/);checks++;
  // Shared phone is not a person key; no candidates may group two unlinked sources.
  await db.query("insert into unidades_condominio values($1,$3,true,$4),($2,$3,true,$4)",[id(105),id(106),id(20),"525550100008"]);
  const shared=await prepare({unitId:id(105),contactId:"synthetic-shared"});assert.equal(shared.reason,"shared_phone_requires_structured_identity");checks++;
  await db.query("insert into client_identities(id,phone_digest) values($1,$2)",[id(950),fixtureDigest("525550100950")]);
  await db.query("insert into unidades_condominio values($1,$2,true,$3)",[id(950),id(20),"525550100950"]);
  const preexisting=await operate({action:"condominium_prepare",unitId:id(950),respondContactId:"synthetic-existing"},admin,async(cid)=>({id:cid,phone:"525550100950"}));
  assert.equal(preexisting.reason,"existing_identity_requires_structured_link");checks++;
  for(const [unit,active,condo,expected] of [[107,false,20,"inactive_unit_or_condominium"],[108,true,21,"inactive_unit_or_condominium"]]) {
    await db.query("insert into unidades_condominio values($1,$2,$3,$4)",[id(unit),id(condo),active,`525550100${unit}`]);
    const r=await operate({action:"condominium_prepare",unitId:id(unit),respondContactId:`synthetic-${unit}`},admin,async(cid)=>({id:cid,phone:`525550100${unit}`}));assert.equal(r.reason,expected);checks++;
  }
  // Fresh Respond change between candidate and confirm fails closed.
  const c8={unitId:id(109),contactId:"synthetic-109",phone:"525550100109"};
  await db.query("insert into unidades_condominio values($1,$2,true,$3)",[c8.unitId,id(20),c8.phone]);
  const contact8=async(cid)=>({id:cid,phone:c8.phone});
  await operate({action:"condominium_prepare",unitId:c8.unitId,respondContactId:c8.contactId},admin,contact8);
  const cid8=await candidateFor(c8.unitId);
  assert.equal((await approve(cid8,admin,async(cid)=>({id:cid,phone:"525550199888"}))).reason,"source_phone_mismatch");checks++;
  // Actual independent PostgreSQL connections: same contact, one confirmation/audit.
  const service2=await connect();await service2.query("set role service_role");const admin2=adapter(service2);
  const concurrent=await Promise.all([approve(cid8,admin,contact8),approve(cid8,admin2,contact8)]);
  assert.deepEqual(concurrent.map(x=>x.status).sort(),["already_confirmed","confirmed"]);checks++;
  assert.equal((await db.query("select count(*)::int n from client_identity_audit where candidate_id=$1 and event_type='confirmed'",[cid8])).rows[0].n,1);checks++;
  // Two contacts, one canonical identity, two pre-existing approved structural sources.
  const person=id(500),phone="525550100500";
  await db.query("insert into client_identities(id,phone_digest) values($1,$2);",[person,fixtureDigest(phone)]);
  await db.query("insert into client_identity_roles(client_identity_id,role_kind) values($1,'owner')",[person]);
  for(const unit of [501,502]){
    await db.query("insert into unidades_condominio values($1,$2,true,$3)",[id(unit),id(20),phone]);
    await db.query("insert into client_source_links(client_identity_id,source_type,source_id,condominium_id,role_kind,link_status,match_method,confirmed_by,confirmed_at) values($1,'condominium_unit_owner',$2,$3,'owner','confirmed','human_resolution',$4,now())",[person,id(unit),id(20),condoActor.id]);
    await operate({action:"condominium_prepare",unitId:id(unit),respondContactId:`synthetic-${unit}`},admin,async(cid)=>({id:cid,phone}));
  }
  const identityRace=await Promise.all([approve(await candidateFor(id(501)),admin,async(cid)=>({id:cid,phone})),approve(await candidateFor(id(502)),admin2,async(cid)=>({id:cid,phone}))]);
  assert.equal(identityRace.filter(x=>x.status==='confirmed').length,1);assert.equal(identityRace.filter(x=>x.reason==='respond_identity_conflict').length,1);checks++;
  // A second unit needs explicit human source review plus the SAME confirmed contact.
  // A shared phone alone is still not an identity merge key.
  const extraUnit=id(510), owner=condominiumCases[0];
  await db.query("insert into unidades_condominio values($1,$2,true,$3)",[extraUnit,id(20),owner.phone]);
  assert.equal((await operate({action:"condominium_prepare",unitId:extraUnit,respondContactId:owner.contactId})).status,"rejected");checks++;
  const extraPrepared=await operate({action:"condominium_prepare",unitId:extraUnit,respondContactId:owner.contactId,attachConfirmedIdentity:true,ownershipReviewed:true});
  assert.equal(extraPrepared.status,"requires_review");checks++;
  const extraCandidate=await candidateFor(extraUnit);
  assert.equal((await approve(extraCandidate)).status,"confirmed");checks++;
  const multi=await loadCondominiumIdentityBefore3A(admin,owner.contactId);
  assert.equal(multi.result[0].resolved,true);assert.equal(multi.result[0].ambiguousUnitContext,true);
  assert.equal(multi.result.filter(x=>x.entityType==='condominium_unit').length,2);
  assert.ok(multi.result.slice(1).every(x=>x.selected===false));checks++;
  assert.equal((await db.query("select count(*)::int n from client_identities where phone_digest=$1",[fixtureDigest(owner.phone)])).rows[0].n,1);checks++;
  assert.equal((await operate({action:"condominium_revoke",candidateId:extraCandidate})).status,"revoked");checks++;
  assert.equal((await loadCondominiumIdentityBefore3A(admin,owner.contactId)).result[0].ambiguousUnitContext,false);checks++;
  // Audit revocation does not delete an identity/evidence and is idempotent.
  const firstCandidate=await candidateFor(id(101));
  assert.equal((await operate({action:"condominium_revoke",candidateId:firstCandidate})).status,"revoked");
  assert.equal((await operate({action:"condominium_revoke",candidateId:firstCandidate})).status,"already_revoke");checks++;
  assert.equal((await loadCondominiumIdentityBefore3A(admin,condominiumCases[0].contactId)).result[0].resolved,false);checks++;
  assert.equal((await db.query("select count(*)::int n from client_identity_audit where candidate_id=$1 and event_type='confirmed'",[firstCandidate])).rows[0].n,1);checks++;
  // The immutable 7/7 wrapper still rejects any eighth reference; definition unchanged.
  await assert.rejects(service.query("select confirm_exact_phone_respond_identity_link('eighth',$1,'synthetic',null,now(),'exact_phone_unique_confirmation_v2',null,$2)",[id(900),condoActor.id]),/candidate_ref_not_in_certified_cohort/);checks++;
  assert.deepEqual((await db.query(historicSql)).rows,historicalBefore);checks++;
  // A change of recorded owner invalidates approval even with the same phone.
  const second=condominiumCases[1];
  await db.query("update unidades_condominio set propietario_nombre='Different synthetic owner' where id=$1",[second.unitId]);
  assert.equal((await approve(await candidateFor(second.unitId))).reason,"source_relationship_changed");checks++;
  assert.equal((await loadCondominiumIdentityBefore3A(admin,second.contactId)).result[0].status,"source_relationship_changed");checks++;
  console.log(JSON.stringify({result:"PASS",engine:"local PostgreSQL",checks,concurrency:"independent connections: same contact + same identity",cases:report,productionAccess:false},null,2));
} finally {
  await Promise.all(clients.map(c=>c.end().catch(()=>{})));
  await cluster.stop();
}
