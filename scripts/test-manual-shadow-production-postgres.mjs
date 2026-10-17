// NATIVE LOCAL SANDBOX ONLY. No .env, real Auth, network provider or Supabase.
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
import {bootstrap,nativeAdapter} from '../tests/helpers/manualProductionPostgres.mjs';
import {productionEnv} from '../tests/helpers/manualProductionFixture.mjs';
import {manualDecision,syntheticResponse} from '../tests/helpers/manualTurnFixture.mjs';
import {manualMessageRef,loadManualTurn} from '../lib/shadow/ai/manualTurn.js';
import {authorizeManualProductionTurn as authorize,executeManualProductionTurn as execute,readManualProductionTurn as read,closeManualProductionTurn as close} from '../lib/shadow/ai/manualTurnProduction.js';
import {manualProductionGates} from '../lib/shadow/ai/manualTurnContext.js';
import {createManualTurnHandler} from '../lib/shadow/ai/manualTurnApi.js';
const runtime=process.env.MANUAL_LOCAL_PG_RUNTIME;if(!runtime)throw Error('local_runtime_required');
const {default:EmbeddedPostgres}=await import(pathToFileURL(resolve(runtime,'node_modules/embedded-postgres/dist/index.js')));
const {default:pg}=await import(pathToFileURL(resolve(runtime,'node_modules/pg/lib/index.js')));
globalThis.fetch=()=>{throw Error('all_external_fetch_forbidden_in_sandbox');};
const directory=await mkdtemp(join(tmpdir(),'manual-prod-pg-')),socket=net.createServer();
await new Promise(ok=>socket.listen(0,'127.0.0.1',ok));const port=socket.address().port;await new Promise(ok=>socket.close(ok));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,'data'),user:'postgres',password:'local-only',port,persistent:false,postgresFlags:['-c','listen_addresses=127.0.0.1','-c',`unix_socket_directories=${directory}`],onLog(){},onError(){}});
const clients=[],databases=[],checks=[],scenarios=[];let activeDb=null;
const pass=name=>checks.push(name);
const connect=async(database='postgres',role)=>{const c=new pg.Client({host:'127.0.0.1',port,user:'postgres',password:'local-only',database,statement_timeout:6000});await c.connect();clients.push(c);if(role)await c.query('set role '+role);return c;};
const file=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const off={...productionEnv,SHADOW_MANUAL_TURN_PRODUCTION_ENABLED:'false'};
const headers={host:'app.emporioinmobiliario.com.mx',origin:'https://app.emporioinmobiliario.com.mx','x-forwarded-proto':'https'};
let root;
async function fixture(name,text='Hay una fuga.'){
 const database='manual_prod_'+name;await root.query('create database '+database);databases.push(database);
 const owner=await connect(database);await owner.query(bootstrap);
 await owner.query(await file('supabase/migrations/202608220001_fase_2a_shadow_ai_manual_authorizations.sql'));
 await owner.query(await file('supabase/migrations/20260929165153_manual_shadow_prod_one_turn.sql'));
 await owner.query(await file('supabase/production/tests/manual_shadow_prod_one_turn_checks.sql'));
 const actor={id:randomUUID(),role_id:'admin',active:true},other=randomUUID(),message=randomUUID(),conversation=randomUUID();
 await owner.query("insert into profiles values($1,'admin',true),($2,'asesor',true)",[actor.id,other]);
 await owner.query("insert into shadow_conversations values($1,'respond_admin','544519','123456')",[conversation]);
 await owner.query("insert into shadow_messages values($1,$2,'respond_admin','inbound',clock_timestamp()-interval '10 minutes',$3,'[]','{}','manual-turn-captured')",[message,conversation,text]);
 const service=await connect(database,'service_role'),db=nativeAdapter(service);activeDb=db;
 return {database,owner,service,db,actor,other,message,messageRef:manualMessageRef(message)};
}
async function api(f,env,action,ref,options={},actor=f.actor,customHeaders=headers){
 const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.value=v;}};
 // Synthetic Auth assertion; profile is still checked server-side in each RPC.
 const authorizeProfile=async()=>{const r=await f.service.query('select * from profiles where id=$1',[actor.id]);return r.rows[0];};
 const handler=createManualTurnHandler({authorize:authorizeProfile,createAdmin:()=>f.db,env,executionOptions:options});
 const req=action==='get'?{method:'GET',headers:customHeaders,query:{authorizationRef:ref}}:
 {method:'POST',headers:customHeaders,body:{action,...(action==='authorize'?{messageRef:ref}:{authorizationRef:ref})}};
 await handler(req,res);return res;
}
async function race(f,a,b,first,second,label){
 await a.query('begin');const won=await first();let done=false;
 const waiting=second().then(value=>{done=true;return {value};},error=>{done=true;return {error};});
 let blocked=false;
 for(let i=0;i<75;i++){if((await f.owner.query('select $1::int=any(pg_blocking_pids($2::int)) blocked',[a.processID,b.processID])).rows[0].blocked){blocked=true;break;}await new Promise(ok=>setTimeout(ok,10));}
 assert.equal(blocked,true,label+' actual blocking');assert.equal(done,false);
 await a.query('commit');const lost=await waiting;pass(label+' B blocked by A on independent connections');return {won,lost};
}
try {
 await cluster.initialise();await cluster.start();root=await connect();
 await root.query('create role anon;create role authenticated;create role service_role bypassrls;');
 const f=await fixture('concurrency');pass('additive production artifact and read-only catalog checks PASS on native sandbox');
 const b=await connect(f.database,'service_role'),anon=await connect(f.database,'anon'),user=await connect(f.database,'authenticated');
 const input=await loadManualTurn(f.db,f.messageRef,productionEnv,'shadow_manual_prod_turn_message_refs');
 const params=[f.message,f.actor.id,input.turn.turnKey,input.fingerprint,JSON.stringify(input.snapshot),'claude-haiku-4-5-20251001',productionEnv.VERCEL_GIT_COMMIT_SHA,productionEnv.VERCEL_DEPLOYMENT_ID,JSON.stringify(manualProductionGates(productionEnv))];
 const auth=c=>c.query('select authorize_manual_shadow_prod_turn($1,$2,$3,$4,$5,$6,$7,$8,$9) result',params).then(r=>r.rows[0].result);
 for(const c of [anon,user]){await assert.rejects(()=>auth(c),/permission denied/);await assert.rejects(()=>c.query('select * from shadow_manual_prod_turn_control'),/permission denied/);}pass('RLS/ACL deny unauthorized role reads and RPC execution');
 const bad=[...params];bad[1]=f.other;await assert.rejects(()=>f.service.query('select authorize_manual_shadow_prod_turn($1,$2,$3,$4,$5,$6,$7,$8,$9)',bad),/admin_required/);pass('service invocation rechecks active admin profile');
 let r=await race(f,f.service,b,()=>auth(f.service),()=>auth(b),'authorize global');
 const id=r.won.authorization_id;assert.equal(r.lost.value.authorization_id,id);assert.equal(r.lost.value.created,false);
 const changed=[...params];changed[3]='c'.repeat(64);await assert.rejects(()=>b.query('select authorize_manual_shadow_prod_turn($1,$2,$3,$4,$5,$6,$7,$8,$9)',changed),/pilot_exists/);pass('different pilot/snapshot cannot bypass lifetime singleton');
 const claim=c=>c.query('select claim_manual_shadow_prod_turn($1,$2,$3,$4,$5) result',[id,f.actor.id,input.fingerprint,params[6],params[7]]).then(r=>r.rows[0].result);
 r=await race(f,f.service,b,()=>claim(f.service),()=>claim(b),'claim');
 const run=r.won.run_id;assert.equal(r.lost.value.run_id,run);assert.equal(r.lost.value.claimed,false);pass('one authorization links exactly one run');
 await f.service.query("update shadow_ai_runs set execution_state='model_round_running' where id=$1",[run]);
 const reserve=(c,n)=>c.query('select reserve_manual_shadow_prod_round($1,$2,$3,$4,$5,$6,$7) result',[id,f.actor.id,run,n,input.fingerprint,params[6],params[7]]).then(r=>r.rows[0].result);
 r=await race(f,f.service,b,()=>reserve(f.service,1),()=>reserve(b,1),'reserve');assert.match(r.lost.error.message,/reservation_reused/);
 await f.service.query('update shadow_ai_runs set current_round=1 where id=$1',[run]);await reserve(f.service,2);
 await assert.rejects(()=>reserve(b,3),/transmission_limit/);await assert.rejects(()=>reserve(b,2),/reservation_reused/);pass('max two reservations; ambiguous/consumed reservation cannot repeat');
 for(const [column,value] of [['runtime_sha','b'.repeat(40)],['source_fingerprint','d'.repeat(64)],['deployment_id','dpl_DifferentRuntimeOnly']])await assert.rejects(()=>f.service.query('update shadow_manual_prod_turn_control set '+column+'=$1',[value]),/immutable/);
 await assert.rejects(()=>f.service.query('update shadow_manual_prod_turn_control set reserved_transmissions=0'),/immutable/);pass('runtime/turn/fingerprint/reservation immutable');
 const action=(await f.service.query("insert into shadow_conversation_actions(ai_run_id,turn_key,status) values($1,$2,'proposed') returning id",[run,input.turn.turnKey])).rows[0].id;
 for(const status of ['approved_for_future_auto','sent'])await assert.rejects(()=>f.service.query('update shadow_conversation_actions set status=$1 where id=$2',[status,action]),/outbound_forbidden/);
 await assert.rejects(()=>f.service.query('update shadow_conversation_actions set ai_run_id=null where id=$1',[action]),/immutable/);
 await assert.rejects(()=>f.service.query('insert into shadow_admin_outbound_messages(conversation_action_id) values($1)',[action]),/outbound_forbidden/);
 await assert.rejects(()=>f.service.query("update shadow_ai_runs set telemetry_json='{}' where id=$1",[run]),/immutable/);pass('persistent linkage blocks promotion, reassignment, telemetry bypass and legacy sender');
 await close(f.db,id.replaceAll('-',''),f.actor,off);
 await assert.rejects(()=>reserve(b,2),/closed/);await assert.rejects(()=>auth(b),/not_renewable/);
 await assert.rejects(()=>f.service.query('update shadow_manual_prod_turn_control set closed_at=null'),/immutable/);
 await assert.rejects(()=>f.service.query('delete from shadow_manual_prod_turn_control'),/permission denied/);await assert.rejects(()=>f.owner.query('truncate shadow_manual_prod_turn_control'),/evidence_preserved/);pass('gate-OFF close monotonic; no delete/truncate/recreation');
 const legacy=(await f.owner.query("insert into shadow_ai_runs(status,prompt_version) values('running','legacy') returning id")).rows[0].id;
 await f.owner.query('grant select,update on shadow_ai_runs to authenticated');await user.query("update shadow_ai_runs set status='completed' where id=$1",[legacy]);pass('private-control trigger does not break unrelated role-authorized operations');
 for(const name of ['happy','silence','tools','invalid','privacy','http','timeout','partial','closed']){
   const f=await fixture(name,name==='silence'?'Gracias.':'Hay una fuga.'),created=await api(f,productionEnv,'authorize',f.messageRef);
   assert.equal(created.code,201,JSON.stringify(created.value));const ref=created.value.authorizationRef;let n=0;
   const snapshot=(await f.owner.query('select input_snapshot from shadow_manual_prod_turn_control')).rows[0].input_snapshot;
   const options={fetchImpl:async(_url,{body,signal})=>{
     n++;const context=JSON.parse(JSON.parse(body).messages[0].content);assert.doesNotMatch(body,/123456|synthetic-captured/);
     if(name==='timeout')return new Promise((_ok,reject)=>signal.addEventListener('abort',()=>reject(Error('synthetic timeout')),{once:true}));
     if(name==='http')return {ok:false,status:400,headers:{get:()=>null},json:async()=>({error:{type:'invalid_request_error',message:'synthetic unknown'}})};
     if(name==='invalid')return syntheticResponse({invalid:true});
     const d=structuredClone(manualDecision);
     if(name==='privacy')d.proposedToolCalls=[{tool:'resolve_contact_identity',arguments:[{key:'respondContactId',value:'unissued'}],reason:'Consulta'}];
     if(name==='tools'&&n===1)d.proposedToolCalls=[{tool:'resolve_contact_identity',arguments:[{key:'respondContactId',value:context.metadata.respondContactId}],reason:'Consultar identidad'}];
     if(name==='silence')Object.assign(d,{intent:'no_determinado',conversationalResponseParts:{acknowledgement:'Gracias.',verifiedFactReferences:[],clarificationQuestion:null,escalationMessage:null}});
     if(name==='closed')await close(f.db,ref,f.actor,off);
     return syntheticResponse(d);
   },...(name==='partial'?{persistManualAction:async()=>{throw Error('synthetic_3b_fault');}}:{})};
   const env={...productionEnv,...(name==='timeout'?{SHADOW_AI_ANTHROPIC_ATTEMPT_TIMEOUT_MS:'15'}:{})};
   const response=await api(f,env,'execute',ref,options);assert.equal(response.code,200,JSON.stringify(response.value));const result=response.value;
   if(['happy','silence','tools'].includes(name)){assert.equal(result.certified,true,JSON.stringify({result,errors:f.db.errors}));assert.equal(result.status,'completed');}
   else {assert.equal(result.certified,false);assert.equal(result.status,name==='timeout'?'timeout':'error');assert.equal(result.conversation_action_persisted,false);}
   if(name==='happy')assert.equal(result.conversation_action.conversation_action,'ask_missing_information');
   if(name==='silence')assert.equal(result.conversation_action.conversation_action,'no_message');
   if(name==='tools'){assert.equal(n,2);assert.ok(result.telemetry.tools.some(t=>t.name==='resolve_contact_identity'&&t.ok));}
   if(name==='partial')assert.equal(result.operational_resolution_persisted,true);
   for(const round of result.telemetry.rounds){assert.equal(round.receipt.final_payload_verified,true);assert.equal(round.receipt.serialized_body_verified,true);assert.equal(round.receipt.provider_invoked,true);}
   assert.ok(result.closed_at);assert.equal(result.reserved_transmissions,n);
   const reload=await api(f,off,'get',ref);assert.equal(reload.code,200);assert.equal(reload.value.status,result.status);assert.deepEqual(reload.value.telemetry,result.telemetry);
   const duplicate=await api(f,env,'execute',ref,options);assert.equal(duplicate.value.duplicate,true);assert.equal(n,result.reserved_transmissions);
   assert.equal((await f.owner.query('select count(*)::int n from shadow_ai_runs')).rows[0].n,1);
   assert.deepEqual((await f.owner.query('select input_snapshot from shadow_manual_prod_turn_control')).rows[0].input_snapshot,snapshot);
   for(const table of ['respond_identity_audit','shadow_admin_outbound_messages'])assert.equal((await f.owner.query('select count(*)::int n from '+table)).rows[0].n,0);
   assert.ok(f.db.writes.every(w=>['shadow_ai_runs','shadow_ai_decisions','shadow_conversation_actions'].includes(w.table)));
   scenarios.push({scenario:name,status:result.status,certified:result.certified,reservations:result.reserved_transmissions,
     closed:Boolean(result.closed_at),telemetry:result.telemetry,decision_persisted:result.decision_persisted,
     operational_resolution_persisted:result.operational_resolution_persisted,conversation_action_persisted:result.conversation_action_persisted,
     conversation_action:result.conversation_action?.conversation_action||null,message_safe:result.conversation_action?.message_safe??null,
     original_snapshot_unchanged:true,runs:1,duplicate_rejected_without_provider:true,identity_mutations:0,outbound:0});
   pass(name+': native persistence, receipts/readback, singleton/no retry, closed OFF, no side writes');
   if(name==='happy'){
     assert.equal((await api(f,off,'get',ref,{}, {...f.actor,id:f.other})).code,403);
     assert.equal((await api(f,off,'get',ref,{},f.actor,{...headers,origin:'https://evil.example'})).code,403);
     assert.equal((await api(f,{...off,VERCEL_ENV:'preview'},'get',ref)).code,409);
     pass('API rejects non-admin, wrong origin, Preview; canonical GET works OFF');
   }
 }
} catch(error){process.exitCode=1;console.error(JSON.stringify({result:'FAIL',code:error.code||null,message:String(error.message).slice(0,1800),sandboxDbDiagnostics:activeDb?.errors?.map(x=>({table:x.table,rpc:x.rpc,code:x.code,category:x.category})).slice(-5)}));}
finally {
 for(const c of clients){await c.query('rollback').catch(()=>{});if(c!==root)await c.end().catch(()=>{});}
 if(root){for(const database of databases)await root.query('drop database '+database);assert.equal((await root.query("select count(*)::int n from pg_database where datname like 'manual_prod_%'")).rows[0].n,0);pass('all owned sandbox databases dropped; zero remaining fixtures');await root.end();}
 await cluster.stop();
 console.log(JSON.stringify({environment:'disposable local PostgreSQL sandbox',auth:'synthetic assertion + real profile/RPC checks',provider:'synthetic transport only',production:false,result:process.exitCode?'FAIL':'PASS',checks,scenarios}));
}
