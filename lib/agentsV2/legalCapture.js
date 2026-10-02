import { sanitizeShadowText } from "../shadow/coordinator.js";

export const LEGAL_AGENT_CHANNEL_IDS=new Set(["497382","497385","498219","515318"]);
const INBOUND_EVENTS=new Set(["message.received","new_incoming_message"]);
const LEGAL_INTENT=/\b(?:p[oó]liza(?: jur[ií]dica)?|blindaje legal|investigaci[oó]n|dictamen|contrato de arrendamiento|pagar[eé]s?|documentos? (?:de|para) (?:la )?p[oó]liza|bur[oó] m[eé]xico|obligado solidario|fiador|rechazad[oa] por p[oó]liza|aprobaci[oó]n de p[oó]liza|resultado de investigaci[oó]n)\b/i;
const clean=(v,max=4000)=>String(v??"").trim().slice(0,max);
function type(body){return clean(body?.event_type||body?.event,80).toLowerCase().replace(/[\s-]+/g,"_");}
function text(body){
  const m=body?.message||{},a=m?.attachment||m?.attachments?.[0]||m?.message?.attachment||{},p=a?.payload||m?.message?.payload||{};
  const vals=[m?.text,m?.caption,m?.message?.text,m?.message?.caption,m?.body,m?.message?.body,a?.caption,a?.text,a?.title,a?.description,p?.text,p?.title,p?.description,p?.body,body?.caption];
  const out=[]; for(const v of vals){const x=clean(v,1600);if(x&&!out.includes(x))out.push(x);} return clean(out.join(" | "),4000);
}
export const hasLegalIntent = (text) => LEGAL_INTENT.test(text);

export async function captureRespondLegalInboundIsolated(admin,body){
  try{
    if(!INBOUND_EVENTS.has(type(body)))return{status:"skipped",reason:"not_inbound"};
    const m=body?.message||{},c=body?.conversation||{};
    const channelId=clean(m?.channelId??c?.channelId??body?.channelId??body?.channel?.id,80);
    if(!LEGAL_AGENT_CHANNEL_IDS.has(channelId))return{status:"skipped",reason:"not_legal_channel"};
    const contactId=clean(body?.contact?.id??m?.contactId??c?.contactId??body?.contactId,200);
    const raw=text(body);
    if(!contactId||!raw||!LEGAL_INTENT.test(raw))return{status:"skipped",reason:"not_legal_intent"};
    const eventId=clean(body?.event_id||body?.eventId||body?.id,200);
    const safe=sanitizeShadowText(raw);
    const rawTs=m?.timestamp??body?.timestamp??Date.now(); let n=Number(rawTs); if(Number.isFinite(n)&&n>0&&n<1e12)n*=1000;
    const occurred=Number.isFinite(n)&&n>0?new Date(n):new Date(rawTs);
    if(!eventId||safe.rejected||Number.isNaN(occurred.getTime()))return{status:"skipped",reason:"invalid_message"};
    const debounceUntil=new Date(Date.now()+4000).toISOString();
    const {data,error}=await admin.from("legal_agent_v1_inbound_messages").insert({
      event_id:eventId,external_message_id:clean(m?.messageId||m?.id,200)||null,respond_contact_id:contactId,channel_id:channelId,
      occurred_at:occurred.toISOString(),sanitized_text:safe.text,status:"captured",debounce_until:debounceUntil
    }).select("id,created_at,debounce_until").single();
    if(error?.code==="23505")return{status:"duplicate"};
    if(error)throw error;
    return{status:"captured",id:data.id,createdAt:data.created_at,debounceUntil:data.debounce_until,respondContactId:contactId};
  }catch(error){console.error("[legal-ai-capture]",String(error?.message||"capture_failed").slice(0,120));return{status:"isolated_error"};}
}
