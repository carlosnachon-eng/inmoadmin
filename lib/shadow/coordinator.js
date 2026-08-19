import crypto from "node:crypto";

export const SHADOW_PROVIDERS = new Set(["synthetic", "respond", "360dialog"]);
export const SHADOW_DIRECTIONS = new Set(["inbound", "outbound"]);
export const ADMIN_LIKELIHOODS = new Set(["high", "medium", "low", "unknown"]);
export const SHADOW_INTENTS = new Set([
  "reportar_mantenimiento", "seguimiento_mantenimiento", "enviar_comprobante_renta",
  "enviar_comprobante_servicio", "consulta_pago", "consulta_servicio", "renovacion",
  "entrega_llaves", "solicitud_llaves", "propietario_liquidacion",
  "propietario_mantenimiento", "proveedor_seguimiento", "firma", "cita_firma",
  "poliza", "contrato", "condominio_cuota", "condominio_incidencia",
  "queja_conflicto", "emergencia", "tarea_recurrente", "comprobante_propietario",
  "datos_incompletos", "mensaje_social_spam", "multintencion", "otro", "no_determinado",
]);

export const MAX_SHADOW_TEXT = 2000;
const MAX_META_BYTES = 8000;
const PHONE = /(?<!\d)(?:\+?52[\s.-]?)?(?:\d[\s.-]?){10}(?!\d)/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL = /https?:\/\/[^\s]+/gi;
const BANK = /\b\d{16,18}\b/g;
const PERSONAL_ID = /\b[A-Z]{4}\d{6}[A-Z0-9]{8}\b/gi;

const clean = (value, max) => String(value ?? "").trim().slice(0, max);
export const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

export function sanitizeShadowText(value) {
  const original = clean(value, MAX_SHADOW_TEXT * 2);
  const sanitized = original
    .replace(EMAIL, "[EMAIL]")
    .replace(URL, "[URL]")
    .replace(BANK, "[CUENTA]")
    .replace(PERSONAL_ID, "[IDENTIFICADOR]")
    .replace(PHONE, "[TELEFONO]")
    .slice(0, MAX_SHADOW_TEXT);
  return { text: sanitized, changed: sanitized !== original, rejected: !sanitized.trim() };
}

function safeObject(value, allowed, maxBytes = MAX_META_BYTES) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const key of allowed) {
    const candidate = value[key];
    if (["string", "number", "boolean"].includes(typeof candidate)) result[key] = clean(candidate, 300);
  }
  return Buffer.byteLength(JSON.stringify(result)) <= maxBytes ? result : {};
}

export function validateShadowEnvelope(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Envelope inválido.");
  const provider = clean(input.provider, 32).toLowerCase();
  const direction = clean(input.direction, 16).toLowerCase();
  if (!SHADOW_PROVIDERS.has(provider)) throw new Error("Provider no permitido.");
  if (!SHADOW_DIRECTIONS.has(direction)) throw new Error("Dirección no permitida.");
  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw new Error("Fecha inválida.");
  const externalContactId = clean(input.externalContactId, 200);
  const externalConversationId = clean(input.externalConversationId, 200);
  if (!externalContactId || !externalConversationId) throw new Error("Contacto y conversación requeridos.");
  const sanitized = sanitizeShadowText(input.sanitizedText);
  const providerMetadata = safeObject(input.providerMetadata, [
    "area", "service", "team", "inbox", "tag", "propertyReference", "propertyId",
    "contractId", "paymentId", "serviceId", "ticketId", "keyId", "ownerPaymentId",
    "workCenterContextKey", "salesRelevant", "syntheticScenario", "eventType",
    "humanEcho", "phoneNumberIdHash", "messageType", "outOfOrder",
  ]);
  const attachmentMetadata = Array.isArray(input.attachmentMetadata)
    ? input.attachmentMetadata.slice(0, 5).map((item) => safeObject(item, ["type", "mimeType", "fileName", "size", "exists", "mediaIdHash"])).filter((item) => Object.keys(item).length)
    : [];
  const externalMessageId = clean(input.externalMessageId, 200) || null;
  const fingerprint = clean(input.payloadFingerprint, 64) || sha256(JSON.stringify({ provider, externalConversationId, direction, occurredAt: occurredAt.toISOString(), text: sanitized.text }));
  return {
    provider,
    externalEventId: clean(input.externalEventId, 200) || null,
    externalMessageId,
    externalConversationId,
    externalContactHash: sha256(`${provider}:${externalContactId}`),
    channel: clean(input.channel, 80) || "unknown",
    direction,
    occurredAt: occurredAt.toISOString(),
    sanitizedText: sanitized.text,
    sanitizationChanged: sanitized.changed,
    sanitizationRejected: sanitized.rejected,
    attachmentMetadata,
    providerMetadata,
    payloadFingerprint: fingerprint,
  };
}

