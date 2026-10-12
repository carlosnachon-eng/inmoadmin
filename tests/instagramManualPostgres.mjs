import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {encryptInstagramRecipient} from '../lib/messaging/instagram/manualRecipient.js';
import {createInstagramManualStore,runInstagramManualReply} from '../lib/messaging/instagram/manualSender.js';
const require=createRequire(path.join(process.env.IG_PG_DEPS,'test.cjs')),{Client}=require('pg');
const bin=process.env.IG_PG_BIN,dir=await mkdtemp('/private/tmp/ig-sender-pg-');
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
let c,c2,started=false;
try {
 execFileSync(path.join(bin,'initdb'),['-D',dir+'/db','-U','postgres','-A','trust','--no-locale'],{stdio:'ignore'});
 execFileSync(path.join(bin,'pg_ctl'),['-D',dir+'/db','-l',dir+'/server.log','-o',`-h 127.0.0.1 -p ${port} -k ${dir}`,'start','-w'],{stdio:'ignore'});started=true;
 c=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres'});c2=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres'});await c.connect();await c2.connect();
 await c.query(`create role anon;create role authenticated;create role service_role;create extension pgcrypto;
 create table profiles(id uuid primary key,active boolean,role_id text);insert into profiles values(gen_random_uuid(),true,'admin');`);
 await c.query(await readFile(new URL('../scripts/sql/instagram-observer-dev.sql',import.meta.url),'utf8'));
 await c.query(await readFile(new URL('../scripts/sql/instagram-observer-dev-id-check.sql',import.meta.url),'utf8'));
 await c.query(await readFile(new URL('../scripts/sql/instagram-manual-sender-dev.sql',import.meta.url),'utf8'));
 await c.query(await readFile(new URL('./instagramManualDev.sql',import.meta.url),'utf8'));
 const input=randomBytes(32).toString('hex'),receipt=randomBytes(32).toString('hex'),actor=(await c.query('select id from profiles')).rows[0].id;
 const row={observation_key:input,kind:'dm',native_id:'fixture.'+input,subject_ref:'a'.repeat(64),media_id:null,parent_id:null,occurred_at:new Date().toISOString(),provenance:'customer_inbound',relation_state:'exact_subject',recipient_ciphertext:{v:1,key_tag:'a'.repeat(16),iv:'b'.repeat(24),tag:'c'.repeat(32),ciphertext:'1234'}};
 await c.query('select observe_instagram_manual_dev_v1($1,$2,$3)',['17841440384433670',receipt,JSON.stringify([row])]);
 const action=randomUUID(),leases=[randomUUID(),randomUUID()];
 const wins=await Promise.all([c,c2].map((db,i)=>db.query('select instagram_manual_reserve_dev_v1($1,$2,$3,$4,$5) won',[input,actor,action,leases[i],'Gracias.'])));
 assert.equal(wins.filter(r=>r.rows[0].won).length,1);const lease=leases[wins.findIndex(r=>r.rows[0].won)];
 const starts=await Promise.all([c,c2].map(db=>db.query('select instagram_manual_start_dev_v1($1,$2) won',[action,lease])));
 assert.equal(starts.filter(r=>r.rows[0].won).length,1);
 await c.query('select instagram_manual_finish_dev_v1($1,$2,$3,$4,null)',[action,lease,'accepted','fixture.outbound']);
 const status=(await c.query('select instagram_manual_status_dev_v1($1,$2) s',[input,actor])).rows[0].s;
 assert.equal(status.status,'accepted');assert.equal(status.delivery_status,null);
 // Real RPC adapter and encrypted target end-to-end; only Graph is mocked.
 const next=randomBytes(32).toString('hex'),recipient='900000123',env={VERCEL_ENV:'preview',APP_ENV:'preview',
  NEXT_PUBLIC_SUPABASE_URL:'https://hjfwjnejbcpmknvfpdcq.supabase.co',INSTAGRAM_MANUAL_REPLY_ENABLED:'true',
  INSTAGRAM_MANUAL_AUTHORIZED_INPUT:next,SOCIAL_INSTAGRAM_PAGE_ACCESS_TOKEN:'fixture',
  INSTAGRAM_MANUAL_RECIPIENT_KEY:'c'.repeat(64),INSTAGRAM_OBSERVER_HMAC_KEY:'b'.repeat(64)};
 const real={...row,observation_key:next,native_id:'fixture.'+next,
  subject_ref:createHmac('sha256',env.INSTAGRAM_OBSERVER_HMAC_KEY).update(JSON.stringify(['17841440384433670',recipient])).digest('hex')};
 real.recipient_ciphertext=encryptInstagramRecipient(recipient,real,env);
 await c.query('select observe_instagram_manual_dev_v1($1,$2,$3)',['17841440384433670',randomBytes(32).toString('hex'),JSON.stringify([real])]);
 const allowed=new Set(['instagram_manual_load_dev_v1','instagram_manual_reserve_dev_v1','instagram_manual_start_dev_v1','instagram_manual_finish_dev_v1','instagram_manual_status_dev_v1']);
 const store=createInstagramManualStore({rpc:async(name,args)=>{assert.ok(allowed.has(name));const values=Object.values(args);
  const result=await c.query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) data`,values);return {data:result.rows[0].data};}});
 let calls=0;const request={input:next,action:randomUUID(),text:'Gracias.',actor:{id:actor,active:true,role_id:'admin'},env,store,
  fetchImpl:async()=>{calls++;assert.equal((await c.query('select instagram_manual_attention_dev_v1($1) paused',[next])).rows[0].paused,true);
   return {ok:false,status:403,json:async()=>({error:{code:200,type:'OAuthException',message:'Permission denied'}})};}};
 assert.equal((await runInstagramManualReply(request)).status,'failed');await runInstagramManualReply(request);assert.equal(calls,1);
 assert.equal((await c.query('select instagram_manual_status_dev_v1($1,$2) s',[next,actor])).rows[0].s.status,'failed');
 console.log(JSON.stringify({functional_acl_rls:'PASS',concurrent_reserve:'one_winner',concurrent_start:'one_winner',real_rpc_mock_graph:'PASS',models:0,sends:0,cleanup:'disposable_database'}));
}finally{
 await c?.end();await c2?.end();if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',dir+'/db','stop','-m','fast','-w'],{stdio:'ignore'});
 if(dir.startsWith('/private/tmp/ig-sender-pg-'))await rm(dir,{recursive:true,force:true});
}
