import {
  RESPOND_CUSTOM_FIELDS,
  assertDevSupabaseUrl,
  authHeaderToken,
  getAdminSupabase,
  getServerSupabase,
  resolveRespondProfile,
  toIsoFromRespondTimestamp,
} from "../../../lib/ejecutivo/workCenter";

const RESPOND_BASE = "https://api.respond.io/v2";
const MAX_CONTACTS = 30;
const MAX_MESSAGES_PER_CONTACT = 12;

function rejectInternal(res, err) {
  console.error("[respond-sync]", err?.message || err);
  return res.status(500).json({ ok: false, error: "No se pudo sincronizar metadata Respond.io en DEV." });
}

async function respondRequest(path, { method = "GET", body, params } = {}) {
  const token = process.env.RESPOND_IO_TOKEN;
  if (!token) throw new Error("Falta RESPOND_IO_TOKEN.");
  const url = new URL(`${RESPOND_BASE}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const err = new Error(`Respond.io ${response.status}`);
    err.public = { status: response.status, code: json?.code, message: json?.message };
    throw err;
  }
  return json;
}

const items = (body) => (Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : []);
const normalize = (value) => String(value || "").trim().toLowerCase();

function customValue(contact, slug) {
  const field = (contact.custom_fields || []).find((f) => normalize(f.slug || f.name || f.fieldId) === slug);
  const value = field?.value;
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function parseDateField(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function parseNumberField(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function messageTimestamp(message) {
  if (message?.messageId) return toIsoFromRespondTimestamp(message.messageId);
  const statusTs = Array.isArray(message?.status) ? message.status.map((s) => s.timestamp).filter(Boolean).sort((a, b) => a - b)[0] : null;
  return statusTs ? toIsoFromRespondTimestamp(statusTs) : null;
}

function messageSignals(messages) {
  let lastInbound = null;
  let lastOutbound = null;
  let lastHumanOutbound = null;
  let lastAiOutbound = null;

  for (const message of messages || []) {
    const ts = messageTimestamp(message);
    if (!ts) continue;
    if (message.traffic === "incoming") {
      if (!lastInbound || ts > lastInbound) lastInbound = ts;
      continue;
    }
    if (message.traffic === "outgoing") {
      if (!lastOutbound || ts > lastOutbound) lastOutbound = ts;
      if (message.sender?.source === "user") {
        if (!lastHumanOutbound || ts > lastHumanOutbound) lastHumanOutbound = ts;
      }
      if (message.sender?.source === "ai_agent" || message.sender?.source === "workflow") {
        if (!lastAiOutbound || ts > lastAiOutbound) lastAiOutbound = ts;
      }
    }
  }

  const unansweredSince = lastInbound && (!lastOutbound || lastInbound > lastOutbound) ? lastInbound : null;
  return { lastInbound, lastOutbound, lastHumanOutbound, lastAiOutbound, unansweredSince };
}

function snapshotFromContact(contact, messages, profiles) {
  const assignee = contact.assignee || null;
  const mapped = resolveRespondProfile(assignee, profiles);
  const channelId = messages?.[0]?.channelId || null;
  const signals = messageSignals(messages);
  const metadata = {
    mapping_method: mapped.method,
    sync_mode: "metadata_only",
    fields_present: Object.keys(contact || {}).filter((key) => !["phone", "email", "profilePic"].includes(key)),
  };
  return {
    respond_contact_id: String(contact.id),
    respond_assignee_id: assignee?.id ? String(assignee.id) : null,
    respond_assignee_email: assignee?.email || null,
    mapped_profile_id: mapped.profile?.id || null,
    mapping_status: mapped.status,
    respond_channel_id: channelId ? String(channelId) : null,
    respond_channel_source: null,
    respond_conversation_status: contact.status || null,
    respond_lifecycle: contact.lifecycle || null,
    respond_last_inbound_at: signals.lastInbound,
    respond_last_outbound_at: signals.lastOutbound,
    respond_last_human_outbound_at: signals.lastHumanOutbound,
    respond_last_ai_outbound_at: signals.lastAiOutbound,
    respond_unanswered_since: signals.unansweredSince,
    respond_last_synced_at: new Date().toISOString(),
    atn_area: customValue(contact, "atn_area"),
    atn_servicio: customValue(contact, "atn_servicio"),
    atn_estado: customValue(contact, "atn_estado"),
    atn_destino: customValue(contact, "atn_destino"),
    atn_proxima_accion: customValue(contact, "atn_proxima_accion"),
    atn_fecha_proxima_accion: parseDateField(customValue(contact, "atn_fecha_proxima_accion")),
    atn_sla_vencido: customValue(contact, "atn_sla_vencido") === true || customValue(contact, "atn_sla_vencido") === "true",
    ven_presupuesto_compra: parseNumberField(customValue(contact, "ven_presupuesto_compra")),
    ven_renta_mensual_objetivo: parseNumberField(customValue(contact, "ven_renta_mensual_objetivo")),
    ven_plazo: customValue(contact, "ven_plazo"),
    inm_tipo: customValue(contact, "inm_tipo"),
    inm_zona: customValue(contact, "inm_zona"),
    metadata,
    updated_at: new Date().toISOString(),
  };
}

async function syncRespond(admin, profiles, actorProfile) {
  const contactList = await respondRequest("/contact/list", {
    method: "POST",
    params: { limit: MAX_CONTACTS },
    body: {
      search: "",
      timezone: "America/Mexico_City",
      filter: { $and: [] },
    },
  });

  const contacts = items(contactList).slice(0, MAX_CONTACTS);
  const snapshots = [];
  for (const contact of contacts) {
    const messageList = await respondRequest(`/contact/id:${contact.id}/message/list`, {
      params: { limit: MAX_MESSAGES_PER_CONTACT },
    });
    const messages = items(messageList);
    snapshots.push(snapshotFromContact(contact, messages, profiles));
    await new Promise((resolve) => setTimeout(resolve, 180));
  }

  if (snapshots.length) {
    const { data: existingSnapshots, error: existingError } = await admin
      .from("gv_respond_contact_snapshots")
      .select("respond_contact_id, mapped_profile_id, mapping_status, metadata")
      .in("respond_contact_id", snapshots.map((snapshot) => snapshot.respond_contact_id));
    if (existingError?.code === "PGRST205" || /gv_respond_contact_snapshots/i.test(existingError?.message || "")) {
      const migrationError = new Error("RESPOND_SNAPSHOTS_MIGRATION_REQUIRED");
      migrationError.statusCode = 424;
      throw migrationError;
    }
    if (existingError) throw existingError;

    const existingByContact = new Map((existingSnapshots || []).map((snapshot) => [snapshot.respond_contact_id, snapshot]));
    snapshots.forEach((snapshot) => {
      const existing = existingByContact.get(snapshot.respond_contact_id);
      if (!snapshot.mapped_profile_id && existing?.mapped_profile_id) {
        snapshot.mapped_profile_id = existing.mapped_profile_id;
        snapshot.mapping_status = existing.mapping_status || "matched";
        snapshot.metadata = {
          ...snapshot.metadata,
          preserved_dev_mapping: true,
          previous_mapping_method: existing.metadata?.mapping_method || null,
        };
      }
    });
  }

  if (snapshots.length) {
    const { error } = await admin
      .from("gv_respond_contact_snapshots")
      .upsert(snapshots, { onConflict: "respond_contact_id" });
    if (error?.code === "PGRST205" || /gv_respond_contact_snapshots/i.test(error?.message || "")) {
      const migrationError = new Error("RESPOND_SNAPSHOTS_MIGRATION_REQUIRED");
      migrationError.statusCode = 424;
      throw migrationError;
    }
    if (error) throw error;
  }

  const linkedContacts = snapshots.map((s) => s.respond_contact_id);
  if (linkedContacts.length) {
    const { data: linkedOpps, error: oppError } = await admin
      .from("gv_opportunities")
      .select("id, respond_contact_id, asesor_id")
      .in("respond_contact_id", linkedContacts);
    if (oppError) throw oppError;

    for (const opp of linkedOpps || []) {
      const snap = snapshots.find((s) => s.respond_contact_id === opp.respond_contact_id);
      if (!snap) continue;
      const update = {
        respond_assignee_id: snap.respond_assignee_id,
        respond_assignee_email: snap.respond_assignee_email,
        respond_channel_id: snap.respond_channel_id,
        respond_channel_source: snap.respond_channel_source,
        respond_conversation_status: snap.respond_conversation_status,
        respond_lifecycle: snap.respond_lifecycle,
        respond_last_inbound_at: snap.respond_last_inbound_at,
        respond_last_outbound_at: snap.respond_last_outbound_at,
        respond_last_human_outbound_at: snap.respond_last_human_outbound_at,
        respond_last_ai_outbound_at: snap.respond_last_ai_outbound_at,
        respond_unanswered_since: snap.respond_unanswered_since,
        respond_last_synced_at: snap.respond_last_synced_at,
        last_synced_at: snap.respond_last_synced_at,
        last_activity_at: snap.respond_last_outbound_at || snap.respond_last_inbound_at || undefined,
        updated_by: actorProfile.id,
        updated_at: new Date().toISOString(),
      };
      const { error: updateError } = await admin.from("gv_opportunities").update(update).eq("id", opp.id);
      if (updateError) throw updateError;
      await admin.from("gv_opportunity_events").insert({
        opportunity_id: opp.id,
        event_type: "external_sync",
        actor_profile_id: actorProfile.id,
        acted_as_profile_id: opp.asesor_id === actorProfile.id ? null : opp.asesor_id,
        is_management_intervention: opp.asesor_id !== actorProfile.id,
        event_source: "respond_io_sync",
        metadata: { sync_mode: "metadata_only", respond_contact_id: snap.respond_contact_id },
        notes: "Sincronizacion metadata-only desde Respond.io Growth Developer API.",
      });
    }
  }

  return {
    contactsRead: contacts.length,
    snapshotsUpserted: snapshots.length,
    matchedProfiles: snapshots.filter((s) => s.mapped_profile_id).length,
    unmatchedProfiles: snapshots.filter((s) => !s.mapped_profile_id).length,
    linkedOpportunitiesUpdated: linkedContacts.length,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    assertDevSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const jwt = authHeaderToken(req);
    if (!jwt) return res.status(401).json({ ok: false, error: "Sesion requerida." });

    const scoped = getServerSupabase(jwt);
    const admin = getAdminSupabase();

    const { data: { user }, error: userError } = await scoped.auth.getUser();
    if (userError || !user) return res.status(401).json({ ok: false, error: "Sesion invalida." });

    const { data: actorProfile, error: profileError } = await admin
      .from("profiles")
      .select("id, email, full_name, role_id, active")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!actorProfile?.active) return res.status(403).json({ ok: false, error: "Perfil no autorizado." });
    if (!["admin", "gerente_ventas", "asesor"].includes(actorProfile.role_id)) {
      return res.status(403).json({ ok: false, error: "Respond.io sync no autorizado para este rol." });
    }

    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id, email, full_name, role_id, active")
      .eq("active", true);
    if (profilesError) throw profilesError;

    const result = await syncRespond(admin, profiles || [], actorProfile);
    return res.status(200).json({ ok: true, dev: true, result });
  } catch (err) {
    if (err.statusCode === 424) {
      return res.status(424).json({
        ok: false,
        error: "Falta ejecutar la migracion DEV de snapshots Respond.io.",
        migration: "supabase/migrations/202608080004_fase_2a_respond_work_center.sql",
      });
    }
    if (err.public) return res.status(502).json({ ok: false, error: "Respond.io rechazo la lectura.", detail: err.public });
    return rejectInternal(res, err);
  }
}
