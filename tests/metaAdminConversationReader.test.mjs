import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createConversationMemoryReader,CONVERSATION_INBOUND_SQL} from '../lib/messaging/metaAdminCapture/conversationMemoryReader.js';
import {ADMIN_SCOPE} from '../lib/messaging/metaAdminCapture/shadowOnce.js';
const id='11111111-1111-4111-8111-111111111111',person='22222222-2222-4222-8222-222222222222',now=100000;
const ref=k=>k+'_'+'a'.repeat(16);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture({identity='matched',audience='external_verified',authorize=true,stale=false,change=false,evidence}={}){
 let reads=0;const queries=[];
 const identityData=identity==='matched'?{state:'matched',reason:'exact_existing_canonical_phone',candidate_count:1,client_identity_id:person,authorizes_business:false}:
 {state:'unmatched',reason:'no_exact_identity',candidate_count:0,authorizes_business:false};
 const identityFingerprint=hash([person,identityData.reason]);
 const scope={property_ref:ref('property'),unit_ref:null,contract_ref:ref('contract'),period:'2026-10'};
 const snap=()=>({enabled:true,scope_channel:ADMIN_SCOPE.channelId,checked_at:new Date(stale?now-5001:now).toISOString(),mutated:change&&reads>1,
 later_scope_echoes:0,echo_assessments:[],later_scope_uncertain:0,identity:identityData,input:{id,waba_id:ADMIN_SCOPE.wabaId,
 phone_number_id:ADMIN_SCOPE.phoneNumberId,subject_ref:'native-hmac',key_tag:'keytag',capture_reason:'captured',message_type:'text',
 observer_only:true,observer_state:'observed',sanitized_text:'El pago'}});
 const reader=createConversationMemoryReader({inputId:id,now:()=>now,
 client:{query:async(q,args)=>{queries.push(q);assert.equal(q,CONVERSATION_INBOUND_SQL);assert.deepEqual(args,[id]);return {rows:[{id,provenance:'customer_inbound',sanitized_text:'El pago',message_type:'text',mutated:false}]};}},
 memoryStore:{read:async()=>[]},readSnapshot:async()=>{reads++;return snap();},readAudience:async()=>audience,
 readEvidence:evidence?async()=>evidence:undefined,
 readCanonical:async()=>({state:'ready',...scope,charges:{period:'2026-10'}}),
 authorizeMessage:async()=>authorize?{allowed:true,identityFingerprint,scope}:null});
 return {reader,queries};
}
test('reader real SQL capability is SELECT-only and explicitly scoped',async()=>{
 const f=fixture();assert.equal((await f.reader()).status,'ready');assert.equal(f.queries.length,1);
 assert.ok(!/\b(insert|update|delete|call)\b/i.test(CONVERSATION_INBOUND_SQL));
 for(const field of ['waba_id','phone_number_id','sender_ref','key_tag'])assert.ok(CONVERSATION_INBOUND_SQL.includes(field));
});
test('history does not require per-message private authorization',async()=>assert.equal((await fixture({authorize:false}).reader()).status,'ready'));
test('reader unmatched anonymous without historical grant',async()=>{
 const x=await fixture({identity:'unmatched',authorize:false}).reader();assert.equal(x.status,'ready');
 assert.equal(x.projection.messages[0].text,'[MESSAGE_RECEIVED_NO_PRIVATE_CONTEXT]');
});
test('reader cannot infer external from channel',async()=>assert.equal((await fixture({audience:'unknown'}).reader()).reason,'audience_unknown_anonymous_only'));
test('reader rejects stale snapshot',async()=>assert.rejects(fixture({stale:true}).reader(),/observation_not_fresh/));
test('reader repeats gates after reads',async()=>assert.rejects(fixture({change:true}).reader(),/memory_snapshot_changed/));
test('real evidence unknown blocks BEFORE fetching any historic text',async()=>{
 const f=fixture({evidence:{subjectRef:'native-hmac',keyTag:'keytag',audience:'unknown',historyAuthorized:false}});
 assert.equal((await f.reader()).status,'clarification_required');assert.equal(f.queries.length,0);
});
test('evidence subject mismatch fails closed',async()=>{
 const f=fixture({evidence:{subjectRef:'other',keyTag:'keytag',audience:'unknown'}});
 await assert.rejects(f.reader(),/subject_changed/);assert.equal(f.queries.length,0);
});
