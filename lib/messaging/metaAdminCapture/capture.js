import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { sanitizeShadowText } from "../../shadow/coordinator.js";
import { normalizeIdentityPhone } from "../../shadow/identityBridge.js";

const ID = /^[1-9][0-9]{7,14}$/;
const HEX = /^[a-f0-9]{64}$/;
const fail = () => { throw new Error("meta_admin_capture_invalid"); };

export function metaAdminCaptureConfig(env = process.env) {
  if (env.META_ADMIN_SHADOW_CAPTURE_ENABLED !== "true") return null;
  const notBefore = env.META_ADMIN_SHADOW_CAPTURE_NOT_BEFORE;
  const encryptionKey = env.META_ADMIN_CAPTURE_ENCRYPTION_KEY;
  const hmacKey = env.META_ADMIN_CAPTURE_HMAC_KEY;
  if (typeof notBefore !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(notBefore)
    || !Number.isFinite(Date.parse(notBefore)) || !HEX.test(encryptionKey || "") || !HEX.test(hmacKey || "")
    || encryptionKey === hmacKey) fail();
  return { notBefore: new Date(notBefore).toISOString(), encryptionKey, hmacKey };
}

function sealSender(from, aad, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(from, "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), data: data.toString("hex") };
}

// Called ONLY after signature verification and the existing normalizer's scope
// validation. No profile, raw payload, media URL, token, contact lookup or logs.
export function captureMetaAdminInputs(body, observations, scope, config) {
  if (!config) return [];
  const eligible = new Map(observations.filter(e => e.providerEventType === "message.received"
    && e.providerMetadata.category === "inbound").map(e => [e.nativeMessageId, e]));
  const rows = [], seen = new Map();
  for (const entry of body.entry) for (const change of entry.changes) {
    if (change.field !== "messages") continue;
    for (const message of change.value.messages || []) {
      if (["edit", "revoke"].includes(message.type)) continue;
      const observed = eligible.get(message.id);
      if (!observed || Date.parse(observed.occurredAt) < Date.parse(config.notBefore)) continue;
      // Signed `from` attests the Meta address, NOT internal identity or consent.
      // Preserve the signed address for evidence; only the private lookup index
      // uses the same canonical phone semantics as client_identities.
      const from = message.from;
      const contacts = change.value.contacts;
      if (!ID.test(from || "") || typeof from !== "string") fail();
      if (contacts !== undefined && (!Array.isArray(contacts) || contacts.some(c => !ID.test(c?.wa_id || ""))
        || contacts.filter(c => c.wa_id === from).length !== 1)) fail();
      const canonicalPhone = normalizeIdentityPhone(from);
      if (!canonicalPhone) fail();
      const messageType = observed.providerMetadata.messageType;
      if (messageType === "text" && typeof message.text?.body !== "string") fail();
      // The same native ID cannot attest two different subjects/inputs in a
      // batch. This comparison is in memory only; never persisted or logged.
      const signature = JSON.stringify([from, message.timestamp, message.type, message.text?.body]);
      if (seen.has(message.id)) {
        if (seen.get(message.id) !== signature) fail();
        continue;
      }
      seen.set(message.id, signature);
      const sanitized = messageType === "text"
        ? sanitizeShadowText(message.text.body.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")) : null;
      const reason = messageType !== "text" ? "unsupported_message_type" : sanitized.rejected ? "empty_sanitized_text" : "captured";
      const subject = `${scope.wabaId}:${scope.phoneNumberId}:${from}`;
      const aad = `${scope.wabaId}:${scope.phoneNumberId}:${observed.observationKey}`;
      rows.push({ event_key: observed.observationKey,
        sender_ciphertext: sealSender(from, aad, config.encryptionKey),
        sender_ref: createHmac("sha256", Buffer.from(config.hmacKey, "hex")).update(subject).digest("hex"),
        // Private compatibility index for canonical identity lookup; never log it.
        exact_phone_digest: createHash("sha256").update(canonicalPhone).digest("hex"),
        sender_evidence: contacts ? "signed_from_and_wa_id" : "signed_from",
        sanitized_text: reason === "captured" ? sanitized.text : null, capture_reason: reason });
    }
  }
  return rows;
}
