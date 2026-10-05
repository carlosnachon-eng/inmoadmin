// Actual lane schemas, pause RPC/trigger and processors; only model/Respond IO
// intercepted. Disposable loopback PostgreSQL; never loads environment files.
import assert from "node:assert/strict";
import { readFile, mkdtemp, access, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { localPgAdapter } from "../tests/helpers/localPgAdapter.mjs";
import { importWithStubs } from "../tests/helpers/socialFixtures.mjs";
import { sanitizeShadowText } from "../lib/shadow/coordinator.js";
import * as handoffs from "../lib/agentsV2/salesHandoff.js";
import * as outbound from "../lib/agentsV2/salesAutoOutbound.js";
import { readHumanAttention, beginHumanGuardedSalesSend } from "../lib/agentsV2/humanAttention.js";

const runtime=process.env.SOCIAL_LOCAL_PG_RUNTIME;
if(!runtime)throw Error("SOCIAL_LOCAL_PG_RUNTIME required (local pg/embedded-postgres)");
const {default:EmbeddedPostgres}=await import(pathToFileURL(resolve(runtime,"node_modules/embedded-postgres/dist/index.js")));
const {default:pg}=await import(pathToFileURL(resolve(runtime,"node_modules/pg/lib/index.js")));
const directory=await mkdtemp(join(tmpdir(),"human-attention-pg-"));
const socket=net.createServer();await new Promise(ok=>socket.listen(0,"127.0.0.1",ok));const port=socket.address().port;await new Promise(ok=>socket.close(ok));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,"data"),user:"postgres",password:"local-synthetic-only",port,persistent:false,
  postgresFlags:["-c","listen_addresses=127.0.0.1","-c",`unix_socket_directories=${directory}`],onLog(){},onError(){}});
