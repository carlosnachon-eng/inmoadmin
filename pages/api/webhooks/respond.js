import { assertSupabaseEnvironment, getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { assertRespondIncrementalWebhooksEnabled } from "../../../lib/ejecutivo/respondSync";
import { extractRespondWebhookEvent, isValidRespondWebhookSignature,
  readRespondWebhookBody, resolveRespondWebhookSigningKeys } from "../../../lib/ejecutivo/respondWebhook";
import { captureRespondAdminShadowIsolated } from "../../../lib/shadow/providers/respondAdmin";
import { routeRespondMessageIsolated } from "../../../lib/respond/channelRouter";
import { captureRespondMediaReferenceIsolated } from "../../../lib/shadow/media/reference";
import { captureRespondAppointmentLifecycleIsolated } from "../../../lib/agentsV2/respondAppointmentSync";
import { commercialQueueEligible, enqueueCommercialEvent } from "../../../lib/social/commercialQueue.js";

export const config = { maxDuration: 120, api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  try {
    assertSupabaseEnvironment();
    assertRespondIncrementalWebhooksEnabled();
    const signingKeys = resolveRespondWebhookSigningKeys();
    const body = await readRespondWebhookBody(req);
    if (!isValidRespondWebhookSignature(body, req.headers["x-webhook-signature"], signingKeys))
      return res.status(401).json({ ok: false, error: "Firma invalida." });
    const event = extractRespondWebhookEvent(body);
    if (!event.supported) return res.status(200).json({ ok: true, skipped: "unsupported_event" });
    if (!event.eventId || !event.respondContactId)
      return res.status(400).json({ ok: false, error: "Evento sin event_id o contact.id." });
    const admin = getAdminSupabase();
    if (commercialQueueEligible(event)) {
      // Atomic transport + #165 receipt + job; no model, debounce or dispatch.
      const queued = await enqueueCommercialEvent(admin, body, event);
      return res.status(200).json({ ok: true, queued: true,
        duplicate: queued.duplicate, commercial: queued.state });
    }
    // Non-commercial handling and the #168 message.sent trigger are unchanged.
    const { error } = await admin.from("gv_respond_webhook_events").insert({
      event_id: event.eventId, event_type: event.eventType,
      respond_contact_id: event.respondContactId, event_occurred_at: event.eventOccurredAt,
      message_id: event.messageId, payload_meta: event.payloadMeta,
    });
    if (error?.code === "23505") {
      await captureRespondAdminShadowIsolated(admin, body);
      await captureRespondMediaReferenceIsolated(admin, body);
      return res.status(200).json({ ok: true, duplicate: true });
    }
    if (error) throw error;
    const routing = await routeRespondMessageIsolated(event);
    if (routing.audit && routing.reason !== "disabled") {
      const { error: auditError } = await admin.from("gv_respond_webhook_events")
        .update({ payload_meta: { ...event.payloadMeta, routing: routing.audit } }).eq("event_id", event.eventId);
      if (auditError) console.error("[respond-channel-router-audit]", "audit_failed");
    }
    await captureRespondAdminShadowIsolated(admin, body);
    await captureRespondMediaReferenceIsolated(admin, body);
    await captureRespondAppointmentLifecycleIsolated(admin, body);
    return res.status(200).json({ ok: true, queued: true });
  } catch (error) {
    if (error?.statusCode === 404) return res.status(404).json({ ok: false, error: "Not Found" });
    if ([400, 413].includes(error?.statusCode)) return res.status(error.statusCode).json({ ok: false, error: error.message });
    console.error("[respond-webhook]", "receiver_persistence_failed");
    return res.status(503).json({ ok: false, error: "No se pudo persistir el evento." });
  }
}
