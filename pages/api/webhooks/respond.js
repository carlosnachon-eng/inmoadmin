import {
  assertSupabaseEnvironment,
  getAdminSupabase,
} from "../../../lib/ejecutivo/workCenter";
import { assertRespondIncrementalWebhooksEnabled } from "../../../lib/ejecutivo/respondSync";
import {
  extractRespondWebhookEvent,
  isValidRespondWebhookSignature,
  readRespondWebhookBody,
  resolveRespondWebhookSigningKeys,
} from "../../../lib/ejecutivo/respondWebhook";
import { observeWhatsappAttributionFailOpen } from "../../../lib/whatsappAttribution/respondAttribution";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    assertSupabaseEnvironment();
    assertRespondIncrementalWebhooksEnabled();
    const signingKeys = resolveRespondWebhookSigningKeys();

    const body = await readRespondWebhookBody(req);
    const signature = req.headers["x-webhook-signature"];
    if (!isValidRespondWebhookSignature(body, signature, signingKeys)) {
      return res.status(401).json({ ok: false, error: "Firma invalida." });
    }

    const event = extractRespondWebhookEvent(body);
    if (!event.supported) return res.status(200).json({ ok: true, skipped: "unsupported_event" });
    if (!event.eventId || !event.respondContactId) {
      return res.status(400).json({ ok: false, error: "Evento sin event_id o contact.id." });
    }

    const admin = getAdminSupabase();
    const { error } = await admin.from("gv_respond_webhook_events").insert({
      event_id: event.eventId,
      event_type: event.eventType,
      respond_contact_id: event.respondContactId,
      event_occurred_at: event.eventOccurredAt,
      message_id: event.messageId,
      payload_meta: event.payloadMeta,
    });
    const duplicate = error?.code === "23505";
    if (error && !duplicate) throw error;

    // Aditivo y fail-open: la atribución nunca condiciona el ACK, la cola,
    // los retries ni el procesamiento canónico del evento Respond.io.
    await observeWhatsappAttributionFailOpen({ admin, body });

    return res.status(200).json(duplicate
      ? { ok: true, duplicate: true }
      : { ok: true, queued: true });
  } catch (error) {
    if (error?.statusCode === 404) return res.status(404).json({ ok: false, error: "Not Found" });
    if (error?.statusCode === 413) return res.status(413).json({ ok: false, error: error.message });
    if (error?.statusCode === 400) return res.status(400).json({ ok: false, error: error.message });
    console.error("[respond-webhook]", error?.code || error?.message || "receiver_failed");
    return res.status(503).json({ ok: false, error: "No se pudo persistir el evento." });
  }
}
