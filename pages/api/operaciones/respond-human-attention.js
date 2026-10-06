import { createClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { readHumanAttention } from "../../../lib/agentsV2/humanAttention.js";

// Explicit operator action, never a model tool, cron, webhook or routing side effect.
export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(!["GET","POST"].includes(req.method))return res.status(405).json({ok:false,error:"method_not_allowed"});
  const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(!token)return res.status(401).json({ok:false,error:"session_required"});
  try{
    const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{
      global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false},
    });
    const {data:{user},error:authError}=await client.auth.getUser(token);
    if(authError||!user)return res.status(401).json({ok:false,error:"session_required"});
    const {data:profile}=await client.from("profiles").select("id,role_id,active").eq("id",user.id).maybeSingle();
    if(!profile?.active||!["admin","gerente_ventas"].includes(profile.role_id))return res.status(403).json({ok:false,error:"not_authorized"});
    const input=req.method==="GET"?req.query:req.body;
    const contactId=String(input?.contactId||"");
    if(!/^\d{1,40}$/.test(contactId))return res.status(400).json({ok:false,error:"invalid_contact"});
    if(req.method==="GET")return res.status(200).json({ok:true,...await readHumanAttention(getAdminSupabase(),{respond_contact_id:contactId,occurred_at:new Date().toISOString()})});
    if(input?.action!=="return_to_ai"||typeof input.episodeKey!=="string"||typeof input.humanEventId!=="string"||input.episodeKey.length>200||input.humanEventId.length>200)
      return res.status(400).json({ok:false,error:"explicit_return_required"});
    const {data,error}=await client.rpc("resume_respond_ai_v1",{p_contact_id:contactId,p_episode_key:input.episodeKey,p_human_event_id:input.humanEventId});
    if(error)return res.status(error.code==="40001"?409:error.code==="42501"?403:503).json({ok:false,error:error.code==="40001"?"human_attention_changed":"resume_not_completed"});
    return res.status(200).json({ok:true,...data});
  }catch{return res.status(503).json({ok:false,error:"human_attention_unverified"});}
}
