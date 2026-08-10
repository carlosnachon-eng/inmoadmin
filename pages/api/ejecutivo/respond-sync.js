import {
  assertFase2AEnabled,
  assertSupabaseEnvironment,
  authHeaderToken,
  getAdminSupabase,
  getServerSupabase,
} from "../../../lib/ejecutivo/workCenter";
import {
  buildRespondSnapshot,
  readRespondMessages,
  respondItems,
  respondPaginationNext,
  respondRequest,
  shouldPersistRespondSnapshot,
} from "../../../lib/ejecutivo/respondSync";

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
    contacts: respondItems(contactList).slice(0, FINAL_SYNC_BATCH_SIZE),
    nextCursor: respondPaginationNext(contactList),
    contactsAvailable: contactList.total ?? contactList.count ?? contactList.pagination?.total ?? null,
  };
}

async function buildSnapshotsForBatch(admin, contacts, profiles) {
  const snapshots = [];
  const metrics = {
    contactsIgnoredOutsideSales: 0,
    contactsExcludedAreaConflict: 0,
    messagePagesRead: 0,
    messageRequests: 0,
    snapshotsCreated: 0,
    snapshotsUpdated: 0,
  };

  const contactIds = contacts.map((contact) => String(contact.id));
  const { data: existingRows, error: existingError } = contactIds.length
    ? await admin.from("gv_respond_contact_snapshots").select("*").in("respond_contact_id", contactIds)
    : { data: [], error: null };
  if (isMissingPhase2ATable(existingError)) throw migrationRequiredError();
  if (existingError) throw existingError;
  const existingByContact = new Map(
    (existingRows || []).map((snapshot) => [snapshot.respond_contact_id, snapshot])
  );

  for (const contact of contacts) {
    const existingSnapshot = existingByContact.get(String(contact.id)) || null;
    const messageResult = await readRespondMessages(contact.id);
    metrics.messagePagesRead += messageResult.pagesRead;
    metrics.messageRequests += messageResult.messageRequests;
    const snapshot = buildRespondSnapshot({
      contact,
      messages: messageResult.messages,
      profiles,
      existingSnapshot,
      messagePagesRead: messageResult.pagesRead,
    });
    if (!snapshot.sales_relevant) {
      if (snapshot.exclusion_reason === "area_outside_sales") metrics.contactsExcludedAreaConflict += 1;
      else metrics.contactsIgnoredOutsideSales += 1;
    }
    if (!shouldPersistRespondSnapshot(snapshot)) continue;
    snapshots.push(snapshot);
    if (existingSnapshot) metrics.snapshotsUpdated += 1;
    else metrics.snapshotsCreated += 1;
  }

  return { snapshots, metrics };
}

async function processRunBatch(admin, profiles, run) {
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
    const { snapshots, metrics } = await buildSnapshotsForBatch(admin, contacts, profiles || []);

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
      snapshots_created: (heartbeat.snapshots_created || 0) + metrics.snapshotsCreated,
      snapshots_updated: (heartbeat.snapshots_updated || 0) + metrics.snapshotsUpdated,
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
        snapshotsCreated: metrics.snapshotsCreated,
        snapshotsUpdated: metrics.snapshotsUpdated,
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
    if (actorProfile.role_id !== "admin") {
      return res.status(403).json({ ok: false, error: "La reconciliacion completa es exclusiva de Admin." });
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
      .select("id, email, full_name, role_id, active");
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
