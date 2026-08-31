export const IDENTITY_INDEPENDENT_ACTIONS = Object.freeze([
  "acknowledge_received_information", "ask_missing_information", "request_document", "clarify_property",
]);

const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const has = (pattern, value) => pattern.test(normalize(value));
const RECEIPT_STATEMENT = /\b(?:les?\s+)?(?:paso|mando|envio|comparto|adjunto|aqui esta)\b.{0,80}\b(?:comprobante|recibo|documento|archivo)\b/;
const RECEIPT_RISK = /\b(?:saldo|monto|parcial|transferencias?|comision|administracion|deposito|renta|cuanto|adeudo|debo|aplicad[oa]|confirmad[oa]|liquidad[oa]|banco|propietari[oa]|emporio)\b/;
const FINANCIAL_OR_SENSITIVE = /\b(?:saldo|renta|pag(?:o|ar|ue|ado|ada)|comision|deposito|adeudo|debo|obligacion|contrato|autoriza|negoci|jurid|legal|devolucion|cobranza|monto|transferencia)\b/;
const EMAIL_RECEIPT = /\b(?:paso|mando|envio|comparto|dejo)\b.{0,60}\b(?:correo|email)\b|\[email\]/;
const MAINTENANCE = /\b(?:humedad|fuga|gotera|filtracion|agua|moho|desperfecto|falla|dan[oa]|no funciona)\b/;
const MAINTENANCE_LOCATION = /\b(?:ban[oa]|cocina|recamara|habitacion|techo|pared|sala|patio|lavabo|regadera|ventana|piso|estacionamiento)\b/;
const PROPERTY_REFERENCE = /\b(?:depto|departamento|unidad|casa|local)\s*[a-z0-9-]{1,12}\b|\b[a-z]{1,6}\s*-?\s*\d{1,4}\b/;
const DOCUMENT_NEEDED = /\b(?:documento|archivo|comprobante|recibo|foto|imagen|evidencia)\b/;
const SAFE_MISSING = Object.freeze([
  [/\b(?:ubicacion|location|area|zona)\b/, "location", "maintenance_location"],
  [/\b(?:foto|imagen|evidencia|maintenance_photo)\b/, "maintenance_photo", "maintenance_photo"],
  [/\b(?:documento|archivo|document)\b/, "document", "document"],
  [/\b(?:asunto|tramite|administrative_pending)\b/, "administrative_subject", "administrative_subject"],
  [/\b(?:propiedad|unidad|property)\b/, "property_reference", "property_reference"],
]);

function result(overrides = {}) {
  return {
    allowed: false, action: null, kind: null, missing_information: [], confidence: 0,
    blocker: "identity_dependent_or_ambiguous", ...overrides,
  };
}

export function deriveIdentityIndependentContext({ caseDomain, text, documentPresent = false, missingInformation = [] } = {}) {
  const value = normalize(text);
  if (!value) return result({ blocker: "empty_customer_message" });
  const receiptStatement = RECEIPT_STATEMENT.test(value);
  if (receiptStatement && !RECEIPT_RISK.test(value) && documentPresent) return result({
    allowed: true, action: "acknowledge_received_information", kind: "document_received",
    confidence: 0.94, blocker: null,
  });
  if (FINANCIAL_OR_SENSITIVE.test(value)) return result({ blocker: "identity_dependent_or_sensitive_subject" });
  if (EMAIL_RECEIPT.test(value)) return result({
    allowed: true, action: "acknowledge_received_information", kind: "information_received",
    confidence: 0.94, blocker: null,
  });
  if (caseDomain === "maintenance" && MAINTENANCE.test(value)) {
    if (!MAINTENANCE_LOCATION.test(value)) return result({
      allowed: true, action: "ask_missing_information", kind: "maintenance_location",
      missing_information: ["location"], confidence: 0.9, blocker: null,
    });
    if (!documentPresent) return result({
      allowed: true, action: "request_document", kind: "maintenance_photo",
      missing_information: ["maintenance_photo"], confidence: 0.88, blocker: null,
    });
  }
  if (PROPERTY_REFERENCE.test(value)) return result({
    allowed: true, action: "clarify_property", kind: "property_reference",
    missing_information: ["property_reference"], confidence: 0.88, blocker: null,
  });

  const actionable = [...new Set(missingInformation)]
    .filter((item) => item !== "trusted_identity_link")
    .map((item) => SAFE_MISSING.find(([pattern]) => pattern.test(normalize(item))))
    .filter(Boolean);
  if (actionable.length !== 1) return result();
  const [, missing, kind] = actionable[0];
  if (kind === "document" || kind === "maintenance_photo") {
    if (documentPresent) return result({
      allowed: true, action: "acknowledge_received_information", kind: "document_received",
      confidence: 0.9, blocker: null,
    });
    return result({ allowed: true, action: "request_document", kind, missing_information: [missing], confidence: 0.84, blocker: null });
  }
  if (kind === "property_reference") return result({ allowed: true, action: "clarify_property", kind, missing_information: [missing], confidence: 0.84, blocker: null });
  return result({ allowed: true, action: "ask_missing_information", kind, missing_information: [missing], confidence: 0.84, blocker: null });
}

const IDENTITY_DEPENDENT_MESSAGE = /\b(?:saldo|renta|pago|comision|deposito|adeudo|obligacion|contrato|autoriza|negoci|jurid|legal|devolucion|cobranza|monto|transferencia|inquilin[oa]|propietari[oa]|tenant|owner)\b/;
const IMPLIED_OWNERSHIP = /\b(?:tu|tus|su|sus)\s+(?:propiedad|propiedades|unidad|unidades|contrato|renta)\b/;

export function validateIdentityIndependentMessage(message, context) {
  const text = normalize(message);
  if (!context?.allowed || !IDENTITY_INDEPENDENT_ACTIONS.includes(context?.action)) return { allowed: false, reason: "identity_independent_policy_not_satisfied" };
  if (!text) return { allowed: false, reason: "identity_independent_empty_message" };
  if (IDENTITY_DEPENDENT_MESSAGE.test(text) || IMPLIED_OWNERSHIP.test(text)) return { allowed: false, reason: "identity_dependent_message_semantics" };
  if (context.kind === "document_received" && !/\b(?:comprobante|documento|archivo|informacion)\b/.test(text)) return { allowed: false, reason: "document_receipt_not_acknowledged" };
  return { allowed: true, reason: null };
}

export function identityIndependentFutureEligibility({ action, resolution } = {}) {
  const context = resolution?.identity_independent_context;
  if (!context?.allowed || context.action !== action?.conversation_action) return { eligible: false, reason: "identity_not_confirmed" };
  if (!IDENTITY_INDEPENDENT_ACTIONS.includes(action.conversation_action)) return { eligible: false, reason: "identity_independent_action_not_allowlisted" };
  if (Number(context.confidence || 0) < 0.8) return { eligible: false, reason: "identity_independent_low_confidence" };
  if (action.conversation_action === "request_document" && resolution?.document_context?.equivalent_document_present === true) return { eligible: false, reason: "equivalent_document_already_present" };
  if (["ask_missing_information", "clarify_property"].includes(action.conversation_action) && context.missing_information?.length !== 1) return { eligible: false, reason: "question_not_single_and_concrete" };
  return { eligible: true, reason: "identity_independent_deterministic_safe_action" };
}
