import { fetchRespondContact, readRespondMessages, respondMessageTimestamp } from "../ejecutivo/respondSync.js";
import { socialRoutingEnabled, SOCIAL_CHANNELS } from "../social/routing.js";
import { resolveSocialAppointmentClient } from "../social/appointmentIdentity.js";

const clean=(v,max=500)=>String(v??"").replace(/\s+/g," ").trim().slice(0,max);
const normalize=(v)=>clean(v,120).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const MX_OFFSET="-06:00";

function messageText(m){
  return clean(m?.text??m?.message?.text??m?.body??m?.message?.body??"",1200);
}
function respondContactName(contact){
  return clean(
    contact?.name
    || contact?.fullName
    || contact?.full_name
    || [contact?.firstName||contact?.first_name,contact?.lastName||contact?.last_name].filter(Boolean).join(" "),
    160
  );
}

async function resolveClient(admin,{respondContactId,advisorId,opp}){
  if(opp?.cliente_id)return opp.cliente_id;

  const {data:lead,error:leadError}=await admin.from("leads_respond")
    .select("contacto_nombre")
    .eq("contacto_id",respondContactId)
    .not("contacto_nombre","is",null)
    .order("created_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(leadError)throw leadError;

  let name=clean(lead?.contacto_nombre,160);
  if(!name){
    try{
      const contact=await fetchRespondContact(respondContactId);
      name=respondContactName(contact);
    }catch(error){
      console.error("[respond-appointment-client]",String(error?.message||"contact_lookup_failed").slice(0,120));
    }
  }
  if(!name)return null;

  const {data:existing,error:existingError}=await admin.from("clientes")
    .select("id")
    .eq("nombre",name)
    .eq("asesor_id",advisorId)
    .order("updated_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(existingError)throw existingError;
  if(existing)return existing.id;

  const {data:created,error:createError}=await admin.from("clientes").insert({
    nombre:name,
    etapa_interes:"caliente",
    asesor_id:advisorId,
    notas:"Cliente creado automáticamente desde Respond.io para registrar una visita agendada."
  }).select("id").single();
  if(createError)throw createError;
  return created.id;
}

async function resolveProperty(admin,{respondContactId,opp}){
  if(opp?.propiedad_id)return opp.propiedad_id;

  const {data:runs,error:runError}=await admin.from("sales_agent_v2_shadow_runs")
    .select("proposed_response,completed_at,sales_agent_v2_inbound_messages!inner(respond_contact_id)")
    .eq("sales_agent_v2_inbound_messages.respond_contact_id",respondContactId)
    .eq("status","idle")
    .order("completed_at",{ascending:false})
    .limit(10);
  if(runError)throw runError;

  for(const run of runs||[]){
    const text=String(run?.proposed_response||"");
    const match=text.match(/emporioinmobiliario\.com\.mx\/propiedades\/([A-Za-z0-9_-]+)/i);
    if(!match)continue;
    const publicId=decodeURIComponent(match[1]);
    const {data:property,error:propertyError}=await admin.from("propiedades")
      .select("id").eq("public_id",publicId).eq("status","published").maybeSingle();
    if(propertyError)throw propertyError;
    if(property?.id)return property.id;
  }
  return null;
}
function mxDateParts(iso){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(iso));
  const o=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return {year:Number(o.year),month:Number(o.month),day:Number(o.day)};
}
function addDays(y,m,d,days){
  const dt=new Date(Date.UTC(y,m-1,d+days,12,0,0));
  return {year:dt.getUTCFullYear(),month:dt.getUTCMonth()+1,day:dt.getUTCDate()};
}
function parseAppointment(text,baseIso){
  const n=normalize(text);
  const tm=n.match(/\b(?:a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/);
  if(!tm)return null;
  let hour=Number(tm[1]),minute=Number(tm[2]||0);
  const meridian=String(tm[3]||"").replace(/\./g,"");
  if(meridian==="pm"&&hour<12)hour+=12;
  if(meridian==="am"&&hour===12)hour=0;
  if(!meridian){
    if(/\b(?:por la tarde|en la tarde|tarde|por la noche|en la noche|noche)\b/.test(n)&&hour<12)hour+=12;
    else if(hour>=1&&hour<=7)return null;
  }
  if(hour>23||minute>59)return null;
  const base=mxDateParts(baseIso);
  let date=null;
  if(/\bmanana\b/.test(n))date=addDays(base.year,base.month,base.day,1);
  else if(/\bhoy\b/.test(n))date={year:base.year,month:base.month,day:base.day};
  else{
    const dm=n.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if(dm){
      const year=dm[3]?Number(dm[3].length===2?"20"+dm[3]:dm[3]):base.year;
      date={year,month:Number(dm[2]),day:Number(dm[1])};
    }
  }
  if(!date)return null;
  const pad=x=>String(x).padStart(2,"0");
  const local=String(date.year)+"-"+pad(date.month)+"-"+pad(date.day)+"T"+pad(hour)+":"+pad(minute)+":00"+MX_OFFSET;
  const parsed=new Date(local);
  if(Number.isNaN(parsed.getTime())||parsed.getTime()<Date.now()-60000)return null;
  return parsed.toISOString();
}

export async function captureRespondAppointmentLifecycleIsolated(admin,body,{env=process.env}={}){
  try{
    const eventType=String(body?.event_type||body?.event||"").trim().toLowerCase().replace(/[\s-]+/g,"_");
    if(eventType!=="contact.lifecycle.updated")return{status:"skipped",reason:"not_lifecycle"};
    const contactId=clean(body?.contact?.id??body?.contactId,200);
    const eventId=clean(body?.event_id||body?.eventId,200);
    if(!contactId||!eventId)return{status:"skipped",reason:"missing_required"};
    const lifecycle=clean(body?.contact?.lifecycle?.name??body?.lifecycle?.name??body?.contact?.lifecycle?.id??body?.lifecycle?.id,120);
    let channelId=clean(body?.conversation?.channelId??body?.message?.channelId??body?.channelId??body?.channel?.id,80);
    if(socialRoutingEnabled(env)&&!channelId){
      const snapshot=await admin.from("gv_respond_contact_snapshots").select("respond_channel_id").eq("respond_contact_id",contactId).maybeSingle();
      if(snapshot.error)throw snapshot.error;
      channelId=clean(snapshot.data?.respond_channel_id,80);
      // Never fall back to name matching for a social event with unresolved provenance.
      if(!channelId)return{status:"needs_confirmation",reason:"appointment_channel_unresolved"};
    }
    const protectedMode=socialRoutingEnabled(env)&&Object.hasOwn(SOCIAL_CHANNELS,channelId);
    const {error}=await admin.from("respond_appointment_sync").insert({event_id:eventId,respond_contact_id:contactId,lifecycle:lifecycle||"unknown",status:"pending",...(protectedMode?{social_routing_version:1}:{})});
    if(error?.code==="23505")return{status:"duplicate"};
    if(error)throw error;
    return{status:"captured"};
  }catch(error){
    console.error("[respond-appointment-capture]",String(error?.message||"capture_failed").slice(0,160));
    return{status:"isolated_error"};
  }
}

export async function processOneRespondAppointmentSync(admin){
  const {data:row,error}=await admin.from("respond_appointment_sync").select("*").eq("status","pending").order("created_at",{ascending:true}).limit(1).maybeSingle();
  if(error)throw error;
  if(!row)return{status:"idle"};

  const transition=(patch)=>{
    let query=admin.from("respond_appointment_sync").update(patch).eq("id",row.id);
    if(row.social_routing_version===1)query=query.eq("status","pending");
    return query;
  };

  try{
    const {data:snapshot,error:snapshotError}=await admin.from("gv_respond_contact_snapshots")
      .select("mapped_profile_id,mapping_status,respond_lifecycle")
      .eq("respond_contact_id",row.respond_contact_id).maybeSingle();
    if(snapshotError)throw snapshotError;
    const lifecycle=clean(snapshot?.respond_lifecycle||row.lifecycle,120);
    if(normalize(lifecycle)!=="visita agendada"){
      await transition({status:"skipped",error_code:"lifecycle_not_visit_scheduled",updated_at:new Date().toISOString()});
      return{status:"skipped"};
    }
    if(!snapshot?.mapped_profile_id){
      await transition({status:"needs_confirmation",error_code:"advisor_not_mapped",updated_at:new Date().toISOString()});
      return{status:"needs_confirmation"};
    }

    const respond=await readRespondMessages(row.respond_contact_id,1);
    const human=(respond.messages||[]).map(m=>({
      at:respondMessageTimestamp(m),
      text:messageText(m),
      source:String(m?.sender?.source||"").toLowerCase(),
      traffic:String(m?.traffic||m?.direction||"").toLowerCase()
    })).filter(x=>x.at&&x.text&&["outgoing","outbound"].includes(x.traffic)&&x.source==="user")
      .sort((a,b)=>b.at.localeCompare(a.at)).slice(0,8);

    let resolved=null;
    for(const msg of human){
      const at=parseAppointment(msg.text,msg.at);
      if(at){resolved={at,msg};break;}
    }
    if(!resolved){
      await transition({status:"needs_confirmation",advisor_profile_id:snapshot.mapped_profile_id,error_code:"appointment_datetime_ambiguous",updated_at:new Date().toISOString()});
      return{status:"needs_confirmation"};
    }

    const {data:opp,error:oppError}=await admin.from("gv_opportunities")
      .select("cliente_id,propiedad_id,asesor_id").eq("respond_contact_id",row.respond_contact_id)
      .order("updated_at",{ascending:false}).limit(1).maybeSingle();
    if(oppError)throw oppError;
    const advisorId=opp?.asesor_id||snapshot.mapped_profile_id;
    const clientResolution=row.social_routing_version===1
      ?await resolveSocialAppointmentClient(admin,row.respond_contact_id):null;
    const clienteId=clientResolution?clientResolution.clientId:await resolveClient(admin,{respondContactId:row.respond_contact_id,advisorId,opp});
    const propiedadId=await resolveProperty(admin,{respondContactId:row.respond_contact_id,opp});

    if(!clienteId||!propiedadId){
      const missing=!clienteId&&clientResolution?clientResolution.reason:!clienteId&&!propiedadId?"client_and_property_missing":!clienteId?"client_missing":"property_missing";
      await transition({
        status:"needs_confirmation",
        advisor_profile_id:advisorId,
        cliente_id:clienteId||null,
        propiedad_id:propiedadId||null,
        appointment_at:resolved.at,
        source_message_at:resolved.msg.at,
        source_message_excerpt:clean(resolved.msg.text,500),
        error_code:missing,
        updated_at:new Date().toISOString()
      });
      return{status:"needs_confirmation",reason:missing};
    }

    if(row.social_routing_version===1){
      const result=await admin.rpc("commit_social_appointment_v1",{p_sync_id:row.id,p_advisor_id:advisorId,p_client_id:clienteId,p_property_id:propiedadId,p_at:resolved.at,p_source_at:resolved.msg.at,p_excerpt:clean(resolved.msg.text,500)});
      if(result.error)throw result.error;
      return result.data;
    }
    const start=new Date(new Date(resolved.at).getTime()-30*60000).toISOString();
    const end=new Date(new Date(resolved.at).getTime()+30*60000).toISOString();
    let q=admin.from("citas").select("id").eq("asesor_id",advisorId).gte("fecha_hora",start).lte("fecha_hora",end);
    q=q.eq("cliente_id",clienteId).eq("propiedad_id",propiedadId);
    const {data:existing,error:existingError}=await q.limit(1).maybeSingle();
    if(existingError)throw existingError;

    let citaId=existing?.id||null;
    if(!citaId){
      const notes=clean("Cita creada automáticamente desde Respond.io. Contacto "+row.respond_contact_id+". Confirmación humana: "+resolved.msg.text,1000);
      const {data:cita,error:citaError}=await admin.from("citas").insert({
        cliente_id:clienteId,
        propiedad_id:propiedadId,
        asesor_id:advisorId,
        fecha_hora:resolved.at,
        estado:"agendada",
        notas:notes,
        confirmacion_estado:"confirmada",
        confirmacion_actualizada_at:new Date().toISOString(),
        confirmacion_actualizada_por:advisorId
      }).select("id").single();
      if(citaError)throw citaError;
      citaId=cita.id;
    }

    await admin.from("respond_appointment_sync").update({
      status:"created",advisor_profile_id:advisorId,cliente_id:clienteId,propiedad_id:propiedadId,
      appointment_at:resolved.at,cita_id:citaId,source_message_at:resolved.msg.at,
      source_message_excerpt:clean(resolved.msg.text,500),updated_at:new Date().toISOString()
    }).eq("id",row.id);
    return{status:existing?"already_exists":"created",citaId,appointmentAt:resolved.at};
  }catch(error){
    await transition({status:"failed",error_code:String(error?.message||"appointment_sync_failed").slice(0,160),updated_at:new Date().toISOString()});
    throw error;
  }
}
