import {
  MANAGEMENT_ROLES,
  authHeaderToken,
  getAdminSupabase,
  getServerSupabase,
} from "../../../lib/ejecutivo/workCenter";

const clean=(v,max=160)=>String(v??"").replace(/\s+/g," ").trim().slice(0,max);
const mxDate=(iso)=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(iso));

async function auth(req){
  const jwt=authHeaderToken(req);
  if(!jwt)return null;
  const scoped=getServerSupabase(jwt);
  const admin=getAdminSupabase();
  const {data:{user}}=await scoped.auth.getUser();
  if(!user)return null;
  const {data:profile}=await admin.from("profiles").select("id,role_id,active").eq("id",user.id).maybeSingle();
  if(!profile?.active)return null;
  return{admin,profile};
}

async function syncKpi(admin,advisorId,appointmentAt){
  const date=mxDate(appointmentAt);
  const start=date+"T00:00:00-06:00";
  const end=new Date(new Date(start).getTime()+24*60*60*1000).toISOString();
  const [{data:profile,error:profileError},{data:citas,error:citasError}]=await Promise.all([
    admin.from("profiles").select("email,full_name").eq("id",advisorId).maybeSingle(),
    admin.from("citas").select("estado,fecha_hora").eq("asesor_id",advisorId).gte("fecha_hora",start).lt("fecha_hora",end)
  ]);
  if(profileError)throw profileError;if(citasError)throw citasError;
  if(!profile?.email)return;
  const same=(citas||[]).filter(c=>mxDate(c.fecha_hora)===date);
  const values={
    citas_agendadas:same.length,
    citas_efectivas:same.filter(c=>["efectiva","calificada"].includes(c.estado)).length,
    citas_calificadas:same.filter(c=>c.estado==="calificada").length,
  };
  const {data:existing,error:existingError}=await admin.from("kpis_diarios").select("id").eq("email",profile.email).eq("fecha",date).maybeSingle();
  if(existingError)throw existingError;
  if(existing){
    const {error}=await admin.from("kpis_diarios").update(values).eq("id",existing.id);if(error)throw error;
  }else{
    const {error}=await admin.from("kpis_diarios").insert({...values,fecha:date,asesor:profile.full_name||profile.email,email:profile.email});if(error)throw error;
  }
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  const ctx=await auth(req);
  if(!ctx)return res.status(401).json({ok:false,error:"not_authorized"});
  const {admin,profile}=ctx;
  const canManage=MANAGEMENT_ROLES.has(profile.role_id);

  try{
    if(req.method==="GET"){
      let q=admin.from("respond_appointment_sync")
        .select("id,respond_contact_id,status,advisor_profile_id,cliente_id,propiedad_id,appointment_at,error_code,source_message_excerpt,created_at,clientes:cliente_id(nombre),profiles:advisor_profile_id(full_name)")
        .eq("status","needs_confirmation")
        .not("appointment_at","is",null)
        .order("created_at",{ascending:false})
        .limit(50);
      if(!canManage)q=q.eq("advisor_profile_id",profile.id);
      const {data,error}=await q;if(error)throw error;
      return res.status(200).json({ok:true,pending:(data||[]).map(r=>({
        id:r.id,
        respondContactId:r.respond_contact_id,
        advisorProfileId:r.advisor_profile_id,
        advisorName:r.profiles?.full_name||null,
        clienteId:r.cliente_id,
        clienteName:r.clientes?.nombre||null,
        appointmentAt:r.appointment_at,
        reason:r.error_code,
        context:clean(r.source_message_excerpt,280),
      }))});
    }

    if(req.method!=="POST")return res.status(405).json({ok:false,error:"method_not_allowed"});
    const syncId=clean(req.body?.syncId,80);
    const propertyId=clean(req.body?.propertyId,80);
    if(!/^[0-9a-f-]{36}$/i.test(syncId)||!/^[0-9a-f-]{36}$/i.test(propertyId))return res.status(400).json({ok:false,error:"invalid_ids"});

    const {data:row,error:rowError}=await admin.from("respond_appointment_sync")
      .select("id,status,advisor_profile_id,cliente_id,appointment_at,respond_contact_id,source_message_excerpt")
      .eq("id",syncId).eq("status","needs_confirmation").maybeSingle();
    if(rowError)throw rowError;
    if(!row)return res.status(409).json({ok:false,error:"appointment_not_pending"});
    if(!canManage&&row.advisor_profile_id!==profile.id)return res.status(403).json({ok:false,error:"not_authorized"});
    if(!row.advisor_profile_id||!row.cliente_id||!row.appointment_at)return res.status(409).json({ok:false,error:"appointment_missing_required_data"});

    const {data:property,error:propertyError}=await admin.from("propiedades").select("id,titulo,status").eq("id",propertyId).maybeSingle();
    if(propertyError)throw propertyError;
    if(!property||!["published","reserved"].includes(property.status))return res.status(409).json({ok:false,error:"property_not_eligible"});

    const start=new Date(new Date(row.appointment_at).getTime()-30*60000).toISOString();
    const end=new Date(new Date(row.appointment_at).getTime()+30*60000).toISOString();
    const {data:existing,error:existingError}=await admin.from("citas").select("id")
      .eq("asesor_id",row.advisor_profile_id).eq("cliente_id",row.cliente_id).eq("propiedad_id",propertyId)
      .gte("fecha_hora",start).lte("fecha_hora",end).limit(1).maybeSingle();
    if(existingError)throw existingError;

    let citaId=existing?.id||null;
    if(!citaId){
      const {data:cita,error:citaError}=await admin.from("citas").insert({
        cliente_id:row.cliente_id,
        propiedad_id:propertyId,
        asesor_id:row.advisor_profile_id,
        fecha_hora:row.appointment_at,
        estado:"agendada",
        notas:"Cita confirmada desde pendiente de Respond.io. "+clean(row.source_message_excerpt,500),
        confirmacion_estado:"confirmada",
        confirmacion_actualizada_at:new Date().toISOString(),
        confirmacion_actualizada_por:profile.id
      }).select("id").single();
      if(citaError)throw citaError;
      citaId=cita.id;
    }

    const now=new Date().toISOString();
    const {error:updateError}=await admin.from("respond_appointment_sync").update({
      status:"created",propiedad_id:propertyId,cita_id:citaId,error_code:null,updated_at:now
    }).eq("id",row.id).eq("status","needs_confirmation");
    if(updateError)throw updateError;

    await syncKpi(admin,row.advisor_profile_id,row.appointment_at);
    return res.status(200).json({ok:true,status:existing?"already_exists":"created",citaId,property:{id:property.id,title:property.titulo}});
  }catch(error){
    console.error("[respond-appointment-pending]",String(error?.message||"appointment_pending_failed").slice(0,160));
    return res.status(500).json({ok:false,error:"appointment_pending_failed"});
  }
}
