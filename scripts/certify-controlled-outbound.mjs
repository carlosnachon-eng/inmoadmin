// Synthetic isolated PostgreSQL fixture: no secrets, network sender or model.
import {readFile,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import net from 'node:net';
export const fixtureSQL=`
create table meta_admin_private.inbound_inputs(id uuid primary key,waba_id text,phone_number_id text,native_message_id text,occurred_at timestamptz,
 meta_observer_event_id uuid,sender_ciphertext jsonb,sender_ref text,exact_phone_digest text,sender_evidence text);
create table meta_admin_private.shadow_once_runs(input_id uuid primary key,status text,identity_state text,provider text,model text,model_calls int,
 send_calls int,input_fingerprint text,proposed_response text);
create table public.meta_observer_events(id uuid primary key,event_key text,native_message_id text,waba_id text,phone_number_id text,category text,state text,observer_only boolean,status text);
insert into meta_admin_private.inbound_inputs values('00000000-0000-4000-8000-000000000001','1297760461811288','1198305790026665','wamid.fixtureInbound',clock_timestamp(),null,'{}',repeat('a',64),repeat('b',64),'signed_from');
insert into meta_admin_private.shadow_once_runs values('00000000-0000-4000-8000-000000000001','complete','matched','openai','gpt-6-luna',1,0,repeat('c',64),'Recibimos tu mensaje.');
`;
export const assertionsSQL=`
do $cert$
declare i uuid:='00000000-0000-4000-8000-000000000001';t uuid:='00000000-0000-4000-8000-000000000002';p text:=encode(sha256(convert_to('Recibimos tu mensaje.','UTF8')),'hex'); n int;
begin
 if not (select relrowsecurity from pg_class where oid='meta_admin_private.controlled_outbound_runs'::regclass) then raise exception 'rls_missing';end if;
 if has_table_privilege('service_role','meta_admin_private.controlled_outbound_runs','UPDATE') or has_table_privilege('anon','meta_admin_private.controlled_outbound_runs','SELECT') then raise exception 'table_acl';end if;
 for n in 1..2 loop
   if has_function_privilege(case when n=1 then 'anon' else 'authenticated' end,'public.meta_admin_outbound_start_v1(uuid,uuid)','EXECUTE') then raise exception 'rpc_acl';end if;
 end loop;
 if not has_function_privilege('service_role','public.meta_admin_outbound_start_v1(uuid,uuid)','EXECUTE') then raise exception 'service_acl';end if;
 if public.meta_admin_outbound_reserve_v1(i,t,repeat('c',64),repeat('d',64),repeat('e',64)) then raise exception 'wrong_proposal_allowed';end if;
 if not public.meta_admin_outbound_reserve_v1(i,t,repeat('c',64),p,repeat('e',64)) then raise exception 'claim_failed';end if;
 if public.meta_admin_outbound_reserve_v1(i,gen_random_uuid(),repeat('c',64),p,repeat('e',64)) then raise exception 'duplicate_claim';end if;
 if public.meta_admin_outbound_finish_v1(i,t,'accepted','wamid.fixtureSent') then raise exception 'premature_finish';end if;
 if public.meta_admin_outbound_start_v1(i,gen_random_uuid()) then raise exception 'wrong_token';end if;
 if not public.meta_admin_outbound_start_v1(i,t) then raise exception 'start_failed';end if;
 if public.meta_admin_outbound_start_v1(i,t) then raise exception 'second_start';end if;
 if public.meta_admin_outbound_finish_v1(i,t,'reserved',null) then raise exception 'reset_allowed';end if;
 if not public.meta_admin_outbound_finish_v1(i,t,'accepted','wamid.fixtureSent') then raise exception 'finish_failed';end if;
 if public.meta_admin_outbound_finish_v1(i,t,'failed',null) then raise exception 'terminal_changed';end if;
 if (public.meta_admin_outbound_status_v1(i)->>'sent')::boolean then raise exception 'accepted_is_not_sent';end if;
 insert into public.meta_observer_events values(gen_random_uuid(),'fixture-read','wamid.fixtureSent','1297760461811288','1198305790026665','status','observed',true,'read');
 insert into public.meta_observer_events values(gen_random_uuid(),'fixture-sent','wamid.fixtureSent','1297760461811288','1198305790026665','status','observed',true,'sent');
 insert into public.meta_observer_events values(gen_random_uuid(),'fixture-other','wamid.other','1297760461811288','1198305790026665','status','observed',true,'failed');
 if not (public.meta_admin_outbound_status_v1(i)->>'read')::boolean or (public.meta_admin_outbound_status_v1(i)->>'failed')::boolean then raise exception 'status_correlation';end if;
end $cert$;
set local role service_role;
do $acl$ begin
 begin update meta_admin_private.controlled_outbound_runs set send_calls=0;raise exception 'direct_write_allowed';exception when insufficient_privilege then null;end;
end $acl$;
reset role;
select 'PASS' as journal_checks,0 as models,0 as real_sends;
`;
const sql=await readFile(new URL('./sql/meta-admin-controlled-outbound.sql',import.meta.url),'utf8');
export const sqlHash=createHash('sha256').update(sql).digest('hex');
// DEV clone is isolated from all real source tables and rolled back. Only schema/
// function identifiers are mapped; SQL logic and constraints are unchanged.
export const devSQL=('begin;create schema outbound_cert_private;grant usage on schema outbound_cert_private to service_role;'+fixtureSQL+
 sql.replace(/^begin;$/m,'').replace(/^commit;$/m,'')+assertionsSQL+'rollback;')
 .replaceAll('meta_admin_private','outbound_cert_private').replaceAll('public.meta_observer_events','outbound_cert_private.fixture_events')
 .replaceAll('public.meta_admin_outbound_','public.cert_meta_admin_outbound_');
if(process.argv.includes('--print-dev')){console.log(devSQL);}
else if(process.argv.includes('--local')){
 const runtime=process.env.CONTROLLED_LOCAL_PG_RUNTIME;if(!runtime)throw Error('local_runtime_required');
 const {default:EmbeddedPostgres}=await import(pathToFileURL(resolve(runtime,'node_modules/embedded-postgres/dist/index.js')));
 const {default:pg}=await import(pathToFileURL(resolve(runtime,'node_modules/pg/lib/index.js')));
 const dir=await mkdtemp(join(tmpdir(),'controlled-outbound-pg-')),sock=net.createServer();
 await new Promise(ok=>sock.listen(0,'127.0.0.1',ok));const port=sock.address().port;await new Promise(ok=>sock.close(ok));
 const cluster=new EmbeddedPostgres({databaseDir:join(dir,'data'),user:'postgres',password:'local-only',port,persistent:false,
 postgresFlags:['-c','listen_addresses=127.0.0.1','-c',`unix_socket_directories=${dir}`],onLog(){},onError(){}});
 const clients=[];const connect=async()=>{const c=new pg.Client({host:'127.0.0.1',port,user:'postgres',password:'local-only',database:'postgres'});await c.connect();clients.push(c);return c;};
 try{
  await cluster.initialise();await cluster.start();const db=await connect();
  await db.query('create role service_role bypassrls;create role anon;create role authenticated;');
  await db.query(devSQL);
  const clean=await db.query("select count(*)::int n from pg_namespace where nspname='outbound_cert_private'");
  if(clean.rows[0].n!==0)throw Error('cleanup_failed');
  // Exact schema/SQL, then simultaneous independent transactions for the claim.
  await db.query('create schema meta_admin_private;grant usage on schema meta_admin_private to service_role;'+fixtureSQL);
  await db.query(sql);const a=await connect(),b=await connect();
  const claim="select public.meta_admin_outbound_reserve_v1('00000000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('c',64),encode(sha256(convert_to('Recibimos tu mensaje.','UTF8')),'hex'),repeat('e',64)) won";
  const results=await Promise.all([a.query(claim),b.query(claim)]);
  if(results.filter(r=>r.rows[0].won).length!==1)throw Error('concurrent_claim_failed');
  console.log(JSON.stringify({result:'PASS',sql_sha256:sqlHash,acl_rls_transitions_replay_status:true,concurrent_winners:1,dev_clone_cleanup:0,models:0,real_sends:0}));
 }finally{for(const c of clients)await c.end().catch(()=>{});await cluster.stop().catch(()=>{});}
}
