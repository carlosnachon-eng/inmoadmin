import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createInstagramObserverHandler, instagramObserverConfig, normalizeInstagramObservations,
  IG_ACCOUNT, IG_DEV_REF, MAX_IG_BYTES } from '../lib/messaging/instagram/observer.js';

const env = { APP_ENV:'test', NEXT_PUBLIC_SUPABASE_URL:`https://${IG_DEV_REF}.supabase.co`,
  INSTAGRAM_OBSERVER_ENABLED:'true', INSTAGRAM_OBSERVER_ACCOUNT_ID:IG_ACCOUNT,
  INSTAGRAM_OBSERVER_APP_SECRET:'a'.repeat(32), INSTAGRAM_OBSERVER_VERIFY_TOKEN:'v'.repeat(32), INSTAGRAM_OBSERVER_HMAC_KEY:'h'.repeat(32) };
const body = () => ({ object:'instagram', entry:[{id:IG_ACCOUNT, time:1700000000, messaging:[{
  sender:{id:'123456789'},recipient:{id:IG_ACCOUNT},timestamp:1700000000000,
  message:{mid:'mid.synthetic',text:'Private synthetic text',attachments:[{payload:{url:'https://private.invalid'}}]}
}]}] });
const response = () => ({ headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(b){this.body=b;return this;},send(b){this.body=b;return this;} });
function request(b=body(), opts={}) {
  const raw = opts.raw || Buffer.from(JSON.stringify(b));
  return {method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256',env.INSTAGRAM_OBSERVER_APP_SECRET).update(raw).digest('hex')},async *[Symbol.asyncIterator](){yield raw;},...opts};
}
function harness(e=env, result) {
  const calls=[], rows=new Map();
  const handler=createInstagramObserverHandler({env:()=>e,getDb:()=>({rpc:async(name,args)=>{
    calls.push({name,args}); if(result)return result;
    let inserted=0;for(const row of args.p_events)if(!rows.has(row.observation_key)){rows.set(row.observation_key,row);inserted++;}
    return {data:{durable:true,inserted,duplicates:args.p_events.length-inserted}};
  }})});
  return {calls,rows,async run(req=request()){const r=response();await handler(req,r);return r;}};
}
test('OFF by default, no database access',async()=>{const h=harness({});assert.equal((await h.run()).statusCode,404);assert.equal(h.calls.length,0);});
for(const patch of [{VERCEL_ENV:'production'},{APP_ENV:'production'},{APP_ENV:undefined},
  {NEXT_PUBLIC_SUPABASE_URL:'https://bnzrnizrmonjxlktbhlp.supabase.co'},{INSTAGRAM_OBSERVER_ACCOUNT_ID:'other'},
  {INSTAGRAM_OBSERVER_APP_SECRET:''},{INSTAGRAM_OBSERVER_HMAC_KEY:env.INSTAGRAM_OBSERVER_APP_SECRET}])
  test(`DEV/config guard ${Object.keys(patch)[0]} ${String(Object.values(patch)[0]).slice(0,12)}`,async()=>{const h=harness({...env,...patch});assert.equal((await h.run()).statusCode,503);assert.equal(h.calls.length,0);});
test('GET verifies challenge without DB',async()=>{const h=harness();const r=await h.run(request({}, {method:'GET',query:{'hub.mode':'subscribe','hub.verify_token':env.INSTAGRAM_OBSERVER_VERIFY_TOKEN,'hub.challenge':'123'}}));assert.equal(r.statusCode,200);assert.equal(r.body,'123');assert.equal(h.calls.length,0);});
test('GET bad token blocked',async()=>{assert.equal((await harness().run(request({}, {method:'GET',query:{'hub.mode':'subscribe','hub.verify_token':'bad','hub.challenge':'123'}}))).statusCode,403);});
for(const signature of [undefined,'sha256=bad','sha256='+'0'.repeat(64),['sha256='+'0'.repeat(64)]])
  test(`invalid signature ${JSON.stringify(signature)}`,async()=>{const h=harness();assert.equal((await h.run(request(body(),{headers:{'x-hub-signature-256':signature}}))).statusCode,401);assert.equal(h.calls.length,0);});
test('raw byte tampering rejected',async()=>{const h=harness(),r=request();r[Symbol.asyncIterator]=async function*(){yield Buffer.from('{}');};assert.equal((await h.run(r)).statusCode,401);});
test('oversize rejected before DB',async()=>{const h=harness();assert.equal((await h.run(request(null,{raw:Buffer.alloc(MAX_IG_BYTES+1)}))).statusCode,413);assert.equal(h.calls.length,0);});
test('malformed JSON rejected',async()=>{assert.equal((await harness().run(request(null,{raw:Buffer.from('{')}))).statusCode,400);});
test('wrong object is not WhatsApp fallback',async()=>{assert.equal((await harness().run(request({object:'whatsapp_business_account',entry:[]}))).statusCode,400);});
test('foreign scope rejects whole batch atomically',async()=>{const b=body();b.entry.push({...b.entry[0],id:'other'});const h=harness();assert.equal((await h.run(request(b))).statusCode,403);assert.equal(h.calls.length,0);});
test('recipient must match account',async()=>{const b=body();b.entry[0].messaging[0].recipient.id='other';assert.equal((await harness().run(request(b))).statusCode,403);});
test('durable metadata only; exact duplicates',async()=>{const h=harness();assert.equal((await h.run()).body.inserted,1);assert.equal((await h.run()).body.duplicates,1);assert.equal(h.rows.size,1);const s=JSON.stringify(h.calls);for(const secret of ['Private synthetic text','private.invalid','123456789',env.INSTAGRAM_OBSERVER_APP_SECRET])assert.ok(!s.includes(secret));});
test('echo never human',()=>{const b=body(),e=b.entry[0].messaging[0];[e.sender,e.recipient]=[e.recipient,e.sender];e.message.is_echo=true;const [r]=normalizeInstagramObservations(b,instagramObserverConfig(env)).rows;assert.equal(r.kind,'dm_echo');assert.equal(r.provenance,'business_outbound_unattributed');});
test('comments preserve exact media/parent but never invent root',()=>{const b=body();b.entry[0].messaging=[];b.entry[0].changes=[{field:'comments',value:{id:'comment1',media:{id:'media1'},parent_id:'parent1',from:{id:'123'},text:'private'}}];const [r]=normalizeInstagramObservations(b,instagramObserverConfig(env)).rows;assert.equal(r.kind,'comment');assert.equal(r.media_id,'media1');assert.equal(r.parent_id,'parent1');assert.equal(r.relation_state,'unresolved');});
test('mentions without actor stay unknown',()=>{const b=body();b.entry[0].messaging=[];b.entry[0].changes=[{field:'mentions',value:{media_id:'media1'}}];const [r]=normalizeInstagramObservations(b,instagramObserverConfig(env)).rows;assert.equal(r.subject_ref,null);assert.equal(r.provenance,'unknown');});
test('same mid changed observation is preserved, not effect dedupe',()=>{const a=body(),b=body();b.entry[0].messaging[0].message.text='changed';const cfg=instagramObserverConfig(env);assert.notEqual(normalizeInstagramObservations(a,cfg).rows[0].observation_key,normalizeInstagramObservations(b,cfg).rows[0].observation_key);});
test('unknown fields counted without interpreting',async()=>{const b=body();b.entry[0].changes=[{field:'unknown',value:{}}];assert.equal((await harness().run(request(b))).body.ignored,1);});
for(const result of [{error:{message:'SECRET'}},{data:{durable:false,inserted:1,duplicates:0}},{data:{durable:true,inserted:0,duplicates:0}}])
  test(`no false ACK ${JSON.stringify(result)}`,async()=>{const r=await harness(env,result).run();assert.equal(r.statusCode,503);assert.ok(!JSON.stringify(r.body).includes('SECRET'));});
test('empty supported batch still persists receipt',async()=>{const h=harness();const r=await h.run(request({object:'instagram',entry:[{id:IG_ACCOUNT,changes:[]}]}));assert.equal(r.statusCode,200);assert.equal(h.calls.length,1);});
test('100-event bound',async()=>{const b=body();b.entry[0].messaging=Array(101).fill(b.entry[0].messaging[0]);assert.equal((await harness().run(request(b))).statusCode,400);});
