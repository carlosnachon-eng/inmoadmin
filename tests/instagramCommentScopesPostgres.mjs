import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
const require=createRequire(path.join(process.env.IG_PG_DEPS,'test.cjs')),{Client}=require('pg');
const bin=process.env.IG_PG_BIN,dir=await mkdtemp('/private/tmp/ig-comment-scope-test-');
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
let db,started=false,checks=0;
try{
 execFileSync(path.join(bin,'initdb'),['-D',dir+'/db','-U','postgres','-A','trust','--no-locale'],{stdio:'ignore'});
 execFileSync(path.join(bin,'pg_ctl'),['-D',dir+'/db','-l',dir+'/server.log','-o',`-h 127.0.0.1 -p ${port} -k ${dir}`,'start','-w'],{stdio:'ignore'});started=true;
 db=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres'});await db.connect();
 const basic='instagram_business_basic',messages='instagram_business_manage_messages',comments='instagram_business_manage_comments';
 await db.query(`create schema instagram_business_private;create table instagram_business_private.credentials(id int primary key,scopes text[] not null,constraint credentials_scopes_check check(scopes @> array['${basic}','${messages}'] and scopes <@ array['${basic}','${messages}'] and cardinality(scopes)=2));`);
 await db.query('insert into instagram_business_private.credentials values(1,$1)',[[basic,messages]]);
 await assert.rejects(()=>db.query('insert into instagram_business_private.credentials values(2,$1)',[[basic,messages,comments]]),e=>e.code==='23514');checks++;
 await db.query(await readFile(new URL('../supabase/migrations/20261018152316_instagram_business_comment_scopes.sql',import.meta.url),'utf8'));
 assert.deepEqual((await db.query('select scopes from instagram_business_private.credentials where id=1')).rows[0].scopes,[basic,messages]);checks++;
 for(const scopes of [[basic,messages],[basic,messages,comments],[comments,messages,basic]]){await db.query('insert into instagram_business_private.credentials values(2,$1)',[scopes]);await db.query('delete from instagram_business_private.credentials where id=2');checks++;}
 for(const scopes of [[],[basic],[messages,comments],[basic,comments],[basic,messages,messages],[basic,messages,comments,comments],[basic,messages,'pages_messaging'],[basic,messages,null],null]){
  await assert.rejects(()=>db.query('insert into instagram_business_private.credentials values(2,$1)',[scopes]),e=>['23514','23502'].includes(e.code));checks++;
 }
 console.log(JSON.stringify({postgres:'PASS',checks,existing_dm_scopes_preserved:true,real_credentials:0}));
}finally{await db?.end();if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',dir+'/db','stop','-m','fast','-w'],{stdio:'ignore'});await rm(dir,{recursive:true,force:true});}
