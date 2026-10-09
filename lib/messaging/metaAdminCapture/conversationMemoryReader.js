import {createHash} from 'node:crypto';
import {shadowOnceGate,ADMIN_SCOPE} from './shadowOnce.js';
import {prepareConversationMemory} from './conversationMemory.js';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');

// Future capture only; native subject AND HMAC key tag, no phone/text/time join.
// Existing Meta capture stores inbound text, not readable echo bodies. Do not invent them.
export const CONVERSATION_INBOUND_SQL=`
with target as (
 select i.*,se.key_tag from meta_admin_private.inbound_inputs i
 join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=i.meta_observer_event_id
 where i.id=$1 and se.subject_ref=i.sender_ref
), history as (
 select i.id,i.sanitized_text,i.message_type,i.occurred_at,i.captured_at,
 'customer_inbound'::text as provenance,
 exists(select 1 from public.meta_observer_events m
   where m.waba_id=i.waba_id and m.phone_number_id=i.phone_number_id
   and m.original_message_id=i.native_message_id) as mutated
 from target t join meta_admin_private.inbound_inputs i
   on i.waba_id=t.waba_id and i.phone_number_id=t.phone_number_id and i.sender_ref=t.sender_ref
 join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=i.meta_observer_event_id
   and se.subject_ref=i.sender_ref and se.key_tag=t.key_tag
 join public.meta_observer_events receipt on receipt.id=i.meta_observer_event_id
   and receipt.waba_id=i.waba_id and receipt.phone_number_id=i.phone_number_id
   and receipt.native_message_id=i.native_message_id
 where i.capture_reason='captured' and se.evidence_state='exact' and se.evidence_source='signed_from'
   and i.sender_evidence in ('signed_from','signed_from_and_wa_id')
   and receipt.source_field='messages' and receipt.category='inbound'
   and receipt.event_type='message.received' and receipt.state='observed' and receipt.observer_only
   and cardinality(receipt.error_codes)=0
   and (i.occurred_at,i.captured_at,i.id)<=(t.occurred_at,t.captured_at,t.id)
 order by i.occurred_at,i.captured_at,i.id limit 501
)
select * from history order by occurred_at,captured_at,id`;

// Read-only capability. History is provenance, not a private-data grant.
// Native reader and canonical reader remain distinct trusted server capabilities.
export function createConversationMemoryReader({client,memoryStore,readSnapshot,readCanonical,readAudience,
  readEvidence,readHistory,inputId,now=Date.now}){
  return async()=>{
    const first=await readSnapshot(inputId),gate=shadowOnceGate(first,now());
    if(!gate.allowed)throw Error(gate.reason);
    const i=first.input;
    if(!i.subject_ref||!i.key_tag)throw Error('native_subject_missing');
    const subject='subject_'+hash([ADMIN_SCOPE,i.subject_ref,i.key_tag]);
    const identity=first.identity.state;
    const identityFingerprint=identity==='matched'?hash([first.identity.client_identity_id,first.identity.reason]):null;
    let audience;
    if(readEvidence){
      const evidence=await readEvidence(inputId);
      if(evidence.subjectRef!==i.subject_ref||evidence.keyTag!==i.key_tag)throw Error('memory_evidence_subject_changed');
      audience=evidence.audience;
    }
    audience??=await readAudience({inputId,subject});
    if(audience!=='external_verified')
        return prepareConversationMemory({snapshot:{subject,identity,identityFingerprint,audience,
          checkedAt:Date.parse(first.checked_at),complete:true,currentRef:'message_'+hash(inputId),messages:[]},
          episodes:[],canonical:null,now:now()});
    const c=identity==='matched'?await readCanonical():null;
    const canonical=c?.state==='ready'?{state:'ready',identityFingerprint,scope:{
      property_ref:c.property_ref,unit_ref:c.unit_ref,contract_ref:c.contract_ref,period:c.charges?.period}}:c;
    const rows=readHistory?await readHistory(inputId):(await client.query(CONVERSATION_INBOUND_SQL,[inputId])).rows;
    if(rows.length>500)throw Error('history_limit_requires_explicit_episode_reader');
    const messages=[];
    for(const [index,row] of rows.entries()){
      if(!['customer_inbound','business_outbound_unattributed'].includes(row.provenance))throw Error('history_provenance_unknown');
      messages.push({ref:'message_'+hash(row.id),subject,order:index,direction:row.provenance,text:row.sanitized_text,
        edited:row.mutated,revoked:row.mutated,attachment:row.message_type!=='text'||row.content_missing===true});
    }
    const episodes=await memoryStore.read(subject);
    audience??=await readAudience({inputId,subject});
    const latest=await readSnapshot(inputId),final=shadowOnceGate(latest,now());
    if(!final.allowed||final.fingerprint!==gate.fingerprint)throw Error('memory_snapshot_changed');
    return prepareConversationMemory({snapshot:{subject,identity,identityFingerprint,audience,
      checkedAt:Date.parse(first.checked_at),complete:true,currentRef:'message_'+hash(inputId),messages},episodes,canonical,now:now()});
  };
}
