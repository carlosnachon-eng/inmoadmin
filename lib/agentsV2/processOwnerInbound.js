import { readRespondMessages, respondMessageTimestamp } from "../ejecutivo/respondSync";
import { sanitizeShadowText } from "../shadow/coordinator";
import { createOwnerSession, fulfillOwnerActions, getOwnerSession, ownerOutput } from "./openaiOwnerAgent";
import { safeAgentUsage } from "./agentUsage";
import { readHumanAttention } from "./humanAttention.js";
import { readSocialAppointment, anchorHistoricalText, absoluteAppointmentLabel, ownerContinuityResponse, assertNoUngroundedAppointment } from "../social/continuity.js";

const SAFE_CHANNELS=new Set(["497382","497385","498219","515318"]);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const clean=(v,max=1600)=>String(v??"").replace(/\s+/g," ").trim().slice(0,max);

async function sendRespond({contactId,channelId,text,env=process.env}){
  const token=env.RESPOND_IO_TOKEN||env.RESPOND_IO_API_TOKEN;
  if(!token)throw new Error("respond_sender_credential_missing");
  const r=await fetch("https://api.respond.io/v2/contact/id:"+encodeURIComponent(String(contactId))+"/message",{
    method:"POST",
    headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json"},
    body:JSON.stringify({channelId:Number(channelId),message:{type:"text",text:clean(text)}})
  });
  const body=await r.json().catch(()=>({}));
  if(!r.ok||!body?.messageId)throw new Error("owner_outbound_failed");
  return String(body.messageId);
}

async function ownerContext(admin,inbound,appointmentContext=null){
  const {data:local,error}=await admin.from("owner_agent_v1_inbound_messages")
    .select("occurred_at,sanitized_text")
    .eq("respond_contact_id",inbound.respond_contact_id)
    .lte("occurred_at",inbound.occurred_at)
    .order("occurred_at",{ascending:false})
    .limit(6);
  if(error)throw error;

  let respondHistory="";
  try{
    const resp=await readRespondMessages(inbound.respond_contact_id,1);
    respondHistory=(resp.messages||[]).map(m=>{
      const ts=respondMessageTimestamp(m);
      const traffic=String(m?.traffic||m?.direction||"").toLowerCase();
      const role=["incoming","inbound"].includes(traffic)?"propietario":["outgoing","outbound"].includes(traffic)?"Emporio":"";
      const raw=String(m?.text??m?.message?.text??m?.body??m?.message?.body??"").trim();
      const safe=sanitizeShadowText(raw);
      return !ts||!role||safe.rejected?null:{ts,role,text:safe.text.slice(0,700)};
    }).filter(x=>x&&(!appointmentContext||x.ts<=inbound.occurred_at)).sort((a,b)=>a.ts.localeCompare(b.ts)).slice(-10).map(x=>"- "+x.role+": "+(appointmentContext?`[${x.ts}] ${anchorHistoricalText(x.text,x.ts)}`:x.text)).join("\n");
  }catch(error){
    console.error("[owner-ai-context]",String(error?.message||"respond_history_failed").slice(0,120));
  }

  const localHistory=(local||[]).reverse().map(x=>"- propietario: "+(appointmentContext?`[${x.occurred_at}] ${anchorHistoricalText(x.sanitized_text,x.occurred_at)}`:String(x.sanitized_text||"").slice(0,500))).join("\n");
  return[
    ...(appointmentContext?[
      "Fecha del mensaje actual: "+inbound.occurred_at+". Zona: America/Mexico_City.",
      appointmentContext.appointment?"Cita confirmada persistida (fuente de verdad; no reconstruir desde historial): "+absoluteAppointmentLabel(appointmentContext.appointment.fecha_hora):"Cita sin evidencia persistida única: no afirmar fecha ni horario; revisión humana si se requiere.",
      "Continuidad OWNER. No crear cita ni nueva asignación. Fechas históricas se anclan al mensaje original, nunca al día actual."
    ]:[]),
    "respondContactId opaco: "+inbound.respond_contact_id,
    "Historial reciente de Respond:",
    respondHistory||"(no disponible)",
    "Historial local de Propietarios IA:",
    localHistory||"(sin historial)",
    "Mensaje actual:",
    appointmentContext?anchorHistoricalText(inbound.sanitized_text,inbound.occurred_at):inbound.sanitized_text
  ].join("\n");
}

