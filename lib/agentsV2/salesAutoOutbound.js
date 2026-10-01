const SAFE_CHANNELS=new Set(["497382","497385","498219","515318"]);

const RISKY=/(apartad|dep[oó]sito|p[oó]liza|jur[ií]dic|contrato|demanda|profeco|descuento|rebaja|contraoferta|negoci|cr[eé]dito|hipoteca|firma|escritura|promesa|garant[ií]a|penaliz|cancelaci[oó]n|rescisi[oó]n|demanda|abogado)/i;
const APPOINTMENT=/(cita|agend|horario|verlo hoy|visita|mostrar|enseñar|ensenar)/i;
const COVERAGE=/(cobertura|zona|zapopan|guadalajara|jalisco|fuera de cobertura|puebla|cholula|veracruz|boca del r[ií]o|alvarado|central de abastos)/i;
const PROPERTY_INTEREST=/(interesad|me interesa|esa casa|ese depa|departamento|casa|local|oficina|bodega|terreno|inmueble)/i;
const GREETING=/^(hola|buen(?:os|as) d[ií]as|buenas tardes|buenas noches)[.! ]*$/i;
const FOLLOWUP=/^(gracias|ok|okay|perfecto|mil gracias|muchas gracias)[.! ]*$/i;
const META_OUTPUT=/(respuesta sugerida|siguiente pregunta sugerida|no se envió ningún mensaje|no se envio ningun mensaje|modo shadow|perfil comercial|herramientas usadas|respuesta para el asesor)/i;

const clean=(v,max=1200)=>String(v??"").replace(/\s+/g," ").trim().slice(0,max);

export function classifySafeSalesOutbound({messageText,calledTools,proposedResponse}){
  const input=clean(messageText,2000);
  const output=clean(proposedResponse,1200);
  const tools=new Set(calledTools||[]);
  if(!input||!output)return{eligible:false,reason:"missing_text"};
  if(META_OUTPUT.test(output))return{eligible:false,reason:"internal_meta_output"};
  if(RISKY.test(input)||RISKY.test(output))return{eligible:false,reason:"risky_topic"};
  if(APPOINTMENT.test(input)||APPOINTMENT.test(output))return{eligible:false,reason:"appointment_requires_validation"};

  if(COVERAGE.test(input)&&tools.has("check_sales_coverage"))return{eligible:true,caseKind:"coverage"};
  if(GREETING.test(input))return{eligible:true,caseKind:"greeting_qualification"};
  if(PROPERTY_INTEREST.test(input)&&tools.has("search_sales_inventory"))return{eligible:true,caseKind:"inventory_search"};
  if(PROPERTY_INTEREST.test(input))return{eligible:true,caseKind:"property_interest"};
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

  const {data:existing,error:existingError}=await admin.from("sales_agent_v2_auto_outbound")
    .select("id,status").eq("inbound_message_id",inbound.id).maybeSingle();
  if(existingError)throw existingError;
  if(existing)return{status:"already_handled",outboundStatus:existing.status};

  const decision=classifySafeSalesOutbound({
    messageText:inbound.sanitized_text,
    calledTools:run.called_tools,
    proposedResponse:run.proposed_response
  });
  if(!decision.eligible)return{status:"blocked",reason:decision.reason};

  const {data:newer,error:newerError}=await admin.from("sales_agent_v2_inbound_messages")
    .select("id").eq("respond_contact_id",inbound.respond_contact_id)
    .gt("occurred_at",inbound.occurred_at).limit(1);
  if(newerError)throw newerError;
  if((newer||[]).length){
    await admin.from("sales_agent_v2_auto_outbound").insert({
      inbound_message_id:inbound.id,shadow_run_id:run.id,respond_contact_id:inbound.respond_contact_id,
      channel_id:inbound.channel_id,case_kind:decision.caseKind,status:"superseded",
      proposed_message:run.proposed_response,error_code:"newer_inbound_exists",completed_at:new Date().toISOString()
    });
    return{status:"superseded",reason:"newer_inbound_exists"};
  }

  const {data:claim,error:claimError}=await admin.from("sales_agent_v2_auto_outbound").insert({
    inbound_message_id:inbound.id,shadow_run_id:run.id,respond_contact_id:inbound.respond_contact_id,
    channel_id:inbound.channel_id,case_kind:decision.caseKind,status:"processing",
    proposed_message:run.proposed_response
  }).select("id").single();
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
    .select("id,status,called_tools,proposed_response,completed_at,inbound_message_id,sales_agent_v2_inbound_messages(id,event_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status)")
    .eq("id",runId)
    .maybeSingle();
  if(error)throw error;
  if(!run||run.status!=="idle")return{status:"skipped",reason:"run_not_ready"};
  return processSalesOutboundRunRecord(admin,run,{env});
}

export async function processOneSalesAutoOutbound(admin,{env=process.env}={}){
  assertSalesAutoOutboundEnvironment(env);
  let query=admin.from("sales_agent_v2_shadow_runs")
    .select("id,status,called_tools,proposed_response,completed_at,inbound_message_id,sales_agent_v2_inbound_messages(id,event_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status)")
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
