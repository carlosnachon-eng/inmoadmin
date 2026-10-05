import { createLegalSession, fulfillLegal, getLegalSession, legalOutput } from "./openaiLegalAgent";
import { readRespondMessages, respondMessageTimestamp } from "../ejecutivo/respondSync";
import { sanitizeShadowText } from "../shadow/coordinator";
import { createAndDispatchLegalHandoff } from "./legalHandoff";
import { safeAgentUsage } from "./agentUsage";
import { readHumanAttention } from "./humanAttention.js";

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const clean=(v,max=1600)=>String(v??"").replace(/\s+/g," ").trim().slice(0,max);
const SAFE_CHANNELS=new Set(["497382","497385","498219","515318"]);
const HUMAN_REVIEW=/(mi expediente|mi dictamen|me rechazaron|me rechaz[oó]|me aprobaron|excepci[oó]n|demanda|problema legal|incumplimiento|desalojo|rescisi[oó]n|negociar contrato|cambiar contrato|quitar pagar[eé])/i;

async function sendRespond({contactId,channelId,text,env=process.env}){
  const token=env.RESPOND_IO_TOKEN||env.RESPOND_IO_API_TOKEN;
  if(!token)throw new Error("respond_sender_credential_missing");
  const r=await fetch("https://api.respond.io/v2/contact/id:"+encodeURIComponent(String(contactId))+"/message",{
    method:"POST",headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json"},
    body:JSON.stringify({channelId:Number(channelId),message:{type:"text",text:clean(text)}})
  });
  const b=await r.json().catch(()=>({}));if(!r.ok||!b?.messageId)throw new Error("legal_outbound_failed");return String(b.messageId);
}

async function context(admin,inbound){
  const {data:local,error}=await admin.from("legal_agent_v1_inbound_messages").select("occurred_at,sanitized_text")
    .eq("respond_contact_id",inbound.respond_contact_id).lte("occurred_at",inbound.occurred_at)
    .order("occurred_at",{ascending:false}).limit(6);
  if(error)throw error;
  let respond="";
  try{
    const r=await readRespondMessages(inbound.respond_contact_id,1);
    respond=(r.messages||[]).map(m=>{
      const ts=respondMessageTimestamp(m),traffic=String(m?.traffic||m?.direction||"").toLowerCase();
      const role=["incoming","inbound"].includes(traffic)?"cliente":["outgoing","outbound"].includes(traffic)?"Emporio":"";
      const raw=String(m?.text??m?.message?.text??m?.body??m?.message?.body??"").trim(),safe=sanitizeShadowText(raw);
      return !ts||!role||safe.rejected?null:{ts,role,text:safe.text.slice(0,700)};
    }).filter(Boolean).sort((a,b)=>a.ts.localeCompare(b.ts)).slice(-10).map(x=>"- "+x.role+": "+x.text).join("\n");
  }catch(error){console.error("[legal-ai-context]",String(error?.message||"respond_history_failed").slice(0,120));}
  return["Historial reciente:",respond||"(no disponible)","Historial legal:",(local||[]).reverse().map(x=>"- cliente: "+x.sanitized_text).join("\n")||"(sin historial)","Mensaje actual:",inbound.sanitized_text].join("\n");
}