const RULES = [
  ["enviar_comprobante_renta", /(?:comprobante|adjunto|mando|env[ií]o).*(?:renta)|renta.*comprobante/i],
  ["enviar_comprobante_servicio", /(?:adjunto|mando|env[ií]o).*(?:cfe|agua|luz|gas|recibo)/i],
  ["reportar_mantenimiento", /(?:fuga|sal(?:e|iendo) agua|no funciona|se descompuso|reparar)/i],
  ["seguimiento_mantenimiento", /t[eé]cnico.*(?:no lleg[oó]|nunca lleg[oó])|seguimiento.*mantenimiento|qued[oó] resuelto.*mantenimiento/i],
  ["proveedor_seguimiento", /t[eé]cnico.*(?:solicita|confirmar acceso)|proveedor.*seguimiento/i],
  ["propietario_liquidacion", /(?:pagaron|liquidaci[oó]n|entrega|dep[oó]sito).*(?:propietario|due[nñ]o)|propietario.*dep[oó]sito/i],
  ["consulta_servicio", /cu[aá]nto.*pagar.*(?:agua|luz|cfe|gas)|consulta.*servicio/i],
  ["solicitud_llaves", /(?:sacar|solicito|necesito).*(?:llave|llaves)/i],
  ["contrato", /cancelar.*contrato|contrato.*(?:cancelar|vence)|vence.*contrato/i],
  ["queja_conflicto", /problema legal|abogado|demanda|conflicto/i],
  ["emergencia", /no tengo luz|incendio|olor a gas|inundaci[oó]n/i],
  ["consulta_pago", /cu[aá]nto.*pagar|ya.*pagaron|pagar menos/i],
  ["mensaje_social_spam", /^\s*(hola|buen(?:os|as) d[ií]as|spam)\s*[.!]*$/i],
];

export function classifyShadowMessage(envelope) {
  if (envelope.direction === "outbound" && envelope.providerMetadata?.humanEcho === "true") {
    return {
      administrativeLikelihood: "unknown",
      reasonCodes: ["human_app_echo"],
      intent: "no_determinado",
      requiresHuman: false,
    };
  }
  const text = envelope.sanitizedText || "";
  let matches = RULES.filter(([, regex]) => regex.test(text)).map(([intent]) => intent);
  if (matches.includes("consulta_pago") && matches.some((intent) => ["consulta_servicio", "propietario_liquidacion"].includes(intent))) {
    matches = matches.filter((intent) => intent !== "consulta_pago");
  }
  const area = String(envelope.providerMetadata?.area || "").toLowerCase();
  const explicitAdmin = ["administracion", "administrativo", "operaciones"].includes(area);
  const salesConflict = envelope.providerMetadata?.salesRelevant === "true" || area === "ventas";
  const reasonCodes = [];
  if (explicitAdmin) reasonCodes.push("explicit_admin_area");
  if (envelope.providerMetadata?.service) reasonCodes.push("admin_custom_field");
  if (envelope.providerMetadata?.team || envelope.providerMetadata?.inbox) reasonCodes.push("admin_team_or_inbox");
  if (envelope.providerMetadata?.contractId) reasonCodes.push("active_contract_contact_match");
  if (envelope.providerMetadata?.propertyId || envelope.providerMetadata?.propertyReference) reasonCodes.push("property_reference_match");
  if (matches.length) reasonCodes.push("message_intent_hint_only");
  if (salesConflict) reasonCodes.push("sales_context_conflict");
  if (!reasonCodes.length) reasonCodes.push("insufficient_signals");
  let likelihood = "unknown";
  if (salesConflict && !explicitAdmin) likelihood = "low";
  else if (explicitAdmin && (matches.length || envelope.providerMetadata?.contractId)) likelihood = "high";
  else if (explicitAdmin || envelope.providerMetadata?.contractId) likelihood = "medium";
  else if (matches.length && !matches.includes("mensaje_social_spam")) likelihood = "low";
  const intent = matches.length > 1 ? "multintencion" : (matches[0] || "no_determinado");
  return { administrativeLikelihood: likelihood, reasonCodes, intent, requiresHuman: likelihood !== "high" || ["multintencion", "queja_conflicto"].includes(intent) };
}

