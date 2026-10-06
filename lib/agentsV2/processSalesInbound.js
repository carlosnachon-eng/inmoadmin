import { runSalesAgentV2ShadowMessage } from "./runSalesShadowMessage";
import { createSalesHandoffIfNeeded, dispatchSalesHandoff } from "./salesHandoff";
import { processSalesAutoOutboundRun } from "./salesAutoOutbound";
import { safeAgentUsage } from "./agentUsage";
import { salesAgentModel } from "./openaiSalesAgent";
import { readHumanAttention } from "./humanAttention.js";
import { withCommercialExecution } from "../social/commercialExecution.js";

export async function processSalesInboundById(admin,inboundId,{env=process.env}={}){
  return withCommercialExecution(admin,"SALES",inboundId,env,execution=>processSalesClaim(admin,inboundId,{env,execution}));
}

async function processSalesClaim(admin,inboundId,{env,execution}){
  const {data:claimed,error:claimError}=execution?{data:execution.inbound}:await admin.from("sales_agent_v2_inbound_messages")
    .update({status:"processing"})
    .eq("id",inboundId)
    .eq("status","captured")
    .select("id,event_id,external_message_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status,social_route_id")
    .maybeSingle();
  if(claimError)throw claimError;
  if(!claimed)return{status:"not_claimed"};

  try{
    const result=await runSalesAgentV2ShadowMessage(admin,claimed,{env,execution});
    if(!result.humanPaused)await execution?.step("effects");
    const completedAt=new Date().toISOString();
    const model=result.policyOnly?null:salesAgentModel(env);
    const usage=await safeAgentUsage(result.sessionId,{model,env});

    const {data:storedRun,error:runError}=await admin.from("sales_agent_v2_shadow_runs").insert({
      inbound_message_id:claimed.id,
      session_id:result.sessionId,
      status:result.status==="idle"?"idle":"failed",
      called_tools:result.calledTools,
      proposed_response:result.output||null,
      latency_ms:result.latencyMs,
      model,
      input_tokens:usage.inputTokens,
      cached_input_tokens:usage.cachedInputTokens,
      output_tokens:usage.outputTokens,
      reasoning_tokens:usage.reasoningTokens,
      total_tokens:usage.totalTokens,
      estimated_cost_usd:usage.estimatedCostUsd,
      error_code:result.error?.code||result.error?.message||null,
      completed_at:completedAt,
    }).select("id").single();
    if(runError)throw runError;

    await admin.from("sales_agent_v2_inbound_messages")
      .update({status:result.humanPaused?"skipped":result.status==="idle"?"processed":"failed"})
      .eq("id",claimed.id);

    if(result.humanPaused)return{status:"paused",reason:result.error.code,inboundMessageId:claimed.id};

    let handoff=null;
    let outbound=null;
    if(result.status==="idle"){
      const attention=await readHumanAttention(admin,claimed);
      if(attention.blocked){
        await admin.from("sales_agent_v2_shadow_runs").update({error_code:attention.reason}).eq("id",storedRun.id);
        if(env.SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED==="true")outbound=await processSalesAutoOutboundRun(admin,storedRun.id,{env});
        return{status:"paused",reason:attention.reason,inboundMessageId:claimed.id,outbound};
      }
      handoff=await createSalesHandoffIfNeeded(admin,{inbound:claimed,run:storedRun,reviewReason:result.reviewReason,env});
      if(handoff?.handoffId){
        if(handoff.created){
          try{
            await execution?.step("verify");
            handoff.dispatch=await dispatchSalesHandoff(admin,{handoffId:handoff.handoffId,env});
          }catch(error){
            if(error.executionState)throw error;
            console.error("[sales-v2-handoff-dispatch]",String(error?.message||"handoff_dispatch_failed").slice(0,160));
            handoff.dispatch={ok:false,error:"handoff_dispatch_failed"};
          }
        }
      }else if(env.SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED==="true"){
        try{
          await execution?.step("verify");
          outbound=await processSalesAutoOutboundRun(admin,storedRun.id,{env});
          if(claimed.social_route_id&&(outbound.status==="blocked"||outbound.outboundStatus==="blocked")&&!String(outbound.reason||"").startsWith("human_attention_")&&!["stale_run","owner_continuity_no_sales_outbound","open_human_review","outbound_not_pending"].includes(outbound.reason)){
            handoff=await createSalesHandoffIfNeeded(admin,{inbound:claimed,run:storedRun,reviewReason:"sender_requires_review",env});
            // Review work only; a blocked sender never grants workflow authority.
          }
        }catch(error){
          if(error.executionState)throw error;
          console.error("[sales-v2-immediate-outbound]",String(error?.message||"immediate_outbound_failed").slice(0,160));
          outbound={status:"error",error:"immediate_outbound_failed"};
        }
      }
    }

    return{
      status:"processed",
      inboundMessageId:claimed.id,
      runStatus:result.status,
      calledTools:result.calledTools,
      latencyMs:result.latencyMs,
      handoff:handoff?{
        created:Boolean(handoff.created),
        reason:handoff.reason||null,
        priority:handoff.priority||null,
        dispatch:handoff.dispatch||null
      }:null,
      outbound
    };
  }catch(error){
    if(execution)throw error;
    const {data:existing}=await admin.from("sales_agent_v2_shadow_runs")
      .select("id").eq("inbound_message_id",claimed.id).maybeSingle();

    if(existing){
      await admin.from("sales_agent_v2_inbound_messages").update({status:"failed"}).eq("id",claimed.id);
    }else{
      await admin.from("sales_agent_v2_inbound_messages").update({status:"captured"}).eq("id",claimed.id).eq("status","processing");
    }
    throw error;
  }
}
