// Local ephemeral PostgreSQL only. No remote URLs, credentials or Meta requests.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHmac} from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import {seal} from '../lib/messaging/facebook/messenger/crypto.js';
import {captureMessenger} from '../lib/messaging/facebook/messenger/observer.js';
import {runManualReply} from '../lib/messaging/facebook/messenger/manual.js';
import {messengerStore} from '../lib/messaging/facebook/messenger/store.js';
const require=createRequire(path.join(process.env.IG_PG_DEPS,'test.cjs')),{Client}=require('pg');
const bin=process.env.IG_PG_BIN,dir=await mkdtemp('/private/tmp/fb-messenger-pg-');
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
let db,started=false,checks=0; const connections=[];
const c={provider:'facebook_messenger',connection:randomUUID(),app:'101',page:'202',secret:'a'.repeat(32),indexKey:'b'.repeat(64),dataKey:'c'.repeat(64),tokenKey:'d'.repeat(64),version:'v26.0',senderEnabled:true};
const actor={id:randomUUID(),active:true,role_id:'asesor'},other=randomUUID();
const box=seal(c,'fixture',[],'local-only');
const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
const q=(sql,values)=>db.query(sql,values);
const makeRow=(id,kind='inbound')=>{
 const raw=Buffer.from(JSON.stringify({object:'page',entry:[{id:c.page,messaging:[{sender:{id:'303'},recipient:{id:c.page},timestamp:Date.now()-1000,message:{mid:id,text:'Local fixture',...(kind==='deleted'?{is_deleted:true}:{})}}]}]}));
 return captureMessenger(raw,'sha256='+createHmac('sha256',c.secret).update(raw).digest('hex'),c).rows[0];
};
async function client(role) {
 const cl=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres'});await cl.connect();connections.push(cl);
 if(role)await cl.query(`set role ${role}`);return cl;
}
async function call(cl,name,args) {
 const keys=Object.keys(args);const result=await cl.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) as data`,Object.values(args).map(x=>x&&typeof x==='object'?JSON.stringify(x):x));return result.rows[0].data;
}
try {
 execFileSync(path.join(bin,'initdb'),['-D',dir+'/db','-U','postgres','-A','trust','--no-locale'],{stdio:'ignore'});
 execFileSync(path.join(bin,'pg_ctl'),['-D',dir+'/db','-l',dir+'/server.log','-o',`-h 127.0.0.1 -p ${port} -k ${dir}`,'start','-w'],{stdio:'ignore'});started=true;
 db=await client();
 await q('create role anon;create role authenticated;create role service_role;create table public.profiles(id uuid primary key,active boolean,role_id text);');
 await q(await readFile(new URL('../supabase/migrations/20261018165210_facebook_messenger_foundation.sql',import.meta.url),'utf8'));checks++;
 await q(await readFile(new URL('../supabase/migrations/20261018194000_facebook_messenger_inbox.sql',import.meta.url),'utf8'));checks++;
 await q(await readFile(new URL('../supabase/migrations/20261018204628_facebook_messenger_canary_preflight.sql',import.meta.url),'utf8'));checks++;
 await q('insert into public.profiles values($1,true,\'asesor\'),($2,true,\'admin\')',[actor.id,other]);
 await q('insert into facebook_messenger_private.connections(id,app_id,page_id) values($1,$2,$3)',[c.connection,c.app,c.page]);
 check((await q('select enabled,sender_enabled from facebook_messenger_private.connections')).rows[0],{enabled:false,sender_enabled:false});
 const service=await client('service_role'),service2=await client('service_role');
 const e=makeRow('mid.local'),args={p_connection:c.connection,p_app:c.app,p_page:c.page,p_rows:[e]};
 await assert.rejects(()=>call(service,'fb_messenger_capture_v1',args));checks++;
 await q('update facebook_messenger_private.connections set enabled=true where id=$1',[c.connection]);
 check(await call(service,'fb_messenger_capture_v1',args),{received:1,inserted:1});
 const pf={p_connection:c.connection,p_actor:other,p_input:e.event_ref,p_thread:e.thread_ref};
 check((await call(service,'fb_messenger_canary_preflight_v1',pf)).event.event_ref,e.event_ref);
 check(await call(service,'fb_messenger_canary_preflight_v1',{...pf,p_actor:actor.id}),null);
 check(await call(service,'fb_messenger_canary_preflight_v1',{...pf,p_thread:'0'.repeat(64)}),null);
 check((await q('select count(*)::int as n from facebook_messenger_private.thread_grants')).rows[0].n,0);
 check((await q('select count(*)::int as n from facebook_messenger_private.actions')).rows[0].n,0);
 for(const role of ['anon','authenticated']){
  const cl=await client(role);await assert.rejects(()=>call(cl,'fb_messenger_canary_preflight_v1',pf),x=>x.code==='42501');checks++;
 }
 check(await call(service,'fb_messenger_capture_v1',args),{received:1,inserted:0});
 await assert.rejects(()=>call(service,'fb_messenger_capture_v1',{...args,p_app:'999'}));checks++;
 await assert.rejects(()=>call(service,'fb_messenger_capture_v1',{...args,p_page:'999'}));checks++;
 await assert.rejects(()=>call(service,'fb_messenger_capture_v1',{...args,p_rows:[{...e,thread_ref:'f'.repeat(64)}]}));checks++;
 await assert.rejects(()=>call(service,'fb_messenger_capture_v1',{...args,p_rows:[{...makeRow('mid.invalid'),content_box:{}}]}));checks++;
 await assert.rejects(()=>call(service,'fb_messenger_capture_v1',{...args,p_rows:[{...makeRow('mid.legacy'),provider:'instagram_login_business'}]}));checks++;
 for(const role of ['anon','authenticated']){
  const cl=await client(role);
  await assert.rejects(()=>cl.query('select * from facebook_messenger_private.events'),x=>x.code==='42501');checks++;
  for(const [name,a] of [['fb_messenger_capture_v1',args],['fb_messenger_credential_v1',{p_connection:c.connection}],['fb_messenger_read_v1',{p_connection:c.connection,p_actor:actor.id,p_input:e.event_ref}],['fb_messenger_reserve_v1',{p_args:{}}],['fb_messenger_start_v1',{p_connection:c.connection,p_action:randomUUID(),p_lease:randomUUID()}],['fb_messenger_finish_v1',{p_connection:c.connection,p_action:randomUUID(),p_lease:randomUUID(),p_outcome:{status:'accepted'}}]]){
   await assert.rejects(()=>call(cl,name,a),x=>x.code==='42501');checks++;
  }
 }
 await assert.rejects(()=>service.query('select * from facebook_messenger_private.credentials'),x=>x.code==='42501');checks++;
 check((await q("select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='facebook_messenger_private' and c.relkind='r' and c.relrowsecurity")).rows[0].n,5);
 const read=a=>call(service,'fb_messenger_read_v1',{p_connection:c.connection,p_actor:a,p_input:e.event_ref});
 check(await read(actor.id),null);check(await read(other),null);
 await q("insert into facebook_messenger_private.thread_grants values($1,$2,$3,now()+interval '1 hour',true)",[c.connection,e.thread_ref,actor.id]);
 check((await read(actor.id)).provider,'facebook_messenger');check(await read(other),null);
 const inbox=(who,thread=null)=>call(service,'fb_messenger_inbox_v1',{p_connection:c.connection,p_actor:who,p_thread:thread});
 check((await inbox(actor.id)).rows.length,1);check((await inbox(other)).rows.length,0);
 check((await inbox(actor.id,e.thread_ref)).rows.length,1);check(await inbox(other,e.thread_ref),null);
 check(await inbox(actor.id,'f'.repeat(64)),null);
 await q('update public.profiles set active=false where id=$1',[actor.id]);check(await inbox(actor.id),null);
 await q('update public.profiles set active=true where id=$1',[actor.id]);
 for(const role of ['anon','authenticated']){
  const cl=await client(role);
  await assert.rejects(()=>call(cl,'fb_messenger_inbox_v1',{p_connection:c.connection,p_actor:actor.id,p_thread:null}),x=>x.code==='42501');checks++;
 }
 const validUntil=new Date(Date.now()+3600000).toISOString();
 await q("insert into facebook_messenger_private.credentials values($1,'PAGE',1,array['pages_messaging'],$2,now(),$3)",[c.connection,seal(c,'token',[1,validUntil],'local-token'),validUntil]);
 const action=()=>({connection:c.connection,actor:actor.id,input:e.event_ref,action:randomUUID(),lease:randomUUID(),generation:1,text_box:box});
 const reserve=a=>call(service,'fb_messenger_reserve_v1',{p_args:a});
 check(await reserve(action()),false); // sender OFF
 await q('update facebook_messenger_private.connections set sender_enabled=true where id=$1',[c.connection]);
 check(await reserve({...action(),actor:other}),false);check(await reserve({...action(),generation:2}),false);
 const a=action();
 const races=await Promise.all([reserve(a),call(service2,'fb_messenger_reserve_v1',{p_args:{...a,action:randomUUID(),lease:randomUUID()}})]);
 check(races.filter(Boolean).length,1);
 const stored=(await q('select * from facebook_messenger_private.actions')).rows[0];
 const startArgs={p_connection:c.connection,p_action:stored.action_id,p_lease:stored.lease};
 const starts=await Promise.all([call(service,'fb_messenger_start_v1',startArgs),call(service2,'fb_messenger_start_v1',startArgs)]);
 check(starts.filter(Boolean).length,1);
 check((await q('select dispatch_count,human_paused from facebook_messenger_private.actions')).rows[0],{dispatch_count:1,human_paused:true});
 check(await call(service,'fb_messenger_finish_v1',{...startArgs,p_outcome:{status:'failed',http_status:400,code:190,subcode:463}}),true);
 check(await call(service,'fb_messenger_start_v1',startArgs),false);
 check(await call(service,'fb_messenger_finish_v1',{...startArgs,p_outcome:{status:'accepted'}}),false);
 check(await reserve(action()),false);
 // Kill-switch after reserve, before start: terminal blocked, zero dispatch.
 const e2=makeRow('mid.kill');await call(service,'fb_messenger_capture_v1',{...args,p_rows:[e2]});
 const a2={...action(),input:e2.event_ref};check(await reserve(a2),true);
 await q('update facebook_messenger_private.connections set sender_enabled=false where id=$1',[c.connection]);
 check(await call(service,'fb_messenger_start_v1',{p_connection:c.connection,p_action:a2.action,p_lease:a2.lease}),false);
 check((await q('select state,dispatch_count from facebook_messenger_private.actions where action_id=$1',[a2.action])).rows[0],{state:'blocked',dispatch_count:0});
 await q('update facebook_messenger_private.connections set sender_enabled=true where id=$1',[c.connection]);
 // Expired grant, disabled actor, stale token, deletion all reject before claim.
 const e3=makeRow('mid.gates');await call(service,'fb_messenger_capture_v1',{...args,p_rows:[e3]});
 const a3=()=>({...action(),input:e3.event_ref});
 await q("update facebook_messenger_private.thread_grants set expires_at=now()-interval '1 second'");check(await reserve(a3()),false);
 await q("update facebook_messenger_private.thread_grants set expires_at=now()+interval '1 hour'");
 await q('update public.profiles set active=false where id=$1',[actor.id]);check(await reserve(a3()),false);
 await q('update public.profiles set active=true where id=$1',[actor.id]);
 await q("update facebook_messenger_private.credentials set verified_at=now()-interval '25 hours'");check(await reserve(a3()),false);
 await q('update facebook_messenger_private.credentials set verified_at=now()');
 await call(service,'fb_messenger_capture_v1',{...args,p_rows:[makeRow('mid.gates','deleted')]});check(await reserve(a3()),false);
 // Real adapter -> real SQL RPC -> mocked Meta HTTP, no transport outside process.
 const e4=makeRow('mid.end-to-end');await call(service,'fb_messenger_capture_v1',{...args,p_rows:[e4]});
 const store=messengerStore({rpc:async(name,a)=>{try{return {data:await call(service,name,a)};}catch{return {error:true};}}},c.connection);
 let network=0;
 const body={action:randomUUID(),input:e4.event_ref,text:'Respuesta local'};
 const run=()=>runManualReply({config:c,actor,body,store,fetchImpl:async()=>{network++;return {ok:true,status:200,json:async()=>({recipient_id:'303',message_id:'mid.outbound'})};}});
 check((await run()).status,'accepted');check((await run()).status,'already_consumed_or_blocked');check(network,1);
 check((await q('select state,dispatch_count from facebook_messenger_private.actions where action_id=$1',[body.action])).rows[0],{state:'accepted',dispatch_count:1});
 await q(await readFile(new URL('../supabase/migrations/20261018171612_facebook_messenger_provisioning.sql',import.meta.url),'utf8'));checks++;
 const provisionConnection=randomUUID(),pnow=new Date(),until=new Date(pnow.getTime()+3600000).toISOString();
 const pargs={actor:other,app:'401',page:'402',expected_generation:0,generation:1,scopes:['pages_messaging','pages_manage_metadata'],verified_at:pnow.toISOString(),valid_until:until,token_box:box,metadata:{ok:true,expires_at:0,subscribed_fields:[]}};
 const provision=a=>call(service,'fb_messenger_provision_v1',{p_connection:provisionConnection,p_args:a});
 check(await provision({...pargs,actor:actor.id}),false);
 check(await provision(pargs),true);
 check(await provision(pargs),false);
 check((await q('select enabled,sender_enabled from facebook_messenger_private.connections where id=$1',[provisionConnection])).rows[0],{enabled:true,sender_enabled:false});
 check(await provision({...pargs,expected_generation:1,generation:2,app:'999'}),false);
 check(await provision({...pargs,expected_generation:1,generation:2}),true);
 await q('update facebook_messenger_private.connections set sender_enabled=true where id=$1',[provisionConnection]);
 check(await provision({...pargs,expected_generation:2,generation:3}),false);
 for(const role of ['anon','authenticated']){
  const cl=await client(role);await assert.rejects(()=>call(cl,'fb_messenger_provision_v1',{p_connection:provisionConnection,p_args:pargs}),x=>x.code==='42501');checks++;
 }
 await q(await readFile(new URL('../supabase/migrations/20261018194331_facebook_messenger_health.sql',import.meta.url),'utf8'));checks++;
 const healthRun=randomUUID(),beginHealth=r=>call(service,'fb_messenger_health_begin_v1',{p_connection:provisionConnection,p_run:r});
 check((await beginHealth(healthRun)).generation,2);check(await beginHealth(randomUUID()),null);
 const finishHealth=(r,a)=>call(service,'fb_messenger_health_finish_v1',{p_connection:provisionConnection,p_run:r,p_args:a});
 const healthArgs={...pargs,valid_until:new Date(pnow.getTime()+8*3600000).toISOString(),expected_generation:2,generation:3,ok:true,stage:'verified',metadata:{...pargs.metadata,ok:true,inbound_ready:true,echo_ready:true}};
 check(await finishHealth(randomUUID(),healthArgs),false);
 check(await finishHealth(healthRun,healthArgs),true);
 check((await q('select sender_enabled from facebook_messenger_private.connections where id=$1',[provisionConnection])).rows[0].sender_enabled,true); // preserves, never opens
 check(await finishHealth(healthRun,healthArgs),false);check(await beginHealth(randomUUID()),null);
 await q("update facebook_messenger_private.health set next_check_at=now() where connection_id=$1",[provisionConnection]);
 const failedRun=randomUUID();await beginHealth(failedRun);
 check(await finishHealth(failedRun,{ok:false,expected_generation:3,stage:'token_invalid',http_status:400,code:190}),true);
 check((await q('select sender_enabled from facebook_messenger_private.connections where id=$1',[provisionConnection])).rows[0].sender_enabled,false);
 check((await q('select generation from facebook_messenger_private.credentials where connection_id=$1',[provisionConnection])).rows[0].generation,'3');
 await q("update facebook_messenger_private.health set next_check_at=now() where connection_id=$1",[provisionConnection]);
 const recoveryRun=randomUUID();await beginHealth(recoveryRun);
 check(await finishHealth(recoveryRun,{...healthArgs,expected_generation:3,generation:4}),true);
 check((await q('select sender_enabled from facebook_messenger_private.connections where id=$1',[provisionConnection])).rows[0].sender_enabled,false);
 for(const role of ['anon','authenticated']){
  const cl=await client(role);for(const [name,a] of [['fb_messenger_health_begin_v1',{p_connection:provisionConnection,p_run:healthRun}],['fb_messenger_health_finish_v1',{p_connection:provisionConnection,p_run:healthRun,p_args:healthArgs}]]){
   await assert.rejects(()=>call(cl,name,a),x=>x.code==='42501');checks++;
  }
 }
 await assert.rejects(()=>service.query('select * from facebook_messenger_private.health'),x=>x.code==='42501');checks++;
 console.log(JSON.stringify({postgres:'PASS',checks,real_meta_requests:0,remote_migrations:0}));
} finally {
 for(const cl of connections)await cl.end();
 if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',dir+'/db','stop','-m','fast','-w'],{stdio:'ignore'});
 await rm(dir,{recursive:true,force:true});
}
