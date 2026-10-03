import { createClient } from "@supabase/supabase-js";
import { getAdminSupabase, respondInboxLink } from "../../../lib/ejecutivo/workCenter";
import { safeSalesAttentionReason, salesAttentionDelivery } from "../../../lib/agentsV2/salesAttentionView.js";

const client=(key,token)=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,key,{
  global:token?{headers:{Authorization:"Bearer "+token}}:undefined,
  auth:{persistSession:false,autoRefreshToken:false},
});

async function authorize(req){
  const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(!token)return null;
  const auth=client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,token);
  const {data:{user}}=await auth.auth.getUser(token);
  if(!user)return null;
  const {data:profile}=await auth.from("profiles").select("id,role_id,active").eq("id",user.id).maybeSingle();
  if(!profile?.active||!["admin","gerente_ventas"].includes(profile.role_id))return null;
  return profile;
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(req.method!=="GET")return res.status(405).json({ok:false,error:"method_not_allowed"});
  const profile=await authorize(req);
  if(!profile)return res.status(403).json({ok:false,error:"not_authorized"});
  const admin=getAdminSupabase();
  const reviewOffset=Math.max(0,Math.min(100000,Number.parseInt(req.query?.reviewOffset,10)||0));

  const [{data:runs,error:runError},{data:pending,error:pendingError},{data:reviews,error:reviewError}]=await Promise.all([
    admin.from("sales_agent_v2_shadow_runs")
      .select("id,inbound_message_id,session_id,status,called_tools,proposed_response,latency_ms,error_code,created_at,completed_at,sales_agent_v2_inbound_messages(id,event_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status)")
      .order("created_at",{ascending:false})
      .limit(100),
    admin.from("sales_agent_v2_inbound_messages")
      .select("id,event_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status,created_at")
      .eq("status","captured")
      .order("created_at",{ascending:false})
      .limit(100),
    admin.from("sales_agent_v2_handoffs")
      .select("id,respond_contact_id,status,reason,priority,summary,assignment_error_code,assignment_requested_at,ack_sent_at,created_at")
      .in("status",["ready_for_advisor","assignment_requested","assigned","escalated"])
      .order("created_at",{ascending:false}).range(reviewOffset,reviewOffset+100),
  ]);
  if(runError||pendingError||reviewError){
    console.error("[sales-v2-shadow-view]",runError?.message||pendingError?.message);
    return res.status(500).json({ok:false,error:"load_failed"});
  }
  const reviewPage=(reviews||[]).slice(0,100);

  const outcomes=(runs||[]).length?await admin.from("sales_agent_v2_auto_outbound")
    .select("shadow_run_id,status,error_code,sent_at").in("shadow_run_id",runs.map(row=>row.id)):{data:[]};
  if(outcomes.error)return res.status(500).json({ok:false,error:"load_failed"});
  const deliveryByRun=new Map((outcomes.data||[]).map(row=>[row.shadow_run_id,row]));
  const snapshots=reviewPage.length?await admin.from("gv_respond_contact_snapshots")
    .select("respond_contact_id,mapped_profile_id,respond_assignee_id,respond_last_synced_at")
    .in("respond_contact_id",[...new Set(reviewPage.map(row=>row.respond_contact_id))]):{data:[]};
  if(snapshots.error)return res.status(500).json({ok:false,error:"load_failed"});
  const byContact=new Map((snapshots.data||[]).map(row=>[row.respond_contact_id,row]));

  const completed=(runs||[]).map((row)=>({
    id:row.id,
    status:row.status,
    calledTools:Array.isArray(row.called_tools)?row.called_tools:[],
    proposedResponse:row.proposed_response||"",
    latencyMs:row.latency_ms,
    errorCode:row.error_code,
    completedAt:row.completed_at,
    inbound:row.sales_agent_v2_inbound_messages||null,
    sortAt:row.sales_agent_v2_inbound_messages?.occurred_at||row.created_at,
    delivery:salesAttentionDelivery(deliveryByRun.get(row.id)),
  }));
  const waiting=(pending||[]).map((row)=>({
    id:"pending-"+row.id,
    status:"pending",
    calledTools:[],
    proposedResponse:"",
    latencyMs:null,
    errorCode:null,
    completedAt:null,
    inbound:row,
    sortAt:row.occurred_at||row.created_at,
  }));

  return res.status(200).json({
    ok:true,
    reviewOffset,
    reviewsHasMore:(reviews||[]).length>100,
    reviews:reviewPage.map(row=>({
      ...row,
      assignment_error_code:safeSalesAttentionReason(row.assignment_error_code),
      operationalOwner:byContact.get(row.respond_contact_id)?.respond_assignee_id?"Responsable actual en Respond; Gerencia de Ventas supervisa":"Gerencia de Ventas",
      assignmentVerifiedAt:byContact.get(row.respond_contact_id)?.respond_last_synced_at||null,
      inboxUrl:respondInboxLink(row.respond_contact_id),
    })),
    rows:[...waiting,...completed].sort((a,b)=>String(b.sortAt||"").localeCompare(String(a.sortAt||""))).slice(0,100),
  });
}
