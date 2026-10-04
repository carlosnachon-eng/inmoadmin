import { onceSocialHandoffEffect } from "../social/handoffEffects.js";
import { socialAssignmentBarrier } from "../social/continuity.js";
import { explicitPropertyAppointment, isCommercialServiceOffer, isShortSocialCta, socialSalesProtected } from "../social/commercialIntent.js";
import { readSocialSalesContext } from "../social/salesInventory.js";
import { readSalesConversation } from "./salesConversation.js";
import { protectedSalesAssignmentContext } from "./salesAssignmentGuard.js";
import { safeSalesAttentionReason } from "./salesAttentionView.js";

const RX={
  human:/\b(asesor|persona|humano|agente|alguien que me atienda|que me llamen|llámame|llamame)\b/i,
  appointment:/\b(cita|visita|verlo|verla|conocerlo|conocerla|mostrar|enseñar|ensenar|hoy|mañana|manana|qué horario|que horario|a qué hora|a que hora)\b/i,
  reservation:/\b(apartar|apartado|reservar|reserva|separar|depositar)\b/i,
  negotiation:/\b(negociar|negociación|negociacion|descuento|rebaja|oferta|contraoferta|menos|último precio|ultimo precio)\b/i,
  financing:/\b(crédito|credito|hipoteca|infonavit|fovissste|banco|financiamiento)\b/i,
  strong:/\b(muy interesad|demasiado interesad|me interesa mucho|lo quiero|la quiero|ese me interesa|esa me interesa)\b/i,
  property:/\b(casa|departamento|depa|local|oficina|bodega|terreno|inmueble|propiedad)\b/i,
};

const clean=(v,max=1200)=>String(v??"").replace(/\s+/g," ").trim().slice(0,max);

export function classifySalesHandoff(text,{strict=false,verifiedProperty=false}={}){
  const value=clean(text,2000);
  if(!value)return null;
  if(strict&&(isCommercialServiceOffer(value)||isShortSocialCta(value)))return null;
  if(RX.human.test(value))return{reason:"human_requested",priority:"urgent"};
  if(RX.reservation.test(value))return{reason:"reservation_intent",priority:"urgent"};
  if(RX.negotiation.test(value))return{reason:"negotiation_intent",priority:"high"};
  if(RX.financing.test(value))return{reason:"financing_intent",priority:"high"};
  if(strict?explicitPropertyAppointment(value,{verifiedProperty}):RX.appointment.test(value))return{reason:"appointment_intent",priority:"urgent"};
  if(RX.strong.test(value)&&RX.property.test(value))return{reason:"specific_property_high_interest",priority:"high"};
  return null;
}

async function inboundHandoffDecision(admin,inbound,env,{notBefore=null}={}){
  const strict=socialSalesProtected(inbound,env);
  const context=strict?await readSocialSalesContext(admin,inbound,env):null;
  const conversation=strict?await readSalesConversation(admin,inbound,{notBefore}):null;
  return classifySalesHandoff(conversation?.burstText||inbound?.sanitized_text,{strict,verifiedProperty:Boolean(context?.sourceProperty)});
}

async function handoffDispatchBarrier(admin,handoff,env,{protectedAssignment=false,reservedPhase=null}={}){
  let verified;
  if(protectedAssignment){
    verified=await protectedSalesAssignmentContext(admin,handoff,env,{reservedPhase});
    if(verified.reason)return verified.reason;
  }
  const assignment=await socialAssignmentBarrier(admin,handoff,{env});
  if(assignment)return assignment;
  if(!socialSalesProtected(handoff,env))return null;
  // Historical fallback rows remain intact, but cannot trigger workflow/ACK/SLA.
  if(handoff.reason==="automation_fallback")return "automation_fallback_requires_review";
  const inbound=await admin.from("sales_agent_v2_inbound_messages").select("id,sanitized_text,respond_contact_id,channel_id,social_route_id,occurred_at")
    .eq("id",handoff.inbound_message_id).eq("respond_contact_id",handoff.respond_contact_id).eq("channel_id",handoff.channel_id).maybeSingle();
  if(inbound.error)throw inbound.error;
  if(!inbound.data)return "handoff_intent_unverified";
  const decision=await inboundHandoffDecision(admin,verified?.inbound||{...inbound.data,social_route_id:inbound.data.social_route_id||handoff.social_route_id},env,
    {notBefore:protectedAssignment?env.SALES_AGENT_V2_PROTECTED_ASSIGNMENT_NOT_BEFORE:null});
  return decision&&decision.reason===handoff.reason?null:"handoff_intent_unverified";
}

