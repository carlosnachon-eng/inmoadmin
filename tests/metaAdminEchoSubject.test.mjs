import assert from 'node:assert/strict';
import test from 'node:test';
import { captureEchoSubjects, assessEchoSubjects } from '../lib/messaging/metaAdminCapture/echoSubject.js';
import { captureMetaAdminInputs } from '../lib/messaging/metaAdminCapture/capture.js';
import { normalizeMetaObservations } from '../lib/messaging/metaObserver/normalize.js';
const scope={wabaId:'1297760461811288',phoneNumberId:'1198305790026665'};
const config={notBefore:'2026-10-08T00:00:00Z',hmacKey:'b2'.repeat(32),encryptionKey:'a1'.repeat(32)};
const from='522221234567';
const inbound={id:'wamid.SYNTHETIC_IN',from,timestamp:'1791490000',type:'text',text:{body:'Consulta sintética'}};
const echo={id:'wamid.SYNTHETIC_ECHO',to:from,from:'522220000000',timestamp:inbound.timestamp,type:'text',text:{body:'No conservar'}};
function capture(items=[echo],extra={}) {
 const body={object:'whatsapp_business_account',entry:[{id:scope.wabaId,changes:[
  {field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:scope.phoneNumberId},messages:[inbound]}},
  {field:'smb_message_echoes',value:{messaging_product:'whatsapp',metadata:{phone_number_id:scope.phoneNumberId},message_echoes:items}}]}]};
 const events=normalizeMetaObservations(body,scope).events;
 const inputs=captureMetaAdminInputs(body,events,scope,config);
 return {rows:captureEchoSubjects(body,events,inputs,scope,{...config,...extra}),inputs};
}
const node=(row,id,native,original=null)=>({...row,event_id:id,native_message_id:native,
 waba_id:scope.wabaId,phone_number_id:scope.phoneNumberId,original_message_id:original});
function assessment(items=[echo],adjust=()=>{}) {
 const {rows}=capture(items),target=node(rows[0],'input',inbound.id);
 const nodes=[target,...rows.slice(1).map((r,k)=>node(r,`e${k}`,items[k].id,items[k][items[k].type]?.original_message_id))];
 adjust(target,nodes);return assessEchoSubjects(target,nodes.slice(1).map(n=>n.event_id),nodes);
}
test('same native HMAC as sender_ref, no clear addresses/text in sidecar',()=>{
 const {rows,inputs}=capture();assert.equal(rows[0].subject_ref,inputs[0].sender_ref);
 assert.equal(rows[1].subject_ref,inputs[0].sender_ref);
 for(const raw of [from,echo.from,'No conservar'])assert.equal(JSON.stringify(rows).includes(raw),false);
 assert.equal(assessment()[0].state,'same_subject');
});
test('different exact recipient, identical timestamp is other_subject',()=>{
 assert.equal(assessment([{...echo,to:'522221234568'}])[0].state,'other_subject');
});
test('native phone semantics do not canonicalize 521 or ten digits',()=>{
 for(const to of ['5212221234567','2221234567'])assert.equal(assessment([{...echo,to}])[0].state,'other_subject');
});
test('context direct exact inbound without recipient proves same subject',()=>{
 assert.equal(assessment([{...echo,to:undefined,context:{id:inbound.id}}])[0].state,'same_subject');
});
test('context against different recipient is conflict',()=>{
 assert.equal(assessment([{...echo,to:'522221234568',context:{id:inbound.id}}])[0].state,'conflict');
});
for(const item of [{...echo,to:undefined},{...echo,to:'invalid'},
 {...echo,context:{}},{...echo,context:{id:'wamid.UNKNOWN'}}])
 test(`missing/malformed/unresolved evidence fails closed ${JSON.stringify(item.context||item.to)}`,()=>{
  assert.equal(assessment([item])[0].state,'unknown');
 });
test('scope mismatch, key rotation or historical missing evidence are unknown',()=>{
 for(const change of [n=>n.phone_number_id='other',n=>n.key_tag='c'.repeat(64),n=>delete n.evidence_state])
  assert.equal(assessment([echo],(t,n)=>change(n[1]))[0].state,'unknown');
});
test('duplicates idempotent; conflicting same ID rejected without clear data',()=>{
 assert.equal(capture([echo,echo]).rows.length,2);
 assert.throws(()=>capture([echo,{...echo,to:'522221234568'}]),/^Error: meta_echo_subject_conflict$/);
});
test('pre-cutoff excluded',()=>assert.equal(capture([echo],{notBefore:'2099-01-01T00:00:00Z'}).rows.filter(r=>r.evidence_source!=='signed_from').length,0));
test('edit/revoke inherit only exact original links',()=>{
 for(const type of ['edit','revoke']) {
  const mutation={...echo,id:`wamid.SYNTHETIC_${type}`,to:undefined,type,[type]:{original_message_id:echo.id}};
  // No own recipient/context: original reference alone is eligible evidence.
  const r=assessment([echo,mutation]);assert.equal(r[0].state,'same_subject');assert.equal(r[1].state,'same_subject');
 }
});
test('cycles and duplicate reference targets fail closed',()=>{
 assert.equal(assessment([{...echo,context:{id:echo.id}}])[0].state,'unknown');
 const {rows}=capture(),target=node(rows[0],'i',inbound.id),e=node({...rows[1],context_id:inbound.id},'e',echo.id);
 assert.equal(assessEchoSubjects(target,['e'],[target,{...target,event_id:'i2'},e])[0].state,'unknown');
});
