import { createMessagingEvent } from "../events.js";
import { messagingProviderError } from "../provider.js";
import { MAX_META_EVENTS, metaId } from "./config.js";

const STATUSES = new Set(["sent", "delivered", "read", "failed"]);
const TYPES = new Set(["text", "image", "audio", "video", "document", "sticker", "location",
  "contacts", "interactive", "button", "reaction", "order", "system", "unsupported", "edit", "revoke"]);
const fail = code => { throw messagingProviderError(code); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nativeId = value => typeof value === "string" && /^wamid\.[A-Za-z0-9+/=_-]{1,500}$/.test(value);
const array = value => Array.isArray(value) ? value : fail("meta_observer_payload_invalid");

function occurredAt(value) {
  if (typeof value !== "string" || !/^[0-9]{1,12}$/.test(value)) return fail("meta_observer_timestamp_invalid");
  const date = new Date(Number(value) * 1000);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 9999)
    return fail("meta_observer_timestamp_invalid");
  return date.toISOString();
}

// Pure normalization only: the receiver MUST verify the raw-body signature
// first. No identity bridge, phone matching, contact lookup, model or sender.
export function normalizeMetaObservations(body, scope) {
  if (!metaId(scope?.wabaId) || !metaId(scope?.phoneNumberId)) fail("meta_observer_scope_invalid");
  if (!object(body) || body.object !== "whatsapp_business_account") fail("meta_observer_payload_invalid");
  const events = [];
  let ignored = 0, items = 0;
  const entries = array(body.entry);
  if (!entries.length || entries.length > MAX_META_EVENTS) fail("meta_observer_payload_invalid");
  for (const entry of entries) {
    if (entry?.id !== scope.wabaId) fail("meta_observer_scope_denied");
    const changes = array(entry.changes);
    if (!changes.length || changes.length > MAX_META_EVENTS) fail("meta_observer_payload_invalid");
    for (const change of changes) {
      const value = change?.value;
      // Validate scope even on unsupported fields; never accept another number
      // merely because it shares the WABA. Reject a mixed batch atomically.
      if (!object(value) || value.messaging_product !== "whatsapp") fail("meta_observer_payload_invalid");
      if (value.metadata?.phone_number_id !== scope.phoneNumberId) fail("meta_observer_scope_denied");
      if (!["messages", "smb_message_echoes"].includes(change.field)) { ignored++; continue; }
      const groups = change.field === "messages"
        ? [["inbound", value.messages], ["status", value.statuses]]
        : [["app_echo", value.message_echoes]];
      let hasItems = false;
      for (const [category, group] of groups) {
        if (group === undefined) continue;
        for (const item of array(group)) {
          hasItems = true;
          if (++items > MAX_META_EVENTS) fail("meta_observer_batch_too_large");
          if (!object(item) || !nativeId(item.id)) fail("meta_observer_native_id_missing");
          const time = occurredAt(item.timestamp);
          if (category === "status" && !STATUSES.has(item.status)) { ignored++; continue; }
          if (category !== "status" && (typeof item.type !== "string" || !item.type.length))
            fail("meta_observer_payload_invalid");
          const type = category === "status" ? null : TYPES.has(item.type) ? item.type : "unsupported";
          const mutation = ["edit", "revoke"].includes(type);
          const originalId = mutation ? item[type]?.original_message_id : null;
          if (mutation && !nativeId(originalId)) fail("meta_observer_native_id_missing");
          // No timestamp/body hash in the identity key. Status stages and
          // edits/revokes are distinct observations, not another inbound turn.
          const eventType = category === "status" ? `message.${item.status}`
            : mutation ? `message.${type}` : category === "inbound" ? "message.received" : "message.sent";
          const event = createMessagingEvent({ provider: "meta", eventType,
            eventId: null, contactId: null, channelId: scope.phoneNumberId,
            messageId: item.id, occurredAt: time, supported: true,
            // Deliberately no text/phones/names/URLs. Observation, not agent input.
            content: null, metadata: {
              wabaId: scope.wabaId, field: change.field, category,
              messageType: type, originalMessageId: originalId,
              status: category === "status" ? item.status : null,
              errorCodes: Array.isArray(item.errors) ? [...new Set(item.errors
                .map(e => e?.code).filter(n => Number.isSafeInteger(n) && n >= 0))].slice(0, 20) : [],
              appOrigin: category === "app_echo" ? "whatsapp_business_app_or_linked_device" : null,
            } });
          event.kind = category === "status" ? "message.status"
            : mutation ? "message.mutation_observed" : event.kind;
          event.nativeMessageId = item.id;
          event.observationKey = `${eventType}:${item.id}`;
          // App/device origin is documented; operator identity and actual human
          // authorship are NOT supplied by this payload. Never synthesize user.
          event.author = { kind: "unknown", actorId: null,
            evidence: category === "app_echo" ? "smb_message_echoes_app_origin" : "human_authorship_unproven" };
          event.observerOnly = true;
          events.push(event);
        }
      }
      if (!hasItems) fail("meta_observer_payload_invalid");
    }
  }
  return { events, ignored };
}
