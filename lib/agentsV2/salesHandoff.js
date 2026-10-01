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

export function classifySalesHandoff(text){
  const value=clean(text,2000);
  if(!value)return null;
  if(RX.human.test(value))return{reason:"human_requested",priority:"urgent"};
  if(RX.reservation.test(value))return{reason:"reservation_intent",priority:"urgent"};
  if(RX.negotiation.test(value))return{reason:"negotiation_intent",priority:"high"};
  if(RX.financing.test(value))return{reason:"financing_intent",priority:"high"};
  if(RX.appointment.test(value))return{reason:"appointment_intent",priority:"urgent"};
  if(RX.strong.test(value)&&RX.property.test(value))return{reason:"specific_property_high_interest",priority:"high"};
  return null;
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
    "Interés alto detectado: "+decision.reason.replaceAll("_"," ")+".",
    prospectContext ? "Contexto reciente del prospecto: "+prospectContext+"." : "",
    agentContext ? "Propiedad/contexto identificado por Sales V2: "+agentContext+"." : "",
    "Último mensaje: “"+clean(inbound.sanitized_text,400)+"”"
  ].filter(Boolean).join(" "),1200);
}

export async function createSalesHandoffIfNeeded(admin,{inbound,run=null}){
  const decision=classifySalesHandoff(inbound?.sanitized_text);
  if(!decision)return{created:false,reason:"not_high_intent"};

  const {data:existing,error:existingError}=await admin.from("sales_agent_v2_handoffs")
    .select("id,status").eq("inbound_message_id",inbound.id).maybeSingle();
  if(existingError)throw existingError;
  if(existing)return{created:false,reason:"already_exists",handoffId:existing.id};

  const summary=await currentConversationSummary(admin,{inbound,run,decision});

  const {data,error}=await admin.from("sales_agent_v2_handoffs").insert({
    respond_contact_id:inbound.respond_contact_id,
    channel_id:inbound.channel_id,
    inbound_message_id:inbound.id,
    shadow_run_id:run?.id||null,
    status:"ready_for_advisor",
    reason:decision.reason,
    priority:decision.priority,
    summary
  }).select("id").single();
  if(error)throw error;
  return{created:true,handoffId:data.id,reason:decision.reason,priority:decision.priority};
}

export async function processPendingSalesHandoffs(admin){
  const {data:rows,error}=await admin.from("sales_agent_v2_inbound_messages")
    .select("id,respond_contact_id,channel_id,sanitized_text,status,occurred_at")
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


const HANDOFF_ACK="Claro. Te voy a asignar con un asesor para que coordinen la visita y confirme disponibilidad. Ya le comparto el contexto de lo que estás buscando para que no tengas que repetirlo.";

function handoffWorkflowUrl(env=process.env){
  const raw=String(env.SALES_AGENT_V2_HANDOFF_WORKFLOW_URL||"").trim();
  if(!raw)return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=="https:"||url.hostname!=="hooks.respond.io"||url.username||url.password)return null;
    return url.toString();
  }catch{return null;}
}

async function sendHandoffAck({contactId,channelId,env=process.env}){
  const token=env.RESPOND_IO_TOKEN||env.RESPOND_IO_API_TOKEN;
  if(!token)throw new Error("respond_sender_credential_missing");
  const response=await fetch("https://api.respond.io/v2/contact/id:"+encodeURIComponent(String(contactId))+"/message",{
    method:"POST",
    headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json"},
    body:JSON.stringify({channelId:Number(channelId),message:{type:"text",text:HANDOFF_ACK}})
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
    .select("id,respond_contact_id,channel_id,status,reason,summary,ack_message_id,ack_sent_at,assignment_requested_at")
    .eq("id",handoffId).maybeSingle();
  if(error)throw error;
  if(!handoff)return{ok:false,reason:"handoff_not_found"};

  const workflowUrl=handoffWorkflowUrl(env);
  if(!workflowUrl)return{ok:true,status:"ready_for_advisor",assignmentTriggered:false,reason:"workflow_not_configured"};

  if(!handoff.assignment_requested_at){
    try{
      const response=await fetch(workflowUrl,{
        method:"POST",
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
      const assignedAt=new Date();
      const now=assignedAt.toISOString();
      const slaDueAt=new Date(assignedAt.getTime()+slaMinutes(env)*60*1000).toISOString();
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
        assignment_error_code:String(error?.message||"handoff_assignment_failed").slice(0,160),
        updated_at:now
      }).eq("id",handoff.id);
      throw error;
    }
  }

  let ackMessageId=handoff.ack_message_id||null;
  if(!ackMessageId){
    ackMessageId=await sendHandoffAck({
      contactId:handoff.respond_contact_id,
      channelId:handoff.channel_id,
      env
    });
    const ackAt=new Date().toISOString();
    const {error:updateAckError}=await admin.from("sales_agent_v2_handoffs").update({
      ack_message_id:ackMessageId,
      ack_sent_at:ackAt,
      updated_at:ackAt
    }).eq("id",handoff.id).is("ack_message_id",null);
    if(updateAckError)throw updateAckError;
  }

  return{ok:true,status:"assignment_requested",ackMessageId,assignmentTriggered:true};
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
    .select("id,respond_contact_id,status,assignment_requested_at,last_reassignment_at,reassignment_count,sla_due_at")
    .in("status",["assignment_requested","assigned"])
    .not("sla_due_at","is",null)
    .lte("sla_due_at",now.toISOString())
    .order("sla_due_at",{ascending:true})
    .limit(20);
  if(error)throw error;

  for(const handoff of rows||[]){
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
