import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const [socket,pgPath]=process.argv.slice(2);
assert.match(socket||'',/^\/private\/tmp\/admin-memory-pg\.[A-Za-z0-9]+$/);
const {default:pg}=await import(pathToFileURL(pgPath));
const clients=await Promise.all([0,1,2].map(async()=>{const c=new pg.Client({host:socket,port:55491,user:'postgres',database:'postgres'});await c.connect();return c;}));
const [c,a,b]=clients,passed=[];
const test=async(name,fn)=>{await fn();passed.push(name);};
const episode={id:'episode_'+'1'.repeat(32),subject:'subject_'+'a'.repeat(64),identityFingerprint:null,scope:{},family:'payments',topic:'payments',version:1,status:'open',pending:'verification',commitment:'none',contradiction:false,sourceRefs:['message_'+'1'.repeat(32)]};
const append=(client,e,version,source)=>client.query('select public.meta_admin_memory_append_v1($1,$2,$3) result',[e,version,source]).then(r=>r.rows[0].result);
try{
 await c.query('create role anon; create role authenticated; create role service_role bypassrls;');
 await c.query(await readFile(new URL('../scripts/sql/meta-admin-conversation-memory.sql',import.meta.url),'utf8'));
 await c.query(`create schema meta_admin_private;
 create table meta_admin_private.inbound_inputs(id uuid,meta_observer_event_id uuid,waba_id text,phone_number_id text,native_message_id text,sender_ref text,sender_evidence text,capture_reason text);
 create table meta_admin_private.native_subject_evidence(meta_observer_event_id uuid,subject_ref text,key_tag text,evidence_state text,evidence_source text);
 create table public.meta_observer_events(id uuid,native_message_id text,waba_id text,phone_number_id text,category text,event_type text,state text,observer_only boolean);
 create table public.meta_observer_admin_scope(waba_id text,phone_number_id text,respond_channel_id text,enabled boolean);`);
 await c.query(await readFile(new URL('../scripts/sql/meta-admin-conversation-memory-rpcs.sql',import.meta.url),'utf8'));
 for(const role of ['anon','authenticated','service_role'])await test(role+' direct access denied',async()=>{
  await a.query('set role '+role);await assert.rejects(a.query('select * from meta_admin_memory_private.episodes'),/permission denied/);await a.query('reset role');
 });
 for(const role of ['anon','authenticated'])await test(role+' all RPCs denied',async()=>{
  await a.query('set role '+role);
  for(const q of ["select public.meta_admin_memory_read_v1('x')","select public.meta_admin_memory_append_v1('{}',0,'x')","select public.meta_admin_memory_evidence_v1(null)"])
   await assert.rejects(a.query(q),/permission denied/);
  await a.query('reset role');
 });
 await a.query('set role service_role');await b.query('set role service_role');
 await test('service append and read',async()=>{
  assert.equal((await append(a,episode,0,episode.sourceRefs[0])).status,'appended');
  assert.equal((await b.query('select public.meta_admin_memory_read_v1($1) result',[episode.subject])).rows[0].result[0].version,1);
 });
 await test('idempotent retry',async()=>assert.equal((await append(a,episode,0,episode.sourceRefs[0])).status,'duplicate'));
 await test('conflicting retry',async()=>assert.rejects(append(a,{...episode,pending:'visit'},0,episode.sourceRefs[0]),/replay_conflict/));
 await test('same-source changed version denied',async()=>assert.rejects(append(a,{...episode,version:2},1,episode.sourceRefs[0]),/replay_conflict/));
 await test('concurrent CAS one winner',async()=>{
  const results=await Promise.allSettled([a,b].map((client,index)=>{const ref='message_'+String(index+2).repeat(32);return append(client,{...episode,version:2,sourceRefs:[...episode.sourceRefs,ref]},1,ref);}));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&/memory_stale/.test(x.reason.message)).length,1);
 });
 await test('scope immutable',async()=>assert.rejects(append(a,{...episode,subject:'subject_'+'b'.repeat(64)},0,episode.sourceRefs[0]),/scope_immutable/));
 await test('unknown input fields denied',async()=>assert.rejects(append(a,{...episode,sql:'select 1'},0,episode.sourceRefs[0]),/input_invalid/));
 await test('non-reference scope denied',async()=>assert.rejects(append(a,{...episode,scope:{phone:'private'}},0,episode.sourceRefs[0]),/scope_invalid/));
 await test('malformed source denied',async()=>assert.rejects(append(a,{...episode,sourceRefs:['private text']},0,episode.sourceRefs[0]),/sources_invalid/));
 await test('history append-only even owner',async()=>{
  await assert.rejects(c.query("update meta_admin_memory_private.revisions set pending='none'"),/append_only/);
  await assert.rejects(c.query('delete from meta_admin_memory_private.revisions'),/append_only/);
 });
 await test('RLS',async()=>assert.equal((await c.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='meta_admin_memory_private' and c.relkind='r' and c.relrowsecurity")).rows[0].n,2));
 await test('source evidence unknown despite exact signed native subject',async()=>{
  const id='11111111-1111-4111-8111-111111111111';
  await c.query(`insert into public.meta_observer_events values($1,'wamid.test','1297760461811288','1198305790026665','inbound','message.received','observed',true);
  `,[id]);
  await c.query("insert into meta_admin_private.inbound_inputs values($1,$1,'1297760461811288','1198305790026665','wamid.test',$2,'signed_from_and_wa_id','captured')",[id,'a'.repeat(64)]);
  await c.query("insert into meta_admin_private.native_subject_evidence values($1,$2,$3,'exact','signed_from')",[id,'a'.repeat(64),'b'.repeat(64)]);
  await c.query("insert into public.meta_observer_admin_scope values('1297760461811288','1198305790026665','544519',true)");
  const r=(await a.query('select public.meta_admin_memory_evidence_v1($1) result',[id])).rows[0].result;
  assert.equal(r.native_verified,true);assert.equal(r.scope_verified,true);assert.equal(r.audience,'unknown');assert.equal(r.history_authorized,false);assert.equal(r.human_authorized,false);
 });
 await c.query(`alter table meta_admin_private.inbound_inputs add column exact_phone_digest text,add column sanitized_text text,add column message_type text,add column occurred_at timestamptz default now(),add column captured_at timestamptz default now();
 alter table public.meta_observer_events add column source_field text default 'messages',add column error_codes integer[] default '{}',add column occurred_at timestamptz default now(),add column received_at timestamptz default now(),add column message_type text default 'text',add column original_message_id text;
 create table public.client_identities(id uuid,status text,revoked_at timestamptz,auth_user_id uuid,phone_digest text);
 create table public.client_identity_roles(client_identity_id uuid,role_kind text,status text,revoked_at timestamptz);
 create table public.client_source_links(client_identity_id uuid,role_kind text,link_status text,revoked_at timestamptz,confirmed_by uuid,confirmed_at timestamptz);
 create table public.profiles(id uuid,role text,telefono text);
 create function public.identity_phone_digest(text) returns text language sql immutable as 'select encode(sha256(convert_to($1,''UTF8'')),''hex'')';`);
 const capture=await readFile(new URL('../supabase/migrations/20261008203257_meta_admin_secure_capture.sql',import.meta.url),'utf8');
 await c.query(capture.match(/create function public\.resolve_meta_admin_identity_v1[\s\S]*?end \$\$;/)[0]);
 await c.query(await readFile(new URL('../supabase/migrations/20261009131426_meta_admin_memory_provenance.sql',import.meta.url),'utf8'));
 const input='11111111-1111-4111-8111-111111111111',identity='22222222-2222-4222-8222-222222222222';
 await c.query("update meta_admin_private.inbound_inputs set exact_phone_digest=repeat('e',64),sanitized_text='El contrato',message_type='text'");
 await c.query('update public.meta_observer_events set occurred_at=(select occurred_at from meta_admin_private.inbound_inputs),received_at=(select captured_at from meta_admin_private.inbound_inputs)');
 await test('unknown cannot retrieve private history',async()=>{
  assert.deepEqual((await a.query('select public.meta_admin_memory_history_v1($1) r',[input])).rows[0].r,[]);
 });
 await c.query("insert into public.client_identities values($1,'active',null,null,repeat('e',64));",[identity]);
 await c.query("insert into public.client_identity_roles values($1,'tenant','active',null)",[identity]);
 await c.query("insert into public.client_source_links values($1,'tenant','confirmed',null,$1,now())",[identity]);
 await test('external canonical role enables native history, not data grant',async()=>{
  const proof=(await a.query('select public.meta_admin_memory_evidence_v1($1) r',[input])).rows[0].r;
  assert.equal(proof.audience,'external_verified');assert.equal(proof.authorizes_private_data,false);
  const history=(await a.query('select public.meta_admin_memory_history_v1($1) r',[input])).rows[0].r;
  assert.equal(history.length,1);assert.equal(history[0].provenance,'customer_inbound');
 });
 await test('staff veto overrides matched external role',async()=>{
  await c.query("insert into public.profiles values($1,'staff',null)",[identity]);
  await c.query('update public.client_identities set auth_user_id=$1',[identity]);
  const proof=(await a.query('select public.meta_admin_memory_evidence_v1($1) r',[input])).rows[0].r;
  assert.equal(proof.audience,'internal');assert.deepEqual((await a.query('select public.meta_admin_memory_history_v1($1) r',[input])).rows[0].r,[]);
 });
 console.log(JSON.stringify({status:'PASS',checks:passed.length,passed,models:0,sends:0}));
}finally{
 for(const client of [a,b])await client.query('reset role');
 await c.query('drop function if exists public.meta_admin_memory_read_v1(text); drop function if exists public.meta_admin_memory_append_v1(jsonb,integer,text); drop function if exists public.meta_admin_memory_evidence_v1(uuid); drop function if exists public.meta_admin_memory_history_v1(uuid);drop function if exists public.resolve_meta_admin_identity_v1(uuid);drop function if exists public.identity_phone_digest(text);');
 await c.query('drop table if exists public.client_identities,public.client_identity_roles,public.client_source_links,public.profiles;');
 await c.query('drop schema if exists meta_admin_memory_private cascade; drop schema if exists meta_admin_private cascade; drop table if exists public.meta_observer_events; drop table if exists public.meta_observer_admin_scope;');
 await c.query('drop role if exists anon; drop role if exists authenticated; drop role if exists service_role;');
 console.log(JSON.stringify({cleanup:(await c.query("select count(*)::int n from pg_namespace where nspname in ('meta_admin_memory_private','meta_admin_private')")).rows[0].n}));
 await Promise.all(clients.map(x=>x.end()));
}
