import { createClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";

const ADMIN_CHANNEL_ID="544519";
const client=(key,token)=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,key,{
  global:token?{headers:{Authorization:`Bearer ${token}`}}:undefined,
  auth:{persistSession:false,autoRefreshToken:false},
});
const clean=(v,max=480)=>String(v??"").replace(/\s+/g," ").trim().slice(0,max);

async function authorize(req){
  const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(!token)return null;
  const auth=client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,token);
  const {data:{user}}=await auth.auth.getUser(token);
  if(!user)return null;
  const {data:profile}=await auth.from("profiles").select("id,role_id,active").eq("id",user.id).maybeSingle();
  if(!profile?.active||!["admin","coord_operaciones"].includes(profile.role_id))return null;
  return profile;
}

async function sendRespond(contactId,text){
  const token=process.env.RESPOND_IO_TOKEN||process.env.RESPOND_IO_API_TOKEN;
  if(!token)throw Object.assign(new Error("respond_sender_credential_missing"),{statusCode:503});
  const response=await fetch(`https://api.respond.io/v2/contact/id:${encodeURIComponent(String(contactId))}/message`,{
    method:"POST",
    headers:{Authorization:`Bearer ${token}`,Accept:"application/json","Content-Type":"application/json"},
    body:JSON.stringify({channelId:Number(ADMIN_CHANNEL_ID),message:{type:"text",text:clean(text)}}),
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(response.status>=500||response.status===429?"respond_delivery_unknown":"respond_rejected");
  if(!body?.messageId)throw new Error("respond_delivery_unknown");
  return String(body.messageId).slice(0,120);
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  const profile=await authorize(req);
  if(!profile)return res.status(403).json({ok:false,error:"not_authorized"});
  const admin=getAdminSupabase();

  if(req.method==="GET"){
    const [{data:providers,error:providerError},{data:requests,error:requestError}]=await Promise.all([
      admin.from("service_providers")
        .select("id,display_name,provider_type,status,service_provider_specialties(specialty,is_primary),respond_provider_links(respond_contact_id,link_status)")
        .eq("status","active")
        .order("display_name"),
      admin.from("service_provider_quote_requests")
        .select("id,ticket_id,provider_id,status,request_message,sent_at,responded_at,response_summary,quoted_amount,availability_text,response_parsed,error_code,created_at")
        .order("created_at",{ascending:false})
        .limit(100),
    ]);
    if(providerError||requestError)return res.status(500).json({ok:false,error:"provider_quote_load_failed"});
    const normalized=(providers||[]).map((p)=>({
      id:p.id,
      displayName:p.display_name,
      providerType:p.provider_type,
      specialties:(p.service_provider_specialties||[]).map((s)=>({name:s.specialty,primary:Boolean(s.is_primary)})),
      respondContactId:(p.respond_provider_links||[]).find((l)=>l.link_status==="confirmed")?.respond_contact_id||null,
    })).filter((p)=>p.respondContactId);
    return res.status(200).json({ok:true,providers:normalized,requests:requests||[]});
  }

  if(req.method!=="POST")return res.status(405).json({ok:false,error:"method_not_allowed"});

  const ticketId=String(req.body?.ticketId||"");
  const providerId=String(req.body?.providerId||"");
  const action=String(req.body?.action||"preview");
  if(!/^[0-9a-f-]{36}$/i.test(ticketId)||!/^[0-9a-f-]{36}$/i.test(providerId))return res.status(400).json({ok:false,error:"invalid_ids"});

  const [{data:ticket,error:ticketError},{data:provider,error:providerError},{data:link,error:linkError}]=await Promise.all([
    admin.from("maintenance_tickets").select("id,property_name,title,description,category,priority,status").eq("id",ticketId).maybeSingle(),
    admin.from("service_providers").select("id,display_name,status").eq("id",providerId).maybeSingle(),
    admin.from("respond_provider_links").select("respond_contact_id,link_status").eq("provider_id",providerId).eq("link_status","confirmed").limit(1).maybeSingle(),
  ]);
  if(ticketError||providerError||linkError)throw ticketError||providerError||linkError;
  if(!ticket||!provider||provider.status!=="active"||!link?.respond_contact_id)return res.status(409).json({ok:false,error:"provider_or_ticket_not_eligible"});

  const detail=clean(ticket.description||ticket.title,220);
  const message=clean(`Hola ${provider.display_name}. ¿Me apoyas por favor con una cotización para el siguiente trabajo en ${ticket.property_name||"un inmueble administrado"}? ${ticket.title}. ${detail}. Por favor indícame costo estimado y disponibilidad. Gracias.`,480);

  if(action==="preview")return res.status(200).json({ok:true,preview:{provider:provider.display_name,message}});

  if(action!=="send")return res.status(400).json({ok:false,error:"invalid_action"});
  const {data:row,error:insertError}=await admin.from("service_provider_quote_requests").insert({
    ticket_id:ticket.id,
    provider_id:provider.id,
    respond_contact_id:link.respond_contact_id,
    status:"draft",
    request_message:message,
    requested_by:profile.id,
  }).select("id").single();
  if(insertError)throw insertError;

  try{
    const providerMessageId=await sendRespond(link.respond_contact_id,message);
    const sentAt=new Date().toISOString();
    await admin.from("service_provider_quote_requests").update({
      status:"sent",provider_message_id:providerMessageId,sent_at:sentAt,updated_at:sentAt,
    }).eq("id",row.id);
    return res.status(200).json({ok:true,status:"sent",requestId:row.id,message});
  }catch(error){
    await admin.from("service_provider_quote_requests").update({
      status:"failed",error_code:String(error?.message||"send_failed").slice(0,120),updated_at:new Date().toISOString(),
    }).eq("id",row.id);
    return res.status(503).json({ok:false,error:String(error?.message||"send_failed").slice(0,120)});
  }
}
