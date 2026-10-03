import { readSocialContinuity } from "../social/continuity.js";
import { socialSalesProtected, isCommercialServiceOffer, isShortSocialCta, isInventoryAbsenceClaim, SOCIAL_CTA_CLARIFICATION } from "../social/commercialIntent.js";
import { readSocialSalesContext } from "../social/salesInventory.js";
import { readSalesConversation, isolatedSalesCta, salesClarificationPolicy, hasSalesProfileContext, LINK_ALTERNATIVE } from "./salesConversation.js";
import { hasSalesAppointmentCommitment } from "./salesAppointmentGuard.js";
const SAFE_CHANNELS=new Set(["497382","497385","498219","515318"]);

// Sensitive roots must start a word, not occur inside confirmar/afirmación/acredito.
// Unicode letters/marks avoid treating Spanish accents as word separators. Keep
// existing inflections conservative, including sensitive prefixed contract/negotiation terms.
const RISKY=/(?<![\p{L}\p{M}\p{N}_])(?:apartad|dep[oó]sito|p[oó]liza|jur[ií]dic|(?:sub)?contrato|demanda|profeco|descuento|rebaja|contraoferta|(?:re)?negoci|cr[eé]dito|hipoteca|firma|escritura|promesa|garant[ií]a|penaliz|cancelaci[oó]n|rescisi[oó]n|abogado)/iu;
const REQUIREMENTS_SENSITIVE=/(me (?:aceptan|aprueban)|voy a pasar|paso la p[oó]liza|sin p[oó]liza|excepci[oó]n|dispensar|no tengo (?:ine|ingresos|comprobante)|puedo dar menos|depositar a|transferir a|cuenta bancaria|clabe|autorizar)/i;
const APPOINTMENT_REQUEST=/(cita|agend|horario|verlo hoy|visita|mostrar|enseñar|ensenar)/i;
const COVERAGE=/(cobertura|zona|zapopan|guadalajara|jalisco|fuera de cobertura|puebla|cholula|veracruz|boca del r[ií]o|alvarado|central de abastos)/i;
const PROPERTY_INTEREST=/(interesad|me interesa|esa casa|ese depa|departamento|casa|local|oficina|bodega|terreno|inmueble)/i;
const GREETING=/^(?:hola[,.! ]*)?(?:buen(?:os|as) d[ií]as|buenas tardes|buenas noches)?[,.! ]*$/i;
const FOLLOWUP=/^(gracias|ok|okay|perfecto|mil gracias|muchas gracias)[.! ]*$/i;
const GENERAL_INQUIRY=/(informes|información|informacion|quisiera saber|me gustaría saber|me gustaria saber|sobre este|sobre esta|qué opciones|que opciones)/i;
const META_OUTPUT=/(respuesta sugerida|siguiente pregunta sugerida|no se envió ningún mensaje|no se envio ningun mensaje|modo shadow|perfil comercial|herramientas usadas|respuesta para el asesor)/i;

const clean=(v,max=1200)=>String(v??"").replace(/\s+/g," ").trim().slice(0,max);

function hasAppointmentCommitment(output){ return hasSalesAppointmentCommitment(output); }

// The journal's original closed taxonomy predates the rental-requirements
// decision. Preserve that decision and its grounded tool in the run, while
// storing it in the existing property-interest category. No schema widening.
export const salesOutboundStorageKind=caseKind=>caseKind==="rental_requirements"?"property_interest":caseKind;

export function classifySafeSalesOutbound({messageText,calledTools,proposedResponse,socialContext=null}){
  const input=clean(messageText,2000);
  const output=clean(proposedResponse,1200);
  const tools=new Set(calledTools||[]);
  if(!input||!output)return{eligible:false,reason:"missing_text"};
  if(socialContext){
    if(isCommercialServiceOffer(input))return{eligible:false,reason:"commercial_service_offer"};
    if(isInventoryAbsenceClaim(output))return{eligible:false,reason:"inventory_absence_not_proven"};
    if(socialContext.isolatedCta===true||(!socialContext.hasConversationContext&&socialContext.isolatedCta!==false&&isShortSocialCta(input)&&!socialContext.sourceProperty))return output===SOCIAL_CTA_CLARIFICATION
      ?{eligible:true,caseKind:"greeting_qualification"}:{eligible:false,reason:"cta_requires_clarification"};
  }
  if(META_OUTPUT.test(output))return{eligible:false,reason:"internal_meta_output"};
  const requirementsGrounded=tools.has("get_rental_requirements");
  if(requirementsGrounded&&!REQUIREMENTS_SENSITIVE.test(input)&&!REQUIREMENTS_SENSITIVE.test(output)){
    return{eligible:true,caseKind:"rental_requirements"};
  }
  if(RISKY.test(input)||RISKY.test(output))return{eligible:false,reason:"risky_topic"};
  if(!socialContext&&APPOINTMENT_REQUEST.test(input))return{eligible:false,reason:"appointment_requires_validation"};
  if(hasAppointmentCommitment(output))return{eligible:false,reason:"appointment_commitment_requires_validation"};

  if(socialContext&&(output===LINK_ALTERNATIVE||socialContext.hasConversationContext))return{eligible:true,caseKind:"greeting_qualification"};
  if(/\b(disponib(?:le|les|ilidad)|renta|compra)\b/i.test(input))return{eligible:true,caseKind:"property_interest"};

  if(COVERAGE.test(input)&&tools.has("check_sales_coverage"))return{eligible:true,caseKind:"coverage"};
  if(GREETING.test(input))return{eligible:true,caseKind:"greeting_qualification"};
  if(tools.has("search_sales_inventory"))return{eligible:true,caseKind:"inventory_search"};
  if(PROPERTY_INTEREST.test(input))return{eligible:true,caseKind:"property_interest"};
  if(GENERAL_INQUIRY.test(input))return{eligible:true,caseKind:"greeting_qualification"};
  if(FOLLOWUP.test(input))return{eligible:true,caseKind:"simple_followup"};
  return{eligible:false,reason:"not_allowlisted"};
}

