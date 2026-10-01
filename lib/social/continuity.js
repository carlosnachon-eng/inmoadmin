// Server-side context only. No new contact, lead, scheduler or assignment authority.
const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export const CONTINUITY_DESTINATIONS = ["SALES", "OWNER", "LEGAL", "ADMINISTRATION", "EXISTING_CLIENT", "UNKNOWN"];

export async function readSocialContinuity(db, contactId, channelId, at) {
  const previous = await db.from("social_message_routes").select("id,destination,reason,occurred_at")
    .eq("respond_contact_id", contactId).eq("source_channel_id", String(channelId))
    .in("destination", CONTINUITY_DESTINATIONS).lte("occurred_at", at)
    .order("occurred_at", { ascending: false }).limit(1).maybeSingle();
  if (previous.error) throw previous.error;
  if (previous.data) return { previous: previous.data, owner: previous.data.destination === "OWNER" };
  // Bootstrap from the existing Owner lane, not a name match or a rolling time window.
  // Once a social transition/closure exists it takes precedence over this legacy evidence.
  const legacy = await db.from("owner_agent_v1_inbound_messages").select("id")
    .eq("respond_contact_id", contactId).eq("channel_id", String(channelId)).lte("occurred_at", at)
    .order("occurred_at", { ascending: false }).limit(1).maybeSingle();
  if (legacy.error) throw legacy.error;
  if(legacy.data)return { previous: null, owner: true };
  const snapshot=await db.from("gv_respond_contact_snapshots").select("atn_area,atn_servicio,atn_estado,respond_channel_id")
    .eq("respond_contact_id",contactId).maybeSingle();
  if(snapshot.error)throw snapshot.error;
  const s=snapshot.data;
  const explicitOwner=s&&String(s.respond_channel_id)===String(channelId)
    && [s.atn_area,s.atn_servicio].some(value=>["owner","propietarios","captacion"].includes(normalize(value).trim()))
    && !["cerrado","resuelto","cancelado"].includes(normalize(s.atn_estado).trim());
  return { previous: null, owner: Boolean(explicitOwner) };
}

// Narrow explicit transitions. A mention of casa/cita/dirección is NOT an intent change.
export function ownerTransition(text) {
  const t = normalize(text);
  if (/\b(cerrar|cancelar|terminar) (?:la |mi )?captacion\b|\bya no quiero (?:vender|rentar|publicar) mi\b/.test(t))
    return { destination: "UNKNOWN", reason: "owner_explicit_closure" };
  if (/\b(?:ahora busco|ahora quiero comprar|quiero comprar|quiero rentar (?:una|un|otra|otro))\b/.test(t))
    return { destination: "SALES", reason: "explicit_intent_change" };
  if (/\b(?:necesito|quiero contratar|solicito) (?:una |el |la )?(?:poliza|blindaje)\b/.test(t))
    return { destination: "LEGAL", reason: "explicit_intent_change" };
  if (/\b(?:quiero hablar con|solicito ayuda de) administracion\b/.test(t))
    return { destination: "ADMINISTRATION", reason: "explicit_intent_change" };
  return null;
}

export async function socialAssignmentBarrier(db, inbound, { env = process.env } = {}) {
  if (!inbound?.social_route_id && env.SOCIAL_ROUTING_V1_ENABLED !== "true") return null;
  if (!["497382", "497385", "498219", "515318"].includes(String(inbound.channel_id))) return null;
  const continuity = await readSocialContinuity(db, inbound.respond_contact_id, inbound.channel_id, new Date().toISOString());
  if (continuity.owner) return "owner_continuity_no_sales_handoff";
  const snapshot = await db.from("gv_respond_contact_snapshots")
    .select("respond_assignee_id,mapped_profile_id,mapping_status,metadata,respond_record_active")
    .eq("respond_contact_id", inbound.respond_contact_id).maybeSingle();
  if (snapshot.error) throw snapshot.error;
  const s = snapshot.data;
  // Even an unmapped current assignee is not permission to replace a person.
  if (s?.respond_assignee_id || s?.mapped_profile_id) return "existing_responsible_preserved";
  const assignedCase=await db.from("gv_opportunities").select("asesor_id")
    .eq("respond_contact_id",inbound.respond_contact_id).not("asesor_id","is",null).limit(1);
  if(assignedCase.error)throw assignedCase.error;
  if(assignedCase.data?.length)return "existing_responsible_preserved";
  if (!s || s.respond_record_active !== true || s.metadata?.mapping_method !== "current_assignee_unassigned")
    return "assignment_state_requires_review";
  return null;
}

const parts = iso => Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).formatToParts(new Date(iso)).map(p => [p.type, p.value]));
export function absoluteAppointmentLabel(iso) {
  const p = parts(iso);
  return `${p.day}/${p.month}/${p.year} a las ${p.hour}:${p.minute} (America/Mexico_City)`;
}
export function anchorHistoricalText(text, occurredAt) {
  if (!Number.isFinite(new Date(occurredAt).getTime())) return "[contexto sin fecha verificable omitido]";
  const p = parts(occurredAt);
  return String(text || "").replace(/\b(hoy|mañana|manana|ayer)\b/gi, word => {
    const offset = { hoy: 0, manana: 1, ayer: -1 }[normalize(word)];
    const date = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + offset, 12));
    return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
  });
}

export async function readSocialAppointment(db, contactId) {
  const sync = await db.from("respond_appointment_sync").select("cita_id")
    .eq("respond_contact_id", contactId).eq("status", "created").not("cita_id", "is", null)
    .order("created_at", { ascending: false }).limit(50);
  if (sync.error) throw sync.error;
  if (sync.data?.length === 50) return { status: "ambiguous", appointment: null };
  const ids = [...new Set((sync.data || []).map(row => row.cita_id))];
  if (!ids.length) return { status: "missing", appointment: null };
  const citas = await db.from("citas").select("id,fecha_hora,estado,confirmacion_estado,asesor_id")
    .in("id", ids).eq("estado", "agendada").eq("confirmacion_estado", "confirmada");
  if (citas.error) throw citas.error;
  if (citas.data?.length !== 1) return { status: citas.data?.length ? "ambiguous" : "missing", appointment: null };
  const appointment = citas.data[0];
  if (!Number.isFinite(new Date(appointment.fecha_hora).getTime())) return { status: "invalid", appointment: null };
  return { status: "confirmed", appointment };
}

export function ownerContinuityResponse(text, appointment) {
  // Acknowledgement of received context, never a new booking, promise, or assignment.
  const t = normalize(text);
  const detail = /\b(direccion|ubicacion|fotos?|adjunto|colonia|col\.?|calle|avenida|caracteristicas|perfecto|gracias)\b/.test(t);
  if (!detail || /[?¿]|\b(cambiar|cancelar|reagendar|puedes|podemos)\b/.test(t)) return null;
  return "Gracias, recibí la información para la captación." + (appointment
    ? ` La visita registrada es el ${absoluteAppointmentLabel(appointment.fecha_hora)}.` : "");
}

export function assertNoUngroundedAppointment(text) {
  // Social output cannot recycle historical relative dates or invent appointment times.
  if (/\b(hoy|mañana|manana|ayer|cita|visita)\b|\bnos vemos\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}[/-]\d{1,2}\b|\ba las? \d|\b(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/i.test(String(text || "")))
    throw new Error("social_appointment_output_requires_review");
}