export function transformRespondFixture(payload) {
  if (!payload || !["message.received", "message.sent"].includes(payload.event)) throw new Error("Evento Respond no soportado.");
  const message = payload.message || {};
  const contact = payload.contact || {};
  const conversation = payload.conversation || {};
  const text = message.text ?? message.message?.text ?? message.body ?? "";
  return validateShadowEnvelope({
    provider: "respond",
    externalEventId: payload.eventId || payload.id,
    externalMessageId: message.messageId || message.id,
    externalConversationId: conversation.id || message.conversationId || `contact:${contact.id || message.contactId}`,
    externalContactId: contact.id || message.contactId,
    channel: message.channelId || conversation.channelId || "respond",
    direction: payload.event === "message.received" ? "inbound" : "outbound",
    occurredAt: message.timestamp ? new Date(Number(message.timestamp) < 1e12 ? Number(message.timestamp) * 1000 : Number(message.timestamp)).toISOString() : payload.timestamp,
    sanitizedText: text,
    attachmentMetadata: [],
    providerMetadata: {
      area: contact.customFields?.atn_area,
      service: contact.customFields?.atn_servicio,
      team: contact.team?.name,
      inbox: conversation.inbox?.name,
      salesRelevant: contact.salesRelevant,
    },
  });
}

export function syntheticEnvelope({ id, text, metadata = {}, occurredAt = "2026-08-18T12:00:00.000Z" }) {
  const namespace = String(id).startsWith("FASE2A-P0-") ? String(id) : `FASE2A-P0-${id}`;
  return validateShadowEnvelope({
    provider: "synthetic", externalEventId: `${namespace}-event`, externalMessageId: namespace,
    externalConversationId: `${namespace}-conversation`, externalContactId: `${namespace}-contact`,
    channel: "fixture", direction: "inbound", occurredAt, sanitizedText: text,
    providerMetadata: { ...metadata, syntheticScenario: id }, attachmentMetadata: [],
  });
}

export async function ingestShadowEnvelope(admin, rawEnvelope) {
  const envelope = rawEnvelope?.externalContactHash && !rawEnvelope?.externalContactId
    ? rawEnvelope
    : validateShadowEnvelope(rawEnvelope);
  const classification = classifyShadowMessage(envelope);
  const { data, error } = await admin.rpc("ingest_shadow_message", {
    p_envelope: envelope, p_classification: classification,
  });
  if (error) throw error;
  return data;
}

export async function captureRespondShadowIsolated(admin, payload, { timeoutMs = 800 } = {}) {
  if (process.env.SHADOW_RESPOND_CAPTURE_ENABLED !== "true") return { status: "disabled" };
  if (process.env.VERCEL_ENV === "production" || process.env.SUPABASE_ENVIRONMENT === "production") return { status: "blocked_production" };
  try {
    return await Promise.race([
      ingestShadowEnvelope(admin, transformRespondFixture(payload)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("shadow_timeout")), timeoutMs)),
    ]);
  } catch (error) {
    console.error("[respond-shadow-isolated]", error?.message || "shadow_error");
    return { status: "isolated_error" };
  }
}
