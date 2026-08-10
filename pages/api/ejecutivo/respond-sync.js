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
const MESSAGE_PAGE_LIMIT = 100;
const MAX_MESSAGE_PAGES_PER_CONTACT = 3;
const RESPOND_MIN_INTERVAL_MS = 250;
const RESPOND_REQUEST_TIMEOUT_MS = 30_000;
const FINAL_SYNC_BATCH_SIZE = 50;
const RESPOND_SYNC_STALE_MS = 15 * 60 * 1000;
const RESPOND_SYNC_ACTIONS = new Set(["start", "continue", "resume", "status"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (parsed.dryRun !== undefined || parsed.limitContacts !== undefined) {
    throw badRequest("dryRun y limitContacts ya no forman parte del flujo publico de Produccion.");
  }
  if (!RESPOND_SYNC_ACTIONS.has(parsed.action)) {
    throw badRequest("action invalida.");
  }
  if (["continue", "resume", "status"].includes(parsed.action) && !UUID_RE.test(String(parsed.runId || ""))) {
    throw badRequest("runId invalido.");
  }
  return {
    action: parsed.action,
    runId: parsed.runId || null,
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RESPOND_REQUEST_TIMEOUT_MS);
    let response;
    let text;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (err) {
      if (err?.name === "AbortError") {
        const timeoutError = new Error("Respond.io request timeout.");
        timeoutError.public = { status: 504, code: "respond_timeout", message: "Respond.io request timeout." };
        throw timeoutError;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
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
  const normalizedArea = normalize(snapshot.atn_area);
  const hasExplicitArea = normalizedArea.length > 0;
  const isCommercialProfile = mapped?.active === true && (mapped.role_id === "asesor" || mapped.role_id === "gerente_ventas");
  if (isCommercialProfile) return !hasExplicitArea || normalizedArea === "ventas";
  return !snapshot.mapped_profile_id && normalizedArea === "ventas";
}

function hasExplicitSalesAreaConflict(snapshot, profilesById) {
  const mapped = snapshot.mapped_profile_id ? profilesById.get(snapshot.mapped_profile_id) : null;
  const normalizedArea = normalize(snapshot.atn_area);
  const isCommercialProfile = mapped?.active === true && (mapped.role_id === "asesor" || mapped.role_id === "gerente_ventas");
  return isCommercialProfile && normalizedArea.length > 0 && normalizedArea !== "ventas";
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

function isMissingPhase2ATable(error) {
  return error?.code === "PGRST205" || /gv_respond_(contact_snapshots|sync_runs)/i.test(error?.message || "");
}

function migrationRequiredError() {
  const migrationError = new Error("RESPOND_PHASE_2A_MIGRATION_REQUIRED");
  migrationError.statusCode = 424;
  return migrationError;
}

function isStaleRun(run) {
  const updatedAt = run?.updated_at ? new Date(run.updated_at).getTime() : 0;
  return updatedAt > 0 && Date.now() - updatedAt > RESPOND_SYNC_STALE_MS;
}

function publicRun(run, extra = {}) {
  if (!run) return null;
  return {
    runId: run.id,
    status: run.status,
    batchNumber: run.batch_number || 0,
    contactsProcessed: run.contacts_processed || 0,
    snapshotsUpserted: run.snapshots_upserted || 0,
    snapshotsCreated: run.snapshots_created || 0,
    snapshotsUpdated: run.snapshots_updated || 0,
    contactsIgnoredOutsideSales: run.contacts_ignored_outside_sales || 0,
    contactsExcludedAreaConflict: run.contacts_excluded_area_conflict || 0,
    messageRequests: run.message_requests || 0,
    coverageComplete: run.coverage_complete || false,
    stoppedReason: run.stopped_reason || null,
    lastError: run.last_error || null,
    startedAt: run.started_at || null,
    finishedAt: run.finished_at || null,
    updatedAt: run.updated_at || null,
    ...extra,
  };
}

async function recoverStaleRuns(admin) {
  const { data: running, error } = await admin
    .from("gv_respond_sync_runs")
    .select("*")
    .eq("status", "running")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (isMissingPhase2ATable(error)) throw migrationRequiredError();
  if (error) throw error;
  if (!running) return null;
  if (!isStaleRun(running)) return running;

  await markRunStaleRecovered(admin, running);
  return null;
}

async function markRunStaleRecovered(admin, run) {
  const { error: updateError } = await admin
    .from("gv_respond_sync_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      stopped_reason: "stale_run_recovered",
      last_error: "stale_run_recovered",
      updated_at: new Date().toISOString(),
    })
    .eq("id", run.id)
    .eq("status", "running");
  if (updateError) throw updateError;
}

async function createRun(admin, actorProfile) {
  const { data, error } = await admin
    .from("gv_respond_sync_runs")
    .insert({
      status: "running",
      actor_profile_id: actorProfile.id,
      metadata: { batch_size: FINAL_SYNC_BATCH_SIZE, stale_ttl_ms: RESPOND_SYNC_STALE_MS },
    })
    .select("*")
    .single();
  if (isMissingPhase2ATable(error)) throw migrationRequiredError();
  if (error?.code === "23505") return { conflict: true };
  if (error) throw error;
  return { run: data };
}

async function getRun(admin, runId) {
  const { data, error } = await admin
    .from("gv_respond_sync_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (isMissingPhase2ATable(error)) throw migrationRequiredError();
  if (error) throw error;
  return data;
}

async function failRun(admin, run, err, stoppedReason = "batch_failed") {
  const message = err?.public?.message || err?.message || "batch_failed";
  const { data, error } = await admin
    .from("gv_respond_sync_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      stopped_reason: stoppedReason,
      last_error: String(message).slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", run.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function readContactBatch(cursor) {
  const contactPath = cursor || "/contact/list";
  const isContactListPath = String(contactPath).includes("/contact/list");
  const contactList = await respondRequest(contactPath, {
    method: "POST",
    params: contactPath === "/contact/list" ? { limit: FINAL_SYNC_BATCH_SIZE } : undefined,
    body: isContactListPath ? {
      search: "",
      timezone: "America/Mexico_City",
      filter: { $and: [] },
    } : undefined,
  });
  return {
    contacts: items(contactList).slice(0, FINAL_SYNC_BATCH_SIZE),
    nextCursor: paginationNext(contactList),
    contactsAvailable: contactList.total ?? contactList.count ?? contactList.pagination?.total ?? null,
  };
}

async function buildSnapshotsForBatch(contacts, profiles, profilesById) {
  const snapshots = [];
  const metrics = {
    contactsIgnoredOutsideSales: 0,
    contactsExcludedAreaConflict: 0,
    messagePagesRead: 0,
    messageRequests: 0,
  };

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
      metrics.messagePagesRead += 1;
      metrics.messageRequests += 1;
      const signals = messageSignals(messages);
      if (signals.lastInbound && signals.lastOutbound && messages.length >= MESSAGE_PAGE_LIMIT) break;
    }
    const snapshot = snapshotFromContact(contact, messages, profiles, messagePage);
    if (isSnapshotRelevantForSales(snapshot, profilesById)) snapshots.push(snapshot);
    else if (hasExplicitSalesAreaConflict(snapshot, profilesById)) metrics.contactsExcludedAreaConflict += 1;
    else metrics.contactsIgnoredOutsideSales += 1;
  }

  return { snapshots, metrics };
}

async function countSnapshotChanges(admin, snapshots) {
  if (!snapshots.length) return { snapshotsCreated: 0, snapshotsUpdated: 0 };
  const { data: existingSnapshots, error } = await admin
    .from("gv_respond_contact_snapshots")
    .select("respond_contact_id, mapped_profile_id, mapping_status, metadata")
    .in("respond_contact_id", snapshots.map((snapshot) => snapshot.respond_contact_id));
  if (isMissingPhase2ATable(error)) throw migrationRequiredError();
  if (error) throw error;

  let snapshotsCreated = 0;
  let snapshotsUpdated = 0;
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
  return { snapshotsCreated, snapshotsUpdated };
}

async function processRunBatch(admin, profiles, run) {
  const profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const batchStartedAt = new Date().toISOString();
  const batchCursor = run.current_cursor || run.last_confirmed_cursor || null;

  const { data: heartbeat, error: heartbeatError } = await admin
    .from("gv_respond_sync_runs")
    .update({
      current_cursor: batchCursor,
      updated_at: batchStartedAt,
    })
    .eq("id", run.id)
    .eq("status", "running")
    .select("*")
    .single();
  if (heartbeatError) throw heartbeatError;

  try {
    const { contacts, nextCursor, contactsAvailable } = await readContactBatch(batchCursor);
    const { snapshots, metrics } = await buildSnapshotsForBatch(contacts, profiles || [], profilesById);
    const { snapshotsCreated, snapshotsUpdated } = await countSnapshotChanges(admin, snapshots);

    if (snapshots.length) {
      const { error } = await admin
        .from("gv_respond_contact_snapshots")
        .upsert(snapshots, { onConflict: "respond_contact_id" });
      if (isMissingPhase2ATable(error)) throw migrationRequiredError();
      if (error) throw error;
    }

    const coverageComplete = !nextCursor;
    const stoppedReason = coverageComplete ? "complete" : "batch_complete";
    const update = {
      current_cursor: nextCursor || null,
      last_confirmed_cursor: nextCursor || null,
      batch_number: (heartbeat.batch_number || 0) + 1,
      contacts_processed: (heartbeat.contacts_processed || 0) + contacts.length,
      snapshots_upserted: (heartbeat.snapshots_upserted || 0) + snapshots.length,
      snapshots_created: (heartbeat.snapshots_created || 0) + snapshotsCreated,
      snapshots_updated: (heartbeat.snapshots_updated || 0) + snapshotsUpdated,
      contacts_ignored_outside_sales: (heartbeat.contacts_ignored_outside_sales || 0) + metrics.contactsIgnoredOutsideSales,
      contacts_excluded_area_conflict: (heartbeat.contacts_excluded_area_conflict || 0) + metrics.contactsExcludedAreaConflict,
      message_requests: (heartbeat.message_requests || 0) + metrics.messageRequests,
      coverage_complete: coverageComplete,
      stopped_reason: stoppedReason,
      last_error: null,
      metadata: {
        ...(heartbeat.metadata || {}),
        batch_size: FINAL_SYNC_BATCH_SIZE,
        contacts_available: contactsAvailable,
        last_batch_contacts: contacts.length,
        last_batch_snapshots: snapshots.length,
        last_batch_message_pages: metrics.messagePagesRead,
        last_batch_started_at: batchStartedAt,
        last_batch_finished_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    };
    if (coverageComplete) {
      update.status = "completed";
      update.finished_at = new Date().toISOString();
    }

    const { data: updatedRun, error: updateError } = await admin
      .from("gv_respond_sync_runs")
      .update(update)
      .eq("id", run.id)
      .eq("status", "running")
      .select("*")
      .single();
    if (updateError) throw updateError;

    return publicRun(updatedRun, {
      batch: {
        contactsProcessed: contacts.length,
        snapshotsUpserted: snapshots.length,
        snapshotsCreated,
        snapshotsUpdated,
        contactsIgnoredOutsideSales: metrics.contactsIgnoredOutsideSales,
        contactsExcludedAreaConflict: metrics.contactsExcludedAreaConflict,
        messageRequests: metrics.messageRequests,
      },
    });
  } catch (err) {
    const failed = await failRun(admin, heartbeat || run, err);
    return publicRun(failed, { error: failed.last_error });
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  let lockKey = null;

  try {
    const env = assertSupabaseEnvironment();
    assertFase2AEnabled();
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

    const options = parseSyncOptions(req.body);
    if (options.action === "status") {
      const run = await getRun(admin, options.runId);
      if (!run) return res.status(404).json({ ok: false, error: "Run no encontrado." });
      return res.status(200).json({ ok: true, result: publicRun(run) });
    }

    lockKey = `${env.projectRef}:respond-sync`;
    if (syncLocks.get(lockKey)) {
      return res.status(409).json({ ok: false, error: "Ya hay una sincronización en curso." });
    }
    syncLocks.set(lockKey, Date.now());

    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id, email, full_name, role_id, active")
      .eq("active", true);
    if (profilesError) throw profilesError;

    let run;
    if (options.action === "start") {
      const running = await recoverStaleRuns(admin);
      if (running) return res.status(409).json({ ok: false, error: "Ya hay una sincronización en curso.", result: publicRun(running) });
      const created = await createRun(admin, actorProfile);
      if (created.conflict) return res.status(409).json({ ok: false, error: "Ya hay una sincronización en curso." });
      run = created.run;
    }

    if (options.action === "continue") {
      run = await getRun(admin, options.runId);
      if (!run) return res.status(404).json({ ok: false, error: "Run no encontrado." });
      if (run.status !== "running") return res.status(409).json({ ok: false, error: "El run no está activo.", result: publicRun(run) });
    }

    if (options.action === "resume") {
      let failedRun = await getRun(admin, options.runId);
      if (!failedRun) return res.status(404).json({ ok: false, error: "Run no encontrado." });
      if (failedRun.status === "running") {
        if (!isStaleRun(failedRun)) {
          return res.status(409).json({ ok: false, error: "El run sigue activo; aun no puede reanudarse.", result: publicRun(failedRun) });
        }
        await markRunStaleRecovered(admin, failedRun);
        failedRun = await getRun(admin, options.runId);
      }
      if (failedRun.status !== "failed") return res.status(409).json({ ok: false, error: "Solo se puede reanudar un run fallido o stale.", result: publicRun(failedRun) });
      const running = await recoverStaleRuns(admin);
      if (running) return res.status(409).json({ ok: false, error: "Ya hay una sincronización en curso.", result: publicRun(running) });
      const { data: resumed, error: resumeError } = await admin
        .from("gv_respond_sync_runs")
        .update({
          status: "running",
          finished_at: null,
          stopped_reason: "resumed",
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", failedRun.id)
        .eq("status", "failed")
        .select("*")
        .single();
      if (resumeError?.code === "23505") return res.status(409).json({ ok: false, error: "Ya hay una sincronización en curso." });
      if (resumeError) throw resumeError;
      run = resumed;
    }

    const result = await processRunBatch(admin, profiles || [], run);
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
    if (lockKey) syncLocks.delete(lockKey);
  }
}
