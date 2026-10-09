import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createConversationMemoryPostgres} from '../lib/messaging/metaAdminCapture/conversationMemoryPostgres.js';
import {CONVERSATION_INBOUND_SQL} from '../lib/messaging/metaAdminCapture/conversationMemoryReader.js';
const [socket,pgPath]=process.argv.slice(2);
assert.match(socket||'',/^\/private\/tmp\/admin-memory-pg\.[A-Za-z0-9]+$/);
const {default:pg}=await import(pathToFileURL(pgPath));
const config={host:socket,port:55491,user:'postgres',database:'postgres'};
const clients=await Promise.all([0,1,2].map(async()=>{const c=new pg.Client(config);await c.connect();return c;}));
const [c,c2,c3]=clients,store=createConversationMemoryPostgres(c),s2=createConversationMemoryPostgres(c2),s3=createConversationMemoryPostgres(c3);
const passed=[];const check=async(name,fn)=>{await fn();passed.push(name);};
const sql=await readFile(new URL('../scripts/sql/meta-admin-conversation-memory.sql',import.meta.url),'utf8');
const id=n=>'episode_'+n.toString(16).padStart(32,'0'),src=n=>'message_'+n.toString(16).padStart(32,'0');
const e={id:id(1),subject:'subject_'+'a'.repeat(64),identityFingerprint:null,scope:{},family:'payments',topic:'payments',
 version:1,status:'open',pending:'verification',commitment:'none',contradiction:false,sourceRefs:[src(1)]};
const write={episode:e,expectedVersion:0,sourceRef:src(1)};
try{
 await c.query('create role anon; create role authenticated; create role service_role bypassrls;');
 const defaultsBefore=(await c.query('select count(*)::int n from pg_default_acl')).rows[0].n;
 await c.query(sql);
 await check('two tables RLS enabled',async()=>assert.equal((await c.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='meta_admin_memory_private' and c.relkind='r' and c.relrowsecurity")).rows[0].n,2));
 for(const role of ['anon','authenticated','service_role'])await check(role+' no schema/table access',async()=>{
   await c.query('set role '+role);try{await assert.rejects(c.query('select * from meta_admin_memory_private.episodes'),/permission denied/);}finally{await c.query('reset role');}
 });
 await check('defaults unchanged',async()=>assert.equal((await c.query('select count(*)::int n from pg_default_acl')).rows[0].n,defaultsBefore));
 await check('persist and read through separate connection',async()=>{
  assert.equal((await store.append(write)).status,'appended');assert.equal((await s2.read(e.subject))[0].version,1);
 });
 await check('duplicate idempotent',async()=>assert.equal((await store.append(write)).status,'duplicate'));
 await check('conflicting replay denied',async()=>assert.rejects(store.append({...write,episode:{...e,pending:'visit'}}),/replay_conflict/));
 await check('concurrency one revision winner',async()=>{
  const updates=[2,3].map(n=>({episode:{...e,version:2,sourceRefs:[src(1),src(n)]},expectedVersion:1,sourceRef:src(n)}));
  const results=await Promise.allSettled([s2.append(updates[0]),s3.append(updates[1])]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected'&&/memory_stale/.test(r.reason.message)).length,1);
 });
 await check('subject isolation',async()=>assert.deepEqual(await store.read('subject_'+'b'.repeat(64)),[]));
 await check('scope immutable',async()=>assert.rejects(store.append({...write,episode:{...e,subject:'subject_'+'b'.repeat(64)}}),/scope_immutable/));
 await check('update/delete rejected by append-only triggers',async()=>{
  await assert.rejects(c.query("update meta_admin_memory_private.revisions set pending='none'"),/memory_append_only/);
  await assert.rejects(c.query('delete from meta_admin_memory_private.episodes'),/memory_append_only/);
 });
 await check('prior versions retained',async()=>assert.equal((await c.query('select count(*)::int n from meta_admin_memory_private.revisions')).rows[0].n,2));
 await check('invalid status denied by PostgreSQL',async()=>{
  await assert.rejects(store.append({episode:{...e,version:3,status:'sent',sourceRefs:[src(1),src(2),src(3),src(4)]},expectedVersion:2,sourceRef:src(4)}),/check constraint/);
 });
 await check('native history SQL isolates subject/key/scope and flags mutation',async()=>{
  // Minimal synthetic source schema in this isolated database only; never a remote fixture.
  await c.query(`create schema meta_admin_private;
    create table meta_admin_private.inbound_inputs(id text,meta_observer_event_id text,native_message_id text,
      waba_id text,phone_number_id text,sender_ref text,sanitized_text text,message_type text,
      occurred_at timestamptz,captured_at timestamptz,capture_reason text);
    create table meta_admin_private.native_subject_evidence(meta_observer_event_id text,subject_ref text,key_tag text);
    create table public.meta_observer_events(waba_id text,phone_number_id text,original_message_id text);`);
  for(let n=1;n<=6;n++){
    await c.query(`insert into meta_admin_private.inbound_inputs values($1,$1,$1,$2,$3,$4,'Pago','text',
      '2026-10-09T00:00Z','2026-10-09T00:00Z','captured')`,[n===6?'9':String(n),n===2?'other-waba':'admin',n===3?'other-phone':'admin',n===4?'other-subject':'subject']);
    await c.query('insert into meta_admin_private.native_subject_evidence values($1,$2,$3)',[n===6?'9':String(n),n===4?'other-subject':'subject',n===5?'other-key':'key']);
  }
  await c.query("insert into public.meta_observer_events values('admin','admin','1')");
  const rows=(await c.query(CONVERSATION_INBOUND_SQL,['9'])).rows;
  assert.deepEqual(rows.map(r=>r.id),['1','9']);assert.equal(rows[0].mutated,true);assert.equal(rows[1].mutated,false);
 });
 console.log(JSON.stringify({status:'PASS',checks:passed.length,passed,schema_sha256:createHash('sha256').update(sql).digest('hex'),models:0,sends:0,remoteWrites:0}));
}finally{
 await c.query('drop schema if exists meta_admin_memory_private cascade');
 await c.query('drop schema if exists meta_admin_private cascade; drop table if exists public.meta_observer_events;');
 const remaining=(await c.query("select count(*)::int n from pg_namespace where nspname='meta_admin_memory_private'")).rows[0].n;
 await c.query('drop role if exists anon; drop role if exists authenticated; drop role if exists service_role;');
 console.log(JSON.stringify({cleanup:remaining}));await Promise.all(clients.map(c=>c.end()));
}