async function currentConversationSummary(admin,{inbound,run,decision}){
  const {data:recent,error:recentError}=await admin.from("sales_agent_v2_inbound_messages")
    .select("occurred_at,sanitized_text")
    .eq("respond_contact_id",inbound.respond_contact_id)
    .lte("occurred_at",inbound.occurred_at)
    .order("occurred_at",{ascending:false})
    .limit(4);
  if(recentError)throw recentError;

  let agentContext="";
  if(run?.id){
    const {data:storedRun,error:runError}=await admin.from("sales_agent_v2_shadow_runs")
      .select("proposed_response")
      .eq("id",run.id)
      .maybeSingle();
    if(runError)throw runError;
    agentContext=clean(storedRun?.proposed_response||"",700)
      .replace(/(?:^|\s)(?:un asesor|te voy a asignar|te asigno)[^.?!]*[.?!]?/ig," ")
      .replace(/\s+/g," ")
      .trim();
  }

  const prospectContext=(recent||[]).reverse()
    .map((row)=>clean(row.sanitized_text,260))
    .filter(Boolean)
    .join(" | ");

  return clean([
    decision.reason==="human_requested"?"Atención humana solicitada explícitamente.":"Interés alto detectado: "+decision.reason.replaceAll("_"," ")+".",
    prospectContext ? "Contexto reciente del prospecto: "+prospectContext+"." : "",
    agentContext ? "Propiedad/contexto identificado por Sales V2: "+agentContext+"." : "",
    "Último mensaje: “"+clean(inbound.sanitized_text,400)+"”"
  ].filter(Boolean).join(" "),1200);
}

export async function createSalesHandoffIfNeeded(admin,{inbound,run=null,reviewReason=null,env=process.env}){
  const blocked=await socialAssignmentBarrier(admin,inbound,{env});
  if(blocked==="owner_continuity_no_sales_handoff")return{created:false,reason:blocked};
  const manualReview=["unresolved_reference_requires_review","repeated_clarification_requires_review","sender_requires_review"].includes(reviewReason);
  const decision=manualReview?{reason:"automation_fallback",priority:"normal"}:await inboundHandoffDecision(admin,inbound,env);
  if(!decision)return{created:false,reason:"not_high_intent"};

  if(socialSalesProtected(inbound,env)&&inbound.occurred_at){
    const newer=await admin.from("sales_agent_v2_inbound_messages").select("id")
      .eq("respond_contact_id",inbound.respond_contact_id).eq("channel_id",inbound.channel_id)
      .gt("occurred_at",inbound.occurred_at).limit(1);
    if(newer.error)throw newer.error;
    if(newer.data?.length)return{created:false,reason:"absorbed_by_newer_message"};
  }

  const {data:existing,error:existingError}=await admin.from("sales_agent_v2_handoffs")
    .select("id,status").eq("inbound_message_id",inbound.id).maybeSingle();
  if(existingError)throw existingError;
  if(existing)return{created:false,reason:"already_exists",handoffId:existing.id};

  if(socialSalesProtected(inbound,env)){
    const open=await admin.from("sales_agent_v2_handoffs").select("id,status")
      .eq("respond_contact_id",inbound.respond_contact_id).eq("channel_id",inbound.channel_id)
      .in("status",["ready_for_advisor","assignment_requested","assigned","escalated"])
      .order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(open.error)throw open.error;
    if(open.data)return{created:false,reason:"open_review_preserved",handoffId:open.data.id};
  }

  const summary=await currentConversationSummary(admin,{inbound,run,decision});

  const {data,error}=await admin.from("sales_agent_v2_handoffs").insert({
    respond_contact_id:inbound.respond_contact_id,
    channel_id:inbound.channel_id,
    inbound_message_id:inbound.id,
    shadow_run_id:run?.id||null,
    status:"ready_for_advisor",
    reason:decision.reason,
    priority:decision.priority,
    summary:manualReview?"Revisión de respuesta o referencia solicitada por política; sin nueva intención comercial ni autorización de asignación.":summary,
    ...(socialSalesProtected(inbound,env)?{social_route_id:inbound.social_route_id||null,assignment_error_code:manualReview?reviewReason:blocked||null}:{}),
  }).select("id").single();
  if(error)throw error;
  return{created:true,handoffId:data.id,reason:decision.reason,priority:decision.priority};
}

