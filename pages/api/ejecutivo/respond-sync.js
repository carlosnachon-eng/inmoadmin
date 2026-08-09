import {
  RESPOND_CUSTOM_FIELDS,
  assertFase2AEnabled,
  assertSupabaseEnvironment,
  authHeaderToken,
  getAdminSupabase,
  getServerSupabase,
  resolveRespondProfile,
  toIsoFromRespondTimestamp,
} from "../../../lib/ejecutivo/workCenter";

const RESPOND_BASE = "https://api.respond.io/v2";
const CONTACT_PAGE_LIMIT = 100;
const MESSAGE_PAGE_LIMIT = 100;
const MAX_CONTACT_PAGES = 10;
const MAX_MESSAGE_PAGES_PER_CONTACT = 3;
const RESPOND_MIN_INTERVAL_MS = 250;
const MAX_LIMIT_CONTACTS = 100;

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

export function parseSyncOptions(body = {}) {
  let parsed;
  try {
    parsed = typeof body === "string" && body ? JSON.parse(body) : (body || {});
  } catch {
    throw badRequest("Body JSON invalido.");
  }
  if (parsed.dryRun !== undefined && typeof parsed.dryRun !== "boolean") {
    throw badRequest("dryRun debe ser booleano.");
  }

  let limitContacts = null;
  if (parsed.limitContacts !== undefined && parsed.limitContacts !== null) {
    if (!Number.isInteger(parsed.limitContacts)) throw badRequest("limitContacts debe ser un entero.");
    if (parsed.limitContacts < 1) throw badRequest("limitContacts debe ser mayor o igual a 1.");
    if (parsed.limitContacts > MAX_LIMIT_CONTACTS) throw badRequest(`limitContacts no puede ser mayor a ${MAX_LIMIT_CONTACTS}.`);
    limitContacts = parsed.limitContacts;
  }

  return {
    dryRun: parsed.dryRun === true,
    limitContacts,
  };
}

function rejectInternal(res, err) {
  console.error("[respond-sync]", err?.message || err);
  return res.status(500).json({ ok: false, error: "No se pudo sincronizar metadata Respond.io." });
}

const syncLocks = globalThis.__fase2aRespondSyncLocks || new Map();
globalThis.__fase2aRespondSyncLocks = syncLocks;
let lastRespondRequestAt = 0;

