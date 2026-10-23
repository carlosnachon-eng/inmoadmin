import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {associationOperation,bindProperty,readPropertyAssociation} from '../lib/messaging/commentAgent/propertyAssociation.js';
import {publicationFacts} from '../lib/messaging/commentAgent/verifiedPublication.js';
import {decideComment} from '../lib/messaging/commentAgent/decision.js';
import * as crypto from '../lib/messaging/facebook/messenger/crypto.js';
const r=n=>String(n).repeat(64),actor={id:'test-actor',role_id:'admin'},c={connection:'test-connection',app:'100',page:'200',indexKey:'b'.repeat(64),dataKey:'c'.repeat(64),senderEnabled:false};
const event={platform:'facebook',connection_ref:r(1),post_ref:r(2),comment_ref:r(3),event_ref:r(4),owned:true,replies_verified:true,occurred_at:new Date().toISOString(),text:'precio'};
const row={comment_ref:r(3),event_ref:r(4),revision:r(5),decision_box:crypto.seal(c,'commercial-review',[r(3),r(5)],{})};
const op={op:'bind_property',comment:r(3),revision:r(5),confirmed:true,property_public_id:'EMP-SYNTHETIC'};
test('only explicit confirmation and opaque exact revision allowed',()=>{
 assert.deepEqual(associationOperation(op),op);
 for(const patch of [{confirmed:false},{comment:'native-id'},{property_public_id:'https://evil.test'},{token:'bad'}])assert.throws(()=>associationOperation({...op,...patch}));
});
test('binding persists encrypted evidence, no price or native ID',async()=>{
 let saved;assert.equal((await bindProperty({operation:op,row,event,proof:{verified:true},c,actor,crypto,links:async(kind,d)=>{assert.equal(kind,'bind');saved=d;return{status:'bound'};}})).status,'bound');
 const stored={platform:'facebook',connection_id:c.connection,post_ref:r(2),property_id:'internal-property',confirmed_by:actor.id,evidence_box:saved.evidence_box};
 const association=await readPropertyAssociation({event,links:async()=>stored,crypto,c});assert.equal(association.public_id,op.property_public_id);
 assert.equal(JSON.stringify(saved.evidence_box).includes('EMP-SYNTHETIC'),false);
 for(const patch of [{platform:'instagram'},{connection_id:'other'},{post_ref:r(6)},{confirmed_by:'other'}])await assert.rejects(readPropertyAssociation({event,links:async()=>({...stored,...patch}),crypto,c}));
});
test('stale, deleted, unverified, sender-on, unauthorized bindings never write',async()=>{
 const base={operation:op,row,event,proof:{verified:true},c,actor,crypto,links:async()=>{throw Error('unexpected write');}};
 for(const patch of [{proof:{}},{event:{...event,deleted:true}},{row:{...row,revision:r(9)}},{actor:{...actor,role_id:'asesor'}},{c:{...c,senderEnabled:true}}])assert.equal((await bindProperty({...base,...patch})).status,'association_target_denied');
 await assert.rejects(bindProperty({...base,row:{...row,decision_box:{}}}));
});
function dbFor(p){return{from:()=>({select(){return this;},eq(){return this;},async limit(){return{data:p?[p]:[]};}})};}
const property={id:'property',public_id:'EMP-SYNTHETIC',status:'published',precio:'6700000.00',moneda:'MXN',operacion:'venta'};
const publication={verified:true,platform:event.platform,connection_ref:event.connection_ref,post_ref:event.post_ref,text:'Copy sin referencia ni precio vigente'};
const association={property_id:'property',public_id:'EMP-SYNTHETIC',source:'human_confirmed_publication'};
test('durable association reads current DEV facts, not old copy or confirmation price',async()=>{
 for(const price of ['6700000.00',6800000]){
  const facts=await publicationFacts({publication,event,association,db:dbFor({...property,precio:price}),reference:()=>r(8)});
  assert.equal(facts.price,Number(price));assert.equal(decideComment({event,facts}).status,'proposed');assert.equal(facts.availability,undefined);
 }
 assert.equal(await publicationFacts({publication,event,association,db:dbFor(null),reference:()=>r(8)}),null);
 assert.equal(await publicationFacts({publication,event,db:dbFor(property),reference:()=>r(8)}),null);
});
test('conflicting URL, changed property identity, malformed/unsafe price fail closed',async()=>{
 assert.equal(await publicationFacts({publication:{...publication,text:'https://emporioinmobiliario.com.mx/propiedades/EMP-OTHER'},event,association,db:dbFor(property)}),null);
 await assert.rejects(publicationFacts({publication,event,association,db:dbFor({...property,id:'other'})}));
 for(const precio of ['9007199254740993','6,700,000','NaN',-1,null])assert.equal((await publicationFacts({publication,event,association,db:dbFor({...property,precio}),reference:()=>r(8)})).price,null);
});
test('normal runtime no longer imports certification override; UI exposes explicit confirmation',async()=>{
 const runtime=await readFile(new URL('../lib/messaging/commentAgent/facebookDevReview.js',import.meta.url),'utf8');
 assert.equal(runtime.includes('confirmedDevProposal'),false);assert.equal(runtime.includes('recordConfirmedDevProposal'),false);
 const ui=await readFile(new URL('../components/CommentReviewPanel.js',import.meta.url),'utf8');assert.match(ui,/Guardar asociación sin publicar/);assert.match(ui,/property_unavailable/);
});