// One read immediately before each remote effect. Missing/malformed/unknown is
// NOT unassigned. A live human assignment always overrides an older snapshot.
async function liveAssignmentBarrier(handoff,env){
  if(!socialSalesProtected(handoff,env))return null;
  try{
    const token=env.RESPOND_IO_TOKEN||env.RESPOND_IO_API_TOKEN;
    if(!token)return "assignment_live_state_unverified";
    const response=await fetch("https://api.respond.io/v2/contact/id:"+encodeURIComponent(String(handoff.respond_contact_id)),{
      method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/json"},signal:AbortSignal.timeout(5000),
    });
    if(!response.ok)return "assignment_live_state_unverified";
    const body=await response.json();const contact=body?.contact||body?.item||body?.data||body;
    if(String(contact?.id)!==String(handoff.respond_contact_id)||!Object.hasOwn(contact,"assignee")||contact.blocked===true||contact.isBlocked===true)return "assignment_live_state_unverified";
    if(contact.assignee===null)return null;
    return contact.assignee?.id?"existing_responsible_preserved":"assignment_live_state_unverified";
  }catch{return "assignment_live_state_unverified";}
}

export async function createSalesAutomationFallbackHandoff(admin,{inbound,run=null,env=process.env}){
  // A model/automation failure is NOT a new buying/appointment intention.
  if(socialSalesProtected(inbound,env))return createSalesHandoffIfNeeded(admin,{inbound,run,env});
  const blocked=await socialAssignmentBarrier(admin,inbound,{env});
  if(blocked)return{created:false,reason:blocked};
  const {data:existing,error:existingError}=await admin.from("sales_agent_v2_handoffs")
    .select("id,status").eq("inbound_message_id",inbound.id).maybeSingle();
  if(existingError)throw existingError;
  if(existing)return{created:false,reason:"already_exists",handoffId:existing.id,status:existing.status};

  const decision={reason:"automation_fallback",priority:"high"};
  const summary=await currentConversationSummary(admin,{inbound,run,decision});
  const {data,error}=await admin.from("sales_agent_v2_handoffs").insert({
    respond_contact_id:inbound.respond_contact_id,
    channel_id:inbound.channel_id,
    inbound_message_id:inbound.id,
    shadow_run_id:run?.id||null,
    status:"ready_for_advisor",
    reason:"automation_fallback",
    priority:"high",
    summary
  }).select("id").single();
  if(error)throw error;
  return{created:true,handoffId:data.id,reason:"automation_fallback",priority:"high"};
}