export async function processLegalInboundById(admin,id,{env=process.env}={}){
  const {data:inbound,error}=await admin.from("legal_agent_v1_inbound_messages").update({status:"processing"}).eq("id",id).eq("status","captured")
    .select("id,respond_contact_id,channel_id,occurred_at,sanitized_text").maybeSingle();
  if(error)throw error;if(!inbound)return{status:"not_claimed"};if(!SAFE_CHANNELS.has(String(inbound.channel_id)))return{status:"skipped"};

  const attention=await readHumanAttention(admin,inbound);
  if(attention.blocked){
    await admin.from("legal_agent_v1_inbound_messages").update({status:"skipped"}).eq("id",inbound.id);return{status:"skipped",reason:attention.reason};
  }

  if(HUMAN_REVIEW.test(inbound.sanitized_text)){
    const now=new Date().toISOString();
    const handoff=await createAndDispatchLegalHandoff(admin,{inbound,reason:"legal_human_review",env});
    const message=handoff.assignmentTriggered
      ?"Este caso sí requiere revisión del área Jurídica. Ya lo asigné al equipo para que revisen tu expediente y te den una respuesta correcta."
      :"Este caso sí requiere revisión del área Jurídica para no darte una respuesta incorrecta sobre tu expediente o contrato.";
    const {data:run,error:runError}=await admin.from("legal_agent_v1_runs").insert({
      inbound_message_id:inbound.id,
      session_id:"human-review-"+inbound.id,
      status:"idle",
      called_tools:[],
      proposed_response:message,
      completed_at:now
    }).select("id").single();
    if(runError)throw runError;

    if(!handoff.assignmentTriggered){
      const beforeSend=await readHumanAttention(admin,inbound);
      if(beforeSend.blocked){
        await admin.from("legal_agent_v1_auto_outbound").insert({inbound_message_id:inbound.id,run_id:run.id,respond_contact_id:inbound.respond_contact_id,channel_id:inbound.channel_id,status:"superseded",proposed_message:message,error_code:beforeSend.reason,completed_at:now});
        await admin.from("legal_agent_v1_inbound_messages").update({status:"skipped"}).eq("id",inbound.id);
        return{status:"blocked",reason:beforeSend.reason};
      }
      const providerMessageId=await sendRespond({contactId:inbound.respond_contact_id,channelId:inbound.channel_id,text:message,env});
      await admin.from("legal_agent_v1_auto_outbound").insert({
        inbound_message_id:inbound.id,run_id:run.id,respond_contact_id:inbound.respond_contact_id,
        channel_id:inbound.channel_id,status:"sent",proposed_message:message,
        provider_message_id:providerMessageId,sent_at:now,completed_at:now
      });
    }
    await admin.from("legal_agent_v1_inbound_messages").update({status:"processed"}).eq("id",inbound.id);
    return{status:"sent",humanReview:true,handoff};
  }

  try{
    const input=await context(admin,inbound);
    const beforeModel=await readHumanAttention(admin,inbound);
    if(beforeModel.blocked){
      await admin.from("legal_agent_v1_inbound_messages").update({status:"skipped"}).eq("id",inbound.id);
      return{status:"skipped",reason:beforeModel.reason};
    }
    const started=Date.now();let session=await createLegalSession(input,env);const calledTools=[];
    for(let i=0;i<80;i+=1){session=await getLegalSession(session.id,env);if(session.status==="requires_action"){for(const a of session.required_actions||[])calledTools.push(String(a?.name||"unknown").slice(0,80));await fulfillLegal(session,env);await sleep(150);continue;}if(["idle","failed"].includes(session.status))break;await sleep(350);}
    session=await getLegalSession(session.id,env);const output=await legalOutput(session.id,env),now=new Date().toISOString();
    const model=env.OPENAI_LEGAL_AGENT_MODEL||env.OPENAI_SALES_AGENT_MODEL||env.OPENAI_ADMIN_AGENT_MODEL;
    const usage=await safeAgentUsage(session.id,{model,env});
    const {data:run,error:runError}=await admin.from("legal_agent_v1_runs").insert({inbound_message_id:inbound.id,session_id:session.id,status:session.status==="idle"?"idle":"failed",called_tools:calledTools,proposed_response:output||null,latency_ms:Date.now()-started,model,input_tokens:usage.inputTokens,cached_input_tokens:usage.cachedInputTokens,output_tokens:usage.outputTokens,reasoning_tokens:usage.reasoningTokens,total_tokens:usage.totalTokens,estimated_cost_usd:usage.estimatedCostUsd,error_code:session?.error?.message||null,completed_at:now}).select("id").single();
    if(runError)throw runError;
    if(session.status!=="idle"||!output)throw new Error("legal_agent_failed");
    const beforeSend=await readHumanAttention(admin,inbound);
    if(beforeSend.blocked){
      await admin.from("legal_agent_v1_auto_outbound").insert({inbound_message_id:inbound.id,run_id:run.id,respond_contact_id:inbound.respond_contact_id,channel_id:inbound.channel_id,status:"superseded",proposed_message:output,error_code:beforeSend.reason,completed_at:now});
      await admin.from("legal_agent_v1_inbound_messages").update({status:"skipped"}).eq("id",inbound.id);
      return{status:"blocked",reason:beforeSend.reason};
    }
    const providerMessageId=await sendRespond({contactId:inbound.respond_contact_id,channelId:inbound.channel_id,text:output,env});
    await admin.from("legal_agent_v1_auto_outbound").insert({inbound_message_id:inbound.id,run_id:run.id,respond_contact_id:inbound.respond_contact_id,channel_id:inbound.channel_id,status:"sent",proposed_message:output,provider_message_id:providerMessageId,sent_at:now,completed_at:now});
    await admin.from("legal_agent_v1_inbound_messages").update({status:"processed"}).eq("id",inbound.id);
    return{status:"sent",calledTools,latencyMs:Date.now()-started};
  }catch(error){
    await admin.from("legal_agent_v1_inbound_messages").update({status:"captured"}).eq("id",inbound.id).eq("status","processing");
    console.error("[legal-ai-process]",String(error?.message||"legal_processing_failed").slice(0,160));throw error;
  }
}
