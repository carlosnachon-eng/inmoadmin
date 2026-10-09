import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareConversationMemory as prepare,conversationTopics,projectConversationMemory,memoryHash,recordConversationMemory} from '../lib/messaging/metaAdminCapture/conversationMemory.js';
import {restrictedAdminRequest,runMetaAdminShadowOnce,ADMIN_SCOPE} from '../lib/messaging/metaAdminCapture/shadowOnce.js';
const r=(kind,n)=>kind+'_'+n.toString(16).padStart(32,'0');
const subject='subject_'+'a'.repeat(64),fp='b'.repeat(64),now=100000;
const scope={property_ref:r('property',1),contract_ref:r('contract',2),period:'2026-10'};
const message=(n,text,extra={})=>({ref:r('message',n),subject,order:n,direction:'customer_inbound',text,
  edited:false,revoked:false,attachment:false,contentAuthorized:true,identityFingerprint:fp,scope,...extra});
const snapshot=(messages,extra={})=>({subject,identity:'matched',identityFingerprint:fp,audience:'external_verified',
  checkedAt:now,complete:true,currentRef:messages.at(-1).ref,messages,...extra});
const canonical={state:'ready',identityFingerprint:fp,scope};
const call=(messages,episodes=[],extra={})=>prepare({snapshot:snapshot(messages),episodes,canonical,now,...extra});
const episode=(family,sourceRefs,extra={})=>({id:r('episode',20),subject,identityFingerprint:fp,scope,family,topic:family,
  status:'open',version:1,pending:'verification',commitment:'none',contradiction:false,sourceRefs,...extra});

for(const [text,topic] of [['Cuánto es la renta mensual','agreement'],['Cuándo vence mi contrato','agreement'],
 ['Ya pagué este mes','payments'],['La fuga sigue','maintenance'],['Contrato de agua','clarification']])