const clients=[],checks=[],sends=[],inputs=[];
const originalFetch=globalThis.fetch;
let transport=async()=>({ok:true,json:async()=>({messageId:"synthetic-"+randomUUID()})});
globalThis.fetch=async(url,options)=>{assert.match(url,/^https:\/\/api\.respond\.io\/v2\/contact\/id:synthetic-[^/]+\/message$/);assert.equal(options.method,"POST");sends.push(JSON.parse(options.body));return transport();};
const connect=async role=>{const c=new pg.Client({host:"127.0.0.1",port,user:"postgres",password:"local-synthetic-only",database:"postgres",statement_timeout:10000});await c.connect();clients.push(c);if(role)await c.query(`set role ${role}`);return c;};
const file=name=>readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8");
const test=async(name,fn)=>{await fn();checks.push(name);};
const env={SOCIAL_ROUTING_V1_ENABLED:"true",VERCEL_ENV:"production",SUPABASE_ENVIRONMENT:"production",SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED:"true",RESPOND_IO_TOKEN:"synthetic-intercepted-only"};
const now=()=>new Date().toISOString();
const before=seconds=>new Date(Date.now()-seconds*1000).toISOString();
const output="¿Cuál es tu presupuesto para el departamento en renta?";
let onModel=async()=>{};
const usage={safeAgentUsage:async()=>({inputTokens:null,outputTokens:null,totalTokens:null,estimatedCostUsd:null})};
const contextIO={readRespondMessages:async()=>({messages:[]}),respondMessageTimestamp:r=>r.at};
try{
  await cluster.initialise();await cluster.start();const db=await connect();
  await db.query(`create role anon;create role authenticated;create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
    create table profiles(id uuid primary key,role_id text,active boolean);
    create table clientes(id uuid primary key,nombre text);create table propiedades(id uuid primary key,public_id text);
    create table client_identities(id uuid primary key,status text);
    create table respond_identity_links(respond_contact_id text,client_identity_id uuid,link_status text);
    create table gv_opportunities(respond_contact_id text,cliente_id uuid,asesor_id uuid);
    create table gv_respond_contact_snapshots(respond_contact_id text primary key,mapped_profile_id uuid,metadata jsonb,atn_area text,atn_servicio text,atn_estado text,respond_channel_id text);
    create table citas(id uuid primary key default gen_random_uuid(),cliente_id uuid references clientes,propiedad_id uuid references propiedades,asesor_id uuid references profiles,
      fecha_hora timestamptz,estado text,notas text,confirmacion_estado text,confirmacion_actualizada_at timestamptz,confirmacion_actualizada_por uuid references profiles);`);
  const transportSql=await file("202608100003_fase_2a1a_respond_incremental_webhooks.sql");
  await db.query(transportSql.slice(transportSql.indexOf("create table if not exists public.gv_respond_webhook_events"),transportSql.indexOf("create index if not exists gv_respond_webhook_events_pending_idx")));
  for(const name of ["202609300009_sales_agent_v2_shadow_lane.sql","202610010001_sales_agent_v2_auto_outbound.sql","202610010002_sales_agent_v2_handoffs.sql","202610010003_sales_agent_v2_handoff_dispatch.sql","202610010004_sales_agent_v2_handoff_sla.sql","202610010005_sales_agent_v2_handoff_escalated_status.sql","202610010006_sales_agent_v2_immediate_processing_status.sql","202610010007_sales_agent_v2_message_debounce.sql","202610010008_owner_agent_v1_base.sql","202610010009_legal_agent_v1_base.sql","202610010010_legal_agent_v1_handoffs.sql","202610010012_respond_appointment_sync.sql","202610010013_agent_usage_tracking.sql","202610010015_agent_usage_details.sql"])
    await db.query(await file(name));
  await db.query("grant select,insert,update on all tables in schema public to service_role");
  await db.query(await file("20261001134913_social_routing_v1.sql"));
  await db.query(await file("20261003201853_social_capture_failsafe.sql"));
  await db.query(await file("20261005211304_respond_human_attention_pause.sql"));
  await test("catalog postcheck: RLS/ACL, four RPCs, trigger and index",async()=>{
    const checks=await db.query(await readFile(new URL("../supabase/checks/respond_human_attention_pause.sql",import.meta.url),"utf8"));
    assert.deepEqual(checks.map(r=>r.rowCount),[1,4,1,1]);
    for(const result of checks)for(const r of result.rows)for(const value of Object.values(r))if(typeof value==="boolean")assert.equal(value,true);
  });
  const service=await connect("service_role"),other=await connect("service_role"),auth=await connect("authenticated"),anon=await connect("anon");
  const admin=localPgAdapter(service);
  const operator=randomUUID(),advisor=randomUUID();
  await db.query("insert into profiles values($1,'admin',true),($2,'asesor',true)",[operator,advisor]);
  const event=async(contact,{id=randomUUID(),source="user",type="message.sent",at=now(),extra={}}={},client=service)=>{
    await client.query("insert into gv_respond_webhook_events(event_id,event_type,respond_contact_id,event_occurred_at,payload_meta) values($1,$2,$3,$4,$5) on conflict(event_id) do nothing",[id,type,contact,at,{...extra,...(source===null?{}:{sender_source:source})}]);return id;};
  const seed=async(contact="synthetic-"+randomUUID(),{lane="sales_agent_v2",text="Busco un departamento en renta",at=now()}={})=>{
    const row=(await service.query(`insert into ${lane}_inbound_messages(event_id,respond_contact_id,channel_id,occurred_at,sanitized_text) values($1,$2,'497382',$3,$4) returning *`,[randomUUID(),contact,at,text])).rows[0];return JSON.parse(JSON.stringify(row));};
  const prepared=async(contact,opts)=>{const inbound=await seed(contact,opts);const run=(await service.query("insert into sales_agent_v2_shadow_runs(inbound_message_id,session_id,status,proposed_response,completed_at) values($1,'synthetic-session','idle',$2,now()) returning id",[inbound.id,output])).rows[0];return {inbound,run};};
  const journal=async(inbound,run,marker="human_guard_pending")=>(await service.query("insert into sales_agent_v2_auto_outbound(inbound_message_id,shadow_run_id,respond_contact_id,channel_id,case_kind,status,proposed_message,error_code) values($1,$2,$3,'497382','property_interest','processing',$4,$5) returning id",[inbound.id,run.id,inbound.respond_contact_id,output,marker])).rows[0].id;
  const row=async(id)=>(await service.query("select * from sales_agent_v2_auto_outbound where id=$1",[id])).rows[0];
  const gate=async inbound=>readHumanAttention(admin,inbound);
  const runner=await importWithStubs(new URL("../lib/agentsV2/runSalesShadowMessage.js",import.meta.url),{
    "./openaiSalesAgent":{assertSalesAgentV2ShadowEnvironment:()=>{},createSalesSession:async({input})=>{inputs.push(input);await onModel();return{id:"synthetic-session"};},getSalesSession:async()=>({id:"synthetic-session",status:"idle"}),fulfillSalesActions:async()=>assert.fail("unexpected model tools"),salesSessionItems:async()=>[],salesAssistantOutput:()=>output},
    "../ejecutivo/respondSync":contextIO,"../shadow/coordinator":{sanitizeShadowText},
  });
  const processor=await importWithStubs(new URL("../lib/agentsV2/processSalesInbound.js",import.meta.url),{
    "./runSalesShadowMessage":runner,"./salesHandoff":handoffs,"./salesAutoOutbound":outbound,"./agentUsage":usage,"./openaiSalesAgent":{salesAgentModel:()=>"synthetic"},
  });
  const process=inbound=>processor.processSalesInboundById(admin,inbound.id,{env});
  await test("1/2: client → generation → human → no send; later inbound still paused; snapshot cannot erase",async()=>{
    const inbound=await seed();const prior=sends.length;onModel=()=>event(inbound.respond_contact_id);
    assert.equal((await process(inbound)).status,"paused");onModel=async()=>{};
    const stored=(await service.query("select status,error_code from sales_agent_v2_auto_outbound where inbound_message_id=$1",[inbound.id])).rows[0];
    assert.deepEqual(stored,{status:"blocked",error_code:"human_attention_active"});
    const generationCount=inputs.length;
    await service.query("update gv_respond_webhook_events set status='processed' where respond_contact_id=$1",[inbound.respond_contact_id]);
    await event(inbound.respond_contact_id,{type:"message.received",source:null});
    assert.equal((await process(await seed(inbound.respond_contact_id))).status,"paused");
    assert.equal(inputs.length,generationCount);assert.equal(sends.length,prior);
    assert.equal((await outbound.processOneSalesAutoOutbound(admin,{env})).status,"idle");assert.equal(sends.length,prior);
  });
  await test("3/4: human before processor, duplicated webhook, unknown/nonhuman source never inferred from assignee or journal",async()=>{
    const inbound=await seed();const human=await event(inbound.respond_contact_id);await event(inbound.respond_contact_id,{id:human});
    const n=inputs.length;assert.equal((await process(inbound)).status,"paused");assert.equal(inputs.length,n);
    assert.equal((await service.query("select count(*)::int n from gv_respond_webhook_events where event_id=$1",[human])).rows[0].n,1);
    for(const source of [null,"api","workflow","ai_agent","agent"]){const i=await seed();await event(i.respond_contact_id,{source,extra:{assignee_id:"synthetic-advisor"}});assert.equal((await gate(i)).blocked,false);}
  });
  await test("final sender rechecks after claim; trigger cancels only provably pending, evidence retained",async()=>{
    const {inbound,run}=await prepared();let fired=false;const n=sends.length;
    const intercepted=localPgAdapter(service,{afterQuery:async(table,op,payload)=>{if(table==="sales_agent_v2_auto_outbound"&&op==="insert"&&payload.error_code==="human_guard_pending"&&!fired){fired=true;await event(inbound.respond_contact_id);}}});
    const result=await outbound.processSalesAutoOutboundRun(intercepted,run.id,{env});assert.equal(result.reason,"human_attention_active");assert.equal(sends.length,n);
    const stored=(await service.query("select * from sales_agent_v2_auto_outbound where inbound_message_id=$1",[inbound.id])).rows[0];assert.equal(stored.status,"blocked");assert.equal(stored.proposed_message,output);
  });
  await test("human during context loading prevents model creation at the second generation gate",async()=>{
    const i=await seed();const n=inputs.length;let inserted=false;
    const duringContext=localPgAdapter(service,{afterQuery:async(table,op)=>{if(table==="gv_respond_contact_snapshots"&&op==="select"&&!inserted){inserted=true;await event(i.respond_contact_id);}}});
    const result=await runner.runSalesAgentV2ShadowMessage(duringContext,i,{env});
    assert.equal(result.humanPaused,true);assert.equal(inputs.length,n);
  });
  await test("5: human transaction and final authorization serialize on actual independent PostgreSQL connections",async()=>{
    const {inbound,run}=await prepared();const id=await journal(inbound,run);
    await service.query("begin");await event(inbound.respond_contact_id);
    let finished=false;const pending=other.query("select begin_sales_human_guarded_send_v1($1) result",[id]).then(r=>{finished=true;return r.rows[0].result;});
    let waiting=false;for(let n=0;n<50;n++){waiting=(await db.query("select $1::int=any(pg_blocking_pids($2::int)) b",[service.processID,other.processID])).rows[0].b;if(waiting)break;await new Promise(ok=>setTimeout(ok,10));}
    assert.equal(waiting,true);assert.equal(finished,false);await service.query("commit");assert.equal((await pending).allowed,false);assert.equal((await row(id)).status,"blocked");
    const p=await prepared();const n=sends.length;
    const results=await Promise.all([outbound.processSalesAutoOutboundRun(admin,p.run.id,{env}),outbound.processSalesAutoOutboundRun(localPgAdapter(other),p.run.id,{env})]);
    assert.equal(results.filter(r=>r.status==="sent").length,1);assert.equal(sends.length,n+1);
  });
  await test("6: sent/unknown/in-flight and legacy processing retained; no false cancellation and no retry",async()=>{
    for(const marker of [null,"dispatch_started"]){const p=await prepared();const id=await journal(p.inbound,p.run,marker);await event(p.inbound.respond_contact_id);assert.equal((await row(id)).status,"processing");assert.equal((await beginHumanGuardedSalesSend(admin,id)).allowed,false);}
    const p=await prepared();const n=sends.length;await outbound.processSalesAutoOutboundRun(admin,p.run.id,{env});await event(p.inbound.respond_contact_id);
    const sent=(await service.query("select * from sales_agent_v2_auto_outbound where inbound_message_id=$1",[p.inbound.id])).rows[0];assert.equal(sent.status,"sent");assert.ok(sent.provider_message_id);
    await outbound.processSalesAutoOutboundRun(admin,p.run.id,{env});assert.equal(sends.length,n+1);
    const uncertain=await prepared();transport=async()=>{await event(uncertain.inbound.respond_contact_id);throw Error("synthetic timeout");};
    await assert.rejects(outbound.processSalesAutoOutboundRun(admin,uncertain.run.id,{env}),/synthetic timeout/);
    const unknown=(await service.query("select status,error_code from sales_agent_v2_auto_outbound where inbound_message_id=$1",[uncertain.inbound.id])).rows[0];assert.deepEqual(unknown,{status:"failed",error_code:"respond_delivery_unknown"});
    const after=sends.length;await outbound.processSalesAutoOutboundRun(admin,uncertain.run.id,{env});assert.equal(sends.length,after);
    transport=async()=>({ok:true,json:async()=>({messageId:"synthetic-"+randomUUID()})});
  });
  await test("7: pause survives OWNER/LEGAL processors and ADMINISTRATION review routing, no agent/assignee reset",async()=>{
    const i=await seed();await event(i.respond_contact_id);const n=inputs.length,m=sends.length;
    await service.query("insert into gv_respond_contact_snapshots(respond_contact_id,mapped_profile_id) values($1,$2)",[i.respond_contact_id,advisor]);
    const common={"../ejecutivo/respondSync":contextIO,"../shadow/coordinator":{sanitizeShadowText},"./agentUsage":usage};
    const owner=await importWithStubs(new URL("../lib/agentsV2/processOwnerInbound.js",import.meta.url),{...common,"./openaiOwnerAgent":{createOwnerSession:()=>assert.fail("paused owner generated"),getOwnerSession:()=>{},fulfillOwnerActions:()=>{},ownerOutput:()=>{}}});
    const legal=await importWithStubs(new URL("../lib/agentsV2/processLegalInbound.js",import.meta.url),{...common,"./openaiLegalAgent":{createLegalSession:()=>assert.fail("paused legal generated"),fulfillLegal:()=>{},getLegalSession:()=>{},legalOutput:()=>{}},"./legalHandoff":{createAndDispatchLegalHandoff:()=>assert.fail("paused legal handoff")}});
    assert.equal((await owner.processOwnerInboundById(admin,(await seed(i.respond_contact_id,{lane:"owner_agent_v1"})).id,{env})).reason,"human_attention_active");
    assert.equal((await legal.processLegalInboundById(admin,(await seed(i.respond_contact_id,{lane:"legal_agent_v1",text:"Mi expediente"})).id,{env})).reason,"human_attention_active");
    const eid=await event(i.respond_contact_id,{type:"message.received",source:null});
    const route=await service.query("select capture_social_route_v1($1) result",[{source_event_id:eid,source_message_id:randomUUID(),source_channel_id:"497382",source_platform:"instagram",respond_contact_id:i.respond_contact_id,destination:"ADMINISTRATION",reason:"administrative_intent",identity_status:"unresolved",occurred_at:now(),sanitized_text:"Consulta sintética administrativa"}]);
    assert.equal(route.rows[0].result.destination,"ADMINISTRATION");assert.equal(route.rows[0].result.inboundId,null);assert.equal((await gate(i)).blocked,true);
    assert.equal((await service.query("select mapped_profile_id from gv_respond_contact_snapshots where respond_contact_id=$1",[i.respond_contact_id])).rows[0].mapped_profile_id,advisor);
    assert.equal(inputs.length,n);assert.equal(sends.length,m);
  });
  await test("8: explicit audited return permits only new turns, does not replay old proposals; newer human invalidates old CAS",async()=>{
    const old=await prepared();const eid=await event(old.inbound.respond_contact_id);const state=await gate(old.inbound);
    await auth.query("select set_config('request.jwt.claim.sub',$1,false)",[operator]);
    const resume=()=>auth.query("select resume_respond_ai_v1($1,$2,$3)",[old.inbound.respond_contact_id,state.episodeKey,eid]);
    await resume();await resume();assert.equal((await gate(old.inbound)).reason,"human_attention_pre_resume");
    assert.equal((await outbound.processSalesAutoOutboundRun(admin,old.run.id,{env})).reason,"human_attention_pre_resume");
    const fresh=await seed(old.inbound.respond_contact_id);assert.equal((await gate(fresh)).blocked,false);
    const result=await process(fresh);assert.equal(result.outbound.status,"sent");
    await event(old.inbound.respond_contact_id);await assert.rejects(resume(),e=>e.code==="40001");assert.equal((await gate(fresh)).blocked,true);
    assert.equal((await service.query("select count(*)::int n from respond_ai_resumptions where respond_contact_id=$1",[fresh.respond_contact_id])).rows[0].n,1);
  });
  await test("OWNER and LEGAL pre-send gates preserve real journal constraints after human during model",async()=>{
    const n=sends.length;
    for(const lane of ["owner","legal"]){
      const i=await seed(undefined,{lane:lane+"_agent_v1",text:"Información general sintética"});
      const create=async()=>{await event(i.respond_contact_id);return{id:"synthetic-session"};};
      const common={"../ejecutivo/respondSync":contextIO,"../shadow/coordinator":{sanitizeShadowText},"./agentUsage":usage};
      const module=await importWithStubs(new URL(`../lib/agentsV2/process${lane==="owner"?"Owner":"Legal"}Inbound.js`,import.meta.url),lane==="owner"?
        {...common,"./openaiOwnerAgent":{createOwnerSession:create,getOwnerSession:async()=>({id:"synthetic-session",status:"idle"}),fulfillOwnerActions:()=>assert.fail(),ownerOutput:async()=>output}}:
        {...common,"./openaiLegalAgent":{createLegalSession:create,getLegalSession:async()=>({id:"synthetic-session",status:"idle"}),fulfillLegal:()=>assert.fail(),legalOutput:async()=>output},"./legalHandoff":{createAndDispatchLegalHandoff:()=>assert.fail("unexpected handoff")}});
      const result=await module[lane==="owner"?"processOwnerInboundById":"processLegalInboundById"](admin,i.id,{env});
      assert.equal(result.reason,"human_attention_active");
      const record=(await service.query(`select status,error_code from ${lane}_agent_v1_auto_outbound where inbound_message_id=$1`,[i.id])).rows[0];
      assert.deepEqual(record,{status:"superseded",error_code:"human_attention_active"});
    }
    assert.equal(sends.length,n);
  });
  await test("closed episode excludes historical human; opened/inbound/assignee do NOT clear active pause; late old turn blocked",async()=>{
    const i=await seed(undefined,{at:before(50)});await event(i.respond_contact_id,{at:before(40)});
    for(const type of ["conversation.opened","message.received","contact.assignee.updated"]){await event(i.respond_contact_id,{type,source:null});assert.equal((await gate(i)).blocked,true);}
    await event(i.respond_contact_id,{type:"conversation.closed",source:null,at:before(20)});
    assert.equal((await gate(i)).reason,"human_attention_inactive_episode");assert.equal((await gate(await seed(i.respond_contact_id))).blocked,false);
    await event(i.respond_contact_id,{at:before(30)});assert.equal((await gate(await seed(i.respond_contact_id))).blocked,false);
    await event(i.respond_contact_id,{at:null});assert.equal((await gate(await seed(i.respond_contact_id))).blocked,true);
  });
  await test("RLS/ACL: no anon access, no direct authenticated mutation, resume role and CAS enforced",async()=>{
    for(const c of [anon,auth]){await assert.rejects(c.query("select * from respond_ai_resumptions"),e=>e.code==="42501");await assert.rejects(c.query("select read_respond_human_pause_v1('synthetic',now())"),e=>e.code==="42501");}
    await auth.query("select set_config('request.jwt.claim.sub',$1,false)",[advisor]);
    await assert.rejects(auth.query("select resume_respond_ai_v1('synthetic','initial','synthetic')"),e=>e.code==="42501");
    const acl=(await db.query("select relrowsecurity,has_table_privilege('authenticated','respond_ai_resumptions','INSERT') writable from pg_class where oid='respond_ai_resumptions'::regclass")).rows[0];assert.deepEqual(acl,{relrowsecurity:true,writable:false});
  });
  await test("unavailable/malformed RPC fails closed; uncertain authorization never resets a consumed marker",async()=>{
    const p=await prepared();const id=await journal(p.inbound,p.run);
    const broken=localPgAdapter(service,{afterRpc:async name=>{if(name==="begin_sales_human_guarded_send_v1")throw Error("lost RPC response");}});
    assert.equal((await beginHumanGuardedSalesSend(broken,id)).allowed,false);assert.equal((await row(id)).error_code,"dispatch_started");
    assert.equal((await beginHumanGuardedSalesSend(admin,id)).allowed,false);
    assert.equal((await readHumanAttention({rpc:async()=>({data:null,error:{code:"unavailable"}})},p.inbound)).blocked,true);
  });
  console.log(JSON.stringify({result:"PASS",checks:checks.length,tests:checks,modelFixtures:inputs.length,interceptedSends:sends.length,externalCalls:0,realRespondDelivery:"NOT_TESTED",productionTouched:false},null,2));
}finally{
  globalThis.fetch=originalFetch;
  for(const c of clients){try{await c.query("rollback");}catch{}try{await c.end();}catch{}}
  await cluster.stop();await assert.rejects(access(join(directory,"data")),{code:"ENOENT"});await rmdir(directory);
  console.log("LOCAL_SYNTHETIC_CLUSTER_STOPPED_AND_REMOVED; residues=0");
}
