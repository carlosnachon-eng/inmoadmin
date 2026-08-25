import crypto from "node:crypto";
import { respondChannelId, respondEventType } from "../providers/respondAdmin.js";

export const MEDIA_ADMIN_CHANNEL_ID = "544519";
export const MEDIA_TTL_MS = 30 * 60 * 1000;
export const MEDIA_MAX_URL_LENGTH = 4096;
export const MEDIA_ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const clean = (value, max = 300) => String(value ?? "").trim().slice(0, max);
const b64 = (value) => Buffer.from(value).toString("base64");

export function validateOpaqueMediaUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.length > MEDIA_MAX_URL_LENGTH) throw Object.assign(new Error("invalid_media_url"), { code: "invalid_media_url" });
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error("invalid_media_url"), { code: "invalid_media_url" }); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) {
    throw Object.assign(new Error("invalid_media_url"), { code: "invalid_media_url" });
  }
  return url;
}

export function mediaReferenceDecision(payload, { enabled = process.env.SHADOW_MEDIA_RETRIEVAL_ENABLED } = {}) {
  if (String(enabled).toLowerCase() !== "true") return { capture: false, reason: "disabled" };
  if (respondEventType(payload) !== "message.received") return { capture: false, reason: "not_inbound" };
  if (respondChannelId(payload) !== MEDIA_ADMIN_CHANNEL_ID) return { capture: false, reason: "channel_not_allowlisted" };
  if (clean(payload?.channel?.source, 80).toLowerCase() !== "whatsapp_business") return { capture: false, reason: "source_not_allowed" };
  const attachment = payload?.message?.message?.attachment;
  if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) return { capture: false, reason: "attachment_missing" };
  const externalMessageId = clean(payload?.message?.messageId ?? payload?.message?.id, 200);
  if (!externalMessageId) return { capture: false, reason: "message_id_missing" };
  if (!attachment.url) return { capture: false, reason: "attachment_url_missing" };
  return { capture: true, attachment, externalMessageId, channelId: MEDIA_ADMIN_CHANNEL_ID };
}

export function encryptMediaReference(urlValue, publicKeyPem) {
  const url = validateOpaqueMediaUrl(urlValue);
  if (!publicKeyPem) throw new Error("media_public_key_missing");
  const key = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(url.href, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrappedKey = crypto.publicEncrypt({ key: publicKeyPem, oaepHash: "sha256", padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, key);
  key.fill(0);
  return {
    encrypted_reference: b64(ciphertext), wrapped_key: b64(wrappedKey), nonce: b64(nonce), auth_tag: b64(tag),
    reference_hash: crypto.createHash("sha256").update(url.href).digest("hex"),
    host_hash: crypto.createHash("sha256").update(url.hostname.toLowerCase()).digest("hex"),
  };
}

export function decryptMediaReference(row, privateKeyPem) {
  if (!privateKeyPem) throw new Error("media_private_key_missing");
  const key = crypto.privateDecrypt({ key: privateKeyPem, oaepHash: "sha256", padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(row.wrapped_key, "base64"));
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(row.nonce, "base64"));
    decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(row.encrypted_reference, "base64")), decipher.final()]).toString("utf8");
  } finally { key.fill(0); }
}

export function buildEncryptedMediaQueueRow(payload, { publicKeyPem, now = new Date() } = {}) {
  const decision = mediaReferenceDecision(payload, { enabled: "true" });
  if (!decision.capture) throw Object.assign(new Error(decision.reason), { code: decision.reason });
  const attachment = decision.attachment;
  const declaredMime = clean(attachment.mimeType ?? attachment.mime, 120).toLowerCase().split(";", 1)[0] || null;
  const encrypted = encryptMediaReference(attachment.url, publicKeyPem);
  const referenceKey = `respond_admin:${decision.externalMessageId}:0:${encrypted.reference_hash}`;
  return {
    provider: "respond_admin", external_message_id: decision.externalMessageId, attachment_index: 0,
    channel_id: decision.channelId, channel_source: "whatsapp_business", reference_key: referenceKey,
    ...encrypted, declared_mime: declaredMime, declared_size: Number.isSafeInteger(Number(attachment.size)) ? Number(attachment.size) : null,
    is_pending: attachment.isPending === true, status: "pending", attempts: 0,
    next_attempt_at: new Date(now.getTime() + (attachment.isPending === true ? 60_000 : 0)).toISOString(),
    expires_at: new Date(now.getTime() + MEDIA_TTL_MS).toISOString(),
  };
}

export async function captureRespondMediaReferenceIsolated(admin, payload, options = {}) {
  const decision = mediaReferenceDecision(payload, options);
  if (!decision.capture) return { status: "skipped", reason: decision.reason };
  try {
    const row = buildEncryptedMediaQueueRow(payload, { publicKeyPem: options.publicKeyPem ?? process.env.SHADOW_MEDIA_RETRIEVAL_PUBLIC_KEY });
    const { error } = await admin.from("shadow_media_retrieval_queue").insert(row);
    if (error?.code === "23505") return { status: "duplicate" };
    if (error) throw error;
    return { status: "queued" };
  } catch (error) {
    console.error("[shadow-media-reference]", error?.code || error?.message || "enqueue_failed");
    return { status: "isolated_error", reason: error?.code || "enqueue_failed" };
  }
}
