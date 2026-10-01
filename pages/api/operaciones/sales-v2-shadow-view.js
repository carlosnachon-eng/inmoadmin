import { createClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";

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

  const {data,error}=await admin.from("sales_agent_v2_shadow_runs")
    .select("id,inbound_message_id,session_id,status,called_tools,proposed_response,latency_ms,error_code,created_at,completed_at,sales_agent_v2_inbound_messages(id,event_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status)")
    .order("created_at",{ascending:false})
    .limit(100);
  if(error){
    console.error("[sales-v2-shadow-view]",error.message);
    return res.status(500).json({ok:false,error:"load_failed"});
  }

  return res.status(200).json({
    ok:true,
    rows:(data||[]).map((row)=>({
      id:row.id,
      status:row.status,
      calledTools:Array.isArray(row.called_tools)?row.called_tools:[],
      proposedResponse:row.proposed_response||"",
      latencyMs:row.latency_ms,
      errorCode:row.error_code,
      completedAt:row.completed_at,
      inbound:row.sales_agent_v2_inbound_messages||null,
    })),
  });
}
