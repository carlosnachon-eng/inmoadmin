import test from 'node:test';
import assert from 'node:assert/strict';
import {createMessengerInboxApi,presentMessengerHistory} from '../lib/messaging/facebook/messenger/inbox.js';
import {seal,binding} from '../lib/messaging/facebook/messenger/crypto.js';
import {messengerConfig} from '../lib/messaging/facebook/messenger/config.js';
const env={FACEBOOK_MESSENGER_ENABLED:'true',APP_ENV:'test',NEXT_PUBLIC_SUPABASE_URL:'https://hjfwjnejbcpmknvfpdcq.supabase.co',
 FACEBOOK_MESSENGER_CONNECTION_ID:'11111111-1111-4111-8111-111111111111',FACEBOOK_MESSENGER_APP_ID:'101',FACEBOOK_MESSENGER_PAGE_ID:'202',
 FACEBOOK_MESSENGER_APP_SECRET:'a'.repeat(32),FACEBOOK_MESSENGER_VERIFY_TOKEN:'b'.repeat(32),FACEBOOK_MESSENGER_INDEX_KEY:'c'.repeat(64),FACEBOOK_MESSENGER_DATA_KEY:'d'.repeat(64),FACEBOOK_MESSENGER_TOKEN_KEY:'e'.repeat(64)};
const c=messengerConfig(env),thread='a'.repeat(64),actor={id:'22222222-2222-4222-8222-222222222222',active:true,role_id:'asesor'};
const row={connection_id:c.connection,event_ref:'b'.repeat(64),thread_ref:thread,message_ref:'c'.repeat(64),kind:'inbound',occurred_at:'2026-10-18T18:00:00.000Z',reply_allowed:true};
row.content_box=seal(c,'content',binding(row),{text:'Synthetic only',attachment_types:[]});
test('history decrypts server-side; only whitelist escapes; deleted content suppressed',()=>{
 const output=presentMessengerHistory(c,thread,[row]);
 assert.equal(output[0].text,'Synthetic only');assert.equal(output[0].can_reply,true);
 assert.equal(JSON.stringify(output).includes('content_box'),false);assert.equal(JSON.stringify(output).includes('connection_id'),false);
 assert.equal(presentMessengerHistory(c,thread,[{...row,deleted:true,content_box:null}])[0].text,'Mensaje anulado');
 assert.equal(presentMessengerHistory(c,thread,[{...row,action_state:'accepted'}])[0].can_reply,false);
});
test('cross thread/connection/ciphertext/dedup fail closed',()=>{
 for(const r of [{...row,thread_ref:'d'.repeat(64)},{...row,connection_id:actor.id},{...row,content_box:{...row.content_box,provider:'instagram_login_business'}}])assert.throws(()=>presentMessengerHistory(c,thread,[r]));
 assert.throws(()=>presentMessengerHistory(c,thread,[row,row]));
});
async function run({who=actor,data={rows:[row],sender_enabled:true},query={op:'history',thread},method='GET'}={}){
 let calls=0;const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;},end(){return this;}};
 await createMessengerInboxApi({env:()=>env,authorize:async()=>who,getDb:async()=>({rpc:async(name,args)=>{
  calls++;assert.equal(name,'fb_messenger_inbox_v1');assert.equal(args.p_actor,actor.id);return {data};}})})({method,query},res);
 return {res,calls};
}
test('verified actor forwarded, env OFF dominates DB, no send RPC on read',async()=>{
 const {res,calls}=await run();assert.equal(res.code,200);assert.equal(res.body.sender_enabled,false);assert.equal(calls,1);
});
test('inactive/unsupported/missing actor denied before database',async()=>{
 for(const who of [null,{...actor,active:false},{...actor,role_id:'staff'}]){
  const {res,calls}=await run({who});assert.equal(res.code,403);assert.equal(calls,0);
 }
});
test('grant rejection, malformed thread, POST and store failure fail closed',async()=>{
 assert.equal((await run({data:null})).res.code,403);
 assert.equal((await run({query:{op:'history',thread:'native-id'}})).res.code,400);
 assert.equal((await run({method:'POST'})).res.code,405);
});
