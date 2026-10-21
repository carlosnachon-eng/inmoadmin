import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createFacebookCommentReceiver} from '../lib/messaging/commentAgent/facebookWebReceiver.js';
import {inspectMetaComment} from '../lib/messaging/commentAgent/verifiedPublication.js';
import {projectFacebookComment} from '../lib/messaging/commentAgent/facebook.js';
import {messengerConfig} from '../lib/messaging/facebook/messenger/config.js';
import {facebookCommentDevConfig} from '../lib/messaging/commentAgent/facebookDevConfig.js';
const env={APP_ENV:'development',VERCEL_ENV:'development',NEXT_PUBLIC_SUPABASE_URL:'https://hjfwjnejbcpmknvfpdcq.supabase.co',FACEBOOK_COMMENTS_DEV_ENABLED:'true',FACEBOOK_COMMENTS_DEV_ENABLED:'true',FACEBOOK_COMMENTS_DEV_CONNECTION_ID:'11111111-1111-4111-8111-111111111111',FACEBOOK_COMMENTS_DEV_APP_ID:'100',FACEBOOK_COMMENTS_DEV_PAGE_ID:'200',FACEBOOK_COMMENTS_DEV_APP_SECRET:'a'.repeat(32),FACEBOOK_COMMENTS_DEV_VERIFY_TOKEN:'b'.repeat(32),FACEBOOK_COMMENTS_DEV_INDEX_KEY:'c'.repeat(64),FACEBOOK_COMMENTS_DEV_DATA_KEY:'d'.repeat(64),FACEBOOK_COMMENTS_DEV_TOKEN_KEY:'e'.repeat(64),FACEBOOK_COMMENTS_DEV_MANUAL_SEND_ENABLED:'false'};
const payload={object:'page',entry:[{id:'200',time:1780000000,changes:[{field:'feed',value:{item:'comment',verb:'add',comment_id:'400_300',post_id:'200_400',message:'precio',from:{id:'500'}}}]}]};
const request=(p=payload,signature)=>{const body=JSON.stringify(p);return new Request('https://dev.invalid',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature??'sha256='+createHmac('sha256',env.FACEBOOK_COMMENTS_DEV_APP_SECRET).update(body).digest('hex')},body});};
test('isolated signed receiver encrypts, acknowledges duplicate and never creates a DM',async()=>{
 const rows=new Map(),logs=[];const handler=createFacebookCommentReceiver({env:()=>env,capture:async(c,row)=>{assert.equal(row.thread_ref,undefined);assert.equal(projectFacebookComment(c,row).event.text,'precio');const inserted=rows.has(row.event_ref)?0:1;rows.set(row.event_ref,row);return {inserted};},diagnostic:r=>logs.push(r)});
 assert.equal((await handler(request())).status,200);assert.equal((await handler(request())).status,200);assert.equal(rows.size,1);assert.deepEqual(logs.map(x=>x.inserted),[1,0]);assert.ok(!JSON.stringify([...rows.values()]).includes('precio'));assert.ok(!JSON.stringify(logs).includes('400_300'));
});
test('environment, gate, sender, signature, foreign Page and encoding fail closed',async()=>{
 let writes=0;const make=e=>createFacebookCommentReceiver({env:()=>e,capture:async()=>{writes++;return {inserted:1};}});
 for(const e of [{...env,VERCEL_ENV:'production'},{...env,FACEBOOK_COMMENTS_DEV_ENABLED:'false'},{...env,NEXT_PUBLIC_SUPABASE_URL:'https://production.invalid'}])assert.equal((await make(e)(request())).status,404);
 assert.equal((await make({...env,FACEBOOK_COMMENTS_DEV_MANUAL_SEND_ENABLED:'true'})(request())).status,403);
 assert.equal((await make(env)(request(payload,'sha256='+'0'.repeat(64)))).status,403);
 assert.equal((await make(env)(request({...payload,entry:[{...payload.entry[0],id:'999'}]}))).status,503);
 const r=request();r.headers.set('content-encoding','gzip');assert.equal((await make(env)(r)).status,415);assert.equal(writes,0);
});
test('challenge exact; persistence failure is sanitized and never retried',async()=>{
 let calls=0;const logs=[];const h=createFacebookCommentReceiver({env:()=>env,capture:async()=>{calls++;throw Error('sensitive-example');},diagnostic:r=>logs.push(r)});
 assert.equal(await (await h(new Request('https://dev.invalid?hub.mode=subscribe&hub.challenge=fixture&hub.verify_token='+env.FACEBOOK_COMMENTS_DEV_VERIFY_TOKEN))).text(),'fixture');
 assert.equal((await h(new Request('https://dev.invalid?hub.mode=subscribe&hub.challenge=fixture&hub.verify_token=bad'))).status,403);
 assert.equal((await h(request())).status,503);assert.equal(calls,1);assert.equal(logs[0].stage,'persistence');assert.ok(!JSON.stringify(logs).includes('sensitive'));
});
test('exact Facebook edge membership replaces invalid parent-post assumption',async()=>{
 for(const [edge,node,pass] of [[{data:[{id:'400_300'}]},{id:'400_300'},true],[{data:[],paging:{next:'https://evil.invalid'}},{id:'400_300'},false],[{data:[{id:'400_300'}]},{id:'400_300',parent:{id:'200_400'}},false],[{data:[{id:'400_300'}]},{id:'999'},false]]){
  const calls=[];const work=inspectMetaComment({platform:'facebook',account:'200',post:'200_400',comment:'400_300',token:'synthetic',fetchImpl:async(u,i)=>{calls.push(u);assert.equal(i.method,'GET');assert.equal(u.hostname,'graph.facebook.com');return {ok:true,json:async()=>u.pathname.endsWith('/200_400')?{id:'200_400',from:{id:'200'}}:u.pathname.endsWith('/comments')?edge:{...node,comments:{data:[]}}};}});
  if(pass)assert.equal((await work).replies_verified,true);else await assert.rejects(work,/comment_post_denied/);
  assert.ok(calls.length<=3);assert.equal(calls[1].searchParams.get('filter'),'toplevel');assert.equal(calls[1].searchParams.get('limit'),'100');
 }
});
test('read-only evaluation never requires a publish scope; prepared ingress uses only comment capture RPC',()=>{
 const api=readFileSync(new URL('../pages/api/operaciones/comment-review.js',import.meta.url),'utf8');assert.ok(!api.includes('pages_manage_engagement'));assert.ok(api.includes("['pages_read_engagement','pages_read_user_content']"));
 const edge=readFileSync(new URL('../supabase/functions/facebook-comments-dev/index.ts',import.meta.url),'utf8');assert.ok(edge.includes("p_op:'capture'"));assert.ok(!edge.includes('fb_messenger_capture_v1'));assert.ok(!edge.includes('comment_action_v1'));
});
test('isolated config never falls back to existing Messenger keys or permits an open sender',()=>{
 const c=facebookCommentDevConfig(env);assert.equal(c.app,'100');assert.equal(c.senderEnabled,false);
 const legacy={...env};
 for(const [k,v] of Object.entries(env))if(k.startsWith('FACEBOOK_COMMENTS_DEV_')){delete legacy[k];legacy[k.replace('FACEBOOK_COMMENTS_DEV_','FACEBOOK_MESSENGER_')]=v;}
 assert.throws(()=>facebookCommentDevConfig(legacy),/sender_not_closed/);
 assert.equal(facebookCommentDevConfig({...legacy,FACEBOOK_COMMENTS_DEV_MANUAL_SEND_ENABLED:'false'}),null);
 assert.throws(()=>facebookCommentDevConfig({...env,FACEBOOK_COMMENTS_DEV_APP_SECRET:undefined,FACEBOOK_MESSENGER_APP_SECRET:'f'.repeat(32)}),/configuration_incomplete/);
 assert.throws(()=>facebookCommentDevConfig({...env,VERCEL_ENV:'production'}),/environment_denied/);
 assert.throws(()=>facebookCommentDevConfig({...env,FACEBOOK_COMMENTS_DEV_MANUAL_SEND_ENABLED:undefined}),/sender_not_closed/);
 const edge=readFileSync(new URL('../supabase/functions/facebook-comments-dev/index.ts',import.meta.url),'utf8');
 assert.ok(!edge.includes('FACEBOOK_MESSENGER_'));
});