export function assertSalesAutoOutboundEnvironment(env=process.env){
  if(env.SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED!=="true")throw new Error("sales_auto_outbound_disabled");
  if(env.VERCEL_ENV!=="production"||env.SUPABASE_ENVIRONMENT!=="production")throw new Error("sales_auto_outbound_environment_mismatch");
  if(!env.RESPOND_IO_TOKEN&&!env.RESPOND_IO_API_TOKEN)throw new Error("respond_sender_credential_missing");
  return true;
}

async function sendRespond({contactId,channelId,text,env=process.env}){
  const token=env.RESPOND_IO_TOKEN||env.RESPOND_IO_API_TOKEN;
  const response=await fetch("https://api.respond.io/v2/contact/id:"+encodeURIComponent(String(contactId))+"/message",{
    method:"POST",
    headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json"},
    body:JSON.stringify({channelId:Number(channelId),message:{type:"text",text:clean(text)}})
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(response.status===429||response.status>=500?"respond_delivery_unknown":"respond_rejected");
  if(!body?.messageId)throw new Error("respond_delivery_unknown");
  return String(body.messageId);
}

async function processSalesOutboundRunRecord(admin,run,{env=process.env}={}){
  const inbound=run?.sales_agent_v2_inbound_messages;
  if(!inbound||!SAFE_CHANNELS.has(String(inbound.channel_id||"")))return{status:"skipped",reason:"channel_not_allowed"};
  const existing=await admin.from("sales_agent_v2_auto_outbound").select("id,status,error_code").eq("inbound_message_id",inbound.id).maybeSingle();
  if(existing.error)throw existing.error;
  if(existing.data)return{status:"already_handled",outboundStatus:existing.data.status,...(existing.data.status==="blocked"?{reason:existing.data.error_code||null}:{})};
  const maxAgeMs=Math.max(30_000,Number(env.SALES_AGENT_V2_OUTBOUND_MAX_AGE_MS||180000));
  const completedAt=new Date(run?.completed_at||0).getTime();
  // Do not backfill historical no-send rows when the autonomous scanner sees
  // expired runs. Durable diagnostics below apply only to current decisions.
  if(!Number.isFinite(completedAt)||Date.now()-completedAt>maxAgeMs)return{status:"blocked",reason:"stale_run"};
  const block=async(reason)=>{
    // Durable no-send outcome, unique per inbound/run. Never resets a reservation
    // or a previously sent/uncertain effect; no retry is authorized by this row.
    const saved=await admin.from("sales_agent_v2_auto_outbound").insert({
      inbound_message_id:inbound.id,shadow_run_id:run.id,respond_contact_id:inbound.respond_contact_id,
      channel_id:inbound.channel_id,case_kind:"greeting_qualification",status:"blocked",
      proposed_message:clean(run.proposed_response)||"[Sin propuesta enviable]",error_code:reason,completed_at:new Date().toISOString(),
    });
    if(saved.error?.code==="23505")return{status:"already_handled"};
    if(saved.error)throw saved.error;
    return{status:"blocked",reason};
  };
  let socialContext=null;
  let conversation=null;
  if(socialSalesProtected(inbound,env)){
    const continuity=await readSocialContinuity(admin,inbound.respond_contact_id,inbound.channel_id,new Date().toISOString());
    if(continuity.owner)return block("owner_continuity_no_sales_outbound");
    if(hasSalesAppointmentCommitment(run.proposed_response))return block("social_appointment_output_requires_review");
    socialContext=await readSocialSalesContext(admin,inbound,env);
    conversation=await readSalesConversation(admin,inbound);
    const profile=await admin.from("gv_respond_contact_snapshots").select("inm_zona,inm_tipo,ven_plazo")
      .eq("respond_contact_id",inbound.respond_contact_id).maybeSingle();
    if(profile.error)throw profile.error;
    const hasContext=conversation.hasContext||hasSalesProfileContext(profile.data);
    Object.assign(socialContext,{hasConversationContext:hasContext,isolatedCta:isolatedSalesCta(inbound.sanitized_text,{...conversation,hasContext},socialContext.sourceProperty)&&!conversation.linkSeen});
    const policy=salesClarificationPolicy(run.proposed_response,conversation,socialContext.sourceProperty);
    if(policy.reviewReason||policy.output!==run.proposed_response)return block(policy.reviewReason||"unresolved_reference_requires_review");
  }

  const {data:handoff,error:handoffError}=await admin.from("sales_agent_v2_handoffs")
    .select("id,status")
    .eq("inbound_message_id",inbound.id)
    .maybeSingle();
  if(handoffError)throw handoffError;
  if(handoff)return block("handoff_exists");
  if(socialContext){
    const pendingReview=await admin.from("sales_agent_v2_handoffs").select("id")
      .eq("respond_contact_id",inbound.respond_contact_id).eq("channel_id",inbound.channel_id)
      .in("status",["ready_for_advisor","assignment_requested","assigned","escalated"]).limit(1);
    if(pendingReview.error)throw pendingReview.error;
    if(pendingReview.data?.length)return block("open_human_review");
  }

  const decision=classifySafeSalesOutbound({
    messageText:conversation?.burstText||inbound.sanitized_text,
    calledTools:run.called_tools,
    proposedResponse:run.proposed_response,
    socialContext
  });
  if(!decision.eligible)return block(decision.reason);

  const {data:newer,error:newerError}=await admin.from("sales_agent_v2_inbound_messages")
    .select("id").eq("respond_contact_id",inbound.respond_contact_id)
    .eq("channel_id",inbound.channel_id)
    .gt("occurred_at",inbound.occurred_at).limit(1);
  if(newerError)throw newerError;
  if((newer||[]).length){
    await admin.from("sales_agent_v2_auto_outbound").insert({
      inbound_message_id:inbound.id,shadow_run_id:run.id,respond_contact_id:inbound.respond_contact_id,
      channel_id:inbound.channel_id,case_kind:salesOutboundStorageKind(decision.caseKind),status:"superseded",
      proposed_message:run.proposed_response,error_code:"newer_inbound_exists",completed_at:new Date().toISOString()
    });
    return{status:"superseded",reason:"newer_inbound_exists"};
  }

  const {data:claim,error:claimError}=await admin.from("sales_agent_v2_auto_outbound").insert({
    inbound_message_id:inbound.id,shadow_run_id:run.id,respond_contact_id:inbound.respond_contact_id,
    channel_id:inbound.channel_id,case_kind:salesOutboundStorageKind(decision.caseKind),status:"processing",
    proposed_message:run.proposed_response
  }).select("id").single();
  if(claimError?.code==="23505")return{status:"already_handled"};
  if(claimError)throw claimError;

  try{
    const providerMessageId=await sendRespond({
      contactId:inbound.respond_contact_id,channelId:inbound.channel_id,text:run.proposed_response,env
    });
    const sentAt=new Date().toISOString();
    await admin.from("sales_agent_v2_auto_outbound").update({
      status:"sent",provider_message_id:providerMessageId,sent_at:sentAt,completed_at:sentAt
    }).eq("id",claim.id);
    return{status:"sent",inboundMessageId:inbound.id,caseKind:decision.caseKind,providerMessageId};
  }catch(error){
    await admin.from("sales_agent_v2_auto_outbound").update({
      status:"failed",error_code:String(error?.message||"send_failed").slice(0,120),completed_at:new Date().toISOString()
    }).eq("id",claim.id);
    throw error;
  }
}

export async function processSalesAutoOutboundRun(admin,runId,{env=process.env}={}){
  assertSalesAutoOutboundEnvironment(env);
  const {data:run,error}=await admin.from("sales_agent_v2_shadow_runs")
    .select("id,status,called_tools,proposed_response,completed_at,inbound_message_id,sales_agent_v2_inbound_messages(id,event_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status,social_route_id)")
    .eq("id",runId)
    .maybeSingle();
  if(error)throw error;
  if(!run||run.status!=="idle")return{status:"skipped",reason:"run_not_ready"};
  return processSalesOutboundRunRecord(admin,run,{env});
}

export async function processOneSalesAutoOutbound(admin,{env=process.env}={}){
  assertSalesAutoOutboundEnvironment(env);
  let query=admin.from("sales_agent_v2_shadow_runs")
    .select("id,status,called_tools,proposed_response,completed_at,inbound_message_id,sales_agent_v2_inbound_messages(id,event_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status,social_route_id)")
    .eq("status","idle")
    .order("completed_at",{ascending:false})
    .limit(50);
  const cutoff=env.SALES_AGENT_V2_AUTO_OUTBOUND_NOT_BEFORE;
  if(cutoff)query=query.gte("completed_at",cutoff);
  const {data:runs,error}=await query;
  if(error)throw error;

  for(const run of runs||[]){
    const result=await processSalesOutboundRunRecord(admin,run,{env});
    if(["sent","failed"].includes(result.status))return result;
  }
  return{status:"idle"};
}
