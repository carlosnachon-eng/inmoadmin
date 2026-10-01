import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { readRespondMessages, latestRespondRelevantMessage, respondMessageTimestamp } from "../../../lib/ejecutivo/respondSync";
import { sanitizeShadowText } from "../../../lib/shadow/coordinator";

export const config={maxDuration:120};
const SALES_CHANNELS=new Set(["497382","497385","498219","515318"]);
const equal=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&timingSafeEqual(x,y);};
const clean=(v,max=2000)=>String(v??"").trim().slice(0,max);

function messageText(message){
  return clean(message?.text??message?.message?.text??message?.body??message?.message?.body??"",4000);
}
function direction(message){
  const value=String(message?.traffic||message?.direction||"").toLowerCase();
  if(["incoming","inbound"].includes(value)) return "incoming";
  if(["outgoing","outbound"].includes(value)) return "outgoing";
  return null;
}

async function nextRecoverableSnapshot(admin){
  const since=new Date(Date.now()-12*60*60*1000).toISOString();
  const {data,error}=await admin.from("gv_respond_contact_snapshots")
    .select("respond_contact_id,respond_channel_id,respond_unanswered_since,respond_conversation_status,sales_relevant,respond_record_active,respond_blocked")
    .eq("sales_relevant",true)
    .eq("respond_record_active",true)
    .eq("respond_blocked",false)
    .eq("respond_conversation_status","open")
    .not("respond_unanswered_since","is",null)
    .gte("respond_unanswered_since",since)
    .order("respond_unanswered_since",{ascending:true})
    .limit(50);
  if(error) throw error;

  for(const row of data||[]){
    if(!SALES_CHANNELS.has(String(row.respond_channel_id||""))) continue;
    const eventId="recovery:"+row.respond_contact_id+":"+row.respond_unanswered_since;
    const {data:existing,error:existingError}=await admin.from("sales_agent_v2_inbound_messages")
      .select("id").eq("event_id",eventId).maybeSingle();
    if(existingError) throw existingError;
    if(!existing) return {...row,eventId};
  }
  return null;
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(!["GET","POST"].includes(req.method)) return res.status(405).json({ok:false,error:"method_not_allowed"});
  if(!process.env.CRON_SECRET||!equal(req.headers.authorization,"Bearer "+process.env.CRON_SECRET)) return res.status(401).json({ok:false,error:"not_authorized"});
  if(process.env.SALES_AGENT_V2_RECOVERY_ENABLED!=="true") { console.info("[sales-v2-recovery] disabled", { value: process.env.SALES_AGENT_V2_RECOVERY_ENABLED || null }); return res.status(200).json({ok:true,status:"disabled"}); }

  const admin=getAdminSupabase();
  try{
    const snapshot=await nextRecoverableSnapshot(admin);
    if(!snapshot) { console.info("[sales-v2-recovery] idle"); return res.status(200).json({ok:true,status:"idle"}); }
    console.info("[sales-v2-recovery] candidate", { contactId: snapshot.respond_contact_id, channelId: snapshot.respond_channel_id, unansweredSince: snapshot.respond_unanswered_since });

    const result=await readRespondMessages(snapshot.respond_contact_id,1);
    const latest=latestRespondRelevantMessage(result.messages||[]);
    if(!latest||direction(latest.message)!=="incoming"){
      await admin.from("sales_agent_v2_inbound_messages").insert({
        event_id:snapshot.eventId,
        external_message_id:latest?.message?.messageId||latest?.message?.id||null,
        respond_contact_id:snapshot.respond_contact_id,
        channel_id:snapshot.respond_channel_id,
        occurred_at:snapshot.respond_unanswered_since,
        sanitized_text:"[SIN MENSAJE RECUPERABLE]",
        sanitization_changed:false,
        status:"skipped",
      });
      return res.status(200).json({ok:true,status:"skipped",reason:"latest_not_inbound"});
    }

    const raw=messageText(latest.message);
    const sanitized=sanitizeShadowText(raw);
    if(sanitized.rejected){
      await admin.from("sales_agent_v2_inbound_messages").insert({
        event_id:snapshot.eventId,
        external_message_id:latest.message?.messageId||latest.message?.id||null,
        respond_contact_id:snapshot.respond_contact_id,
        channel_id:snapshot.respond_channel_id,
        occurred_at:respondMessageTimestamp(latest.message)||snapshot.respond_unanswered_since,
        sanitized_text:"[MENSAJE SIN TEXTO UTIL]",
        sanitization_changed:false,
        status:"skipped",
      });
      return res.status(200).json({ok:true,status:"skipped",reason:"empty_or_unsupported"});
    }

    const {data,error}=await admin.from("sales_agent_v2_inbound_messages").insert({
      event_id:snapshot.eventId,
      external_message_id:latest.message?.messageId||latest.message?.id||null,
      respond_contact_id:snapshot.respond_contact_id,
      channel_id:snapshot.respond_channel_id,
      occurred_at:respondMessageTimestamp(latest.message)||snapshot.respond_unanswered_since,
      sanitized_text:sanitized.text,
      sanitization_changed:sanitized.changed,
      status:"captured",
    }).select("id").single();
    if(error?.code==="23505") return res.status(200).json({ok:true,status:"duplicate"});
    if(error) throw error;
    return res.status(200).json({ok:true,status:"captured",inboundMessageId:data.id,contactId:snapshot.respond_contact_id});
  }catch(error){
    console.error("[sales-v2-recovery]",String(error?.message||"recovery_failed").slice(0,160));
    return res.status(503).json({ok:false,error:"sales_v2_recovery_failed"});
  }
}
