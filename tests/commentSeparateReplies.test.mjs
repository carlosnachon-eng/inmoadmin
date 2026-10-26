import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMetaComment} from '../lib/messaging/commentAgent/verifiedPublication.js';
const run=async(replies,{status=200,node={id:'3_4'},owner='2',member='3_4'}={})=>{
 const calls=[];const queue=[{id:'2_3',from:{id:owner}},{data:[{id:member}]},node,replies];
 const result=inspectMetaComment({platform:'facebook',account:'2',post:'2_3',comment:'3_4',token:'synthetic',fetchImpl:async(u,o)=>{
  calls.push(u);assert.equal(o.method,'GET');assert.equal(o.redirect,'error');assert.equal(u.hostname,'graph.facebook.com');
  const body=queue.shift();if(calls.length===4){assert.equal(u.pathname,'/v26.0/3_4/comments');assert.equal(u.searchParams.get('limit'),'100');assert.equal(u.searchParams.get('fields'),'id,from');}
  return {ok:calls.length!==4||status===200,json:async()=>body};
 }});return {result,calls};
};
test('omitted expansion and empty explicit edge proves no replies',async()=>{
 const {result,calls}=await run({data:[]});assert.equal((await result).replies_verified,true);assert.equal(calls.length,4);
});
test('Page reply detected using author, not text',async()=>{
 const {result}=await run({data:[{id:'5',from:{id:'2'}}]});assert.equal((await result).replied,true);
});
test('incomplete or malformed edge never proves absence',async()=>{
 for(const edge of [{},{data:null},{data:[],paging:{next:'https://evil.invalid'}},{data:[{id:'5'}]},{data:[null]},{data:Array.from({length:101},()=>({id:'5',from:{id:'6'}}))}]){
  const {result,calls}=await run(edge);assert.equal((await result).replies_verified,false);assert.equal(calls.length,4);
 }
});
test('Graph error and HTTP failure fail closed with no retry',async()=>{
 for(const [data,status] of [[{error:{code:100}},200],[{},403]]){const {result,calls}=await run(data,{status});await assert.rejects(result,/meta_read_unavailable/);assert.equal(calls.length,4);}
});
test('foreign owner, membership or nested target block before replies',async()=>{
 for(const options of [{owner:'9'},{member:'9'},{node:{id:'3_4',parent:{id:'9'}}}]){const {result,calls}=await run({data:[]},options);await assert.rejects(result);assert.ok(calls.length<4);}
});
test('Instagram retains its existing replies expansion and three-free read path',async()=>{
 let calls=0;const proof=await inspectMetaComment({platform:'instagram',account:'2',post:'3',comment:'4',token:'synthetic',fetchImpl:async u=>{
  assert.equal(u.hostname,'graph.instagram.com');calls++;return {ok:true,json:async()=>calls===1?{id:'3',owner:{id:'2'}}:{id:'4',media:{id:'3'},replies:{data:[]}}};
 }});assert.equal(proof.replies_verified,true);assert.equal(calls,2);
});
