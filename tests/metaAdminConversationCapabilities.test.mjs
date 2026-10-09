import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConversationMemorySupabase,createConversationMemoryEvidence} from '../lib/messaging/metaAdminCapture/conversationMemorySupabase.js';
const inputId='11111111-1111-4111-8111-111111111111',now=Date.parse('2026-10-09T00:00Z');
const base={input_id:inputId,checked_at:new Date(now).toISOString(),native_verified:true,scope_verified:true,subject_ref:'a'.repeat(64),key_tag:'b'.repeat(64),audience:'unknown'};
const db=(data=base,error=null)=>({rpc:async(name,args)=>{assert.equal(name,'meta_admin_memory_evidence_v1');assert.deepEqual(args,{p_input_id:inputId});return {data,error};}});
test('real adapter accepts accredited audience but never grants data or human authorship',async()=>{
 const result=await createConversationMemoryEvidence(db({...base,audience:'external_verified',history_authorized:true}),{now:()=>now})(inputId);
 assert.equal(result.audience,'external_verified');assert.equal(result.historyAuthorized,undefined);assert.equal(result.humanAuthorized,false);
});
for(const field of ['native_verified','scope_verified'])test(field+' required',async()=>{
 await assert.rejects(createConversationMemoryEvidence(db({...base,[field]:false}),{now:()=>now})(inputId),/native_scope_unverified/);
});
test('stale proof fails closed',async()=>assert.rejects(createConversationMemoryEvidence(db(),{now:()=>now+5001})(inputId),/stale/));
test('missing or unreadable source fails closed',async()=>{
 for(const source of [db(null),db(base,{message:'private detail'}),db({...base,input_id:'other'})])
  await assert.rejects(createConversationMemoryEvidence(source,{now:()=>now})(inputId),/unavailable/);
});
test('storage wrapper calls only the two fixed capabilities',async()=>{
 const calls=[];const s=createConversationMemorySupabase({rpc:async(...args)=>{calls.push(args);return {data:[],error:null};}});
 await s.read('subject_'+'a'.repeat(64));await s.append({episode:{},expectedVersion:0,sourceRef:'x'});
 assert.deepEqual(calls.map(c=>c[0]),['meta_admin_memory_read_v1','meta_admin_memory_append_v1']);
});
test('storage does not leak SQL errors',async()=>{
 await assert.rejects(createConversationMemorySupabase({rpc:async()=>({error:{message:'secret'}})}).read('x'),/^Error: memory_rpc_failed$/);
});
