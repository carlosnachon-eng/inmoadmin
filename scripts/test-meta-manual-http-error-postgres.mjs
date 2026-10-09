// Disposable loopback PostgreSQL. No env files or remote database access.
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
const runtime=process.env.SOCIAL_LOCAL_PG_RUNTIME;
if(!runtime)throw Error('local PostgreSQL runtime required');
const {default:EmbeddedPostgres}=await import(pathToFileURL(resolve(runtime,'node_modules/embedded-postgres/dist/index.js')));
const {default:pg}=await import(pathToFileURL(resolve(runtime,'node_modules/pg/lib/index.js')));
const dir=await mkdtemp(join(tmpdir(),'manual-error-pg-'));
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const cluster=new EmbeddedPostgres({databaseDir:join(dir,'data'),user:'postgres',password:'synthetic-only',port,persistent:false,postgresFlags:['-c','listen_addresses=127.0.0.1','-c',`unix_socket_directories=${dir}`],onLog(){},onError(){}});
const clients=[];let checks=0;
const connect=async()=>{const c=new pg.Client({host:'127.0.0.1',port,user:'postgres',password:'synthetic-only',database:'postgres'});await c.connect();clients.push(c);return c;};
try {
 await cluster.initialise();await cluster.start();const db=await connect();
 await db.query('create role anon;create role authenticated;create role service_role bypassrls;create schema meta_admin_private;create table public.profiles(id uuid primary key);create table meta_admin_private.inbound_inputs(id uuid primary key);');
 const base=await readFile(new URL('../supabase/migrations/20261009150550_meta_admin_inbox_manual.sql',import.meta.url),'utf8');
 await db.query(base.slice(base.indexOf('create table'),base.indexOf('-- Exact evidence')));
 await db.query(base.slice(base.indexOf('create function public.meta_admin_manual_finish_v1'),base.indexOf('-- Delivery projection')));
 await db.query(await readFile(new URL('./sql/meta-admin-manual-http-error.sql',import.meta.url),'utf8'));
 const input=randomUUID(),actor=randomUUID();await db.query('insert into public.profiles values($1)',[actor]);await db.query('insert into meta_admin_private.inbound_inputs values($1)',[input]);
 const fixture=async()=>{const id=randomUUID(),token=randomUUID();await db.query(`insert into meta_admin_private.manual_actions(action_id,input_id,actor_id,token,waba_id,phone_number_id,subject_ref,key_tag,sanitized_text) values($1,$2,$3,$4,'1297760461811288','1198305790026665','synthetic','synthetic','synthetic');`,[id,input,actor,token]);await db.query("insert into meta_admin_private.manual_events(action_id,phase,status) values($1,'dispatch_started','dispatch_started')",[id]);return [id,token];};
 const e={http_status:403,code:200,subcode:33,type:'OAuthException',message:'Permissions error',details:null};
 const finish=(c,a,status='failed',error=e)=>c.query('select public.meta_admin_manual_finish_http_error_v1($1,$2,$3,$4) as ok',[...a,status,error]);
 const a=await fixture();assert.equal((await finish(db,a)).rows[0].ok,true);checks++;
 assert.deepEqual((await db.query("select http_error from meta_admin_private.manual_events where action_id=$1 and phase='outcome'",[a[0]])).rows[0].http_error,e);checks++;
 assert.equal((await finish(db,a)).rows[0].ok,false);checks++;
 assert.equal((await finish(db,[a[0],randomUUID()])).rows[0].ok,false);checks++;
 const b=await fixture();assert.equal((await finish(db,b,'accepted')).rows[0].ok,false);checks++;
 await assert.rejects(()=>finish(db,b,'failed',{...e,recipient:'synthetic'}));checks++;
 const c=await fixture(),db2=await connect();const winners=await Promise.all([finish(db,c),finish(db2,c)]);assert.equal(winners.filter(r=>r.rows[0].ok).length,1);checks++;
 await assert.rejects(()=>db.query('update meta_admin_private.manual_events set http_error=null where action_id=$1',[a[0]]));checks++;
 for(const role of ['anon','authenticated','service_role']){
  const acl=(await db.query("select has_function_privilege($1,'public.meta_admin_manual_finish_http_error_v1(uuid,uuid,text,jsonb)','EXECUTE') ok",[role])).rows[0].ok;
  assert.equal(acl,role==='service_role');checks++;
  assert.equal((await db.query("select has_table_privilege($1,'meta_admin_private.manual_events','SELECT,INSERT,UPDATE,DELETE') ok",[role])).rows[0].ok,false);checks++;
 }
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='meta_admin_private.manual_events'::regclass")).rows[0].relrowsecurity,true);checks++;
 // Fixture cleanup only in this disposable local DB, with original triggers intact.
 await db.query('truncate meta_admin_private.manual_events,meta_admin_private.manual_attention,meta_admin_private.manual_actions,meta_admin_private.inbound_inputs,public.profiles cascade');
 assert.equal((await db.query('select count(*)::int n from meta_admin_private.manual_events')).rows[0].n,0);checks++;
 console.log(JSON.stringify({pass:checks,cleanup:0,remote_writes:0,sends:0}));
} finally {for(const c of clients)await c.end();await cluster.stop();}
