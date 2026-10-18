import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import {TARGET_EVENT} from '../lib/messaging/instagram/business/bindingCheck.js';
const require=createRequire(path.join(process.env.IG_PG_DEPS,'test.cjs')),{Client}=require('pg'),bin=process.env.IG_PG_BIN;
const dir=await mkdtemp('/private/tmp/ig-binding-pg-');let db,started=false,checks=0;
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const ok=v=>{assert.ok(v);checks++;};
try{
 execFileSync(path.join(bin,'initdb'),['-D',dir+'/db','-U','postgres','-A','trust','--no-locale'],{stdio:'ignore'});
 execFileSync(path.join(bin,'pg_ctl'),['-D',dir+'/db','-l',dir+'/server.log','-o',`-h 127.0.0.1 -p ${port} -k ${dir}`,'start','-w'],{stdio:'ignore'});started=true;
 db=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres'});await db.connect();
 await db.query('create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key,active boolean,role_id text)');
 await db.query(await readFile(new URL('../scripts/sql/instagram-business-production-closed-canary.sql',import.meta.url),'utf8'));
 await db.query(await readFile(new URL('../supabase/migrations/20261018030000_instagram_binding_check_readonly.sql',import.meta.url),'utf8'));
 const actor='00000000-0000-4000-8000-000000000001',connection='5f695ba8-eeed-4dd7-8b9d-88b7e3a1327b';
 await db.query("insert into profiles values($1,true,'admin');",[actor]);
 await db.query("insert into instagram_business_private.connections(id,app_id,instagram_app_id,account_id,active) values($1,'2918004201870607','2370690620336933','17841440384433670',true)",[connection]);
 await db.query('insert into instagram_business_private.canary_operators values($1,$2,true)',[connection,actor]);
 await db.query("insert into instagram_business_private.events values($1,$2,$3,$3,$3,$3,'inbound',now(),now(),$4,$4)",[connection,TARGET_EVENT,'a'.repeat(64),{provider:'instagram_login_business'}]);
 const read=async()=>{await db.query('set role service_role');try{return (await db.query('select public.ig_business_binding_check_input_v1($1) value',[actor])).rows[0].value;}finally{await db.query('reset role');}};
 ok((await read()).event_ref===TARGET_EVENT);
 for(const role of ['anon','authenticated']){await db.query('set role '+role);await assert.rejects(()=>db.query('select public.ig_business_binding_check_input_v1($1)',[actor]));checks++;await db.query('reset role');}
 for(const [bad,restore] of [["update instagram_business_private.connections set sender_enabled=true","update instagram_business_private.connections set sender_enabled=false"],["update instagram_business_private.canary_operators set active=false","update instagram_business_private.canary_operators set active=true"],["update profiles set role_id='staff'","update profiles set role_id='admin'"],["update instagram_business_private.events set event_ref=repeat('b',64)","update instagram_business_private.events set event_ref='"+TARGET_EVENT+"'"]]){await db.query(bad);ok(await read()===null);await db.query(restore);}
 ok((await db.query('select count(*)::int n from instagram_business_private.actions')).rows[0].n===0);
 ok((await db.query('select count(*)::int n from instagram_business_private.canary_threads')).rows[0].n===0);
 console.log(JSON.stringify({checks,status:'PASS',claims:0,dispatches:0}));
}finally{await db?.end();if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',dir+'/db','stop','-m','fast','-w'],{stdio:'ignore'});await rm(dir,{recursive:true,force:true});}
