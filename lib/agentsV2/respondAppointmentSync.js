import { readRespondMessages, respondMessageTimestamp } from "../ejecutivo/respondSync";

const clean=(v,max=500)=>String(v??"").replace(/\s+/g," ").trim().slice(0,max);
const normalize=(v)=>clean(v,120).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const MX_OFFSET="-06:00";

function messageText(m){
  return clean(m?.text??m?.message?.text??m?.body??m?.message?.body??"",1200);
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

export async function captureRespondAppointmentLifecycleIsolated(admin,body){
  try{
    const eventType=String(body?.event_type||body?.event||"").trim().toLowerCase().replace(/[\s-]+/g,"_");
    if(eventType!=="contact.lifecycle.updated")return{status:"skipped",reason:"not_lifecycle"};
    const contactId=clean(body?.contact?.id??body?.contactId,200);
    const eventId=clean(body?.event_id||body?.eventId,200);
    if(!contactId||!eventId)return{status:"skipped",reason:"missing_required"};
    const lifecycle=clean(body?.contact?.lifecycle?.name??body?.lifecycle?.name??body?.contact?.lifecycle?.id??body?.lifecycle?.id,120);
    const {error}=await admin.from("respond_appointment_sync").insert({event_id:eventId,respond_contact_id:contactId,lifecycle:lifecycle||"unknown",status:"pending"});
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

  try{
    const {data:snapshot,error:snapshotError}=await admin.from("gv_respond_contact_snapshots")
      .select("mapped_profile_id,mapping_status,respond_lifecycle")
      .eq("respond_contact_id",row.respond_contact_id).maybeSingle();
    if(snapshotError)throw snapshotError;
    const lifecycle=clean(snapshot?.respond_lifecycle||row.lifecycle,120);
    if(normalize(lifecycle)!=="visita agendada"){
      await admin.from("respond_appointment_sync").update({status:"skipped",error_code:"lifecycle_not_visit_scheduled",updated_at:new Date().toISOString()}).eq("id",row.id);
      return{status:"skipped"};
    }
    if(!snapshot?.mapped_profile_id){
      await admin.from("respond_appointment_sync").update({status:"needs_confirmation",error_code:"advisor_not_mapped",updated_at:new Date().toISOString()}).eq("id",row.id);
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
      await admin.from("respond_appointment_sync").update({status:"needs_confirmation",advisor_profile_id:snapshot.mapped_profile_id,error_code:"appointment_datetime_ambiguous",updated_at:new Date().toISOString()}).eq("id",row.id);
      return{status:"needs_confirmation"};
    }

    const {data:opp,error:oppError}=await admin.from("gv_opportunities")
      .select("cliente_id,propiedad_id,asesor_id").eq("respond_contact_id",row.respond_contact_id)
      .order("updated_at",{ascending:false}).limit(1).maybeSingle();
    if(oppError)throw oppError;
    const advisorId=opp?.asesor_id||snapshot.mapped_profile_id;

    const start=new Date(new Date(resolved.at).getTime()-30*60000).toISOString();
    const end=new Date(new Date(resolved.at).getTime()+30*60000).toISOString();
    let q=admin.from("citas").select("id").eq("asesor_id",advisorId).gte("fecha_hora",start).lte("fecha_hora",end);
    if(opp?.cliente_id)q=q.eq("cliente_id",opp.cliente_id);
    else if(opp?.propiedad_id)q=q.eq("propiedad_id",opp.propiedad_id);
    const {data:existing,error:existingError}=await q.limit(1).maybeSingle();
    if(existingError)throw existingError;

    let citaId=existing?.id||null;
    if(!citaId){
      const notes=clean("Cita creada automáticamente desde Respond.io. Contacto "+row.respond_contact_id+". Confirmación humana: "+resolved.msg.text,1000);
      const {data:cita,error:citaError}=await admin.from("citas").insert({
        cliente_id:opp?.cliente_id||null,
        propiedad_id:opp?.propiedad_id||null,
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
      status:"created",advisor_profile_id:advisorId,cliente_id:opp?.cliente_id||null,propiedad_id:opp?.propiedad_id||null,
      appointment_at:resolved.at,cita_id:citaId,source_message_at:resolved.msg.at,
      source_message_excerpt:clean(resolved.msg.text,500),updated_at:new Date().toISOString()
    }).eq("id",row.id);
    return{status:existing?"already_exists":"created",citaId,appointmentAt:resolved.at};
  }catch(error){
    await admin.from("respond_appointment_sync").update({status:"failed",error_code:String(error?.message||"appointment_sync_failed").slice(0,160),updated_at:new Date().toISOString()}).eq("id",row.id);
    throw error;
  }
}
