// Isolated loopback PostgreSQL ONLY. No .env, Supabase URL or provider access.
import assert from "node:assert/strict";
import { readFile, mkdtemp, access, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import net from "node:net";
import { createHistoricalReplayHandler } from "../pages/api/operaciones/shadow-historical-replay.js";

const runtime=process.env.REPLAY_LOCAL_PG_RUNTIME;
if(!runtime) throw new Error("REPLAY_LOCAL_PG_RUNTIME must identify local embedded-postgres/pg packages");
const {default:EmbeddedPostgres}=await import(pathToFileURL(resolve(runtime,"node_modules/embedded-postgres/dist/index.js")));
const {default:pg}=await import(pathToFileURL(resolve(runtime,"node_modules/pg/lib/index.js")));
const directory=await mkdtemp(join(tmpdir(),"replay-attempts-fixtures-"));
const socket=net.createServer();await new Promise((ok,fail)=>{socket.once("error",fail);socket.listen(0,"127.0.0.1",ok);});
const port=socket.address().port;await new Promise(ok=>socket.close(ok));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,"data"),user:"postgres",password:"synthetic-local-only",port,persistent:false,postgresFlags:["-c","listen_addresses=127.0.0.1","-c",`unix_socket_directories=${directory}`],onLog(){},onError(){}});
const clients=[],results=[];let providerCalls=0;
const check=(label,fn)=>{fn();results.push({test:label,result:"PASS"});};
const connection={host:"127.0.0.1",port,database:"postgres",user:"postgres",password:"synthetic-local-only",statement_timeout:10000};
const connect=async(role)=>{const c=new pg.Client(connection);await c.connect();clients.push(c);if(role)await c.query(`set role ${role}`);return c;};
const id=n=>`aa000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor={id:id(1),active:true,role_id:"admin"};
const file=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8");
const rpc=(db,caseId,parent=null,actorId=actor.id)=>db.query("select public.prepare_historical_replay_retry($1,$2,$3) result",[caseId,parent,actorId]).then(r=>r.rows[0].result);
const reject=async(label,operation,pattern)=>{await assert.rejects(operation,pattern);results.push({test:label,result:"PASS"});};
const tableNames=new Set(["shadow_historical_replay_cases","shadow_historical_replay_attempts","shadow_historical_replay_cohorts","shadow_historical_replay_reviews"]);
function postgrest(db){return {async rpc(name,args){assert.equal(name,"prepare_historical_replay_retry");try{return {data:await rpc(db,args.p_case_id,args.p_parent_attempt_id,args.p_actor_id),error:null};}catch(error){return {data:null,error};}},from(table){
  assert.ok(tableNames.has(table));let fields="*",where=[],values=[],patch,order="",limit="",single=false;
  const q={select(s="*"){assert.match(s,/^[a-z_,*]+$/);fields=s;return q;},eq(k,v){assert.match(k,/^[a-z_]+$/);values.push(v);where.push(`${k}=$${values.length}`);return q;},in(k,v){assert.match(k,/^[a-z_]+$/);values.push(v);where.push(`${k}=any($${values.length})`);return q;},order(k,o){assert.match(k,/^[a-z_]+$/);order=` order by ${k} ${o?.ascending===false?"desc":"asc"}`;return q;},limit(n){assert.ok(Number.isInteger(n));limit=` limit ${n}`;return q;},maybeSingle(){single=true;return q;},update(p){patch=p;return q;},then(ok,fail){
    let sql=`select ${fields} from public.${table}`;
    if(patch){const set=Object.entries(patch).map(([k,v])=>{assert.match(k,/^[a-z_]+$/);values.push(v&&typeof v==="object"?JSON.stringify(v):v);return `${k}=$${values.length}`;});sql=`update public.${table} set ${set.join(",")}`;}
    sql+=(where.length?` where ${where.join(" and ")}`:"")+order+limit+(patch?` returning ${fields}`:"");
    return db.query(sql,values).then(r=>({data:single?r.rows[0]||null:r.rows,error:null}),error=>({data:null,error})).then(ok,fail);
  }};return q;
}};}
function endpoint(db,options={}){const handler=createHistoricalReplayHandler({createAdmin:()=>postgrest(db),authorize:async()=>actor,sameOrigin:()=>true,env:{SHADOW_HISTORICAL_REPLAY_ANTHROPIC_ENABLED:"false"},executeCase:async()=>{providerCalls++;return {operationalResolution:{case_status:"synthetic",would_resolve_without_human:false},conversationAction:{conversation_action:"human_handoff",proposed_message:null,requires_human:true,auto_send_eligible:false,blocked_reason:"financial_sensitive"},tools:[],evidence:[],providerModels:["synthetic-only"],providerModelStatus:"reported",providerRequestRefs:[],privacyChecks:[],inputTokens:7,outputTokens:2,messageSafe:true,latencyMs:1};},...options});return async(body,method="POST")=>{const res={setHeader(){},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};await handler({method,body,headers:{}},res);return res;};}

try{
  await cluster.initialise();await cluster.start();const db=await connect();
  await db.query("create role anon; create role authenticated; create role service_role bypassrls; create table public.profiles(id uuid primary key,role_id text,active boolean); grant usage on schema public to anon,authenticated,service_role;");
  await db.query(await file("202608280001_fase_3b_eval_historical_replay.sql"));
  await db.query(await file("202608280002_fase_3b_utility_evaluation.sql"));
  const uniqueSql="select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.shadow_historical_replay_cases'::regclass and contype='u'";
  const beforeUnique=(await db.query(uniqueSql)).rows;
  await db.query(await file("20260925160512_historical_replay_attempts.sql"));
  check("original uniqueness unchanged",()=>assert.deepEqual((beforeUnique),[{definition:"UNIQUE (historical_turn_key, evaluation_runtime_version)"}]));
  const installedUnique=(await db.query(uniqueSql)).rows;
  check("installed uniqueness identical",()=>assert.deepEqual(installedUnique,beforeUnique));
  await db.query("insert into public.profiles values($1,'admin',true),($2,'asesor',true),($3,'admin',false)",[id(1),id(2),id(3)]);
  await db.query("insert into public.shadow_historical_replay_cohorts(id,runtime_version,requested_count,created_by) values($1,'same-runtime',1,$2)",[id(5),id(1)]);
  const seed=async(n,status="error")=>{await db.query("insert into public.shadow_historical_replay_cases(id,cohort_id,historical_turn_key,evaluation_runtime_version,case_ref,case_domain,status,occurred_at,turn_snapshot,temporal_grounding,identity_grounding,result_safe,error_code) values($1,$2,$3,'same-runtime',$3,'administrative_pending',$4,now(),$5,'current_state','current_canonical_mapping',$6,'old-error')",[id(n),id(5),`synthetic-${n}`,status,JSON.stringify({sanitizedText:"Consulta sintética",envelope:{sanitizedText:"Consulta sintética"}}),JSON.stringify({providerModels:["old-synthetic"],privacy_checks:[],outputDiagnostics:{outputStage:"final_model_privacy"}})]);return id(n);};
  const a=await connect("service_role"),b=await connect("service_role"),anon=await connect("anon"),authenticated=await connect("authenticated");
  const original=await seed(10),originalBytes=(await db.query("select row_to_json(c)::text bytes from public.shadow_historical_replay_cases c where id=$1",[original])).rows[0].bytes;
  for(const [n,status] of ["pending","running","completed","not_evaluable"].entries()){const c=await seed(20+n,status);await reject(`reject original ${status}`,()=>rpc(a,c),/replay_retry_requires_error/);}
  for(const user of [id(2),id(3),id(4)]) await reject(`reject actor ${user.slice(-1)}`,()=>rpc(a,original,null,user),/admin_required/);
  for(const [label,role] of [["anon",anon],["authenticated",authenticated]]){await reject(`${label} cannot create`,()=>rpc(role,original),/permission denied/);await reject(`${label} cannot read attempts`,()=>role.query("select * from public.shadow_historical_replay_attempts"),/permission denied/);}
  await reject("service cannot insert bypass RPC",()=>a.query("insert into public.shadow_historical_replay_attempts(case_id,attempt_number,authorized_by,authorization_kind) values($1,2,$2,'explicit_admin_retry')",[original,id(1)]),/permission denied/);
  // Real independent transactions: A holds original lock; B must wait, not run serially.
  await a.query("begin");const first=await rpc(a,original);let finished=false;
  const secondPromise=rpc(b,original).then(result=>{finished=true;return result;});
  let blocked=false;
  for(let i=0;i<40;i++){const r=await db.query("select $1::int = any(pg_blocking_pids($2::int)) blocked",[a.processID,b.processID]);if(r.rows[0].blocked){blocked=true;break;}await new Promise(ok=>setTimeout(ok,25));}
  check("worker B blocked by A (pg_blocking_pids)",()=>{assert.equal(blocked,true);assert.equal(finished,false);});
  await a.query("commit");const second=await secondPromise;
  check("concurrent creation idempotent: one child",()=>{assert.equal(first.created,true);assert.equal(second.created,false);assert.equal(second.id,first.id);});
  const childRow=(await db.query("select * from public.shadow_historical_replay_attempts where id=$1",[first.id])).rows[0];
  check("child metadata and empty own telemetry",()=>{assert.equal(childRow.attempt_number,2);assert.equal(childRow.authorized_by,actor.id);assert.equal(childRow.result_safe,null);assert.equal(childRow.input_tokens,null);});
  await reject("root evidence cannot be reset",()=>a.query("update public.shadow_historical_replay_cases set status='pending' where id=$1",[original]),/replay_original_evidence_immutable/);
  await reject("pending child cannot retry",()=>rpc(a,original,first.id),/replay_retry_requires_error/);
  // Hold the first claim uncommitted: the independent second claim must wait.
  const claimSql="update public.shadow_historical_replay_attempts set status='running' where id=$1 and status='pending' returning id";
  await a.query("begin");const firstClaim=await a.query(claimSql,[first.id]);
  const secondClaimPromise=b.query(claimSql,[first.id]);let claimBlocked=false;
  for(let i=0;i<40;i++){const r=await db.query("select $1::int = any(pg_blocking_pids($2::int)) blocked",[a.processID,b.processID]);if(r.rows[0].blocked){claimBlocked=true;break;}await new Promise(ok=>setTimeout(ok,25));}
  check("execution claim B blocked by A",()=>assert.equal(claimBlocked,true));
  await a.query("commit");const secondClaim=await secondClaimPromise;
  check("concurrent execute claims only once",()=>{assert.equal(firstClaim.rowCount,1);assert.equal(secondClaim.rowCount,0);});
  await reject("running child cannot retry",()=>rpc(a,original,first.id),/replay_retry_requires_error/);
  await a.query("update public.shadow_historical_replay_attempts set status='error',result_safe=$2,error_code='synthetic-child-error',input_tokens=12,output_tokens=3,completed_at=now() where id=$1",[first.id,JSON.stringify({privacy_checks:[],providerModels:["child-synthetic"]})]);
  const failedChildBytes=(await db.query("select row_to_json(a)::text bytes from public.shadow_historical_replay_attempts a where id=$1",[first.id])).rows[0].bytes;
  await reject("terminal child cannot reset/overwrite",()=>a.query("update public.shadow_historical_replay_attempts set status='pending' where id=$1",[first.id]),/replay_attempt_immutable/);
  const stale=await rpc(a,original);check("stale original click never creates another child",()=>assert.equal(stale.id,first.id));
  const third=await rpc(a,original,first.id);check("explicit child error retry links attempt 3",()=>assert.equal(third.attemptNumber,3));
  const childAfterRetry=(await db.query("select row_to_json(a)::text bytes from public.shadow_historical_replay_attempts a where id=$1",[first.id])).rows[0].bytes;
  check("previous child evidence remains byte-for-byte identical",()=>assert.equal(childAfterRetry,failedChildBytes));
  const other=await seed(40);await reject("cross-case parent rejected",()=>rpc(a,other,first.id),/replay_parent_not_found/);
  await reject("service cannot change audit metadata",()=>a.query("update public.shadow_historical_replay_attempts set authorized_by=$2 where id=$1",[third.id,id(2)]),/permission denied/);
  await reject("service cannot delete attempts",()=>a.query("delete from public.shadow_historical_replay_attempts where id=$1",[third.id]),/permission denied/);
  const endpointCase=await seed(50),api=endpoint(a);
  const prepared=await api({action:"prepare_retry",caseId:endpointCase,authorization:"explicit_admin_retry"});
  check("real endpoint+Postgres creation: no provider",()=>{assert.equal(prepared.statusCode,201);assert.equal(providerCalls,0);});
  const completed=await api({action:"execute_one",caseId:endpointCase,attemptId:prepared.body.attemptId});
  check("real endpoint persists only synthetic child's result",()=>{assert.equal(completed.statusCode,200);assert.equal(providerCalls,1);});
  await reject("completed child cannot retry",()=>rpc(a,endpointCase,prepared.body.attemptId),/replay_retry_requires_error/);
  const get=await api(null,"GET"),root=get.body.cases.find(r=>r.id===endpointCase);
  check("GET separates root error from completed child",()=>{assert.equal(root.status,"error");assert.equal(root.result_safe.providerModels[0],"old-synthetic");assert.equal(root.attempts[0].status,"completed");assert.equal(root.attempts[0].input_tokens,7);assert.deepEqual(root.attempts[0].result_safe.providerModels,["synthetic-only"]);});
  const finalOriginalBytes=(await db.query("select row_to_json(c)::text bytes from public.shadow_historical_replay_cases c where id=$1",[original])).rows[0].bytes;
  check("original bytes remain identical",()=>assert.equal(finalOriginalBytes,originalBytes));
  const privilege=(await db.query("select relrowsecurity from pg_class where oid='public.shadow_historical_replay_attempts'::regclass")).rows[0];
  check("RLS enabled",()=>assert.equal(privilege.relrowsecurity,true));
  console.log(JSON.stringify({scope:"local isolated PostgreSQL (not Supabase DEV/Production)",results,checks:results.length,provider:"synthetic executor only; no network model",originalEvidence:"byte-for-byte intact",concurrency:"independent connections; B blocked by A; one child and one execution claim"},null,2));
}finally{
  for(const c of clients){try{await c.query("rollback");}catch{}try{await c.end();}catch{}}
  await cluster.stop();
  await assert.rejects(access(join(directory,"data")),{code:"ENOENT"});
  await rmdir(directory);
  console.log("LOCAL_SYNTHETIC_CLUSTER_STOPPED_AND_REMOVED");
}
