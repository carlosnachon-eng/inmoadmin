import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";

export const config={maxDuration:60};
const ADMIN_CHANNEL_ID="544519";
const equal=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&timingSafeEqual(x,y);};
const clean=(v,max=480)=>String(v??"").replace(/\s+/g," ").trim().slice(0,max);

function mxParts(date){
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:"America/Mexico_City",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(date);
  const o=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return{weekday:o.weekday,hour:Number(o.hour),minute:Number(o.minute)};
}

function isBusinessMinute(date){
  const p=mxParts(date);
  const minuteOfDay=p.hour*60+p.minute;
  if(p.weekday==="Sun")return false;
  if(p.weekday==="Sat")return minuteOfDay>=10*60&&minuteOfDay<14*60;
  return minuteOfDay>=9*60&&minuteOfDay<19*60;
}

function businessMinutesBetween(startIso,endDate=new Date()){
  const start=new Date(startIso);
  if(Number.isNaN(start.getTime()))return 0;
  const end=endDate instanceof Date?endDate:new Date(endDate);
  if(end<=start)return 0;
  let cursor=new Date(Math.floor(start.getTime()/60000)*60000);
  const maxStart=new Date(Math.max(cursor.getTime(),end.getTime()-14*24*60*60000));
  cursor=maxStart;
  let total=0;
  while(cursor<end){
    if(isBusinessMinute(cursor))total+=1;
    cursor=new Date(cursor.getTime()+60000);
  }
  return total;
}

async function sendRespond(contactId,text,env=process.env){
  const token=env.RESPOND_IO_TOKEN||env.RESPOND_IO_API_TOKEN;
  if(!token)throw new Error("respond_sender_credential_missing");
  const r=await fetch("https://api.respond.io/v2/contact/id:"+encodeURIComponent(String(contactId))+"/message",{
    method:"POST",
    headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json"},
    body:JSON.stringify({channelId:Number(ADMIN_CHANNEL_ID),message:{type:"text",text:clean(text)}})
  });
  const b=await r.json().catch(()=>({}));
  if(!r.ok||!b?.messageId)throw new Error("provider_reminder_send_failed");
  return String(b.messageId).slice(0,120);
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(!["GET","POST"].includes(req.method))return res.status(405).json({ok:false,error:"method_not_allowed"});
  if(!process.env.CRON_SECRET||!equal(req.headers.authorization,"Bearer "+process.env.CRON_SECRET))return res.status(401).json({ok:false,error:"not_authorized"});

  const now=new Date();
  if(!isBusinessMinute(now))return res.status(200).json({ok:true,status:"outside_business_hours"});

  const admin=getAdminSupabase();
  try{
    const cutoff=new Date(now.getTime()-14*24*60*60000).toISOString();
    const {data:requests,error}=await admin.from("service_provider_quote_requests")
      .select("id,ticket_id,provider_id,respond_contact_id,status,sent_at,reminder_sent_at,service_providers(display_name),maintenance_tickets(property_name,title)")
      .eq("status","sent")
      .not("sent_at","is",null)
      .gte("sent_at",cutoff)
      .order("sent_at",{ascending:true})
      .limit(100);
    if(error)throw error;

    for(const request of requests||[]){
      const minutes=businessMinutesBetween(request.sent_at,now);

      if(minutes>=240){
        const changedAt=now.toISOString();
        const {data:updated,error:updateError}=await admin.from("service_provider_quote_requests").update({
          status:"no_response",
          escalated_at:changedAt,
          error_code:"provider_no_response_4_business_hours",
          updated_at:changedAt
        }).eq("id",request.id).eq("status","sent").select("id").maybeSingle();
        if(updateError)throw updateError;
        if(updated)return res.status(200).json({ok:true,status:"escalated",requestId:request.id,businessMinutes:minutes});
        continue;
      }

      if(minutes>=120&&!request.reminder_sent_at){
        const providerName=clean(request.service_providers?.display_name||"",100);
        const ticket=request.maintenance_tickets||{};
        const place=clean(ticket.property_name||"el inmueble",120);
        const issue=clean(ticket.title||"el trabajo solicitado",150);
        const message=clean("Hola "+(providerName||"de nuevo")+". Te recuerdo la cotización pendiente para "+place+": "+issue+". Cuando puedas, por favor compártenos costo estimado y disponibilidad. Gracias.",480);

        const messageId=await sendRespond(request.respond_contact_id,message);
        const sentAt=now.toISOString();
        const {data:updated,error:updateError}=await admin.from("service_provider_quote_requests").update({
          reminder_sent_at:sentAt,
          reminder_message_id:messageId,
          updated_at:sentAt
        }).eq("id",request.id).eq("status","sent").is("reminder_sent_at",null).select("id").maybeSingle();
        if(updateError)throw updateError;
        if(updated)return res.status(200).json({ok:true,status:"reminded",requestId:request.id,businessMinutes:minutes});
      }
    }

    return res.status(200).json({ok:true,status:"idle"});
  }catch(error){
    console.error("[provider-quote-sla]",String(error?.message||"provider_quote_sla_failed").slice(0,160));
    return res.status(503).json({ok:false,error:"provider_quote_sla_failed"});
  }
}
