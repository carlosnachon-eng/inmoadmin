import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticQA} from './whatsappAdminSynthetic.mjs';
test('three synthetic subjects through real reader and adapter; chronology, previews, echo, media, isolation',async()=>{
 const qa=syntheticQA(),list=await qa.request({op:'threads'});
 assert.equal(list.code,200);assert.equal(list.body.rows.length,3);
 assert.deepEqual(list.body.rows.map(x=>x.identity_state),['ambiguous','unmatched','matched']);
 for(const row of list.body.rows){const r=await qa.request({op:'history',thread:row.thread_ref});assert.equal(r.code,200);assert.equal(r.body.rows.length,3);
 assert.deepEqual(r.body.rows.map(x=>x.occurred_at),r.body.rows.map(x=>x.occurred_at).sort());
 assert.equal(r.body.rows[1].provenance,'business_outbound_unattributed');assert.equal(r.body.rows[1].text,null);
 assert.equal(r.body.status.sender,false);assert.doesNotMatch(JSON.stringify(r.body),/subject_ref|key_tag|phone_number_id|client_identity_id/);}
 assert.match(list.body.rows[0].preview,/Contacto sintético 3/);
 qa.state.revision++;assert.match((await qa.request({op:'threads'})).body.rows[0].preview,/actualizado/);
 const before=qa.state.rpcs.length;qa.state.role='asesor';assert.equal((await qa.request({op:'threads'})).code,403);assert.equal(qa.state.rpcs.length,before);
 qa.state.role='admin';assert.equal((await qa.request({op:'threads',waba_id:'sales'})).code,400);
 assert.equal((await qa.request({op:'threads'},'POST')).code,405);
 qa.state.mode='error';assert.equal((await qa.request({op:'threads'})).code,503);
 qa.state.mode='empty';assert.deepEqual((await qa.request({op:'threads'})).body.rows,[]);
 assert.equal(qa.state.writes,0);
});
