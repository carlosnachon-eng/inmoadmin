import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";

export const config={maxDuration:30};
const equal=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&timingSafeEqual(x,y);};
const clean=(value,max=500)=>String(value||"").replace(/\s+/g," ").trim().slice(0,max);

const parseQuoteResponse=(text)=>{
  const value=clean(text,500);
  const amountMatch=value.match(/(?:\$|mxn\s*)\s*([0-9]{1,3}(?:[, ][0-9]{3})*(?:\.[0-9]{1,2})?)/i)
    || value.match(/\b([0-9]{3,6}(?:\.[0-9]{1,2})?)\s*(?:pesos|mxn)\b/i);
  const amount=amountMatch?Number(String(amountMatch[1]).replace(/[, ]/g,"")):null;
  const availabilityMatch=value.match(/\b(hoy|mañana|manana|pasado mañana|pasado manana|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|por la mañana|por la manana|por la tarde|en la tarde|en la mañana|en la manana)\b[^.]{0,80}/i);
  return{
    amount:Number.isFinite(amount)?amount:null,
    availability:availabilityMatch?clean(availabilityMatch[0],160):null,
  };
};


async function nextProviderReply(admin){
  const {data:links,error:linkError}=await admin.from("respond_provider_links")
    .select("provider_id,respond_contact_id")
    .eq("link_status","confirmed");
  if(linkError)throw linkError;
  for(const link of links||[]){
    const {data:requests,error:requestError}=await admin.from("service_provider_quote_requests")
      .select("id,ticket_id,provider_id,respond_contact_id,status,sent_at")
      .eq("respond_contact_id",link.respond_contact_id)
      .eq("status","sent")
      .not("sent_at","is",null)
      .order("sent_at",{ascending:true});
    if(requestError)throw requestError;
    if(!requests?.length)continue;

    const earliest=requests[0].sent_at;
    const {data:messages,error:messageError}=await admin.from("shadow_messages")
      .select("id,conversation_id,direction,occurred_at,sanitized_text")
      .eq("provider","respond_admin")
      .eq("direction","inbound")
      .gte("occurred_at",earliest)
      .order("occurred_at",{ascending:true})
      .limit(50);
    if(messageError)throw messageError;
    for(const message of messages||[]){
      const {data:conversation,error:conversationError}=await admin.from("shadow_conversations")
        .select("respond_contact_id").eq("id",message.conversation_id).maybeSingle();
      if(conversationError)throw conversationError;
      if(conversation?.respond_contact_id!==link.respond_contact_id)continue;
      const matching=requests.filter((request)=>
        request.sent_at && new Date(request.sent_at)<=new Date(message.occurred_at)
      );
      if(matching.length!==1)continue;
      return{message,request:matching[0]};
    }
  }
  return null;
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(!["GET","POST"].includes(req.method))return res.status(405).json({ok:false,error:"method_not_allowed"});
  if(!process.env.CRON_SECRET||!equal(req.headers.authorization,`Bearer ${process.env.CRON_SECRET}`))return res.status(401).json({ok:false,error:"not_authorized"});
  const admin=getAdminSupabase();
  try{
    const candidate=await nextProviderReply(admin);
    if(!candidate)return res.status(200).json({ok:true,status:"idle"});
    const text=clean(candidate.message.sanitized_text,500);
    if(!text)return res.status(200).json({ok:true,status:"idle"});
    const parsed=parseQuoteResponse(text);
    const now=new Date().toISOString();
    const {data,error}=await admin.from("service_provider_quote_requests").update({
      status:"responded",
      provider_reply_message_id:candidate.message.id,
      response_summary:text,
      quoted_amount:parsed.amount,
      availability_text:parsed.availability,
      response_parsed:true,
      responded_at:candidate.message.occurred_at,
      updated_at:now,
    }).eq("id",candidate.request.id).eq("status","sent").select("id,ticket_id,provider_id,status,response_summary,quoted_amount,availability_text,responded_at").maybeSingle();
    if(error)throw error;
    return res.status(200).json({ok:true,status:data?"matched":"race_lost",request:data||null});
  }catch(error){
    console.error("[provider-quote-replies]",String(error?.message||"provider_quote_reply_failed").slice(0,120));
    return res.status(503).json({ok:false,error:"provider_quote_reply_failed"});
  }
}
