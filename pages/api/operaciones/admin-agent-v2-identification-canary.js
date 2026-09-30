import { createClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";

export const config = { maxDuration: 30 };
const IDENTIFICATION_MESSAGE = "Hola. Para ubicar correctamente tu expediente, ¿me confirmas por favor tu nombre completo y el inmueble o departamento que rentas con nosotros?";
const ADMIN_CHANNEL_ID = "544519";

const client = (key, token) => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
  global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  auth: { persistSession: false, autoRefreshToken: false },
});

async function authorize(req) {
  const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(!token) return null;
  const auth=client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,token);
  const { data:{ user } }=await auth.auth.getUser(token);
  if(!user) return null;
  const { data:profile }=await auth.from("profiles").select("id,role_id,active").eq("id",user.id).maybeSingle();
  if(!profile?.active || profile.role_id!=="admin") return null;
  return profile;
}

async function sendRespondText(contactId) {
  const token=process.env.RESPOND_IO_TOKEN || process.env.RESPOND_IO_API_TOKEN;
  if(!token) throw Object.assign(new Error("respond_sender_credential_missing"),{statusCode:503});
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch(`https://api.respond.io/v2/contact/id:${encodeURIComponent(String(contactId))}/message`,{
      method:"POST",
      headers:{Authorization:`Bearer ${token}`,Accept:"application/json","Content-Type":"application/json"},
      body:JSON.stringify({channelId:Number(ADMIN_CHANNEL_ID),message:{type:"text",text:IDENTIFICATION_MESSAGE}}),
      signal:controller.signal,
    });
    const body=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(response.status>=500||response.status===429?"respond_delivery_unknown":"respond_rejected");
    if(!body?.messageId) throw new Error("respond_delivery_unknown");
    return String(body.messageId).slice(0,120);
  }finally{clearTimeout(timeout);}
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"method_not_allowed"});
  const profile=await authorize(req);
  if(!profile) return res.status(403).json({ok:false,error:"not_authorized"});
  const messageId=String(req.body?.messageId||"");
  if(!/^[0-9a-f-]{36}$/i.test(messageId)) return res.status(400).json({ok:false,error:"invalid_message_id"});
  const admin=getAdminSupabase();
  try{
    const { data:message,error:messageError }=await admin.from("shadow_messages")
      .select("id,conversation_id,provider,direction,occurred_at")
      .eq("id",messageId).maybeSingle();
    if(messageError) throw messageError;
    if(!message || message.provider!=="respond_admin" || message.direction!=="inbound") return res.status(409).json({ok:false,error:"message_not_eligible"});
    const { data:conversation,error:conversationError }=await admin.from("shadow_conversations")
      .select("id,channel,respond_contact_id").eq("id",message.conversation_id).maybeSingle();
    if(conversationError) throw conversationError;
    if(!conversation || conversation.channel!==ADMIN_CHANNEL_ID || !conversation.respond_contact_id) return res.status(409).json({ok:false,error:"conversation_not_eligible"});

    const { data:confirmed,error:linkError }=await admin.from("respond_identity_links")
      .select("id").eq("respond_contact_id",conversation.respond_contact_id).eq("link_status","confirmed").limit(1);
    if(linkError) throw linkError;
    if((confirmed||[]).length) return res.status(409).json({ok:false,error:"identity_already_confirmed"});

    const { data:newer,error:newerError }=await admin.from("shadow_messages")
      .select("id,direction,occurred_at")
      .eq("conversation_id",conversation.id)
      .gt("occurred_at",message.occurred_at)
      .order("occurred_at",{ascending:true})
      .limit(1);
    if(newerError) throw newerError;
    if((newer||[]).length) return res.status(409).json({ok:false,error:"newer_message_exists"});

    const { data:claim,error:claimError }=await admin.from("admin_agent_v2_identification_canaries")
      .insert({
        message_id:message.id,
        conversation_id:conversation.id,
        respond_contact_id:conversation.respond_contact_id,
        status:"processing",
        requested_by:profile.id,
      }).select("id").single();
    if(claimError?.code==="23505") return res.status(409).json({ok:false,error:"identification_canary_already_used"});
    if(claimError) throw claimError;

    try{
      const providerMessageId=await sendRespondText(conversation.respond_contact_id);
      await admin.from("admin_agent_v2_identification_canaries")
        .update({status:"sent",provider_message_id:providerMessageId,completed_at:new Date().toISOString()})
        .eq("id",claim.id);
      return res.status(200).json({ok:true,status:"sent",message:IDENTIFICATION_MESSAGE});
    }catch(error){
      await admin.from("admin_agent_v2_identification_canaries")
        .update({status:"failed",error_code:String(error?.message||"send_failed").slice(0,120),completed_at:new Date().toISOString()})
        .eq("id",claim.id);
      throw error;
    }
  }catch(error){
    console.error("[admin-agent-v2-identification-canary]",error?.message||error);
    return res.status(Number(error?.statusCode||500)).json({ok:false,error:String(error?.message||"identification_canary_failed").slice(0,160)});
  }
}
