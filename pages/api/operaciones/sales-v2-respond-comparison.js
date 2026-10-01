import { createClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { readRespondMessages, respondMessageTimestamp } from "../../../lib/ejecutivo/respondSync";
import { sanitizeShadowText } from "../../../lib/shadow/coordinator";

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

function textFromMessage(message){
  return String(message?.text??message?.message?.text??message?.body??message?.message?.body??"").trim();
}
function direction(message){
  const value=String(message?.traffic||message?.direction||"").toLowerCase();
  if(["incoming","inbound"].includes(value))return"inbound";
  if(["outgoing","outbound"].includes(value))return"outbound";
  return"unknown";
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(req.method!=="GET")return res.status(405).json({ok:false,error:"method_not_allowed"});
  const profile=await authorize(req);
  if(!profile)return res.status(403).json({ok:false,error:"not_authorized"});

  const runId=String(req.query?.runId||"").trim();
  if(!/^[0-9a-f-]{36}$/i.test(runId))return res.status(400).json({ok:false,error:"invalid_run_id"});

  const admin=getAdminSupabase();
  const {data:run,error}=await admin.from("sales_agent_v2_shadow_runs")
    .select("id,inbound_message_id,sales_agent_v2_inbound_messages(id,respond_contact_id,occurred_at)")
    .eq("id",runId).maybeSingle();
  if(error)return res.status(500).json({ok:false,error:"load_failed"});
  if(!run?.sales_agent_v2_inbound_messages)return res.status(404).json({ok:false,error:"run_not_found"});

  const inbound=run.sales_agent_v2_inbound_messages;
  try{
    const {messages}=await readRespondMessages(inbound.respond_contact_id,1);
    const after=(messages||[])
      .map((message)=>({
        message,
        timestamp:respondMessageTimestamp(message),
        direction:direction(message),
      }))
      .filter((row)=>row.timestamp&&row.direction==="outbound"&&new Date(row.timestamp)>new Date(inbound.occurred_at))
      .sort((a,b)=>a.timestamp.localeCompare(b.timestamp));

    const first=after[0]||null;
    if(!first)return res.status(200).json({ok:true,found:false});

    const raw=textFromMessage(first.message);
    const safe=sanitizeShadowText(raw);
    return res.status(200).json({
      ok:true,
      found:true,
      response:safe.rejected?"[SALIDA SIN TEXTO ÚTIL]":safe.text,
      sentAt:first.timestamp,
      senderSource:String(first.message?.sender?.source||"unknown").slice(0,80),
    });
  }catch(error){
    console.error("[sales-v2-respond-comparison]",String(error?.message||"comparison_failed").slice(0,120));
    return res.status(503).json({ok:false,error:"comparison_failed"});
  }
}
