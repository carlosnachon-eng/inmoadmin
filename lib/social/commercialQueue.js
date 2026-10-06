import { salesMessageText } from "../agentsV2/salesCapture.js";
import { sanitizeShadowText } from "../shadow/coordinator.js";
import { SOCIAL_CHANNELS, socialAttribution, socialRoutingEnabled } from "./routing.js";
import { publicPropertyReferences } from "./publicPropertyReference.js";
import { captureSocialRouteSafely } from "./captureReceipt.js";
import { processSocialRouteImmediate } from "./immediate.js";

// Channel membership is deliberately independent of the enable flag: disabling
// Social must hold durable work, never fall through to legacy commercial capture.
export const commercialQueueEligible = event => event?.eventType === "message.received"
  && Object.hasOwn(SOCIAL_CHANNELS, String(event?.channelId));

export function commercialEnvelope(body, event) {
  const raw = salesMessageText(body);
  const safe = sanitizeShadowText(raw);
  const a = socialAttribution(body, event);
  const explicit = String(body?.source?.property_id || "");
  return {
    version: 1, text: safe.rejected ? "" : safe.text,
    hasAttachment: Boolean(body?.message?.attachment || body?.message?.attachments?.length),
    references: publicPropertyReferences(raw),
    source: { post_id: a.source_post_id, comment_id: a.source_comment_id,
      ad_id: a.source_ad_id, campaign_id: a.source_campaign_id,
      metadata: a.source_metadata,
      property_id: /^[A-Za-z0-9_.:-]{1,200}$/.test(explicit) ? explicit : null },
  };
}

export async function enqueueCommercialEvent(db, body, event) {
  const controller = new AbortController();
  let timer;
  try {
    const request = db.rpc("enqueue_respond_commercial_v1", {
      p_event: { event_id: event.eventId, event_type: event.eventType,
        respond_contact_id: event.respondContactId, event_occurred_at: event.eventOccurredAt,
        message_id: event.messageId, channel_id: String(event.channelId), payload_meta: event.payloadMeta },
      p_envelope: commercialEnvelope(body, event),
    });
    // A network timeout has an uncertain commit outcome: answer 503, not a false
    // 200. The provider's retry resolves that outcome through the same DB key.
    const result = await Promise.race([
      request.abortSignal ? request.abortSignal(controller.signal) : request,
      new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new Error("commercial_enqueue_timeout"));
      }, 3500); }),
    ]);
    if (result.error || !result.data?.durable) throw new Error("commercial_enqueue_failed");
    return result.data;
  } finally { clearTimeout(timer); }
}

// Processors are supplied by the cron, never imported into the webhook bundle.
// Finish/fence durable capture BEFORE invoking the existing lane. Queue retries
// only recover capture; they never authorize a second agent or remote effect.
export async function processCommercialQueueOne(db, { env = process.env, processors, sleep } = {}) {
  if (!socialRoutingEnabled(env)) return { status: "disabled" };
  const claim = await db.rpc("claim_respond_commercial_v1", {});
  if (claim.error) throw new Error("commercial_claim_failed");
  const job = claim.data;
  if (!job) return { status: "idle" };
  let state = "pending";
  let route;
  try {
    const event = { eventId: job.event_id, eventType: "message.received",
      respondContactId: job.respond_contact_id, channelId: job.channel_id,
      messageId: job.message_id, eventOccurredAt: job.occurred_at };
    const body = { message: { text: job.envelope.text,
      ...(job.envelope.hasAttachment ? { attachment: {} } : {}) }, source: job.envelope.source };
    const result = await captureSocialRouteSafely(db, body, event,
      { env, publicReferences: job.envelope.references });
    if (!result.handled) throw new Error("commercial_not_handled");
    route = result;
    state = result.status === "review_required" ? "review_required" : "complete";
  } catch { /* Durable lease/backoff, no payload or provider diagnostics in logs. */ }
  const finish = await db.rpc("finish_respond_commercial_v1", {
    p_event_id: job.event_id, p_token: job.claim_token, p_state: state,
  });
  if (finish.error) throw new Error("commercial_finish_failed");
  const status = finish.data?.state || "lease_lost";
  if (status !== "complete" || !route?.created || !route.inboundId || !processors
    || !["SALES", "OWNER", "LEGAL"].includes(route.destination)) return { status };
  // Includes debounce/coalescing, lane atomic claim, #168 and existing send
  // journals. Failure leaves the lane's evidence/state intact, never resets it.
  const result = await processSocialRouteImmediate(db, route, processors, { env, sleep });
  const allowed = new Set(["queued", "not_claimed", "absorbed_by_newer_message", "processed", "sent",
    "paused", "skipped", "blocked", "failed", "superseded", "retryable", "review_required", "fallback_to_existing_lane"]);
  return { status, laneAttempted: true, laneStatus: allowed.has(result?.status) ? result.status : "lane_result_recorded" };
}