export async function processOwnerInboundById(admin,inboundId,{env=process.env}={}){
  const {data:inbound,error:claimError}=await admin.from("owner_agent_v1_inbound_messages")
    .update({status:"processing"}).eq("id",inboundId).eq("status","captured")
    .select("id,event_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status,social_route_id").maybeSingle();
  if(claimError)throw claimError;
  if(!inbound)return{status:"not_claimed"};
  if(!SAFE_CHANNELS.has(String(inbound.channel_id)))return{status:"skipped"};

  try{
    const attention=await readHumanAttention(admin,inbound);
    if(attention.blocked){
      await admin.from("owner_agent_v1_inbound_messages")
        .update({status:"skipped"})
        .eq("id",inbound.id)
        .eq("status","processing");
      return{status:"skipped",reason:attention.reason};
    }

    const protectedMode=Boolean(inbound.social_route_id);
    const appointmentContext=protectedMode?await readSocialAppointment(admin,inbound.respond_contact_id):null;
    const input=await ownerContext(admin,inbound,appointmentContext);
    const started=Date.now();
    const beforeModel=await readHumanAttention(admin,inbound);
    if(beforeModel.blocked){
      await admin.from("owner_agent_v1_inbound_messages").update({status:"skipped"}).eq("id",inbound.id).eq("status","processing");
      return{status:"skipped",reason:beforeModel.reason};
    }
    let session=await createOwnerSession({input,env});
    const calledTools=[];
    for(let i=0;i<80;i+=1){
      session=await getOwnerSession(session.id,env);
      if(session.status==="requires_action"){
        for(const a of session.required_actions||[])calledTools.push(String(a?.name||"unknown").slice(0,80));
        await fulfillOwnerActions(session,env);
        await sleep(150);
        continue;
      }
      if(["idle","failed"].includes(session.status))break;
      await sleep(350);
    }
    session=await getOwnerSession(session.id,env);
    let output=await ownerOutput(session.id,env);
    let outputError=null;
    let responseAppointment=null;
    if(protectedMode&&session.status==="idle"&&output){
      // Deterministic acknowledgement is grounded only in the persisted cita, not model memory.
      const fresh=await readSocialAppointment(admin,inbound.respond_contact_id);
      const grounded=ownerContinuityResponse(inbound.sanitized_text,fresh.appointment);
      if(grounded)responseAppointment=fresh.appointment;
      if(grounded)output=grounded;
      else try{assertNoUngroundedAppointment(output);}catch(error){output=null;outputError=error.message;}
    }
    const completedAt=new Date().toISOString();
    const model=env.OPENAI_OWNER_AGENT_MODEL||env.OPENAI_SALES_AGENT_MODEL||env.OPENAI_ADMIN_AGENT_MODEL;
    const usage=await safeAgentUsage(session.id,{model,env});
    const {data:run,error:runError}=await admin.from("owner_agent_v1_runs").insert({
      inbound_message_id:inbound.id,session_id:session.id,status:session.status==="idle"&&!outputError?"idle":"failed",
      called_tools:calledTools,proposed_response:output||null,latency_ms:Date.now()-started,
      model,input_tokens:usage.inputTokens,cached_input_tokens:usage.cachedInputTokens,output_tokens:usage.outputTokens,reasoning_tokens:usage.reasoningTokens,total_tokens:usage.totalTokens,estimated_cost_usd:usage.estimatedCostUsd,
      error_code:outputError||session?.error?.code||session?.error?.message||null,completed_at:completedAt
    }).select("id").single();
    if(runError)throw runError;

    if(session.status!=="idle"||!output){
      await admin.from("owner_agent_v1_inbound_messages").update({status:"failed"}).eq("id",inbound.id);
      return{status:"failed"};
    }

    const {data:newer,error:newerError}=await admin.from("owner_agent_v1_inbound_messages")
      .select("id").eq("respond_contact_id",inbound.respond_contact_id).gt("occurred_at",inbound.occurred_at).limit(1);
    if(newerError)throw newerError;
    if((newer||[]).length){
      await admin.from("owner_agent_v1_auto_outbound").insert({
        inbound_message_id:inbound.id,run_id:run.id,respond_contact_id:inbound.respond_contact_id,
        channel_id:inbound.channel_id,status:"superseded",proposed_message:output,error_code:"newer_inbound_exists",completed_at:new Date().toISOString()
      });
      await admin.from("owner_agent_v1_inbound_messages").update({status:"processed"}).eq("id",inbound.id);
      return{status:"superseded"};
    }

    const {data:claim,error:outError}=await admin.from("owner_agent_v1_auto_outbound").insert({
      inbound_message_id:inbound.id,run_id:run.id,respond_contact_id:inbound.respond_contact_id,
      channel_id:inbound.channel_id,status:"processing",proposed_message:output
    }).select("id").single();
    if(outError)throw outError;

    if(protectedMode&&responseAppointment){
      const fresh=await readSocialAppointment(admin,inbound.respond_contact_id);
      if(fresh.appointment?.id!==responseAppointment.id||fresh.appointment?.fecha_hora!==responseAppointment.fecha_hora){
        await admin.from("owner_agent_v1_auto_outbound").update({status:"failed",error_code:"social_appointment_changed_requires_review",completed_at:new Date().toISOString()}).eq("id",claim.id);
        await admin.from("owner_agent_v1_inbound_messages").update({status:"failed"}).eq("id",inbound.id);
        return{status:"failed",reason:"social_appointment_changed_requires_review"};
      }
    }
    const beforeSend=await readHumanAttention(admin,inbound);
    if(beforeSend.blocked){
      await admin.from("owner_agent_v1_auto_outbound").update({status:"superseded",error_code:beforeSend.reason,completed_at:new Date().toISOString()}).eq("id",claim.id).eq("status","processing");
      await admin.from("owner_agent_v1_inbound_messages").update({status:"skipped"}).eq("id",inbound.id);
      return{status:"blocked",reason:beforeSend.reason};
    }
    const providerMessageId=await sendRespond({contactId:inbound.respond_contact_id,channelId:inbound.channel_id,text:output,env});
    const sentAt=new Date().toISOString();
    await admin.from("owner_agent_v1_auto_outbound").update({status:"sent",provider_message_id:providerMessageId,sent_at:sentAt,completed_at:sentAt}).eq("id",claim.id);
    await admin.from("owner_agent_v1_inbound_messages").update({status:"processed"}).eq("id",inbound.id);
    return{status:"sent",providerMessageId,calledTools,latencyMs:Date.now()-started};
  }catch(error){
    await admin.from("owner_agent_v1_inbound_messages").update({status:inbound.social_route_id?"failed":"captured"}).eq("id",inbound.id).eq("status","processing");
    console.error("[owner-ai-process]",String(error?.message||"owner_processing_failed").slice(0,160));
    throw error;
  }
}