test('topic comprehension: '+text,()=>assert.deepEqual(conversationTopics(text),[topic]));
test('new topic creates separate episode, not newest by time',()=>{
 const ms=[message(1,'El pago'),message(2,'Hay una fuga')];
 const out=call(ms,[episode('payments',[ms[0].ref])]);
 assert.equal(out.write.episode.family,'maintenance');assert.notEqual(out.write.episode.id,r('episode',20));
 assert.deepEqual(out.projection.messages.map(m=>m.text),['Hay una fuga']);assert.equal(out.send_authorized,false);
});
for(const text of ['los otros','alguna novedad','sí','mañana'])test('ambiguous antecedent: '+text,()=>{
 const ms=[message(1,'Pago'),message(2,text)];
 assert.equal(call(ms,[episode('payments',[ms[0].ref])]).reason,'antecedent_not_explicit');
});
test('exact native reply selects correct episode, no temporal matching',()=>{
 const ms=[message(1,'Pago'),message(2,'Fuga'),message(3,'alguna novedad',{replyRef:r('message',1)})];
 const out=call(ms,[episode('payments',[ms[0].ref]),episode('maintenance',[ms[1].ref],{id:r('episode',21)})]);
 assert.equal(out.projection.topic,'payments');assert.equal(out.projection.messages.length,2);
});
test('unresolved native reference blocks fallback',()=>assert.equal(call([message(1,'Pago',{replyRef:r('message',90)})]).reason,'reply_reference_ambiguous'));
test('conflicting native reply/topic blocks',()=>{
 const ms=[message(1,'Pago'),message(2,'Fuga',{replyRef:r('message',1)})];
 assert.equal(call(ms,[episode('payments',[ms[0].ref])]).reason,'reply_reference_ambiguous');
});
test('two active maintenance episodes need clarification',()=>{
 const ms=[message(1,'Fuga'),message(2,'Luz'),message(3,'El técnico')];
 assert.equal(call(ms,[episode('maintenance',[ms[0].ref]),episode('maintenance',[ms[1].ref],{id:r('episode',22)})]).reason,'multiple_active_episodes');
});
test('at most eight chronological messages',()=>{
 const ms=Array.from({length:12},(_,i)=>message(i+1,'Pago'));
 const out=call(ms,[episode('payments',ms.slice(0,-1).map(m=>m.ref))]);
 assert.equal(out.projection.messages.length,8);assert.equal(out.write.episode.sourceRefs.length,12);
});
test('attachment remains uninterpreted',()=>assert.equal(call([message(1,'Pago',{attachment:true})]).projection.incomplete,true));
for(const key of ['edited','revoked'])test(key+' history invalidates memory',()=>{
 const ms=[message(1,'Pago',{[key]:true}),message(2,'El pago')];
 assert.equal(call(ms,[episode('payments',[ms[0].ref])]).reason,'source_changed_or_missing');
});
for(const audience of ['internal','unknown',undefined])test('audience '+audience,()=>{
 const ms=[message(1,'Pago')];assert.equal(call(ms,[],{snapshot:snapshot(ms,{audience})}).reason,audience==='internal'?'internal_subject':'audience_unknown_anonymous_only');
});
test('foreign subject rejected before projection',()=>assert.throws(()=>call([message(1,'Pago',{subject:r('subject',3)})]),/source_scope/));
test('old different property private text never projected',()=>{
 const ms=[message(1,'Pago de otra propiedad'),message(2,'Pago')];
 const out=call(ms,[episode('payments',[ms[0].ref],{scope:{property_ref:r('property',99)}})]);
 assert.deepEqual(out.projection.messages.map(m=>m.text),['Pago']);
});
for(const state of ['ambiguous','blocked','insufficient_context'])test('canonical '+state,()=>assert.equal(call([message(1,'Pago')],[],{canonical:{state}}).reason,'canonical_scope_unavailable'));
test('identity changed blocks',()=>assert.throws(()=>call([message(1,'Pago')],[],{canonical:{...canonical,identityFingerprint:'c'.repeat(64)}}),/identity_changed/));
test('unmatched exposes only anonymous projection, not old private episodes',()=>{
 const ms=[message(1,'El pago de la propiedad privada')];
 const out=call(ms,[episode('payments',[ms[0].ref])],{snapshot:snapshot(ms,{identity:'unmatched',identityFingerprint:null}),canonical:null});
 assert.equal(out.write.episode.identityFingerprint,null);assert.deepEqual(out.write.episode.scope,{});
 assert.equal(out.projection.messages[0].text,'[MESSAGE_RECEIVED_NO_PRIVATE_CONTEXT]');
});
test('snapshot over 5 seconds rejected, old inbound not a risk by age',()=>{
 const ms=[message(1,'Pago',{occurredAt:0})];assert.equal(call(ms).status,'ready');
 assert.throws(()=>call(ms,[],{snapshot:snapshot(ms,{checkedAt:now-5001})}),/snapshot_stale/);
});
test('mixed intentions clarify',()=>assert.equal(call([message(1,'El pago y la fuga')]).reason,'multiple_topics'));
test('contradiction preserved rather than overwritten by new statement',()=>{
 const ms=[message(1,'Pago'),message(2,'El recibo corresponde a otro periodo')];
 const out=call(ms,[episode('payments',[ms[0].ref])]);assert.equal(out.projection.state,'clarification_required');assert.equal(out.write.episode.contradiction,true);
});
test('app echo commitment observed, not proof of human or accomplished action',()=>{
 const ms=[message(1,'Lo reporto',{direction:'business_outbound_unattributed'}),message(2,'La fuga')];
 const out=call(ms,[episode('maintenance',[ms[0].ref],{topic:'maintenance_water'})]);
 assert.equal(out.projection.memory.commitment,'none');
 assert.equal(out.projection.messages[0].direction,'business_outbound_unattributed');assert.equal(out.projection.memory.commitment_attribution,'outbound_observed_not_human_proof');
});
test('projection strips internal IDs and extra data',()=>{
 const p=call([message(1,'Pago')]).projection;
 assert.equal(projectConversationMemory({...p,client_identity_id:'PRIVATE'}).client_identity_id,undefined);
});
test('explicit persistence capability only, no model/sender',async()=>{
 let writes=0;await recordConversationMemory({read:async()=>({snapshot:snapshot([message(1,'Pago')]),episodes:[],canonical}),
 store:{append:async()=>{writes++;}},now:()=>now});assert.equal(writes,1);
});
test('restricted request keeps tools empty and anonymous private history denied',()=>{
 const p=call([message(1,'Pago')]).projection,env={OPENAI_ADMIN_AGENT_MODEL:'gpt-4.1-mini'};
 assert.throws(()=>restrictedAdminRequest({identity_state:'unmatched',sanitized_text:'hola',conversation_memory:p},env),/anonymous_memory_private_text/);
 assert.deepEqual(restrictedAdminRequest({identity_state:'matched',sanitized_text:'hola',conversation_memory:p},env).tools,[]);
});
test('ambiguous episode suppresses canonical amounts at model boundary',()=>{
 const p=call([message(1,'alguna novedad')]).projection;
 const req=restrictedAdminRequest({identity_state:'matched',sanitized_text:'alguna novedad',conversation_memory:p,
 admin_context:{state:'ready',roles:['tenant'],property_ref:'property_'+'a'.repeat(16),unit_ref:null,contract_ref:'contract_'+'b'.repeat(16),
 agreement:{kind:'rent',status:'active',start_date:'2026-01-01',end_date:'2026-12-31',monthly_amount:'12345.00',currency:'MXN',source:'contracts.monthly_rent'}}},
 {OPENAI_ADMIN_AGENT_MODEL:'gpt-4.1-mini'});
 assert.equal(JSON.parse(req.input).admin_context.state,'ambiguous');assert.ok(!req.input.includes('12345'));
});
test('financial period missing cannot select payment memory',()=>assert.equal(call([message(1,'Pago')],[],
 {canonical:{...canonical,scope:{property_ref:r('property',1),contract_ref:r('contract',2)}}}).reason,'payment_period_unavailable'));
