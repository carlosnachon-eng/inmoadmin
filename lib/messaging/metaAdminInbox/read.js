import {createHash} from 'node:crypto';
import {createShadowOnceSupabaseStore} from '../metaAdminCapture/shadowOnceSupabase.js';
import {shadowOnceGate,ADMIN_SCOPE} from '../metaAdminCapture/shadowOnce.js';
import {createCanonicalShadowContextReaders,prepareAdminShadowContext} from '../../shadow/canonicalReadOnlyContext.js';
import {projectAdminShadowContext} from '../metaAdminCapture/shadowContextProjection.js';

export const inboxUuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const states=new Set(['matched','unmatched','ambiguous']);
const ref=(x,prefix)=>typeof x==='string'&&new RegExp(`^${prefix}_[a-f0-9]{16,64}$`).test(x);
const fresh=(s,now)=>Number.isFinite(Date.parse(s?.checked_at))&&Date.parse(s.checked_at)<=now+1000&&now-Date.parse(s.checked_at)<=5000;

// Exact source capabilities remain server-side. Never spread a DB row into API output.
export function projectInboxMessage(row){
 if(!['customer_inbound','business_outbound_unattributed'].includes(row.provenance)||!inboxUuid(row.message_ref)
 ||!Number.isFinite(Date.parse(row.occurred_at)))throw Error('history_unverified');
 const type=['text','image','document','audio','video'].includes(row.message_type)?row.message_type:'unknown';
 return {message_ref:row.message_ref,occurred_at:row.occurred_at,provenance:row.provenance,type,
  text:row.mutated===true?null:typeof row.text==='string'?row.text.slice(0,2000):null,
  modified:row.mutated===true,attachment:type==='text'?null:row.mutated===true?'not_available':
   row.media_reference_present===true&&['image','document'].includes(type)?'interpretation_pending':'not_available'};
}

export function projectInboxEpisodes(rows,context,identity){
 if(context?.state!=='ready'||identity?.state!=='matched')return [];
 const identityHash=hash([identity.client_identity_id,identity.reason]);
 return rows.filter(e=>e.identityFingerprint===identityHash&&e.scope&&
  Object.entries(e.scope).every(([k,v])=>k==='period'?v===context.charges?.period:
   ['property_ref','unit_ref','contract_ref'].includes(k)&&context[k]===v))
 .map(e=>{
  if(!ref(e.id,'episode')||!['agreement','payments','maintenance','clarification','maintenance_water','maintenance_gas','maintenance_electricity'].includes(e.topic)
  ||!['open','waiting','contradicted','resolved'].includes(e.status)
  ||!['none','clarification','verification','document','visit','human_review'].includes(e.pending))throw Error('memory_unverified');
  return {id:e.id,topic:e.topic,status:e.status,pending:e.pending,contradiction:e.contradiction===true,version:e.version};
 });
}

export function createInboxReader({db,now=Date.now}){
 const rpc=async(name,args)=>{const r=await db.rpc(name,args);if(r.error)throw Error('inbox_unavailable');return r.data;};
 const snapshot=createShadowOnceSupabaseStore(db).snapshot;
 return {
  async list(before=null){
   if(before!==null&&!Number.isFinite(Date.parse(before)))throw Error('invalid_cursor');
   const rows=await rpc('meta_admin_inbox_list_v1',{p_before:before,p_limit:30});
   if(!Array.isArray(rows))throw Error('inbox_unavailable');
   return rows.filter(r=>r.audience!=='internal').map(r=>{
    if(!inboxUuid(r.input_id)||!states.has(r.identity_state)||!Number.isFinite(Date.parse(r.last_activity)))throw Error('inbox_unavailable');
    return {input_id:r.input_id,last_activity:r.last_activity,identity_state:r.identity_state,
     label:r.identity_state==='matched'?'Identidad acreditada':'Contacto sin identidad acreditada'};
   });
  },
  async detail(inputId){
   if(!inboxUuid(inputId))throw Error('invalid_input');
   const first=await snapshot(inputId);
   if(first?.input?.id!==inputId||first.input.waba_id!==ADMIN_SCOPE.wabaId||first.input.phone_number_id!==ADMIN_SCOPE.phoneNumberId
   ||!fresh(first,now())||!states.has(first.identity?.state))throw Error('inbox_unavailable');
   const proof=await rpc('meta_admin_memory_evidence_v1',{p_input_id:inputId});
   if(!proof||proof.input_id!==inputId||!fresh(proof,now())||!proof.native_verified||!proof.scope_verified
   ||proof.subject_ref!==first.input.subject_ref||proof.key_tag!==first.input.key_tag||proof.audience==='internal')throw Error('inbox_unavailable');
   const rows=await rpc('meta_admin_inbox_history_v1',{p_input_id:inputId});
   if(!Array.isArray(rows))throw Error('inbox_unavailable');
   let context={state:'blocked',reason:'context_unavailable'},episodes=[],readContext;
   if(first.identity.state==='matched'&&proof.audience==='external_verified'){
    const readers=createCanonicalShadowContextReaders({db,now,readIdentity:async()=>{
     const s=await snapshot(inputId);
     if(!fresh(s,now())||hash(s.identity)!==hash(first.identity))return {allowed:false,reason:'identity_changed'};
     return {allowed:true,clientIdentityId:s.identity.client_identity_id,fingerprint:hash(s.identity)};
    }});
    readContext=async()=>projectAdminShadowContext(await prepareAdminShadowContext({readers,sections:['agreement']}));
    context=await readContext();
    const subject='subject_'+hash([ADMIN_SCOPE,first.input.subject_ref,first.input.key_tag]);
    const memory=await rpc('meta_admin_memory_read_v1',{p_subject:subject});
    if(!Array.isArray(memory))throw Error('memory_unavailable');
    episodes=projectInboxEpisodes(memory,context,first.identity);
   }
   if(readContext&&hash(await readContext())!==hash(context))throw Error('context_changed');
   const last=await snapshot(inputId),lastProof=await rpc('meta_admin_memory_evidence_v1',{p_input_id:inputId});
   if(!fresh(last,now())||!fresh(lastProof,now())||lastProof.audience!==proof.audience
   ||hash(last.identity)!==hash(first.identity)||last.input.subject_ref!==first.input.subject_ref
   ||last.input.key_tag!==first.input.key_tag||lastProof.input_id!==inputId||!lastProof.native_verified||!lastProof.scope_verified
   ||lastProof.subject_ref!==first.input.subject_ref||lastProof.key_tag!==first.input.key_tag)throw Error('inbox_changed');
   const gate=shadowOnceGate(last,now());
   // UI basic context deliberately excludes all financial fields.
   const basic=context.state==='ready'?{state:'ready',roles:context.roles,property_ref:context.property_ref,
    unit_ref:context.unit_ref,contract_ref:context.contract_ref,
    agreement:context.agreement?{status:context.agreement.status,start_date:context.agreement.start_date,end_date:context.agreement.end_date}:null}:context;
   return {input_id:inputId,identity_state:last.identity.state,context:basic,episodes,
    messages:rows.slice(-100).map(projectInboxMessage),history_truncated:rows.length>100,
    ai:{state:gate.allowed?'shadow_available':'blocked',reason:gate.allowed?'operator_shadow_only':'requires_review'},
    manual_send:{enabled:false,reason:'manual_journal_and_pause_pending'}};
  }
 };
}
