const RX={
  human:/\b(asesor|persona|humano|agente|alguien que me atienda|que me llamen|llámame|llamame)\b/i,
  appointment:/\b(cita|visita|verlo|verla|conocerlo|conocerla|mostrar|enseñar|ensenar|hoy|mañana|manana|qué horario|que horario|a qué hora|a que hora)\b/i,
  reservation:/\b(apartar|apartado|reservar|reserva|separar|depositar)\b/i,
  negotiation:/\b(negociar|negociación|negociacion|descuento|rebaja|oferta|contraoferta|menos|último precio|ultimo precio)\b/i,
  financing:/\b(crédito|credito|hipoteca|infonavit|fovissste|banco|financiamiento)\b/i,
  strong:/\b(muy interesad|demasiado interesad|me interesa mucho|lo quiero|la quiero|ese me interesa|esa me interesa)\b/i,
  property:/\b(casa|departamento|depa|local|oficina|bodega|terreno|inmueble|propiedad)\b/i,
};

const clean=(v,max=1200)=>String(v??"").replace(/\s+/g," ").trim().slice(0,max);

export function classifySalesHandoff(text){
  const value=clean(text,2000);
  if(!value)return null;
  if(RX.human.test(value))return{reason:"human_requested",priority:"urgent"};
  if(RX.reservation.test(value))return{reason:"reservation_intent",priority:"urgent"};
  if(RX.negotiation.test(value))return{reason:"negotiation_intent",priority:"high"};
  if(RX.financing.test(value))return{reason:"financing_intent",priority:"high"};
  if(RX.appointment.test(value))return{reason:"appointment_intent",priority:"urgent"};
  if(RX.strong.test(value)&&RX.property.test(value))return{reason:"specific_property_high_interest",priority:"high"};
  return null;
}

function qualificationSummary(snapshot){
  const bits=[];
  if(snapshot?.atn_servicio)bits.push("Servicio: "+clean(snapshot.atn_servicio,80));
  if(snapshot?.inm_zona)bits.push("Zona: "+clean(snapshot.inm_zona,120));
  if(snapshot?.inm_tipo)bits.push("Tipo: "+clean(snapshot.inm_tipo,80));
  if(snapshot?.ven_renta_mensual_objetivo)bits.push("Renta objetivo: $"+Number(snapshot.ven_renta_mensual_objetivo).toLocaleString("es-MX"));
  if(snapshot?.ven_presupuesto_compra)bits.push("Presupuesto compra: $"+Number(snapshot.ven_presupuesto_compra).toLocaleString("es-MX"));
  if(snapshot?.ven_plazo)bits.push("Plazo: "+clean(snapshot.ven_plazo,80));
  return bits.join(" · ");
}

export async function createSalesHandoffIfNeeded(admin,{inbound,run=null}){
  const decision=classifySalesHandoff(inbound?.sanitized_text);
  if(!decision)return{created:false,reason:"not_high_intent"};

  const {data:existing,error:existingError}=await admin.from("sales_agent_v2_handoffs")
    .select("id,status").eq("inbound_message_id",inbound.id).maybeSingle();
  if(existingError)throw existingError;
  if(existing)return{created:false,reason:"already_exists",handoffId:existing.id};

  const {data:snapshot,error:snapshotError}=await admin.from("gv_respond_contact_snapshots")
    .select("atn_servicio,inm_zona,inm_tipo,ven_renta_mensual_objetivo,ven_presupuesto_compra,ven_plazo,mapped_profile_id")
    .eq("respond_contact_id",inbound.respond_contact_id).maybeSingle();
  if(snapshotError)throw snapshotError;

  const summaryParts=[
    "Interés alto detectado: "+decision.reason.replaceAll("_"," ")+".",
    qualificationSummary(snapshot),
    "Último mensaje: “"+clean(inbound.sanitized_text,500)+"”"
  ].filter(Boolean);
  const summary=clean(summaryParts.join(" "),1200);

  const {data,error}=await admin.from("sales_agent_v2_handoffs").insert({
    respond_contact_id:inbound.respond_contact_id,
    channel_id:inbound.channel_id,
    inbound_message_id:inbound.id,
    shadow_run_id:run?.id||null,
    status:"ready_for_advisor",
    reason:decision.reason,
    priority:decision.priority,
    summary
  }).select("id").single();
  if(error)throw error;
  return{created:true,handoffId:data.id,reason:decision.reason,priority:decision.priority};
}

export async function processPendingSalesHandoffs(admin){
  const {data:rows,error}=await admin.from("sales_agent_v2_inbound_messages")
    .select("id,respond_contact_id,channel_id,sanitized_text,status,occurred_at")
    .in("status",["captured","processed"])
    .order("occurred_at",{ascending:false})
    .limit(100);
  if(error)throw error;

  let created=0;
  for(const inbound of rows||[]){
    const decision=classifySalesHandoff(inbound.sanitized_text);
    if(!decision)continue;
    const {data:run}=await admin.from("sales_agent_v2_shadow_runs").select("id").eq("inbound_message_id",inbound.id).maybeSingle();
    const result=await createSalesHandoffIfNeeded(admin,{inbound,run});
    if(result.created)created+=1;
  }
  return{created};
}
