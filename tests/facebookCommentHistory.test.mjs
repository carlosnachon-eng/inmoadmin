import test from 'node:test';import assert from 'node:assert/strict';
import {importFacebookHistory,historicalSampleRef} from '../lib/messaging/commentAgent/facebookHistory.js';
import {projectFacebookComment} from '../lib/messaging/commentAgent/facebook.js';
import {decideComment} from '../lib/messaging/commentAgent/decision.js';
const c={connection:'00000000-0000-4000-8000-000000000001',app:'100',page:'200',secret:'a'.repeat(32),indexKey:'b'.repeat(64),dataKey:'c'.repeat(64)};
function fixture({patch={},postPatch={},existing=[]}={}){const calls=[],rows=[...existing];return {calls,rows,run:()=>importFacebookHistory({c,token:'synthetic',store:async(op,data)=>{calls.push(op);if(op==='events')return rows;if(op!=='capture')throw Error('no other writes');if(rows.some(r=>r.event_ref===data.event_ref))return{inserted:0};rows.push(data);return{inserted:1};},fetchImpl:async(url,opts)=>{assert.equal(opts.method,'GET');assert.equal(new URL(url).hostname,'graph.facebook.com');return Response.json(String(url).includes('/posts?')?{data:[{id:'200_300',from:{id:'200'},...postPatch}]}:{data:[{id:'400',from:{id:'500'},message:'precio',created_time:'2026-10-01T12:00:00Z',...patch}]});}})};}
test('historical sample is encrypted, marked and exact native binding decrypts',async()=>{const f=fixture(),r=await f.run();assert.equal(r.inserted,1);assert.equal(r.webhook_verified,false);assert.equal(f.rows[0].content_box.origin,'meta_history_v1');assert.equal(JSON.stringify(f.rows).includes('precio'),false);const p=projectFacebookComment(c,f.rows[0]);assert.equal(p.event.historical,true);assert.equal(p.event.text,'precio');assert.equal(p.native.comment_id,'400');});
test('repeated import does not read Meta or insert again',async()=>{const f=fixture();await f.run();const r=await f.run();assert.equal(r.inserted,0);assert.equal(f.rows.length,1);assert.deepEqual(f.calls,['events','capture','events']);});
test('metadata tampering fails authenticated provenance',async()=>{const f=fixture();await f.run();delete f.rows[0].content_box.origin;assert.throws(()=>projectFacebookComment(c,f.rows[0]),/provenance/);});
test('foreign publication or nested comment fail without capture',async()=>{for(const opts of [{postPatch:{from:{id:'999'}}},{patch:{parent:{id:'999'}}}]){const f=fixture(opts);await assert.rejects(f.run());assert.deepEqual(f.calls,['events']);}});
test('new, hidden, own or invalid date excluded',async()=>{for(const patch of [{created_time:'2026-10-22T00:00:00Z'},{created_time:'bad'},{is_hidden:true},{from:{id:'200'}}]){const f=fixture({patch});assert.equal((await f.run()).inserted,0);assert.equal(f.rows.length,0);}});
test('missing author retained as unknown and always escalated, no proposal',async()=>{const f=fixture({patch:{from:null}});assert.equal((await f.run()).author_verified,false);const {event}=projectFacebookComment(c,f.rows[0]);assert.equal(event.own_author,null);const decision=decideComment({event:{...event,replies_verified:true}});assert.equal(decision.reason,'author_unverified');assert.equal(decision.status,'escalated');assert.equal(decision.public_proposal,null);assert.equal(decision.publish_allowed,false);});
test('fixed batch event slot limits concurrency without claiming webhook HMAC',()=>{assert.equal(historicalSampleRef(c),historicalSampleRef(c));assert.notEqual(historicalSampleRef(c),historicalSampleRef({...c,connection:'different'}));});
function proposalFixture({linked=true,inventory=true,replied=false,complete=true,author=true}={}){
 const rows=[],calls=[];const text=linked?'https://emporioinmobiliario.com.mx/propiedades/EMP-TEST1':'sin enlace';
 const q={select(){return this;},eq(){return this;},async limit(){return {data:inventory?[{id:'synthetic-property',public_id:'EMP-TEST1',status:'published',precio:1000000,moneda:'MXN',operacion:'venta'}]:[]};}};
 return {rows,calls,run:()=>importFacebookHistory({c,token:'synthetic',proposalOnly:true,db:{from:()=>q},store:async(op,row)=>{if(op==='events')return rows;assert.equal(op,'capture');rows.push(row);return {inserted:1};},fetchImpl:async(url,opts)=>{
  assert.equal(opts.method,'GET');const path=new URL(url).pathname;calls.push(path);
  if(path.endsWith('/posts'))return Response.json({data:[{id:'200_300',from:{id:'200'},message:text}]});
  if(path.endsWith('/200_300'))return Response.json({id:'200_300',from:{id:'200'},message:text});
  if(path.endsWith('/200_300/comments'))return Response.json({data:[{id:'400',from:author?{id:'500'}:null,message:'precio',created_time:'2026-10-01T12:00:00Z'}]});
  if(path.endsWith('/400'))return Response.json({id:'400',from:{id:'500'},comments:{data:replied?[{id:'600',from:{id:'200'}}]:[],...(complete?{}:{paging:{next:'never-follow'}})}});
  throw Error('unexpected read');
 }})};
}
test('proposal search requires real inventory binding, absent reply and known author',async()=>{
 for(const options of [{linked:false},{inventory:false},{replied:true},{complete:false},{author:false}]){const f=proposalFixture(options);assert.equal((await f.run()).inserted,0);assert.equal(f.rows.length,0);}
});
test('eligible proposal sample encrypted and repeated search bounded without more reads',async()=>{
 const f=proposalFixture();assert.equal((await f.run()).inserted,1);assert.equal(f.rows.length,1);assert.equal(projectFacebookComment(c,f.rows[0]).event.author_verified,true);const n=f.calls.length;assert.equal((await f.run()).inserted,0);assert.equal(f.calls.length,n);assert.equal(JSON.stringify(f.rows).includes('precio'),false);
});