export async function processPendingSalesHandoffs(admin){
  const {data:rows,error}=await admin.from("sales_agent_v2_inbound_messages")
    .select("id,respond_contact_id,channel_id,sanitized_text,status,occurred_at,social_route_id")
    .in("status",["captured","processed"])
    .order("occurred_at",{ascending:false})
    .limit(100);
  if(error)throw error;

  let created=0;
  for(const inbound of rows||[]){
    const decision=classifySalesHandoff(inbound.sanitized_text);
    if(!decision)continue;
    const {data:run}=await admin.from("sales_agent_v2_shadow_runs").select("id").eq("inbound_message_id",inbound.id).maybeSingle();
    const result=await createSalesHandoffIfNeeded(admin,{inbound,run});
    if(result.created)created+=1;
  }
  return{created};
}


const HANDOFF_ACK="Envié tu solicitud de atención al equipo de Ventas; la asignación de un asesor aún está pendiente de confirmar.";
const FALLBACK_ACK="Gracias. Para no dejarte sin atención, te voy a asignar con un asesor y le comparto el contexto de tu conversación.";

function handoffWorkflowUrl(env=process.env){
  const raw=String(env.SALES_AGENT_V2_HANDOFF_WORKFLOW_URL||"").trim();
  if(!raw)return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=="https:"||url.hostname!=="hooks.respond.io"||url.username||url.password)return null;
    return url.toString();
  }catch{return null;}
}

async function sendHandoffAck({contactId,channelId,reason,env=process.env}){
  const token=env.RESPOND_IO_TOKEN||env.RESPOND_IO_API_TOKEN;
  if(!token)throw new Error("respond_sender_credential_missing");
  const response=await fetch("https://api.respond.io/v2/contact/id:"+encodeURIComponent(String(contactId))+"/message",{
    method:"POST",
    signal:AbortSignal.timeout(10000),
    headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json"},
    body:JSON.stringify({channelId:Number(channelId),message:{type:"text",text:reason==="automation_fallback"?FALLBACK_ACK:HANDOFF_ACK}})
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok||!body?.messageId)throw new Error("handoff_ack_failed");
  return String(body.messageId);
}

async function triggerHandoffWorkflow({contactId,handoffId,reason,summary,env=process.env}){
  const url=handoffWorkflowUrl(env);
  if(!url)return{triggered:false,reason:"workflow_not_configured"};
  const response=await fetch(url,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      contactId:String(contactId),
      handoffId:String(handoffId),
      reason:String(reason||""),
      summary:String(summary||"").slice(0,1200),
      routingDecision:"sales_v2_handoff"
    })
  });
  if(!response.ok)throw new Error("handoff_workflow_http_"+response.status);
  return{triggered:true};
}

