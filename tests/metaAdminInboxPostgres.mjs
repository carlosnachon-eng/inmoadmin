// Disposable LOCAL PostgreSQL; no remote credentials, fixtures only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import {tmpdir} from 'node:os';
assert.ok(path.isAbsolute(process.env.META_CAPTURE_TEST_DEPS||''));
const require=createRequire(path.join(process.env.META_CAPTURE_TEST_DEPS,'test.cjs'));
const EmbeddedPostgres=require('embedded-postgres').default,{Client}=require('pg');
const directory=await mkdtemp(path.join(tmpdir(),'meta-inbox-pg-'));
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const password=randomBytes(24).toString('hex');
const server=new EmbeddedPostgres({databaseDir:path.join(directory,'db'),port,user:'postgres',password,persistent:false,postgresFlags:['-h','127.0.0.1','-k',directory],onLog(){},onError(){}});
let client;
try{
 await server.initialise();await server.start();client=new Client({host:'127.0.0.1',port,user:'postgres',password,database:'postgres'});await client.connect();
 await client.query(`create role anon;create role authenticated;create role service_role;create schema meta_admin_private;
 create table public.meta_observer_events(id uuid primary key,native_message_id text,waba_id text,phone_number_id text,category text,source_field text,event_type text,observer_only boolean,state text,error_codes text[],received_at timestamptz,occurred_at timestamptz,message_type text,original_message_id text);
 create table meta_admin_private.inbound_inputs(id uuid primary key,meta_observer_event_id uuid,native_message_id text,waba_id text,phone_number_id text,sender_ref text,captured_at timestamptz,sanitized_text text,media_ciphertext jsonb);
 create table meta_admin_private.native_subject_evidence(meta_observer_event_id uuid,subject_ref text,key_tag text,evidence_state text,evidence_source text);
 create function public.resolve_meta_admin_identity_v1(uuid) returns jsonb language sql as $$select '{"state":"unmatched"}'::jsonb$$;
 create function public.meta_admin_memory_evidence_v1(uuid) returns jsonb language sql as $$select jsonb_build_object('audience',case when $1::text like '%000004' then 'internal' else 'unknown' end)$$;`);
 await client.query(await readFile(new URL('../scripts/sql/meta-admin-inbox-read.sql',import.meta.url),'utf8'));
 const ids=[1,2,3,4].map(n=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0'));
 for(let n=0;n<4;n++){
  await client.query(`insert into public.meta_observer_events values($1,$2,'1297760461811288','1198305790026665','inbound','messages','message.received',true,'observed','{}',now()+$3*interval '1 second',now()+$3*interval '1 second','text',null)`,[ids[n],'wamid.fixture'+n,n]);
  await client.query(`insert into meta_admin_private.inbound_inputs values($1,$1,$2,'1297760461811288','1198305790026665',$3,now()+$4*interval '1 second','Sintetico',null)`,[ids[n],'wamid.fixture'+n,n===3?'staff':'same',n]);
  await client.query(`insert into meta_admin_private.native_subject_evidence values($1,$2,$3,'exact','signed_from')`,[ids[n],n===3?'staff':'same',n===2?'rotated':'key']);
 }
 const call=async(sql,args=[])=>(await client.query(sql,args)).rows[0].x;
 assert.equal((await call('select public.meta_admin_inbox_list_v1() x')).length,2); // staff excluded, rotated key distinct
 assert.equal((await call('select public.meta_admin_inbox_history_v1($1) x',[ids[0]])).length,2);
 assert.equal((await call('select public.meta_admin_inbox_history_v1($1) x',[ids[2]])).length,1);
 assert.deepEqual(await call('select public.meta_admin_inbox_history_v1($1) x',[ids[3]]),[]);
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await call("select has_function_privilege($1,'public.meta_admin_inbox_history_v1(uuid)','EXECUTE') x",[role]),role==='service_role');
  assert.equal(await call("select has_table_privilege($1,'meta_admin_private.inbound_inputs','SELECT') x",[role]),false);
 }
 await client.query('set role service_role');
 assert.equal((await call('select public.meta_admin_inbox_list_v1() x')).length,2);
 await client.query('reset role');
 const before=await call('select count(*)::int x from meta_admin_private.inbound_inputs');
 await call('select public.meta_admin_inbox_history_v1($1) x',[ids[0]]);
 assert.equal(await call('select count(*)::int x from meta_admin_private.inbound_inputs'),before);
 console.log('PASS local SQL: exact subject/key isolation, staff veto, service-only RPC, no direct private access, read-only. Synthetic identity/provenance stubs; not hosted certification.');
}finally{await client?.end();await server.stop();}
