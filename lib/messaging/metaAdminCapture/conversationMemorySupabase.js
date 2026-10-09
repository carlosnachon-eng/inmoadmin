import {createConversationMemoryReader} from './conversationMemoryReader.js';
// Trusted server capability only. No model/HTTP-controlled SQL, no direct table access.
export function createConversationMemorySupabase(db){
 const rpc=async(name,args)=>{const {data,error}=await db.rpc(name,args);if(error)throw Error('memory_rpc_failed');return data;};
 return {
  read:subject=>rpc('meta_admin_memory_read_v1',{p_subject:subject}),
  append:({episode,expectedVersion,sourceRef})=>rpc('meta_admin_memory_append_v1',{
   p_episode:episode,p_expected_version:expectedVersion,p_source_ref:sourceRef}),
 };
}

// Audience evidence is canonical external roles/confirmed links, with a staff veto.
// It never authorizes financial/private facts; those stay in the canonical reader.
export function createConversationMemoryEvidence(db,{now=Date.now}={}){
 return async inputId=>{
  const {data,error}=await db.rpc('meta_admin_memory_evidence_v1',{p_input_id:inputId});
  if(error||!data||data.input_id!==inputId)throw Error('memory_evidence_unavailable');
  const checked=Date.parse(data.checked_at);
  if(!Number.isFinite(checked)||checked>now()||now()-checked>5000)throw Error('memory_evidence_stale');
  if(data.native_verified!==true||data.scope_verified!==true)throw Error('memory_native_scope_unverified');
  if(!['external_verified','internal','unknown'].includes(data.audience))throw Error('memory_audience_invalid');
  return {audience:data.audience,humanAuthorized:false,
   reason:data.audience_reason,subjectRef:data.subject_ref,keyTag:data.key_tag};
 };
}

// Internal DEV integration only; no endpoint, cron, webhook or outbound caller.
export function createEvidenceBackedConversationReader({db,...options}){
 return createConversationMemoryReader({...options,memoryStore:createConversationMemorySupabase(db),
  readEvidence:createConversationMemoryEvidence(db,{now:options.now}),readHistory:async inputId=>{
   const {data,error}=await db.rpc('meta_admin_memory_history_v1',{p_input_id:inputId});
   if(error||!Array.isArray(data))throw Error('memory_history_unavailable');return data;
  }});
}
