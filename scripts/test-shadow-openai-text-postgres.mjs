import assert from "node:assert/strict";
import { mkdtemp,readFile,rmdir,access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { pathToFileURL } from "node:url";
import net from "node:net";
import { certifyShadowOpenAiText } from "./certify-shadow-openai-text.mjs";
const runtime=process.env.SHADOW_ACTION_LOCAL_PG_RUNTIME;
if(!runtime)throw Error("isolated_postgres_runtime_required");
const {default:EmbeddedPostgres}=await import(pathToFileURL(resolve(runtime,"node_modules/embedded-postgres/dist/index.js")));
const {default:pg}=await import(pathToFileURL(resolve(runtime,"node_modules/pg/lib/index.js")));
const socket=net.createServer();await new Promise(ok=>socket.listen(0,"127.0.0.1",ok));const port=socket.address().port;await new Promise(ok=>socket.close(ok));
const directory=await mkdtemp(join(tmpdir(),"shadow-openai-text-pg-"));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,"data"),user:"postgres",password:"synthetic-local-only",port,persistent:false,
  postgresFlags:["-c","listen_addresses=127.0.0.1","-c",`unix_socket_directories=${directory}`],onLog(){},onError(){}});
let client;
try{
  await cluster.initialise();await cluster.start();
  client=new pg.Client({host:"127.0.0.1",port,database:"postgres",user:"postgres",password:"synthetic-local-only"});await client.connect();
  await client.query(`create extension pgcrypto; create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
    create table profiles(id uuid primary key,role_id text,active boolean);
    create function public.current_profile_role_id() returns text language sql as 'select null::text';
    create table shadow_operational_events(id uuid primary key);grant usage on schema public to service_role;`);
  for(const name of ["202608190003_fase_2a_shadow_production_schema.sql","202608210003_fase_2a_p3_shadow_ai_integration.sql",
    "202608270001_fase_3b_shadow_conversation_actions.sql","202608280003_fase_3b_interaction_direction.sql",
    "202608290001_auto_real_timeout_resilience.sql","202608290002_auto_real_explicit_retry.sql"]){
    await client.query(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8"));
  }
  // Non-model FK/read dependencies only; run/decision/action constraints above
  // are installed from the ORIGINAL migrations, not simplified test schemas.
  await client.query(`alter table shadow_conversations add column respond_contact_id text;
    create table shadow_media_interpretations(external_message_id text,status text,result_safe jsonb,interpreted_at timestamptz,created_at timestamptz);
    create table shadow_media_retrieval_queue(external_message_id text,status text,completed_at timestamptz,created_at timestamptz);
    grant select on shadow_media_interpretations,shadow_media_retrieval_queue to service_role;`);
  let chain=Promise.resolve();
  const query=sql=>{
    const pending=chain.then(async()=>{
      try{const value=await client.query(sql);return (Array.isArray(value)?value.filter(r=>r.rows?.length).at(-1)?.rows:value.rows)||[];}
      catch(e){await client.query("rollback");throw e;}
    });chain=pending.catch(()=>{});return pending;
  };
  const result=await certifyShadowOpenAiText(query,{environment:"local_postgresql",withIdentity:false});
  console.log(JSON.stringify(result,null,2));
} finally{
  await client?.end();await cluster.stop();await assert.rejects(access(join(directory,"data")),{code:"ENOENT"});await rmdir(directory);
  console.log("ISOLATED_POSTGRES_REMOVED");
}
