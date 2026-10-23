import test from 'node:test';
import assert from 'node:assert/strict';
import {decideComment,reviewBatch} from '../lib/messaging/commentAgent/decision.js';
import {createCommentObservationApi,commentObservationAllowed} from '../lib/messaging/commentAgent/api.js';
const now=Date.parse('2026-10-20T12:00:00Z'),ref=n=>String(n).repeat(64);
const event={platform:'instagram',connection_ref:ref(1),comment_ref:ref(2),post_ref:ref(3),event_ref:ref(4),owned:true,replies_verified:true,occurred_at:new Date(now-1000).toISOString(),text:'¿Precio?'};
const facts={platform:event.platform,connection_ref:event.connection_ref,post_ref:event.post_ref,property_ref:ref(5),source:'inmoadmin_verified_publication',public:true,active:true,verified_at:new Date(now).toISOString(),price:2000000,currency:'MXN',operation:'venta'};
const decide=(e={},f=facts,c=null)=>decideComment({event:{...event,...e},facts:f,capability:c,now});
test('exact verified public fact generates proposal, never dispatch authority',()=>{
 const d=decide();assert.equal(d.status,'proposed');assert.match(d.public_proposal,/2,000,000/);assert.equal(d.publish_allowed,false);assert.equal(d.private_send_allowed,false);assert.equal(d.private_proposal,null);
});
for(const text of ['precio y descuento','fraude','mi telefono 2221234567','Hola Juan','precio de otra propiedad','quiero una cita','ubicación','requisitos'])test(`conservative escalation: ${text}`,()=>assert.equal(decide({text}).status,'escalated'));
for(const patch of [{platform:'facebook'},{connection_ref:ref(8)},{post_ref:ref(9)},{public:false},{active:false},{verified_at:new Date(now-901000).toISOString()}])test(`binding fails closed ${JSON.stringify(patch)}`,()=>assert.equal(decide({}, {...facts,...patch}).reason,'property_binding_or_freshness'));
test('no data or unverified external replies cannot generate proposal',()=>{assert.equal(decide({},null).public_proposal,null);assert.equal(decide({replies_verified:false}).reason,'reply_state_unverified');});
for(const status of ['accepted','uncertain','reserved','failed'])test(`existing action ${status} suppresses second bot`,()=>assert.equal(decide({automation_status:status}).status,'suppressed'));
test('nested and own comments never receive proposals',()=>{assert.equal(decide({nested:true}).status,'ignored');assert.equal(decide({own_author:true}).status,'ignored');});
test('dedup and conflicting revisions cannot create two proposals',()=>{
 const input={event,facts};assert.equal(reviewBatch([input,input],{now}).rows.length,1);
 const b=reviewBatch([input,{event:{...event,text:'disponible'},facts}],{now});assert.equal(b.rows.length,1);assert.equal(b.rows[0].reason,'conflicting_revision');assert.equal(b.rows[0].public_proposal,null);assert.equal(b.metrics.responded_by_agent,0);
});
test('platform identities never merge',()=>{const b=reviewBatch([{event,facts},{event:{...event,platform:'facebook'},facts:{...facts,platform:'facebook'}}],{now});assert.equal(b.rows.length,2);});
test('private eligibility is platform-bound and remains proposal only',()=>{
 const cap={platform:'instagram',connection_ref:ref(1),comment_ref:ref(2),verified:true,private_reply_allowed:true,already_used:false,checked_at:new Date(now).toISOString()};
 assert.ok(decide({},facts,cap).private_proposal);assert.equal(decide({},facts,cap).private_send_allowed,false);
 for(const patch of [{platform:'facebook'},{already_used:true},{verified:false}])assert.equal(decide({},facts,{...cap,...patch}).private_proposal,null);
 assert.equal(decide({live:true},facts,cap).private_proposal,null);
});
async function call({role='admin',allowed=true,method='GET',query={},fail=false}={}){
 let reads=0;const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;}};
 await createCommentObservationApi({allowed:()=>allowed,authorize:async()=>({active:true,role_id:role}),loadInstagram:async()=>{reads++;if(fail)throw Error('private detail');return [];}})({method,query},res);
 return {...res,reads};
}
test('operator authorization enforced before reading',async()=>{for(const role of ['asesor','staff','inactive']){const r=await call({role});assert.equal(r.code,403);assert.equal(r.reads,0);}});
test('production disabled before reads',async()=>{const r=await call({allowed:false});assert.equal(r.code,404);assert.equal(r.reads,0);assert.equal(commentObservationAllowed({VERCEL_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:'https://hjfwjnejbcpmknvfpdcq.supabase.co'}),false);});
test('POST and caller-supplied facts prohibited',async()=>{assert.equal((await call({method:'POST'})).code,405);assert.equal((await call({query:{facts:'fake'}})).code,400);});
test('reader errors are sanitized, not empty success',async()=>{const r=await call({fail:true});assert.equal(r.code,503);assert.deepEqual(r.body,{error:'observation_unavailable'});});
test('response explicitly identifies pending guarantees',async()=>{const r=await call();assert.equal(r.code,200);assert.equal(r.body.durable_audit,false);assert.equal(r.body.approval_enabled,false);assert.equal(r.body.sender,false);});
