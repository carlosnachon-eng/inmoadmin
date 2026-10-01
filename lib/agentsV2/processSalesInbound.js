import { runSalesAgentV2ShadowMessage } from "./runSalesShadowMessage";
import { createSalesHandoffIfNeeded, dispatchSalesHandoff } from "./salesHandoff";

export async function processSalesInboundById(admin,inboundId,{env=process.env}={}){
  const {data:claimed,error:claimError}=await admin.from("sales_agent_v2_inbound_messages")
    .update({status:"processing"})
    .eq("id",inboundId)
    .eq("status","captured")
    .select("id,event_id,external_message_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status")
    .maybeSingle();
  if(claimError)throw claimError;
  if(!claimed)return{status:"not_claimed"};

  try{
    const result=await runSalesAgentV2ShadowMessage(admin,claimed,{env});
    const completedAt=new Date().toISOString();

    const {data:storedRun,error:runError}=await admin.from("sales_agent_v2_shadow_runs").insert({
      inbound_message_id:claimed.id,
      session_id:result.sessionId,
      status:result.status==="idle"?"idle":"failed",
      called_tools:result.calledTools,
      proposed_response:result.output||null,
      latency_ms:result.latencyMs,
      error_code:result.error?.code||result.error?.message||null,
      completed_at:completedAt,
    }).select("id").single();
    if(runError)throw runError;

    await admin.from("sales_agent_v2_inbound_messages")
      .update({status:result.status==="idle"?"processed":"failed"})
      .eq("id",claimed.id);

    let handoff=null;
    if(result.status==="idle"){
      handoff=await createSalesHandoffIfNeeded(admin,{inbound:claimed,run:storedRun});
      if(handoff?.created){
        try{
          handoff.dispatch=await dispatchSalesHandoff(admin,{handoffId:handoff.handoffId,env});
        }catch(error){
          console.error("[sales-v2-handoff-dispatch]",String(error?.message||"handoff_dispatch_failed").slice(0,160));
          handoff.dispatch={ok:false,error:"handoff_dispatch_failed"};
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
      }:null
    };
  }catch(error){
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
