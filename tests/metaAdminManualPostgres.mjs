// Disposable LOCAL PostgreSQL, synthetic sources; never reads remote credentials.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import {tmpdir} from 'node:os';
assert.ok(path.isAbsolute(process.env.META_CAPTURE_TEST_DEPS||''));
const require=createRequire(path.join(process.env.META_CAPTURE_TEST_DEPS,'test.cjs'));
const EmbeddedPostgres=require('embedded-postgres').default,{Client}=require('pg');
const directory=await mkdtemp(path.join(tmpdir(),'meta-manual-pg-'));
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const password=randomBytes(24).toString('hex'),config={host:'127.0.0.1',port,user:'postgres',password,database:'postgres'};
const server=new EmbeddedPostgres({databaseDir:path.join(directory,'db'),port,user:'postgres',password,persistent:false,postgresFlags:['-h','127.0.0.1','-k',directory],onLog(){},onError(){}});
let c,c2,checks=0;
const ok=(v)=>{assert.ok(v);checks++;};
try{
 await server.initialise();await server.start();c=new Client(config);c2=new Client(config);await c.connect();await c2.connect();
 await c.query(`create role anon;create role authenticated;create role service_role;create schema meta_admin_private;
 create table public.profiles(id uuid primary key,active boolean,role_id text);
 create table public.meta_observer_admin_scope(waba_id text,phone_number_id text,respond_channel_id text,enabled boolean);
 insert into public.meta_observer_admin_scope values('1297760461811288','1198305790026665','544519',true);
 create table public.meta_observer_events(id uuid primary key,event_key text,native_message_id text,waba_id text,phone_number_id text,category text,source_field text,event_type text,observer_only boolean,state text,error_codes text[],received_at timestamptz,occurred_at timestamptz,message_type text,original_message_id text,status text);
 create table meta_admin_private.inbound_inputs(id uuid primary key,meta_observer_event_id uuid,native_message_id text,waba_id text,phone_number_id text,sender_ref text,captured_at timestamptz,occurred_at timestamptz,sanitized_text text,sender_ciphertext jsonb,exact_phone_digest text,sender_evidence text);
 create table meta_admin_private.native_subject_evidence(meta_observer_event_id uuid,subject_ref text,key_tag text,evidence_state text,evidence_source text);
 create table meta_admin_private.shadow_once_runs(input_id uuid primary key,model_calls int default 0,media_model_calls int default 0);
 create table meta_admin_private.controlled_outbound_runs(input_id uuid primary key,status text,send_calls int default 0);
 create function public.meta_admin_memory_evidence_v1(uuid) returns jsonb language sql as $$select jsonb_build_object('native_verified',true,'scope_verified',true,'subject_ref',i.sender_ref,'key_tag',s.key_tag,'audience',case when i.sender_ref='staff' then 'internal' else 'unknown' end) from meta_admin_private.inbound_inputs i join meta_admin_private.native_subject_evidence s on s.meta_observer_event_id=i.meta_observer_event_id where i.id=$1$$;`);
 await c.query(await readFile(new URL('../supabase/migrations/20261009150550_meta_admin_inbox_manual.sql',import.meta.url),'utf8'));
 const actor=randomUUID(),outsider=randomUUID();await c.query("insert into profiles values($1,true,'admin'),($2,true,'sales')",[actor,outsider]);
 const ids=Array.from({length:5},()=>randomUUID());
 for(let n=0;n<5;n++){
  const subject=n===2?'staff':n>=3?'race'+n:'subject';
  await c.query(`insert into meta_observer_events values($1,'fixture',$2,'1297760461811288','1198305790026665','inbound','messages','message.received',true,'observed','{}',now(),now(),'text',null,null)`,[ids[n],'wamid.fixture'+n]);
  await c.query(`insert into meta_admin_private.inbound_inputs values($1,$1,$2,'1297760461811288','1198305790026665',$3,now(),now(),'Sintetico','{}','digest','signed_from')`,[ids[n],'wamid.fixture'+n,subject]);
  await c.query(`insert into meta_admin_private.native_subject_evidence values($1,$2,'key','exact','signed_from')`,[ids[n],subject]);
 }
 const q=async(sql,args=[],db=c)=>(await db.query(sql,args)).rows[0].x;
 const reserve='select public.meta_admin_manual_reserve_v1($1,$2,$3,$4,$5) x';
 const action=randomUUID(),token=randomUUID(),values=[ids[0],actor,action,token,'Hola.\nGracias.'];
 ok(await q('select public.meta_admin_manual_load_v1($1,$2) x',[ids[0],actor])); // unmatched/unknown audience, exact native proof
 ok(await q('select public.meta_admin_manual_load_v1($1,$2) x',[ids[0],outsider])===null);
 ok(await q('select public.meta_admin_manual_load_v1($1,$2) x',[ids[2],actor])===null);
 const wins=await Promise.all([q(reserve,values),q(reserve,[...values.slice(0,3),randomUUID(),values[4]],c2)]);
 ok(wins.filter(Boolean).length===1);
 // Winner's token is read ONLY in this disposable test DB, never application code.
 const won=await q('select token x from meta_admin_private.manual_actions where action_id=$1',[action]);
 ok(await q('select public.meta_admin_manual_attention_v1($1) x',[ids[1]])===true); // another inbound, same conversation
 const starts=await Promise.all([q('select public.meta_admin_manual_start_v1($1,$2) x',[action,won]),q('select public.meta_admin_manual_start_v1($1,$2) x',[action,won],c2)]);
 ok(starts.filter(Boolean).length===1);
 ok(await q('select public.meta_admin_manual_finish_v1($1,$2,$3,$4) x',[action,won,'accepted','wamid.result']));
 ok(!await q('select public.meta_admin_manual_finish_v1($1,$2,$3,$4) x',[action,won,'failed',null]));
 ok(!await q(reserve,values));
 let view=await q('select public.meta_admin_manual_status_v1($1,$2) x',[ids[0],actor]);ok(view.paused&&view.messages[0].status==='accepted');
 ok(!JSON.stringify(view).includes('wamid.'));ok(!JSON.stringify(view).includes('ciphertext'));
 for(const [status,wamid,waba] of [['read','wamid.other','1297760461811288'],['read','wamid.result','other'],['delivered','wamid.result','1297760461811288'],['read','wamid.result','1297760461811288'],['sent','wamid.result','1297760461811288']]){
  await c.query(`insert into meta_observer_events(id,waba_id,phone_number_id,native_message_id,category,source_field,state,observer_only,status) values($1,$2,'1198305790026665',$3,'status','messages','observed',true,$4)`,[randomUUID(),waba,wamid,status]);
  view=await q('select public.meta_admin_manual_status_v1($1,$2) x',[ids[0],actor]);
  ok(view.messages[0].status===(waba==='other'||wamid==='wamid.other'?'accepted':status==='delivered'?'delivered':'read'));
 }
 const uncertain=randomUUID(),ut=randomUUID();ok(await q(reserve,[ids[1],actor,uncertain,ut,'Otro mensaje sintético.']));
 ok(await q('select public.meta_admin_manual_start_v1($1,$2) x',[uncertain,ut]));
 ok(await q('select public.meta_admin_manual_finish_v1($1,$2,$3,$4) x',[uncertain,ut,'uncertain',null]));
 ok(!await q('select public.meta_admin_manual_start_v1($1,$2) x',[uncertain,ut]));
 ok(await q('select public.meta_admin_manual_attention_v1($1) x',[ids[1]]));
 await c.query('insert into meta_admin_private.shadow_once_runs(input_id) values($1)',[ids[1]]);
 await c.query("insert into meta_admin_private.controlled_outbound_runs(input_id,status) values($1,'reserved')",[ids[1]]);
 for(const sql of ['update meta_admin_private.shadow_once_runs set model_calls=1','update meta_admin_private.shadow_once_runs set media_model_calls=1','update meta_admin_private.controlled_outbound_runs set send_calls=1']){await assert.rejects(()=>c.query(sql),/meta_manual_attention_active/);checks++;}
 // Real overlapping transactions: manual reservation wins => AI cannot dispatch.
 await c.query("insert into meta_admin_private.controlled_outbound_runs(input_id,status) values($1,'reserved'),($2,'reserved')",[ids[3],ids[4]]);
 await c.query('begin');ok(await q(reserve,[ids[3],actor,randomUUID(),randomUUID(),'Reserva concurrente.']));
 const blockedAI=c2.query("update meta_admin_private.controlled_outbound_runs set send_calls=1,status='dispatch_started' where input_id=$1",[ids[3]])
  .then(()=>false,e=>/meta_manual_attention_active/.test(e.message));
 await c.query('select pg_sleep(0.03)');
 ok(await q("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event='advisory') x",[c2.processID]));
 await c.query('commit');ok(await blockedAI);
 // Reverse ordering: existing AI dispatch is not canceled or retried by a human send.
 await c.query('begin');await c.query("update meta_admin_private.controlled_outbound_runs set send_calls=1,status='dispatch_started' where input_id=$1",[ids[4]]);
 const blockedManual=q(reserve,[ids[4],actor,randomUUID(),randomUUID(),'No competir con dispatch.'],c2);
 await c.query('select pg_sleep(0.03)');await c.query('commit');ok(await blockedManual===false);
 for(const table of ['manual_actions','manual_events','manual_attention']){
  for(const op of ['update','delete']){await assert.rejects(()=>c.query(op==='delete'?`delete from meta_admin_private.${table}`:`update meta_admin_private.${table} set action_id=action_id`),/manual_history_immutable/);checks++;}
  ok(await q('select relrowsecurity x from pg_class where oid=$1::regclass',['meta_admin_private.'+table]));
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])ok(!await q('select has_table_privilege($1,$2,$3) x',[role,'meta_admin_private.'+table,privilege]));
 }
 const functions=(await c.query("select oid::regprocedure::text name from pg_proc where proname like 'meta_admin_manual_%'")).rows;
 ok(functions.length===6);
 for(const f of functions)for(const role of ['anon','authenticated','service_role'])ok(await q('select has_function_privilege($1,$2,\'EXECUTE\') x',[role,f.name])===(role==='service_role'));
 await c.query('set role service_role');ok((await q('select public.meta_admin_manual_status_v1($1,$2) x',[ids[0],actor])).paused);await assert.rejects(()=>c.query('select * from meta_admin_private.manual_actions'));checks++;await c.query('reset role');
 console.log(JSON.stringify({status:'PASS',checks,concurrency:'independent PostgreSQL sessions',source_evidence:'synthetic source fixtures + provenance stub',models:0,sends:0,business_writes:0}));
}finally{await c?.end();await c2?.end();await server.stop();await rm(directory,{recursive:true,force:true});console.log('cleanup=0 (disposable local cluster removed)');}