export async function dispatchSalesHandoff(admin,{handoffId,env=process.env}){
  const {data:handoff,error}=await admin.from("sales_agent_v2_handoffs")
    .select("*")
    .eq("id",handoffId).maybeSingle();
  if(error)throw error;
  if(!handoff)return{ok:false,reason:"handoff_not_found"};
  const review=async(reason)=>{
    const result=await admin.from("sales_agent_v2_handoffs").update({assignment_error_code:safeSalesAttentionReason(reason),updated_at:new Date().toISOString()})
      .eq("id",handoff.id);
    if(result.error)throw result.error;
    return{ok:true,status:"requires_review",assignmentTriggered:false,assignmentConfirmed:false,reason:safeSalesAttentionReason(reason)};
  };
  // This entry point no longer has an OFF/missing-marker legacy escape hatch.
  // Re-read after each live GET too: the Social head can change during that IO.
  const barrier=(reservedPhase=null)=>handoffDispatchBarrier(admin,handoff,env,{protectedAssignment:true,reservedPhase});
  try{
  const blocked=await barrier();
  if(blocked)return review(["unresolved_reference_requires_review","repeated_clarification_requires_review","sender_requires_review"].includes(handoff.assignment_error_code)?handoff.assignment_error_code:blocked);

  const workflowUrl=handoffWorkflowUrl(env);
  if(!workflowUrl)return review("workflow_not_configured");

  const liveBlocked=await liveAssignmentBarrier(handoff,env);
  if(liveBlocked)return review(liveBlocked);

  if(!handoff.assignment_requested_at){
    try{
      await onceSocialHandoffEffect(admin,{kind:"sales",handoff,phase:"assignment",requireReservation:true,effect:async()=>{
      if(await barrier("assignment"))throw new Error("social_assignment_state_changed_requires_review");
      if(await liveAssignmentBarrier(handoff,env))throw new Error("social_assignment_state_changed_requires_review");
      if(await barrier("assignment"))throw new Error("social_assignment_state_changed_requires_review");
      const response=await fetch(workflowUrl,{
        method:"POST",
        signal:AbortSignal.timeout(10000),
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          contactId:String(handoff.respond_contact_id),
          handoffId:String(handoff.id),
          reason:String(handoff.reason||""),
          summary:String(handoff.summary||"").slice(0,1200),
          routingDecision:"sales_v2_handoff"
        })
      });
      if(!response.ok)throw new Error("handoff_workflow_http_"+response.status);
      return null;
      }});
      const assignedAt=new Date();
      const now=assignedAt.toISOString();
      const slaDueAt=env.SALES_AGENT_V2_HANDOFF_SLA_ENABLED==="true"?new Date(assignedAt.getTime()+slaMinutes(env)*60*1000).toISOString():null;
      const {error:updateError}=await admin.from("sales_agent_v2_handoffs").update({
        status:"assignment_requested",
        assignment_requested_at:now,
        sla_due_at:slaDueAt,
        assignment_error_code:null,
        updated_at:now
      }).eq("id",handoff.id).is("assignment_requested_at",null);
      if(updateError)throw updateError;
    }catch(error){
      const now=new Date().toISOString();
      await admin.from("sales_agent_v2_handoffs").update({
        assignment_error_code:safeSalesAttentionReason(error?.message),
        updated_at:now
      }).eq("id",handoff.id);
      throw error;
    }
  }

  let ackMessageId=handoff.ack_message_id||null;
  if(!ackMessageId){
    const blocked=await barrier();
    if(blocked)return review(blocked);
    const liveBlocked=await liveAssignmentBarrier(handoff,env);
    if(liveBlocked)return review(liveBlocked);
    ackMessageId=await onceSocialHandoffEffect(admin,{kind:"sales",handoff,phase:"ack",requireReservation:true,effect:async()=>{
      if(await barrier("ack"))throw new Error("social_assignment_state_changed_requires_review");
      if(await liveAssignmentBarrier(handoff,env))throw new Error("social_assignment_state_changed_requires_review");
      if(await barrier("ack"))throw new Error("social_assignment_state_changed_requires_review");
      return sendHandoffAck({
      contactId:handoff.respond_contact_id,
      channelId:handoff.channel_id,
      reason:handoff.reason,
      env
    });}});
    const ackAt=new Date().toISOString();
    const {error:updateAckError}=await admin.from("sales_agent_v2_handoffs").update({
      ack_message_id:ackMessageId,
      ack_sent_at:ackAt,
      updated_at:ackAt
    }).eq("id",handoff.id).is("ack_message_id",null);
    if(updateAckError)throw updateAckError;
  }

  // Webhook 2xx acknowledges a request, NOT an actual advisor assignment.
  return{ok:true,status:"assignment_requested",ackMessageId,assignmentTriggered:true,assignmentConfirmed:false};
  }catch(error){
    const reason=safeSalesAttentionReason(error?.message);
    return review(!reason||reason==="requires_manual_review"?"protected_assignment_verification_failed":reason);
  }
}



function slaMinutes(env=process.env){
  const raw=Number(env.SALES_AGENT_V2_HANDOFF_SLA_MINUTES||10);
  return Number.isFinite(raw)&&raw>=1&&raw<=120?Math.floor(raw):10;
}

