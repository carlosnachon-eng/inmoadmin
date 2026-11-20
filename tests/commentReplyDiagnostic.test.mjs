import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseReplyRead,certifiedOrganicTarget} from '../lib/messaging/commentAgent/replyDiagnostic.js';
test('diagnostic remains bound to certified event when new organic comments arrive',()=>{
 const target={event_ref:'09082f812f5efd9360ef5e853a39929e24c4364b831e7a3c3ab24df00ba73736',deleted:false};
 assert.deepEqual(certifiedOrganicTarget([{event_ref:'other'},target]),[target]);
 assert.deepEqual(certifiedOrganicTarget([{...target,deleted:true},{...target,content_box:{origin:'meta_history_v1'}}]),[]);
});
test('DEV opt-in exposes only validated published copy and permalink, never comment content',async()=>{
 const check=async(overrides={},membership=true)=>{
  const queue=[{id:'2_3',from:{id:'2'},is_published:true,message:'Synthetic public copy',permalink_url:'https://www.facebook.com/2/posts/3',...overrides},{data:membership?[{id:'3_4'}]:[]},{id:'3_4',message:'PRIVATE COMMENT'},{data:[]}];
  return diagnoseReplyRead({account:'2',post:'2_3',comment:'3_4',token:'SECRET',includePublication:true,fetchImpl:async()=>({ok:true,status:200,json:async()=>queue.shift()})});
 };
 const result=await check();assert.equal(result.publication.copy,'Synthetic public copy');assert.ok(!JSON.stringify(result).includes('PRIVATE COMMENT'));assert.ok(!JSON.stringify(result).includes('SECRET'));
 assert.equal((await check({},false)).publication,undefined);
 assert.equal((await check({is_published:false})).publication,null);
 assert.equal((await check({permalink_url:'https://evil.example/'})).publication,null);
 assert.equal((await check({from:{id:'9'}})).publication,undefined);
});
const run=async(node,edge={data:[{id:'3_4'}]})=>{
 const queue=[{id:'2_3',from:{id:'2'}},edge,node,node?.comments];
 return diagnoseReplyRead({account:'2',post:'2_3',comment:'3_4',token:'synthetic-secret',fetchImpl:async(u,o)=>{assert.equal(o.method,'GET');assert.equal(u.hostname,'graph.facebook.com');const d=queue.shift();return {ok:!d?.error,status:d?.error?400:200,json:async()=>d};}});
};
test('reports verified reply without native IDs or content',async()=>{
 const r=await run({id:'3_4',comments:{data:[{id:'5',from:{id:'2'},message:'private-content'}]}});
 assert.equal(r.page_replied,true);assert.equal(r.status,'verified');
 for(const forbidden of ['3_4','2_3','synthetic-secret','private-content'])assert.ok(!JSON.stringify(r).includes(forbidden));
});
test('diagnoses missing reply edge, unknown authors, membership and parent',async()=>{
 assert.equal((await run({id:'3_4'})).steps[2].replies_array,false);
 assert.equal((await run({id:'3_4',comments:{data:[{id:'5'}]}})).steps[2].missing_authors,1);
 assert.equal((await run({}, {data:[]})).validation,'comment_post_denied');
 assert.equal((await run({id:'3_4',parent:{id:'6'}})).steps[2].parent_present,true);
});
test('sanitizes Graph failure and never claims absence of replies',async()=>{
 const r=await run({error:{code:100,error_subcode:33,message:'secret-content'}});
 assert.equal(r.steps[2].code,100);assert.equal(r.page_replied,null);
 assert.ok(!JSON.stringify(r).includes('secret-content'));
});
test('omitted expansion can be checked with a separate bounded GET edge',async()=>{
 const queue=[{id:'2_3',from:{id:'2'}},{data:[{id:'3_4'}]},{id:'3_4'},{data:[{id:'5',from:{id:'2'}}]}];
 const r=await diagnoseReplyRead({account:'2',post:'2_3',comment:'3_4',token:'synthetic',fetchImpl:async(u,o)=>{
  assert.equal(o.method,'GET');if(queue.length===1){assert.equal(u.pathname,'/v26.0/3_4/comments');assert.equal(u.searchParams.get('fields'),'id,from');}
  return {ok:true,status:200,json:async()=>queue.shift()};
 }});
 assert.equal(r.status,'verified');assert.equal(r.page_replied,true);assert.equal(r.steps[3].stage,'replies_edge');
});
