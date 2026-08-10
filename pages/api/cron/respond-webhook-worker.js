import { randomUUID, timingSafeEqual } from "crypto";

import {
  assertFase2AEnabled,
  assertSupabaseEnvironment,
  authHeaderToken,
  getAdminSupabase,
  getServerSupabase,
} from "../../../lib/ejecutivo/workCenter";
import {
  assertRespondIncrementalWorkerEnabled,
  buildMissingRespondSnapshot,
  buildRespondSnapshot,
  fetchRespondContact,
  readRespondMessages,
  shouldPersistRespondSnapshot,
} from "../../../lib/ejecutivo/respondSync";

const WORKER_CONTACT_LIMIT = 20;
const MAX_ATTEMPTS = 8;

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function authorizeWorkerRequest(req, admin) {
  if (req.method === "GET") {
    const expected = process.env.CRON_SECRET;
    const authorization = req.headers.authorization || "";
    if (!expected || !constantTimeEqual(authorization, `Bearer ${expected}`)) return null;
    return { kind: "cron", profile: null };
  }

  const jwt = authHeaderToken(req);
  if (!jwt) return null;
  const scoped = getServerSupabase(jwt);
  const { data: { user }, error: userError } = await scoped.auth.getUser();
  if (userError || !user) return null;
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role_id, active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.active || !["admin", "gerente_ventas"].includes(profile.role_id)) return null;
  return { kind: "manual", profile };
}

async function existingSnapshot(admin, respondContactId) {
  const { data, error } = await admin
    .from("gv_respond_contact_snapshots")
    .select("*")
    .eq("respond_contact_id", respondContactId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function completeContact(admin, workerId, claim, profiles) {
  const previous = await existingSnapshot(admin, claim.respond_contact_id);
  let snapshot = null;
  let messageRequests = 0;

  try {
    const contact = await fetchRespondContact(claim.respond_contact_id);
    const messageResult = await readRespondMessages(claim.respond_contact_id);
    messageRequests = messageResult.messageRequests;
    const calculated = buildRespondSnapshot({
      contact,
      messages: messageResult.messages,
      profiles,
      existingSnapshot: previous,
      messagePagesRead: messageResult.pagesRead,
      eventOccurredAt: claim.latest_event_at,
    });
    if (shouldPersistRespondSnapshot(calculated, previous)) snapshot = calculated;
  } catch (error) {
    if (error?.public?.status !== 404) throw error;
    if (previous) {
      snapshot = buildMissingRespondSnapshot({
        respondContactId: claim.respond_contact_id,
        existingSnapshot: previous,
        eventOccurredAt: claim.latest_event_at,
      });
    }
  }

  const { error: applyError } = await admin.rpc("apply_respond_snapshot_and_complete_events", {
    p_snapshot: snapshot,
    p_event_ids: claim.event_ids,
    p_worker_id: workerId,
  });
  if (applyError) throw applyError;

  return {
    eventsProcessed: claim.event_count,
    snapshotUpserted: Boolean(snapshot),
    salesRelevant: snapshot?.sales_relevant ?? null,
    messageRequests,
  };
}

async function failClaim(admin, workerId, claim, error) {
  const detail = error?.public?.message || error?.message || "worker_failed";
  const { error: failError } = await admin.rpc("fail_respond_webhook_events", {
    p_event_ids: claim.event_ids,
    p_worker_id: workerId,
    p_error: String(detail).slice(0, 500),
    p_max_attempts: MAX_ATTEMPTS,
  });
  if (failError) throw failError;
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    assertSupabaseEnvironment();
    assertFase2AEnabled();
    assertRespondIncrementalWorkerEnabled();
    const admin = getAdminSupabase();
    const authorization = await authorizeWorkerRequest(req, admin);
    if (!authorization) return res.status(401).json({ ok: false, error: "No autorizado." });

    const workerId = randomUUID();
    const receivedBefore = new Date().toISOString();
    const { data: claims, error: claimError } = await admin.rpc("claim_respond_webhook_contacts", {
      p_worker_id: workerId,
      p_limit: WORKER_CONTACT_LIMIT,
      p_received_before: receivedBefore,
    });
    if (claimError) throw claimError;

    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id, email, full_name, role_id, active");
    if (profilesError) throw profilesError;

    const result = {
      workerId,
      receivedBefore,
      contactsClaimed: (claims || []).length,
      contactsProcessed: 0,
      contactsFailed: 0,
      eventsProcessed: 0,
      snapshotsUpserted: 0,
      contactsOutsideSales: 0,
      messageRequests: 0,
      errors: [],
    };

    for (const claim of claims || []) {
      try {
        const completed = await completeContact(admin, workerId, claim, profiles || []);
        result.contactsProcessed += 1;
        result.eventsProcessed += completed.eventsProcessed;
        result.snapshotsUpserted += completed.snapshotUpserted ? 1 : 0;
        result.contactsOutsideSales += completed.salesRelevant === false ? 1 : 0;
        result.messageRequests += completed.messageRequests;
      } catch (error) {
        result.contactsFailed += 1;
        result.errors.push({
          respondContactId: claim.respond_contact_id,
          error: String(error?.public?.message || error?.message || "worker_failed").slice(0, 160),
        });
        await failClaim(admin, workerId, claim, error);
      }
    }

    return res.status(result.contactsFailed ? 207 : 200).json({ ok: result.contactsFailed === 0, result });
  } catch (error) {
    if (error?.statusCode === 404) return res.status(404).json({ ok: false, error: "Not Found" });
    const missingMigration = error?.code === "PGRST202"
      || error?.code === "PGRST205"
      || /gv_respond_webhook_events|claim_respond_webhook_contacts/i.test(error?.message || "");
    if (missingMigration) {
      return res.status(424).json({
        ok: false,
        error: "Falta ejecutar la migracion incremental Respond.io.",
        migration: "supabase/migrations/202608100003_fase_2a1a_respond_incremental_webhooks.sql",
      });
    }
    console.error("[respond-webhook-worker]", error?.code || error?.message || "worker_failed");
    return res.status(500).json({ ok: false, error: "No se pudo procesar la cola Respond.io." });
  }
}
