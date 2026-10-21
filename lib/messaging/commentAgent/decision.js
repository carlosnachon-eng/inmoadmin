import {createHash} from 'node:crypto';

export const RULE_VERSION='commercial-comments-observation-v1';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const reference=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const fold=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?¡!.,;:]/g,' ').replace(/\s+/g,' ').trim();
const intents={price:/^(precio|costo|cuanto cuesta|cuanto vale|que precio tiene)$/,
 availability:/^(disponible|disponibilidad|sigue disponible|esta disponible)$/,
 location:/^(ubicacion|donde esta|en donde esta)$/,
 features:/^(caracteristicas|cuantas recamaras|cuantos banos|tiene estacionamiento)$/,
 appointment:/^(cita|quiero una cita|puedo visitarla|puedo agendar una visita)$/,
 requirements:/^(requisitos|cuales son los requisitos|que requisitos piden)$/,
 interest:/^(me interesa|estoy interesado|estoy interesada|quiero comprar|quiero rentar|informes|informacion|quiero informacion)$/};
const sensitive=/\b(queja|fraude|estafa|denuncia|demanda|deposito|devolucion|reembolso|negociar|negociacion|descuento|ofrezco|aceptan|problema|caro|robo|mentira|enganaron|abogado|discriminacion)\b|no responden|no contestan|me deben/;
const privateData=/@|https?:|\+?\d[\d\s()-]{7,}\d|\b(curp|rfc|telefono|whatsapp|mi direccion|mi correo)\b/i;
// Inputs must come from authorized server adapters, never request body or an LLM.
export function decideComment({event,facts=null,capability=null,now=Date.now()}){
 if(!event||!['instagram','facebook'].includes(event.platform)||!reference(event.connection_ref)
  ||!reference(event.comment_ref)||!reference(event.post_ref)||!reference(event.event_ref))throw Error('comment_contract');
 const base={platform:event.platform,comment_ref:event.comment_ref,event_ref:event.event_ref,
  decision_ref:hash([RULE_VERSION,event.platform,event.connection_ref,event.comment_ref]),
  version:RULE_VERSION,phase:'observation',public_proposal:null,private_proposal:null,
  publish_allowed:false,private_send_allowed:false,opportunity_candidate:false};
 const result=(status,reason,extra={})=>({...base,status,reason,...extra});
 if(event.owned!==true)return result('escalated','ownership_unverified');
 if(event.deleted===true)return result('ignored','deleted');
 if(event.own_author===true||event.nested===true)return result('ignored','own_or_nested');
 if(event.reply_status||event.automation_status)return result('suppressed','existing_action');
 const age=now-Date.parse(event.occurred_at);
 if(!Number.isFinite(age)||age<0)return result('escalated','invalid_time');
 const text=fold(event.text),clean=text.replace(/ (por favor|porfa|gracias)$/,'');
 if(!text||/^[\s\p{Extended_Pictographic}\uFE0F\u200D]+$/u.test(text))return result('ignored','empty_or_reaction');
 if(sensitive.test(text)||privateData.test(text))return result('escalated','sensitive_or_private');
 const intent=Object.keys(intents).find(key=>intents[key].test(clean));
 if(!intent)return result('escalated','ambiguous');
 const common={intent,opportunity_candidate:true};
 if(event.author_verified===false)return result('escalated','author_unverified',common);
 if(event.replies_verified!==true)return result('escalated','reply_state_unverified',common);
 // Exact publication+property binding with fresh public facts, never caption extraction.
 if(!facts||facts.platform!==event.platform||facts.connection_ref!==event.connection_ref
  ||facts.post_ref!==event.post_ref||facts.source!=='inmoadmin_verified_publication'
  ||!reference(facts.property_ref)||facts.active!==true||facts.public!==true
  ||!Number.isFinite(Date.parse(facts.verified_at))||now-Date.parse(facts.verified_at)<0
  ||now-Date.parse(facts.verified_at)>15*60*1000)return result('escalated','property_binding_or_freshness',common);
 let answer;
 if(intent==='price'&&Number.isSafeInteger(facts.price)&&facts.price>0&&['MXN','USD'].includes(facts.currency)
  &&['venta','renta mensual'].includes(facts.operation))answer=`El precio de ${facts.operation} es ${new Intl.NumberFormat('es-MX',{style:'currency',currency:facts.currency,maximumFractionDigits:0}).format(facts.price)} ${facts.currency}.`;
 if(intent==='availability'&&['disponible','no disponible'].includes(facts.availability))answer=`Esta propiedad está ${facts.availability}.`;
 if(intent==='features'&&[facts.bedrooms,facts.bathrooms,facts.parking].every(n=>Number.isInteger(n)&&n>=0&&n<=20))answer=`Cuenta con ${facts.bedrooms} recámaras, ${facts.bathrooms} baños y ${facts.parking} espacios de estacionamiento.`;
 // Free-form location/requirements need separate approved public-field contracts.
 if(!answer)return result('escalated','approved_fact_missing',common);
 const privateEligible=capability?.platform===event.platform&&capability?.verified===true
  &&capability?.comment_ref===event.comment_ref&&capability?.connection_ref===event.connection_ref
  &&capability?.private_reply_allowed===true&&capability?.already_used===false
  &&Number.isFinite(Date.parse(capability.checked_at))&&now-Date.parse(capability.checked_at)>=0
  &&now-Date.parse(capability.checked_at)<=60000&&age<=7*86400000&&event.live!==true;
 return result('proposed','verified_public_facts',{...common,public_proposal:answer,
  private_proposal:privateEligible?answer:null,source_fingerprint:hash(facts),
  proposal_fingerprint:hash([base.decision_ref,event.event_ref,facts,answer])});
}

export function reviewBatch(inputs,{now=Date.now()}={}){
 if(!Array.isArray(inputs)||inputs.length>200)throw Error('batch_contract');
 const seen=new Map();
 for(const input of inputs){
  const decision=decideComment({...input,now}),key=decision.decision_ref,fingerprint=hash(input);
  const prior=seen.get(key);
  if(prior&&prior.fingerprint!==fingerprint)seen.set(key,{fingerprint:null,decision:{...decision,status:'escalated',reason:'conflicting_revision',public_proposal:null,private_proposal:null}});
  else if(!prior)seen.set(key,{fingerprint,decision});
 }
 const rows=[...seen.values()].map(x=>x.decision);
 return {rows,metrics:{scope:'current_authorized_batch',received:rows.length,
  proposed:rows.filter(r=>r.status==='proposed').length,pending:rows.filter(r=>['proposed','escalated'].includes(r.status)).length,
  escalated:rows.filter(r=>r.status==='escalated').length,suppressed:rows.filter(r=>r.status==='suppressed').length,
  responded_by_agent:0,opportunities_generated:0,opportunity_candidates:rows.filter(r=>r.opportunity_candidate).length},
  phase:'observation',durable_audit:false,sender:false,approval_enabled:false};
}
