import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { processSalesAutoOutboundRun } from "../../../lib/agentsV2/salesAutoOutbound";
import { createSalesAutomationFallbackHandoff, dispatchSalesHandoff } from "../../../lib/agentsV2/salesHandoff";

export const config={maxDuration:120};
const equal=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&timingSafeEqual(x,y);};

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(!["GET","POST"].includes(req.method))return res.status(405).json({ok:false,error:"method_not_allowed"});
  if(!process.env.CRON_SECRET||!equal(req.headers.authorization,"Bearer "+process.env.CRON_SECRET))return res.status(401).json({ok:false,error:"not_authorized"});

  const admin=getAdminSupabase();
  const olderThan=new Date(Date.now()-75_000).toISOString();
  const newerThan=new Date(Date.now()-15*60_000).toISOString();

  const {data:runs,error}=await admin.from("sales_agent_v2_shadow_runs")
    .select("id,status,completed_at,inbound_message_id,sales_agent_v2_inbound_messages(id,respond_contact_id,channel_id,occurred_at,sanitized_text,status)")
    .eq("status","idle")
    .lte("completed_at",olderThan)
    .gte("completed_at",newerThan)
    .order("completed_at",{ascending:false})
    .limit(40);
  if(error)throw error;

  for(const run of runs||[]){
    const inbound=run.sales_agent_v2_inbound_messages;
    if(!inbound)continue;

    const [{data:outbound,error:outboundError},{data:handoff,error:handoffError},{data:newer,error:newerError},{data:snapshot,error:snapshotError}]=await Promise.all([
      admin.from("sales_agent_v2_auto_outbound").select("id,status").eq("inbound_message_id",inbound.id).maybeSingle(),
      admin.from("sales_agent_v2_handoffs").select("id,status").eq("inbound_message_id",inbound.id).maybeSingle(),
      admin.from("sales_agent_v2_inbound_messages").select("id").eq("respond_contact_id",inbound.respond_contact_id).gt("occurred_at",inbound.occurred_at).limit(1),
      admin.from("gv_respond_contact_snapshots")
        .select("mapped_profile_id,mapping_status,respond_lifecycle,respond_last_human_outbound_at")
        .eq("respond_contact_id",inbound.respond_contact_id)
        .maybeSingle()
    ]);
    if(outboundError)throw outboundError;if(handoffError)throw handoffError;if(newerError)throw newerError;if(snapshotError)throw snapshotError;

    const lifecycle=String(snapshot?.respond_lifecycle||"").trim().toLowerCase();
    const advancedLifecycle=["en atencion","en atención","visita agendada","apartado","cerrado","ganado"].includes(lifecycle);
    const humanAfterInbound=snapshot?.respond_last_human_outbound_at
      && new Date(snapshot.respond_last_human_outbound_at)>new Date(inbound.occurred_at);
    const alreadyAssigned=Boolean(snapshot?.mapped_profile_id)&&String(snapshot?.mapping_status||"").toLowerCase()==="matched";

    if(outbound||handoff||(newer||[]).length||humanAfterInbound||advancedLifecycle||alreadyAssigned)continue;

    let retry=null;
    try{
      retry=await processSalesAutoOutboundRun(admin,run.id,{env:process.env});
    }catch(error){
      console.error("[sales-v2-watchdog-retry]",String(error?.message||"retry_failed").slice(0,160));
    }

    if(retry?.status==="sent"||retry?.status==="superseded"||retry?.status==="already_handled"){
      return res.status(200).json({ok:true,status:"recovered",mode:"outbound",result:retry});
    }

    const fallback=await createSalesAutomationFallbackHandoff(admin,{inbound,run});
    if(fallback?.created){
      try{
        fallback.dispatch=await dispatchSalesHandoff(admin,{handoffId:fallback.handoffId,env:process.env});
      }catch(error){
        console.error("[sales-v2-watchdog-handoff]",String(error?.message||"handoff_failed").slice(0,160));
        return res.status(503).json({ok:false,error:"watchdog_handoff_failed"});
      }
      return res.status(200).json({ok:true,status:"recovered",mode:"handoff",handoffId:fallback.handoffId});
    }
  }

  return res.status(200).json({ok:true,status:"idle"});
}