async function respondRequest(path, { method = "GET", body, params } = {}) {
  const token = process.env.RESPOND_IO_TOKEN || process.env.RESPOND_IO_API_TOKEN;
  if (!token) throw new Error("Falta RESPOND_IO_TOKEN.");
  const now = Date.now();
  const wait = Math.max(0, RESPOND_MIN_INTERVAL_MS - (now - lastRespondRequestAt));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRespondRequestAt = Date.now();

  const url = new URL(String(path).startsWith("http") ? path : `${RESPOND_BASE}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  for (let attempt = 0; attempt < 4; attempt += 1) {
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
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("Retry-After") || 1);
      await new Promise((resolve) => setTimeout(resolve, Math.max(1000, retryAfter * 1000)));
      continue;
    }
    if (!response.ok) {
      const err = new Error(`Respond.io ${response.status}`);
      err.public = { status: response.status, code: json?.code, message: json?.message };
      throw err;
    }
    return json;
  }
  throw new Error("Respond.io rate limit retry agotado.");
}

const items = (body) => (Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : []);
const normalize = (value) => String(value || "").trim().toLowerCase();
const paginationNext = (body) => body?.pagination?.next || null;

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

function contactDisplayName(contact) {
  const pieces = [
    contact?.firstName,
    contact?.lastName,
  ].filter(Boolean);
  return contact?.name || contact?.fullName || (pieces.length ? pieces.join(" ") : null);
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

function isSnapshotRelevantForSales(snapshot, profilesById) {
  const mapped = snapshot.mapped_profile_id ? profilesById.get(snapshot.mapped_profile_id) : null;
  if (mapped?.role_id === "asesor" || mapped?.role_id === "gerente_ventas") return true;
  return !snapshot.mapped_profile_id && normalize(snapshot.atn_area) === "ventas";
}

function snapshotFromContact(contact, messages, profiles, messagePagesRead) {
  const assignee = contact.assignee || null;
  const mapped = resolveRespondProfile(assignee, profiles);
  const channelId = messages?.[0]?.channelId || null;
  const signals = messageSignals(messages);
  const metadata = {
    contact_name: contactDisplayName(contact),
    mapping_method: mapped.method,
    sync_mode: "metadata_only",
    message_pages_read: messagePagesRead,
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

async function syncRespond(admin, profiles, options = {}) {
  const dryRun = options.dryRun === true;
  const limitContacts = options.limitContacts || null;
  const profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const coverage = {
    contactsAvailable: null,
    contactsScanned: 0,
    pagesRead: 0,
    contactsMatched: 0,
    contactsUnassignedSales: 0,
    contactsIgnoredOutsideSales: 0,
    coverageComplete: false,
    stoppedReason: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    requestedLimit: limitContacts,
    processedContacts: 0,
    messagePagesRead: 0,
    messageRequests: 0,
  };
  const contacts = [];
  let nextPath = "/contact/list";
  let contactPage = 0;
  let lastContactNextPath = null;
  while (nextPath && contactPage < MAX_CONTACT_PAGES && (!limitContacts || contacts.length < limitContacts)) {
    const remaining = limitContacts ? limitContacts - contacts.length : CONTACT_PAGE_LIMIT;
    const requestedPageLimit = Math.min(CONTACT_PAGE_LIMIT, remaining);
    const contactList = await respondRequest(nextPath, {
      method: "POST",
      params: nextPath === "/contact/list" ? { limit: requestedPageLimit } : undefined,
      body: nextPath === "/contact/list" ? {
        search: "",
        timezone: "America/Mexico_City",
        filter: { $and: [] },
      } : undefined,
    });
    const pageItems = items(contactList);
    contacts.push(...(limitContacts ? pageItems.slice(0, limitContacts - contacts.length) : pageItems));
    coverage.pagesRead += 1;
    coverage.contactsAvailable = contactList.total ?? contactList.count ?? contactList.pagination?.total ?? coverage.contactsAvailable;
    lastContactNextPath = paginationNext(contactList);
    nextPath = limitContacts && contacts.length >= limitContacts ? null : lastContactNextPath;
    contactPage += 1;
  }
  coverage.contactsScanned = contacts.length;
  coverage.processedContacts = contacts.length;
  coverage.coverageComplete = !lastContactNextPath;
  coverage.stoppedReason = lastContactNextPath && limitContacts && contacts.length >= limitContacts
    ? "limit_contacts"
    : lastContactNextPath
      ? "max_contact_pages"
      : "complete";

  const snapshots = [];
  for (const contact of contacts) {
    const messages = [];
    let messageNextPath = `/contact/id:${contact.id}/message/list`;
    let messagePage = 0;
    while (messageNextPath && messagePage < MAX_MESSAGE_PAGES_PER_CONTACT) {
      const messageList = await respondRequest(messageNextPath, {
        params: messageNextPath.includes("?") ? undefined : { limit: MESSAGE_PAGE_LIMIT },
      });
      messages.push(...items(messageList));
      messageNextPath = paginationNext(messageList);
      messagePage += 1;
      coverage.messagePagesRead += 1;
      coverage.messageRequests += 1;
      const signals = messageSignals(messages);
      if (signals.lastInbound && signals.lastOutbound && messages.length >= MESSAGE_PAGE_LIMIT) break;
    }
    const snapshot = snapshotFromContact(contact, messages, profiles, messagePage);
    if (isSnapshotRelevantForSales(snapshot, profilesById)) snapshots.push(snapshot);
    else coverage.contactsIgnoredOutsideSales += 1;
  }
  coverage.contactsMatched = snapshots.filter((s) => s.mapped_profile_id).length;
  coverage.contactsUnassignedSales = snapshots.filter((s) => !s.mapped_profile_id && normalize(s.atn_area) === "ventas").length;

  let snapshotsCreated = 0;
  let snapshotsUpdated = 0;
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
      if (existing) snapshotsUpdated += 1;
      else snapshotsCreated += 1;
      if (!snapshot.mapped_profile_id && existing?.mapped_profile_id) {
        snapshot.mapped_profile_id = existing.mapped_profile_id;
        snapshot.mapping_status = existing.mapping_status || "matched";
        snapshot.metadata = { ...snapshot.metadata, preserved_mapping: true };
      }
    });
  }

  if (snapshots.length && !dryRun) {
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

  const finishedAt = new Date().toISOString();
  const durationMs = new Date(finishedAt).getTime() - new Date(coverage.startedAt).getTime();
  return {
    dryRun,
    requestedLimit: limitContacts,
    processedContacts: contacts.length,
    contactsRead: contacts.length,
    snapshotsUpserted: dryRun ? 0 : snapshots.length,
    snapshotsWouldUpsert: snapshots.length,
    snapshotsWouldCreate: snapshotsCreated,
    snapshotsWouldUpdate: snapshotsUpdated,
    matchedProfiles: snapshots.filter((s) => s.mapped_profile_id).length,
    unmatchedProfiles: snapshots.filter((s) => !s.mapped_profile_id).length,
    linkedOpportunitiesUpdated: 0,
    coverage: {
      ...coverage,
      finishedAt,
      durationMs,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    const env = assertSupabaseEnvironment();
    assertFase2AEnabled();
    const lockKey = `${env.projectRef}:respond-sync`;
    if (syncLocks.get(lockKey)) {
      return res.status(409).json({ ok: false, error: "Ya hay una sincronización en curso." });
    }
    syncLocks.set(lockKey, Date.now());
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
    if (!["admin", "gerente_ventas"].includes(actorProfile.role_id)) {
      return res.status(403).json({ ok: false, error: "Respond.io sync no autorizado para este rol." });
    }

    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id, email, full_name, role_id, active")
      .eq("active", true);
    if (profilesError) throw profilesError;

    const options = parseSyncOptions(req.body);
    const result = await syncRespond(admin, profiles || [], options);
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ ok: false, error: err.message });
    if (err.statusCode === 404) return res.status(404).json({ ok: false, error: "Modulo no habilitado." });
    if (err.statusCode === 424) {
      return res.status(424).json({
        ok: false,
        error: "Falta ejecutar la migracion de snapshots Respond.io.",
        migration: "supabase/migrations/202608080007_fase_2a_production_hardening.sql",
      });
    }
    if (err.public) return res.status(502).json({ ok: false, error: "Respond.io rechazo la lectura.", detail: err.public });
    return rejectInternal(res, err);
  } finally {
    try {
      const ref = assertSupabaseEnvironment().projectRef;
      syncLocks.delete(`${ref}:respond-sync`);
    } catch {}
  }
}
