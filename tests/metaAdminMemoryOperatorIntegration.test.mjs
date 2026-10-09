import {runMetaAdminShadowOnceWithContext} from '../lib/messaging/metaAdminCapture/shadowOnceWithContext.js';
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
for(const variant of ['complete','canonical_revoked','audience_unknown','internal','post_context_changed','unmatched','media_only','pre_memory_changed','post_memory_changed','echo_unattributed','recoverable_media','media_post_echo'])test('operator memory integration: '+variant,async()=>{
 const b=structuredClone(source),now=()=>Date.parse(b.checked_at),inputId=b.snapshot.input.id;
 b.tables.payments=[{id:'a0000000-0000-4000-8000-000000000004',contract_id:b.tables.contracts[0].id,status:'pendiente',due_date:'2026-10-05',amount:1234}];
 const snapshot=async()=>({...structuredClone(b.snapshot),echo_assessments:[]});
 const {admin,mutations}=readOnlyReplay(b.tables);
 const readers=createAdminShadowContextReaders({db:admin,snapshot,inputId,now});
 const readContext=()=>prepareAdminShadowContext({readers,sections:['agreement','charges']});
 const initial=await readContext();assert.equal(initial.state,'ready',JSON.stringify(initial));
 const identityFingerprint=hash([b.snapshot.identity.client_identity_id,b.snapshot.identity.reason]);
 const subject='subject_'+hash([ADMIN_SCOPE,b.proof.subject_ref,b.proof.key_tag]);
 const scope={property_ref:initial.property_ref,unit_ref:initial.unit_ref,contract_ref:initial.contract_ref,period:initial.charges?.period};
 const first=b.history[0];
 const seed=prepareConversationMemory({snapshot:{subject,identity:'matched',identityFingerprint,audience:'external_verified',checkedAt:now(),complete:true,
  currentRef:'message_'+hash(first.id),messages:[{ref:'message_'+hash(first.id),subject,order:0,direction:first.provenance,text:first.sanitized_text,edited:false,revoked:false,attachment:false}]},
  canonical:{state:'ready',identityFingerprint,scope},episodes:[],now:now()});
 assert.ok(seed.write);
 if(variant==='unmatched')b.snapshot.identity={state:'unmatched',reason:'no_exact_identity',candidate_count:0,authorizes_business:false};
 if(variant==='media_only'){b.snapshot.input.message_type='image';b.snapshot.input.capture_reason='unsupported_message_type';b.snapshot.input.sanitized_text=null;}
 if(['recoverable_media','media_post_echo'].includes(variant)){Object.assign(b.snapshot.input,{message_type:'image',capture_reason:'media_captured',sanitized_text:null,media_reference_present:true});b.history.at(-1).message_type='image';b.history.at(-1).sanitized_text='[IMAGEN]';}
 if(variant==='echo_unattributed')b.history[0].provenance='business_outbound_unattributed';
 let modelCalls=0,historyReads=0;
 const rpc=async(name,args)=>{
  if(name==='meta_admin_memory_evidence_v1')return {data:{...b.proof,audience:['audience_unknown','unmatched'].includes(variant)?'unknown':variant==='internal'?'internal':b.proof.audience}};
  if(name==='meta_admin_memory_history_v1'){historyReads++;if(variant==='pre_memory_changed'&&historyReads===2)b.history[0].sanitized_text='La renta mensual cambió';assert.equal(args.p_input_id,inputId);return {data:b.history};}
  if(name==='meta_admin_memory_read_v1'){assert.equal(args.p_subject,subject);return {data:[seed.write.episode]};}
  assert.fail('unexpected RPC/write '+name);
 };
 admin.rpc=rpc;
 if(variant==='canonical_revoked')b.tables.client_identity_roles[0].status='revoked';
 let terminal;
 const result=await runMetaAdminShadowOnceWithContext({db:admin,inputId,authorizedInputId:inputId,now,env:{OPENAI_ADMIN_AGENT_MODEL:'gpt-4.1-mini'},
  store:{snapshot,claim:async()=>true,start:async()=>true,finish:async x=>{terminal=x.status;}},
  readMedia:async({authorizeInterpretation})=>{assert.equal(await authorizeInterpretation(),true);return {text:'[IMAGEN] Posible comprobante observado; no acredita pago conciliado.',incomplete:true,model_calls:1};},
  propose:async context=>{
   modelCalls++;const request=restrictedAdminRequest(context,{OPENAI_ADMIN_AGENT_MODEL:'gpt-4.1-mini'}),payload=JSON.parse(request.input);
   assert.deepEqual(request.tools,[]);
   if(['complete','post_context_changed','post_memory_changed','echo_unattributed'].includes(variant)){
    assert.equal(payload.conversation_memory.messages.length,2);assert.equal(payload.admin_context.agreement.monthly_amount,'1234.00');
   }else if(['recoverable_media','media_post_echo'].includes(variant)){
    assert.match(request.input,/Posible comprobante observado/);assert.equal(payload.conversation_memory.incomplete,true);
   }else{assert.ok(!request.input.includes('1234'));assert.equal(payload.conversation_memory.messages.length,0);}
   if(variant==='echo_unattributed')assert.match(request.instructions,/no prueba autoría humana/);
   if(variant==='post_memory_changed')b.history[0].sanitized_text='La renta mensual cambió';
   if(variant==='post_context_changed')b.tables.contracts[0].monthly_rent=5678;
   if(variant==='media_post_echo')b.snapshot.later_scope_echoes=1;
   return {provider:'openai',model:'gpt-4.1-mini',run_id:'mock-only',proposed_response:'Propuesta interceptada de prueba.'};
  }});
 assert.equal(modelCalls,['internal','media_only','pre_memory_changed'].includes(variant)?0:1);assert.equal(result.send_calls,0);assert.equal(mutations.length,0);
 assert.equal(terminal,variant==='media_only'?undefined:['internal','pre_memory_changed'].includes(variant)?'blocked':['post_context_changed','post_memory_changed','media_post_echo'].includes(variant)?'invalidated':'complete');
 if(variant==='media_only')assert.equal(result.reason,'unsupported_message_type');
 if(['internal','audience_unknown','unmatched','media_only'].includes(variant))assert.equal(historyReads,0);
});
