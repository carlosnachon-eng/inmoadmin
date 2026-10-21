import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';
import {captureFacebookComments,projectFacebookComment} from '../lib/messaging/commentAgent/facebook.js';
import {publicationFacts,inspectMetaComment} from '../lib/messaging/commentAgent/verifiedPublication.js';
import {recordReview,approveReview} from '../lib/messaging/commentAgent/review.js';
import * as crypto from '../lib/messaging/facebook/messenger/crypto.js';
const c={connection:'00000000-0000-4000-8000-000000000001',app:'100',page:'200',secret:'a'.repeat(32),indexKey:'b'.repeat(64),dataKey:'c'.repeat(64)},ref=n=>String(n).repeat(64);
function capture(patch={}){const raw=Buffer.from(JSON.stringify({object:'page',entry:[{id:'200',time:1780000000,changes:[{field:'feed',value:{item:'comment',verb:'add',comment_id:'200_300',post_id:'200_400',parent_id:'200_400',from:{id:'500'},message:'precio',...patch}}]}]}));return{raw,signature:'sha256='+createHmac('sha256',c.secret).update(raw).digest('hex')};}
test('signed Facebook feed captured separately encrypted and deduplicable',()=>{const {raw,signature}=capture();const a=captureFacebookComments(raw,signature,c)[0],b=captureFacebookComments(raw,signature,c)[0];assert.equal(a.event_ref,b.event_ref);assert.equal(a.thread_ref,undefined);assert.equal(a.content_box.data.includes('precio'),false);assert.equal(projectFacebookComment(c,a).event.text,'precio');});
test('bad HMAC/account/post are rejected',()=>{const {raw,signature}=capture();assert.throws(()=>captureFacebookComments(raw,'sha256='+'0'.repeat(64),c));assert.throws(()=>captureFacebookComments(raw,signature,{...c,page:'201'}));const x=capture({post_id:'201_400'});assert.throws(()=>captureFacebookComments(x.raw,x.signature,c));});
test('removal and own author classified safely; tamper rejected',()=>{const x=capture({verb:'remove',from:{id:'200'}}),e=captureFacebookComments(x.raw,x.signature,c)[0];assert.equal(e.deleted,true);assert.equal(projectFacebookComment(c,e).event.own_author,true);assert.throws(()=>projectFacebookComment(c,{...e,comment_ref:ref(9)}));});
const event={platform:'instagram',connection_ref:ref(1),post_ref:ref(2),comment_ref:ref(3),event_ref:ref(4),owned:true,replies_verified:true,occurred_at:new Date().toISOString(),text:'precio'};
test('only verified exact publication with one first party catalog link selects property',async()=>{
 let reads=0;const db={from(){reads++;return{select(){return this;},eq(){return this;},async limit(){return{data:[{id:'synthetic',public_id:'EMP-TEST1',status:'published',precio:100,moneda:'MXN',operacion:'venta'}]};}};}};
 const publication={verified:true,platform:'instagram',connection_ref:ref(1),post_ref:ref(2),text:'https://emporioinmobiliario.com.mx/propiedades/EMP-TEST1'};
 assert.equal((await publicationFacts({publication,event,db,reference:()=>ref(8)})).price,100);
 assert.equal(await publicationFacts({publication:{...publication,post_ref:ref(9)},event,db}),null);assert.equal(reads,1);
 assert.equal(await publicationFacts({publication:{...publication,text:publication.text+' https://emporioinmobiliario.com.mx/propiedades/EMP-TEST2'},event,db}),null);
});
test('external replies require complete authors and exact post binding',async()=>{
 const read=async replies=>inspectMetaComment({platform:'facebook',account:'200',post:'200_400',comment:'200_300',token:'synthetic',fetchImpl:async u=>({ok:true,json:async()=>String(u).includes('/200_400?')?{id:'200_400',from:{id:'200'},message:'listing'}:{id:'200_300',parent:{id:'200_400'},from:{id:'500'},comments:replies}})});
 assert.equal((await read({data:[{id:'200_600',from:{id:'200'}}]})).replied,true);
 assert.equal((await read({data:[],paging:{next:'not-followed'}})).replies_verified,false);
 assert.equal((await read({data:[{id:'200_600'}]})).replies_verified,false);
});
test('approval decrypts exact review and only stores approval; no transport',async()=>{
 const row={status:'proposed',comment_ref:ref(3),revision:ref(4)},actor={id:'test-actor'};row.decision_box=crypto.seal(c,'commercial-review',[row.comment_ref,row.revision],{public_proposal:'Precio verificado'});
 const calls=[];const result=await approveReview({row,text:'Texto revisado',actor,c,crypto,store:async(op,data)=>{calls.push({op,data});return{status:'approved_not_sent'};}});
 assert.equal(result.status,'approved_not_sent');assert.deepEqual(calls.map(x=>x.op),['approve']);assert.equal(JSON.stringify(calls).includes('Texto revisado'),false);
 await assert.rejects(approveReview({row:{...row,comment_ref:ref(9)},text:'Texto',actor,c,crypto,store:async()=>{throw Error('must not call');}}));
});
