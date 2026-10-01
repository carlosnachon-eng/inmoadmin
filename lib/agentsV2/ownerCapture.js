import { sanitizeShadowText } from "../shadow/coordinator.js";

export const OWNER_AGENT_CHANNEL_IDS=new Set(["497382","497385","498219","515318"]);
const INBOUND_EVENTS=new Set(["message.received","new_incoming_message"]);
const OWNER_INTENT=/\b(?:soy (?:propietari[oa]|dueñ[oa])|mi propiedad|mi inmueble|quiero (?:rentar|vender|administrar|publicar) mi|quiero (?:poner|dar) en (?:renta|venta)|tengo (?:una?|un) (?:casa|departamento|depa|local|oficina|bodega|terreno|inmueble)|administren mi|administrar mi propiedad|promover mi propiedad)\b/i;
const clean=(v,max=4000)=>String(v??"").trim().slice(0,max);

function eventType(body){return clean(body?.event_type||body?.event,80).toLowerCase().replace(/[\s-]+/g,"_");}
function messageText(body){
  const m=body?.message||{};
  const a=m?.attachment||m?.attachments?.[0]||m?.message?.attachment||{};
  const p=a?.payload||m?.message?.payload||{};
  const values=[m?.text,m?.caption,m?.message?.text,m?.message?.caption,m?.body,m?.message?.body,a?.caption,a?.text,a?.title,a?.description,p?.text,p?.title,p?.description,p?.body,body?.caption];
  const parts=[];
  for(const v of values){const x=clean(v,1600);if(x&&!parts.includes(x))parts.push(x);}
  return clean(parts.join(" | "),4000);
}

export const hasOwnerIntent = (text) => OWNER_INTENT.test(text);

export async function captureRespondOwnerInboundIsolated(admin,body){
  try{
    if(!INBOUND_EVENTS.has(eventType(body)))return{status:"skipped",reason:"not_inbound"};
    const m=body?.message||{},c=body?.conversation||{};
    const channelId=clean(m?.channelId??c?.channelId??body?.channelId??body?.channel?.id,80);
    if(!OWNER_AGENT_CHANNEL_IDS.has(channelId))return{status:"skipped",reason:"not_owner_channel"};
    const contactId=clean(body?.contact?.id??m?.contactId??c?.contactId??body?.contactId,200);
    const text=messageText(body);
    if(!contactId||!text)return{status:"skipped",reason:"missing_required"};

    let ownerIntent=OWNER_INTENT.test(text);
    if(!ownerIntent){
      const since=new Date(Date.now()-2*60*60*1000).toISOString();
      const {data:recent,error}=await admin.from("owner_agent_v1_inbound_messages")
        .select("id").eq("respond_contact_id",contactId).gte("created_at",since).limit(1);
      if(error)throw error;
      ownerIntent=(recent||[]).length>0;
    }
    if(!ownerIntent)return{status:"skipped",reason:"not_owner_intent"};

    const eventId=clean(body?.event_id||body?.eventId||body?.id,200);
    const messageId=clean(m?.messageId||m?.id,200)||null;
    const rawTs=m?.timestamp??body?.timestamp??Date.now();
    let n=Number(rawTs);if(Number.isFinite(n)&&n>0&&n<1e12)n*=1000;
    const occurred=Number.isFinite(n)&&n>0?new Date(n):new Date(rawTs);
    const safe=sanitizeShadowText(text);
    if(!eventId||Number.isNaN(occurred.getTime())||safe.rejected)return{status:"skipped",reason:"invalid_message"};

    const debounceUntil=new Date(Date.now()+4000).toISOString();
    const {data,error}=await admin.from("owner_agent_v1_inbound_messages").insert({
      event_id:eventId,external_message_id:messageId,respond_contact_id:contactId,channel_id:channelId,
      occurred_at:occurred.toISOString(),sanitized_text:safe.text,status:"captured",debounce_until:debounceUntil
    }).select("id,created_at,debounce_until").single();
    if(error?.code==="23505")return{status:"duplicate"};
    if(error)throw error;
    return{status:"captured",id:data.id,createdAt:data.created_at,debounceUntil:data.debounce_until,respondContactId:contactId};
  }catch(error){
    console.error("[owner-ai-capture]",String(error?.message||"capture_failed").slice(0,120));
    return{status:"isolated_error"};
  }
}
