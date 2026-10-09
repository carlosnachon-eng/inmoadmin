import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createAdminShadowContextReaders,prepareAdminShadowContext} from '../lib/messaging/metaAdminCapture/shadowContextReadOnly.js';
import {createEvidenceBackedConversationReader} from '../lib/messaging/metaAdminCapture/conversationMemorySupabase.js';
import {prepareConversationMemory} from '../lib/messaging/metaAdminCapture/conversationMemory.js';
import {ADMIN_SCOPE,restrictedAdminRequest,runMetaAdminShadowOnce} from '../lib/messaging/metaAdminCapture/shadowOnce.js';
const source=JSON.parse(readFileSync(new URL('./fixtures/metaAdminMemoryDevBundle.json',import.meta.url)));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function readOnlyReplay(tables){
 const mutations=[];const deny=()=>{mutations.push('attempt');throw Error('write_forbidden');};
 return {mutations,admin:{rpc:deny,from(table){let filters=[],columns,limit=100;
  const q={select:c=>{assert.ok(!c.includes('*'));columns=c;return q;},
   eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},in:(k,v)=>{filters.push(r=>v.includes(r[k]));return q;},
   gte:(k,v)=>{filters.push(r=>r[k]>=v);return q;},lte:(k,v)=>{filters.push(r=>r[k]<=v);return q;},
   limit:n=>{limit=n;return q;},order:()=>q,insert:deny,update:deny,delete:deny,upsert:deny,
   then(ok,bad){return Promise.resolve({data:(tables[table]||[]).filter(r=>filters.every(f=>f(r))).slice(0,limit)
    .map(r=>Object.fromEntries(columns.split(',').map(k=>[k,r[k]]))),error:null}).then(ok,bad);}};return q;
 }}};
}
// This is an intercepted replay of actual DEV SQL fixture output, not a live model,
// and not a claim that a cached snapshot is currently fresh. Replay clock is explicit.
for(const variant of ['complete','canonical_revoked','audience_unknown','internal','post_context_changed'])test('DEV-source intercepted Shadow replay: '+variant,async()=>{
 const b=structuredClone(source),now=()=>Date.parse(b.checked_at),inputId=b.snapshot.input.id;
 const snapshot=async()=>({...structuredClone(b.snapshot),echo_assessments:[]});
 const {admin,mutations}=readOnlyReplay(b.tables);
 const readers=createAdminShadowContextReaders({db:admin,snapshot,inputId,now});
 const readContext=()=>prepareAdminShadowContext({readers,sections:['agreement']});
 const initial=await readContext();assert.equal(initial.state,'ready',JSON.stringify(initial));
 const identityFingerprint=hash([b.snapshot.identity.client_identity_id,b.snapshot.identity.reason]);
 const subject='subject_'+hash([ADMIN_SCOPE,b.proof.subject_ref,b.proof.key_tag]);
 const scope={property_ref:initial.property_ref,unit_ref:initial.unit_ref,contract_ref:initial.contract_ref};
 const first=b.history[0];
 const seed=prepareConversationMemory({snapshot:{subject,identity:'matched',identityFingerprint,audience:'external_verified',checkedAt:now(),complete:true,
  currentRef:'message_'+hash(first.id),messages:[{ref:'message_'+hash(first.id),subject,order:0,direction:first.provenance,text:first.sanitized_text,edited:false,revoked:false,attachment:false}]},
  canonical:{state:'ready',identityFingerprint,scope},episodes:[],now:now()});
 assert.ok(seed.write);
 let modelCalls=0,historyReads=0;
 const rpc=async(name,args)=>{
  if(name==='meta_admin_memory_evidence_v1')return {data:{...b.proof,audience:variant==='audience_unknown'?'unknown':variant==='internal'?'internal':b.proof.audience}};
  if(name==='meta_admin_memory_history_v1'){historyReads++;assert.equal(args.p_input_id,inputId);return {data:b.history};}
  if(name==='meta_admin_memory_read_v1'){assert.equal(args.p_subject,subject);return {data:[seed.write.episode]};}
  assert.fail('unexpected RPC/write '+name);
 };
 const readConversation=createEvidenceBackedConversationReader({db:{rpc},inputId,readSnapshot:snapshot,readCanonical:readContext,now});
 if(variant==='canonical_revoked')b.tables.client_identity_roles[0].status='revoked';
 let terminal;
 const result=await runMetaAdminShadowOnce({inputId,authorizedInputId:inputId,now,env:{OPENAI_ADMIN_AGENT_MODEL:'gpt-4.1-mini'},readContext,readConversation,
  store:{snapshot,claim:async()=>true,start:async()=>true,startAdminModel:async()=>true,finish:async x=>{terminal=x.status;}},
  propose:async context=>{
   modelCalls++;const request=restrictedAdminRequest(context,{OPENAI_ADMIN_AGENT_MODEL:'gpt-4.1-mini'}),payload=JSON.parse(request.input);
   assert.deepEqual(request.tools,[]);
   if(['complete','post_context_changed'].includes(variant)){
    assert.equal(payload.conversation_memory.messages.length,2);assert.equal(payload.admin_context.agreement.monthly_amount,'1234.00');
   }else{assert.ok(!request.input.includes('1234'));assert.equal(payload.conversation_memory.messages.length,0);}
   if(variant==='post_context_changed')b.tables.contracts[0].monthly_rent=5678;
   return {provider:'openai',model:'gpt-4.1-mini',run_id:'mock-only',proposed_response:'Propuesta interceptada de prueba.'};
  }});
 assert.equal(modelCalls,variant==='internal'?0:1);assert.equal(result.send_calls,0);assert.equal(mutations.length,0);
 assert.equal(terminal,variant==='internal'?'blocked':variant==='post_context_changed'?'invalidated':'complete');
 if(['internal','audience_unknown'].includes(variant))assert.equal(historyReads,0);
});
