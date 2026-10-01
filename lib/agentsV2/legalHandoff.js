const clean=(v,max=1200)=>String(v??"").replace(/\s+/g," ").trim().slice(0,max);

function workflowUrl(env=process.env){
  const raw=String(env.LEGAL_AGENT_V1_HANDOFF_WORKFLOW_URL||"").trim();
  if(!raw)return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=="https:"||url.hostname!=="hooks.respond.io"||url.username||url.password)return null;
    return url.toString();
  }catch{return null;}
}

async function sendAck({contactId,channelId,env=process.env}){
  const token=env.RESPOND_IO_TOKEN||env.RESPOND_IO_API_TOKEN;
  if(!token)throw new Error("respond_sender_credential_missing");
  const text="Este caso sí requiere revisión del área Jurídica. Ya lo asigné al equipo para que revisen tu expediente y te den una respuesta correcta.";
  const r=await fetch("https://api.respond.io/v2/contact/id:"+encodeURIComponent(String(contactId))+"/message",{
    method:"POST",
    headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json"},
    body:JSON.stringify({channelId:Number(channelId),message:{type:"text",text}})
  });
  const body=await r.json().catch(()=>({}));
  if(!r.ok||!body?.messageId)throw new Error("legal_handoff_ack_failed");
  return String(body.messageId);
}

export async function createAndDispatchLegalHandoff(admin,{inbound,reason="legal_human_review",env=process.env}){
  const {data:existing,error:existingError}=await admin.from("legal_agent_v1_handoffs")
    .select("id,status").eq("inbound_message_id",inbound.id).maybeSingle();
  if(existingError)throw existingError;
  if(existing)return{created:false,handoffId:existing.id,status:existing.status};

  const {data:history,error:historyError}=await admin.from("legal_agent_v1_inbound_messages")
    .select("sanitized_text,occurred_at")
    .eq("respond_contact_id",inbound.respond_contact_id)
    .lte("occurred_at",inbound.occurred_at)
    .order("occurred_at",{ascending:false})
    .limit(4);
  if(historyError)throw historyError;
  const context=(history||[]).reverse().map(x=>clean(x.sanitized_text,260)).filter(Boolean).join(" | ");
  const summary=clean("Revisión jurídica requerida. Contexto reciente: "+context,1200);

  const {data:handoff,error}=await admin.from("legal_agent_v1_handoffs").insert({
    inbound_message_id:inbound.id,
    respond_contact_id:inbound.respond_contact_id,
    channel_id:inbound.channel_id,
    reason,
    summary,
    status:"ready_for_legal"
  }).select("id").single();
  if(error)throw error;

  const url=workflowUrl(env);
  if(!url)return{created:true,handoffId:handoff.id,status:"ready_for_legal",assignmentTriggered:false,reason:"workflow_not_configured"};

  try{
    const response=await fetch(url,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        contactId:String(inbound.respond_contact_id),
        handoffId:String(handoff.id),
        reason,
        summary,
        routingDecision:"legal_agent_v1_handoff"
      })
    });
    if(!response.ok)throw new Error("legal_handoff_workflow_http_"+response.status);
    const now=new Date().toISOString();
    await admin.from("legal_agent_v1_handoffs").update({
      status:"assignment_requested",
      assignment_requested_at:now,
      assignment_error_code:null,
      updated_at:now
    }).eq("id",handoff.id);

    const ackMessageId=await sendAck({contactId:inbound.respond_contact_id,channelId:inbound.channel_id,env});
    const ackAt=new Date().toISOString();
    await admin.from("legal_agent_v1_handoffs").update({
      ack_message_id:ackMessageId,
      ack_sent_at:ackAt,
      updated_at:ackAt
    }).eq("id",handoff.id);

    return{created:true,handoffId:handoff.id,status:"assignment_requested",assignmentTriggered:true,ackMessageId};
  }catch(error){
    const now=new Date().toISOString();
    await admin.from("legal_agent_v1_handoffs").update({
      status:"failed",
      assignment_error_code:String(error?.message||"legal_handoff_failed").slice(0,160),
      updated_at:now
    }).eq("id",handoff.id);
    throw error;
  }
}
