import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareConversationMemory} from '../lib/messaging/metaAdminCapture/conversationMemory.js';
const data=JSON.parse(readFileSync(new URL('./fixtures/metaAdminConversationReplay.json',import.meta.url)));
const ref=(k,n)=>k+'_'+n.toString(16).padStart(32,'0');
for(const c of data.cases)test('15-day deidentified replay: '+c.case,()=>{
 const subject='subject_'+'a'.repeat(64),identityFingerprint='b'.repeat(64),scope={property_ref:ref('property',1),contract_ref:ref('contract',1),period:'2026-10'};
 // Simulation of the new provenance DTO; the historical corpus does not certify native Meta receipts.
 const messages=c.messages.map(m=>({...m,direction:m.direction==='inbound'?'customer_inbound':'business_outbound_unattributed',ref:ref('message',m.seq),order:m.seq,subject,edited:false,revoked:false,
   contentAuthorized:true,identityFingerprint,scope}));
 const episodes=c.seeds.map((e,j)=>({id:ref('episode',j+1),subject,identityFingerprint,scope,family:e.family,topic:e.topic,
   status:'open',version:1,pending:'verification',commitment:'none',contradiction:false,sourceRefs:e.seq.map(n=>ref('message',n))}));
 const out=prepareConversationMemory({snapshot:{subject,identity:c.identity||'matched',identityFingerprint,
  audience:c.audience||'external_verified',checkedAt:1000,complete:true,currentRef:messages.at(-1).ref,messages},episodes,
  canonical:{state:'ready',identityFingerprint,scope},now:1000});
 assert.equal(out.reason,c.expect==='audience_unverified_or_internal'?'internal_subject':c.expect);assert.equal(out.send_authorized,false);
 if(c.topic){assert.equal(out.write.episode.topic,c.topic);assert.ok(!episodes.some(e=>e.id===out.write.episode.id));}
 if(c.identity==='unmatched')assert.ok(out.projection.messages.every(m=>m.text==='[MESSAGE_RECEIVED_NO_PRIVATE_CONTEXT]'));
 if(c.case==='H83_cambio_pago_a_fuga'||c.case==='H59_agua_a_gas')assert.equal(out.projection.messages.length,1);
});