function maxReassignments(env=process.env){
  const raw=Number(env.SALES_AGENT_V2_HANDOFF_MAX_REASSIGNMENTS||2);
  return Number.isFinite(raw)&&raw>=0&&raw<=5?Math.floor(raw):2;
}

export async function processSalesHandoffSla(admin,{env=process.env}={}){
  const now=new Date();
  const {data:rows,error}=await admin.from("sales_agent_v2_handoffs")
    .select("*")
    .in("status",["assignment_requested","assigned"])
    .not("sla_due_at","is",null)
    .lte("sla_due_at",now.toISOString())
    .order("sla_due_at",{ascending:true})
    .limit(20);
  if(error)throw error;

  for(const handoff of rows||[]){
    if(await handoffDispatchBarrier(admin,handoff,env))continue;
    const baseline=handoff.last_reassignment_at||handoff.assignment_requested_at;
    const {data:snapshot,error:snapshotError}=await admin.from("gv_respond_contact_snapshots")
      .select("respond_last_human_outbound_at")
      .eq("respond_contact_id",handoff.respond_contact_id)
      .maybeSingle();
    if(snapshotError)throw snapshotError;

    const humanAt=snapshot?.respond_last_human_outbound_at||null;
    if(humanAt&&baseline&&new Date(humanAt)>new Date(baseline)){
      const takenAt=new Date(humanAt).toISOString();
      const {error:updateError}=await admin.from("sales_agent_v2_handoffs").update({
        status:"taken",
        taken_at:takenAt,
        last_human_outbound_at:takenAt,
        sla_due_at:null,
        updated_at:new Date().toISOString()
      }).eq("id",handoff.id);
      if(updateError)throw updateError;
      return{status:"taken",handoffId:handoff.id,takenAt};
    }

    const max=maxReassignments(env);
    if(Number(handoff.reassignment_count||0)>=max){
      const {error:updateError}=await admin.from("sales_agent_v2_handoffs").update({
        status:"escalated",
        assignment_error_code:"sla_exhausted_human_attention_required",
        sla_due_at:null,
        updated_at:new Date().toISOString()
      }).eq("id",handoff.id);
      if(updateError)throw updateError;
      return{status:"escalated",handoffId:handoff.id};
    }

    const url=handoffWorkflowUrl(env);
    if(!url)throw new Error("handoff_workflow_not_configured");
    await onceSocialHandoffEffect(admin,{kind:"sales",handoff,phase:"sla:"+(Number(handoff.reassignment_count||0)+1),effect:async()=>{
    if(await handoffDispatchBarrier(admin,handoff,env))throw new Error("social_assignment_state_changed_requires_review");
    const response=await fetch(url,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        contactId:String(handoff.respond_contact_id),
        handoffId:String(handoff.id),
        reason:"sla_reassignment",
        summary:"Reasignación automática por SLA: el asesor anterior no respondió dentro del tiempo objetivo.",
        routingDecision:"sales_v2_handoff_sla_reassignment"
      })
    });
    if(!response.ok)throw new Error("handoff_workflow_http_"+response.status);
    return null;
    }});

    const reassignedAt=new Date();
    const due=new Date(reassignedAt.getTime()+slaMinutes(env)*60*1000).toISOString();
    const {error:updateError}=await admin.from("sales_agent_v2_handoffs").update({
      status:"assignment_requested",
      reassignment_count:Number(handoff.reassignment_count||0)+1,
      last_reassignment_at:reassignedAt.toISOString(),
      sla_due_at:due,
      assignment_error_code:null,
      updated_at:reassignedAt.toISOString()
    }).eq("id",handoff.id);
    if(updateError)throw updateError;
    return{
      status:"reassigned",
      handoffId:handoff.id,
      reassignmentCount:Number(handoff.reassignment_count||0)+1,
      nextDueAt:due
    };
  }

  return{status:"idle"};
}