test('two canonical entities cannot grant private memory',()=>assert.equal(call([message(1,'Pago')],[],
 {canonical:{...canonical,scope:{...scope,unit_ref:r('unit',4)}}}).reason,'canonical_entity_not_unique'));

for(const change of ['none','during','before','blocked'])test('runner seam '+change,async()=>{
 const id='11111111-1111-4111-8111-111111111111';let reads=0,calls=0,claim=0,finished;
 const projection=call([message(1,'Pago')],[],{snapshot:snapshot([message(1,'Pago')],{identity:'unmatched',identityFingerprint:null}),canonical:null}).projection;
 const snap={enabled:true,scope_channel:ADMIN_SCOPE.channelId,checked_at:new Date(now).toISOString(),mutated:false,
 later_scope_echoes:0,echo_assessments:[],later_scope_uncertain:0,identity:{state:'unmatched',reason:'no_exact_identity',candidate_count:0,authorizes_business:false},
 input:{id,waba_id:ADMIN_SCOPE.wabaId,phone_number_id:ADMIN_SCOPE.phoneNumberId,capture_reason:'captured',message_type:'text',observer_only:true,observer_state:'observed',sanitized_text:'Hola'}};
 const result=await runMetaAdminShadowOnce({inputId:id,authorizedInputId:id,now:()=>now,env:{OPENAI_ADMIN_AGENT_MODEL:'gpt-4.1-mini'},
 store:{snapshot:async()=>snap,claim:async()=>{claim++;return true;},start:async()=>true,finish:async x=>{finished=x;}},
 readConversation:async()=>{reads++;return {status:change==='blocked'?'blocked':'ready',projection,fingerprint:memoryHash(change==='before'&&reads>=2||change==='during'&&reads>=3?'changed':'same')};},
 propose:async context=>{calls++;assert.ok(context.conversation_memory);return {provider:'openai',model:'gpt-4.1-mini',run_id:'fixture',proposed_response:'¿Qué deseas aclarar?'};}});
 assert.equal(claim,1);assert.equal(calls,['before','blocked'].includes(change)?0:1);assert.equal(result.send_calls,0);
 assert.equal(finished.status,change==='during'?'invalidated':change==='before'?'uncertain':change==='blocked'?'blocked':'complete');
});
