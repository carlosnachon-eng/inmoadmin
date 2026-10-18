import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {submitBusinessReply} from '../lib/messaging/instagram/business/replyResult.js';
const args={thread:'thread-ref',input:'input-ref',action:'action-ref',text:'Respuesta de prueba'};
const row=(patch={})=>({input:args.input,thread_ref:args.thread,provider:'instagram_login_business',thread_type:'instagram_dm',direction:'customer_inbound',status:'accepted',...patch});
function harness(reply,history){const calls=[];return {calls,request:async(op,options)=>{calls.push({op,options});if(op==='reply')return reply();assert.equal(op,'history');return history();}};}
test('accepted response preserved without any extra request',async()=>{
 const h=harness(()=>({status:'accepted',http_status:200}),()=>assert.fail('no reconciliation required'));
 assert.deepEqual(await submitBusinessReply({...args,...h}),{status:'accepted',http_status:200});assert.equal(h.calls.length,1);
});
for(const failure of [()=>{throw Error('response lost');},()=>{throw SyntaxError('invalid JSON');},()=>undefined,()=>({status:'unknown'}),()=>({status:'uncertain'})])test('committed accepted survives lost/malformed/uncertain response with one GET only',async()=>{
 const h=harness(failure,()=>({rows:[row()]}));assert.deepEqual(await submitBusinessReply({...args,...h}),{status:'accepted',source:'journal'});
 assert.deepEqual(h.calls,[{op:'reply',options:{body:{input:args.input,action:args.action,text:args.text}}},{op:'history',options:{query:{thread:args.thread}}}]);
});
test('failed and uncertain journal outcomes are not promoted to accepted',async()=>{
 for(const status of ['failed','uncertain']){const h=harness(()=>{throw Error('lost');},()=>({rows:[row({status})]}));assert.deepEqual(await submitBusinessReply({...args,...h}),{status,source:'journal'});assert.equal(h.calls.length,2);}
});
test('missing, ambiguous, pending, foreign provider/thread/input or echo cannot prove acceptance',async()=>{
 for(const rows of [[],[row(),row()],[row({status:'dispatch_started'})],[row({status:null})],[row({thread_ref:'other'})],[row({input:'other'})],[row({provider:'legacy'})],[row({thread_type:'instagram_comment'})],[row({direction:'human_confirmed'})]]){
  const h=harness(()=>{throw Error('lost');},()=>({rows}));assert.deepEqual(await submitBusinessReply({...args,...h}),{status:'uncertain'});assert.equal(h.calls.length,2);
 }
});
test('history error including forbidden remains uncertain without retry',async()=>{
 const h=harness(()=>{throw Error('lost');},()=>{throw Error('403');});assert.deepEqual(await submitBusinessReply({...args,...h}),{status:'uncertain'});assert.equal(h.calls.length,2);
});
test('pre-claim diagnostic and disabled results do not trigger another request',async()=>{
 for(const result of [{status:'blocked',diagnostic:{stage:'pre_claim',validation:'input_window'}},{status:'disabled'},{status:'already_consumed_or_blocked'}]){
  const h=harness(()=>result,()=>assert.fail('no extra request'));assert.deepEqual(await submitBusinessReply({...args,...h}),result);assert.equal(h.calls.length,1);
 }
});
test('journal reconciliation returns no content, native IDs or ciphertext',async()=>{
 const h=harness(()=>{throw Error('lost');},()=>({rows:[row({text:'private',ciphertext:'secret',recipient:'native'})]}));assert.deepEqual(await submitBusinessReply({...args,...h}),{status:'accepted',source:'journal'});
});
test('UI retains consumed-input lock, no resend and accepted is not delivered',()=>{
 const code=readFileSync(new URL('../components/InstagramBusinessInbox.js',import.meta.url),'utf8');
 assert.ok(code.includes('consumed.current.add(input)'));assert.ok(code.includes('consumed.current.has(input)'));assert.ok(!code.includes('consumed.current.delete'));assert.ok(code.includes('submitBusinessReply({request,thread:selected,input'));assert.ok(code.includes('Accepted no acredita entrega ni lectura.'));assert.ok(code.includes('journal confirmado'));
});
