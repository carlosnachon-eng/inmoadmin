import { sanitizeShadowText } from "../shadow/coordinator";

export const SALES_AGENT_V2_CHANNEL_IDS = new Set(["497382","497385","498219","515318"]);
const INBOUND_EVENTS = new Set(["message.received","new_incoming_message"]);
const clean=(value,max=200)=>String(value??"").trim().slice(0,max);

function normalizedEventType(body){
  return clean(body?.event_type||body?.event,80).toLowerCase().replace(/[\s-]+/g,"_");
}
function messageText(body){
  const message=body?.message||{};
  const attachment=message?.attachment||message?.attachments?.[0]||message?.message?.attachment||{};
  const candidates=[
    message?.text,
    message?.caption,
    message?.message?.text,
    message?.message?.caption,
    message?.body,
    message?.message?.body,
    attachment?.caption,
    attachment?.text,
    body?.caption,
  ];
  return clean(candidates.find((value)=>String(value??"").trim())||"",4000);
}

export async function captureRespondSalesV2InboundIsolated(admin, body){
  try{
    const eventType=normalizedEventType(body);
    if(!INBOUND_EVENTS.has(eventType)) return {status:"skipped",reason:"not_inbound"};
    const message=body?.message||{};
    const conversation=body?.conversation||{};
    const channelId=clean(message?.channelId??conversation?.channelId??body?.channelId??body?.channel?.id,80);
    if(!SALES_AGENT_V2_CHANNEL_IDS.has(channelId)) return {status:"skipped",reason:"not_sales_channel"};
    const eventId=clean(body?.event_id||body?.eventId||body?.id,200);
    const contactId=clean(body?.contact?.id??message?.contactId??conversation?.contactId??body?.contactId,200);
    const messageId=clean(message?.messageId||message?.id,200)||null;
    const rawTimestamp=message?.timestamp??body?.timestamp??Date.now();
    let timestampNumber=Number(rawTimestamp);
    if(Number.isFinite(timestampNumber)&&timestampNumber>0&&timestampNumber<1e12) timestampNumber*=1000;
    const occurred=Number.isFinite(timestampNumber)&&timestampNumber>0 ? new Date(timestampNumber) : new Date(rawTimestamp);
    const raw=messageText(body);
    const sanitized=sanitizeShadowText(raw);
    if(!eventId||!contactId||Number.isNaN(occurred.getTime())||sanitized.rejected) return {status:"skipped",reason:"missing_required"};
    const {data,error}=await admin.from("sales_agent_v2_inbound_messages").insert({
      event_id:eventId,
      external_message_id:messageId,
      respond_contact_id:contactId,
      channel_id:channelId,
      occurred_at:occurred.toISOString(),
      sanitized_text:sanitized.text,
      sanitization_changed:sanitized.changed,
      status:"captured",
    }).select("id").single();
    if(error?.code==="23505") return {status:"duplicate"};
    if(error) throw error;
    return {status:"captured",id:data.id};
  }catch(error){
    console.error("[sales-v2-capture]",String(error?.message||"capture_failed").slice(0,120));
    return {status:"isolated_error"};
  }
}
