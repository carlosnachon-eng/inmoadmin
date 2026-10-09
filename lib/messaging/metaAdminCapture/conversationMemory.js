import {createHash} from 'node:crypto';
import {sanitizeShadowText} from '../../shadow/coordinator.js';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const norm=x=>x.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const families=['agreement','payments','maintenance','clarification'];
const topicsAllowed=[...families,'maintenance_water','maintenance_gas','maintenance_electricity'];
const states=['open','waiting','contradicted','resolved'];
const pending=['none','clarification','verification','document','visit','human_review'];
const commitments=['none','will_check','will_report','will_confirm','will_send'];
const ref=x=>typeof x==='string'&&/^[a-z][a-z0-9_]{0,24}_[a-f0-9]{16,64}$/.test(x);
const assert=(x,r)=>{if(!x)throw Error(r);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const memoryHash=hash;

// Understanding ONLY. These patterns never authorize data, attention or delivery.
export function conversationTopics(text){
  const t=norm(text),found=[];
  if(/\b(contrato|renovar|renovacion|renta mensual|monto de (la )?renta)\b/.test(t))found.push('agreement');
  if(/\b(pago|pagado|pague|comprobante|recibo|deposito|cobro|renta de este mes)\b/.test(t))found.push('payments');
  if(/\b(fuga|reparacion|reparaciones|tinaco|filtracion|luz|agua|ticket|tecnico|plomero)\b/.test(t))found.push('maintenance');
  // Water contract is a document, not evidence of a maintenance incident.
  if(/\bcontrato de agua\b/.test(t))return ['clarification'];
  return found;
}
const scopeKeys=['property_ref','unit_ref','contract_ref','period','ticket_ref'];
const subtopic=(text,family)=>{
  if(family!=='maintenance')return family;
  const t=norm(text),types=[];
  if(/\bgas\b/.test(t))types.push('maintenance_gas');
  if(/\b(luz|electricidad|electrico|iluminacion)\b/.test(t))types.push('maintenance_electricity');
  if(/\b(agua|tinaco|cisterna|filtracion)\b/.test(t)||/\bfuga\b/.test(t)&&!types.includes('maintenance_gas'))types.push('maintenance_water');
  return types.length>1?'multiple':types[0]||null;
};
function projectScope(s={}){
  assert(s&&typeof s==='object'&&!Array.isArray(s),'scope_invalid');
  const out={};
  for(const k of scopeKeys)if(s[k]!=null){
    assert(k==='period'?/^\d{4}-(0[1-9]|1[0-2])$/.test(s[k]):ref(s[k])&&s[k].startsWith(k.replace('_ref','')+'_'),'scope_invalid');out[k]=s[k];
  }
  return out;
}
function validateMessage(m,subject){
  assert(m.subject===subject&&ref(m.ref)&&Number.isSafeInteger(m.order)&&m.order>=0,'source_scope_invalid');
  assert(['customer_inbound','business_outbound_unattributed'].includes(m.direction),'source_direction_invalid');
  assert(typeof m.text==='string'&&m.text.length<=2000&&sanitizeShadowText(m.text).text===m.text,'source_text_invalid');
  assert(typeof m.edited==='boolean'&&typeof m.revoked==='boolean'&&typeof m.attachment==='boolean','source_state_unknown');
  assert(m.replyRef==null||ref(m.replyRef),'source_reference_invalid');
}

// snapshot comes from trusted server readers, NEVER body/query/model arguments.
// subject includes WABA, phone_number_id, native subject HMAC AND key tag.
// Source completeness/mutations must be refreshed; no inference from traffic age.
export function prepareConversationMemory({snapshot,episodes,canonical,now=Date.now()}){
  const stop=reason=>({status:reason==='internal_subject'?'blocked':'clarification_required',reason,send_authorized:false,
    fingerprint:hash([reason,snapshot?.subject,snapshot?.currentRef,snapshot?.identityFingerprint,
      snapshot?.messages,episodes,canonical]),
    projection:{state:'clarification_required',incomplete:true,topic:null,memory:null,messages:[]}});
  assert(snapshot&&ref(snapshot.subject)&&['matched','unmatched'].includes(snapshot.identity),'identity_invalid');
  assert(Number.isFinite(snapshot.checkedAt)&&now-snapshot.checkedAt<=5000&&now>=snapshot.checkedAt,'snapshot_stale');
  assert(snapshot.complete===true,'source_incomplete');
  if(snapshot.audience==='internal')return stop('internal_subject');
  if(snapshot.audience!=='external_verified')return stop('audience_unknown_anonymous_only');
  assert(Array.isArray(snapshot.messages)&&snapshot.messages.length<=500,'source_limit');
  assert(Array.isArray(episodes)&&episodes.length<=100,'episode_limit');
  for(const m of snapshot.messages)validateMessage(m,snapshot.subject);
  assert(new Set(snapshot.messages.map(m=>m.ref)).size===snapshot.messages.length,'duplicate_source');
  assert(new Set(snapshot.messages.map(m=>m.order)).size===snapshot.messages.length,'ambiguous_order');
  const current=snapshot.messages.find(m=>m.ref===snapshot.currentRef);
  assert(current&&current.direction==='customer_inbound'&&!current.edited&&!current.revoked,'current_input_invalid');
  if(/\b(las rentas|los contratos|las propiedades|los departamentos|las unidades|ambas propiedades)\b/.test(norm(current.text)))
    return stop('multiple_entities_mentioned');
  const messages=snapshot.messages.filter(m=>m.order<=current.order);
  const topics=conversationTopics(current.text);
  if(topics.length>1)return stop('multiple_topics');
  const family=topics[0]||null;
  const topic=subtopic(current.text,family);
  if(topic==='multiple')return stop('multiple_topics');
  const privateAllowed=snapshot.identity==='matched'&&canonical?.state==='ready';
  // Fresh canonical gate, identity binding and source-resolved refs, not old memory.
  if(snapshot.identity==='matched'&&!privateAllowed)return stop('canonical_scope_unavailable');
  if(privateAllowed)assert(canonical.identityFingerprint===snapshot.identityFingerprint,'identity_changed');
  const scope=privateAllowed?projectScope(canonical.scope):{};
  if(privateAllowed&&Number(Boolean(scope.property_ref))+Number(Boolean(scope.unit_ref))!==1)return stop('canonical_entity_not_unique');
  if(privateAllowed&&family==='agreement'&&!scope.contract_ref)return stop('agreement_scope_unavailable');
  if(privateAllowed&&family==='payments'&&(!scope.contract_ref||!scope.period))return stop('payment_period_unavailable');
  const eligible=episodes.filter(e=>e.subject===snapshot.subject&&e.status!=='resolved'
    &&e.identityFingerprint===(privateAllowed?snapshot.identityFingerprint:null)&&same(projectScope(e.scope),scope));
  for(const e of eligible){
    assert(ref(e.id)&&families.includes(e.family)&&topicsAllowed.includes(e.topic)&&states.includes(e.status)&&Number.isSafeInteger(e.version)&&e.version>0,'episode_invalid');
    assert(pending.includes(e.pending)&&commitments.includes(e.commitment)&&typeof e.contradiction==='boolean','episode_invalid');
    assert(Array.isArray(e.sourceRefs)&&e.sourceRefs.length>0&&e.sourceRefs.length<=500,'episode_sources_invalid');
  }
  let candidates;
  if(current.replyRef){
    // An unresolved or conflicting native reference must not fall back to time/topic.
    candidates=eligible.filter(e=>e.sourceRefs.includes(current.replyRef));
    if(candidates.length!==1||family&&candidates[0].family!==family||topic&&candidates[0]?.topic!==topic)return stop('reply_reference_ambiguous');
  }else candidates=eligible.filter(e=>(!family||e.family===family)&&(!topic||e.topic===topic));
  if(candidates.length>1)return stop('multiple_active_episodes');
  if(!family&&!current.replyRef)return stop('antecedent_not_explicit');
  let episode=candidates[0];
  if(episode&&episode.sourceRefs.some(r=>!messages.some(m=>m.ref===r&&!m.edited&&!m.revoked)))return stop('source_changed_or_missing');
  if(!episode){
    assert(family,'topic_required');
    episode={id:'episode_'+hash([snapshot.subject,current.ref]).slice(0,32),subject:snapshot.subject,
      identityFingerprint:privateAllowed?snapshot.identityFingerprint:null,scope,family,topic:topic||family,status:'open',version:0,
      pending:'none',commitment:'none',contradiction:false,sourceRefs:[]};
  }
  const relevant=messages.filter(m=>episode.sourceRefs.includes(m.ref)||m.ref===current.ref);
  if(relevant.some(m=>m.edited||m.revoked))return stop('source_changed_or_missing');
  const t=norm(current.text);
  const contradiction=episode.contradiction||/\b(pero|no corresponde|otro periodo|ya (lo )?(pague|envie|realice)|sigue igual|aun no|todavia no)\b/.test(t);
  const incomplete=relevant.some(m=>m.attachment);
  // Echo text is never proof of a promise, recorded action or human authorship.
  // Historical commitment fields remain stored; they do not become response facts.
  const commitment='none';
  const sourceRefs=[...new Set([...episode.sourceRefs,current.ref])];
  assert(sourceRefs.length<=500,'episode_source_limit');
  const next={...episode,version:episode.version+1,status:contradiction?'contradicted':'open',
    pending:contradiction?'human_review':incomplete?'document':'verification',commitment,contradiction,sourceRefs,
    updatedAt:now};
  // Anonymous memory contains no quoted historic text, entity refs or facts.
  const projection={state:contradiction?'clarification_required':'ready',incomplete,
    topic:episode.family,memory:{status:next.status,pending:next.pending,commitment:next.commitment,
      commitment_attribution:'outbound_observed_not_human_proof',contradiction},
    messages:relevant.sort((a,b)=>a.order-b.order).slice(-8).map(m=>({
      direction:m.direction,attachment:m.attachment,
      text:privateAllowed?m.text:'[MESSAGE_RECEIVED_NO_PRIVATE_CONTEXT]',
    }))};
  return {status:projection.state,reason:contradiction?'contradiction_observed':'episode_selected',send_authorized:false,
    projection,write:{episode:next,expectedVersion:episode.version,sourceRef:current.ref},
    fingerprint:hash([snapshot.identityFingerprint||null,scope,episode.id,episode.version,sourceRefs,projection])};
}

// Reconstruct model DTO, dropping IDs, subject, scope and any unapproved fields.
export function projectConversationMemory(value){
  assert(['ready','clarification_required'].includes(value?.state)&&typeof value.incomplete==='boolean','memory_projection_invalid');
  assert(value.topic===null||families.includes(value.topic),'memory_projection_invalid');
  assert(Array.isArray(value.messages)&&value.messages.length<=8,'memory_projection_invalid');
  let memory=null;
  if(value.memory){const m=value.memory;assert(states.includes(m.status)&&pending.includes(m.pending)
    &&commitments.includes(m.commitment)&&typeof m.contradiction==='boolean','memory_projection_invalid');
    memory={status:m.status,pending:m.pending,commitment:m.commitment,contradiction:m.contradiction,
      commitment_attribution:'outbound_observed_not_human_proof'};}
  return {state:value.state,incomplete:value.incomplete,topic:value.topic,memory,messages:value.messages.map(m=>{
    assert(['customer_inbound','business_outbound_unattributed'].includes(m.direction)&&typeof m.attachment==='boolean'
      &&typeof m.text==='string'&&m.text.length<=2000&&sanitizeShadowText(m.text).text===m.text,'memory_projection_invalid');
    return {direction:m.direction,attachment:m.attachment,text:m.text};})};
}

// Explicit memory persistence is separate from the read-only model path.
export async function recordConversationMemory({read,store,now=Date.now}){
  const data=await read(),result=prepareConversationMemory({...data,now:now()});
  if(result.write)await store.append(result.write);
  return result;
}
