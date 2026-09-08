import { createAnthropicShadowRepairResponse, createAnthropicShadowResponse } from "./anthropic.js";
import { SHADOW_AI_LIMITS } from "./guards.js";
import { buildEvidenceLedger } from "./grounding.js";
import { invokeSanitizedPhase3A, sanitizePreModelInput, verifyPreModelPayload } from "./preModelSanitizer.js";

const METADATA_TEXT_KEYS = Object.freeze(["area", "service", "subject", "contactRole", "authorRole", "turnAuthorRole", "propertyReference", "syntheticScenario"]);
const METADATA_REFERENCE_KEYS = Object.freeze(["propertyId", "contractId", "paymentId", "serviceId", "ticketId", "keyId", "ownerPaymentId", "workCenterContextKey"]);
const TOOL_ARGUMENT_KEYS = new Set(["respondContactId", "propertyReference", "propertyId", "contractId", "paymentId", "serviceId", "ticketId", "contextKey", "keyId", "ownerPaymentId", "recordId", "unitId", "clientIdentityId", "workItemId", "domain", "status", "sourceType", "sourceId"]);
const TOOL_RESULT_REFERENCE_KEYS = new Set(["internalId", "id", "contextKey", "linkId", "propertyId", "contractId", "clientIdentityId", "workItemId", "sourceId", "unitId", "evidenceId", "responsibleId"]);
const TOOL_RESULT_TEXT_KEYS = new Set(["label", "status", "linkSource", "method", "reasonCode", "startDate", "endDate", "renewal", "period", "priority", "category", "bucket", "paymentDestination", "commissionStatus", "sourceType", "domain"]);
const TOOL_RESULT_SCALAR_KEYS = new Set(["resolved", "conflicts", "ambiguousPropertyContext", "active", "confidence", "amount", "hasReceipt", "pending", "requiresAuthorization", "inCustody", "totalAmount", "paidAmount", "createdAt", "lastActionAt"]);
const ATTACHMENT_ITEM_KEYS = new Set(["type", "mimeType"]);
const INTERPRETATION_TEXT_KEYS = new Set(["interpretationStatus", "category", "summary", "reviewReason"]);
const INTERPRETATION_SCALAR_KEYS = new Set(["confidence", "requiresHumanReview"]);
const EXTRACTED_FIELD_KEYS = new Set(["amount", "currency", "date", "sender_bank", "recipient_bank", "observable_issues"]);

export class PreModelSanitizationBlockedError extends Error {
  constructor(reasons = []) {
    super("pre_model_sanitization_blocked");
    this.name = "PreModelSanitizationBlockedError";
    this.code = "pre_model_sanitization_blocked";
    this.reasons = [...new Set(reasons.map(String))].slice(0, 12);
  }
}

const boundedReference = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 120 && /^[A-Za-z0-9._:-]+$/u.test(trimmed) ? trimmed : null;
};

const safeScalar = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
};

const sanitizedText = (value, field) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const result = sanitizePreModelInput({ text: value });
  if (!result.allowed) throw new PreModelSanitizationBlockedError(result.reasons.map((reason) => `${field}:${reason}`));
  return result.payload.message;
};

const allowlistedArguments = (args = {}) => Object.fromEntries(Object.entries(args)
  .filter(([key]) => TOOL_ARGUMENT_KEYS.has(key))
  .map(([key, value]) => {
    if (["domain", "status", "sourceType", "propertyReference"].includes(key)) return [key, sanitizedText(value, `tool_arg.${key}`)];
    return [key, boundedReference(value)];
  })
  .filter(([, value]) => value !== null));

const allowlistedToolRow = (row = {}) => {
  const output = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (TOOL_RESULT_REFERENCE_KEYS.has(key)) {
      const reference = boundedReference(String(value ?? ""));
      if (reference) output[key] = reference;
    } else if (TOOL_RESULT_TEXT_KEYS.has(key)) {
      const text = sanitizedText(value, `tool_result.${key}`);
      if (text) output[key] = text;
    } else if (TOOL_RESULT_SCALAR_KEYS.has(key)) {
      const scalar = safeScalar(value);
      if (scalar !== null) output[key] = scalar;
    } else if (key === "roles" && Array.isArray(value)) {
      output.roles = value.map((item) => sanitizedText(item, "tool_result.roles")).filter(Boolean).slice(0, 8);
    }
  }
  return output;
};

const allowlistedInterpretation = (value = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (INTERPRETATION_TEXT_KEYS.has(key)) {
      const text = sanitizedText(item, `attachment.interpretation.${key}`);
      if (text) output[key] = text;
    } else if (INTERPRETATION_SCALAR_KEYS.has(key)) {
      const scalar = safeScalar(item);
      if (scalar !== null) output[key] = scalar;
    } else if (key === "extractedFields" && item && typeof item === "object" && !Array.isArray(item)) {
      output.extractedFields = Object.fromEntries(Object.entries(item).filter(([field]) => EXTRACTED_FIELD_KEYS.has(field)).map(([field, fieldValue]) => {
        const scalar = safeScalar(fieldValue);
        if (scalar !== null) return [field, scalar];
        if (Array.isArray(fieldValue)) return [field, fieldValue.map((entry) => sanitizedText(entry, `attachment.${field}`)).filter(Boolean).slice(0, 8)];
        return [field, sanitizedText(fieldValue, `attachment.${field}`)];
      }).filter(([, fieldValue]) => fieldValue !== null));
    }
  }
  return Object.keys(output).length ? output : null;
};

const allowlistedMetadata = (metadata = {}) => {
  const output = {};
  for (const key of METADATA_TEXT_KEYS) {
    const value = sanitizedText(metadata[key], `metadata.${key}`);
    if (value) output[key] = value;
  }
  for (const key of METADATA_REFERENCE_KEYS) {
    const value = boundedReference(String(metadata[key] ?? ""));
    if (value) output[key] = value;
  }
  if (Array.isArray(metadata.priorConversation)) {
    output.priorConversation = metadata.priorConversation.slice(-8).map((item) => ({
      direction: ["inbound", "outbound_human", "outbound_ai_inmoadmin", "outbound_respond_ai", "outbound_unknown"].includes(item?.direction) ? item.direction : "unknown",
      actor: ["contact", "emporio_human", "emporio_ai", "unknown"].includes(item?.actor) ? item.actor : "unknown",
      sanitizedText: sanitizedText(item?.sanitizedText, "metadata.priorConversation") || "[SIN_TEXTO]",
    }));
  }
  if (metadata.attachmentContext && typeof metadata.attachmentContext === "object") {
    output.attachmentContext = {
      present: metadata.attachmentContext.present === true,
      interpreted: metadata.attachmentContext.interpreted === true,
      items: Array.isArray(metadata.attachmentContext.items) ? metadata.attachmentContext.items.slice(0, 10).map((item) => {
        const safe = {};
        for (const key of ATTACHMENT_ITEM_KEYS) {
          const text = sanitizedText(item?.[key], `attachment.${key}`);
          if (text) safe[key] = text;
        }
        const interpretation = allowlistedInterpretation(item?.interpretation);
        if (interpretation) safe.interpretation = interpretation;
        return safe;
      }) : [],
    };
  }
  return output;
};

const allowlistedEvidence = (tools) => buildEvidenceLedger(tools).map((entry) => ({
  evidenceId: boundedReference(entry.evidenceId),
  domain: sanitizedText(entry.domain, "evidence.domain"),
  subjectId: boundedReference(entry.subjectId),
  facts: Object.fromEntries(Object.entries(entry.facts || {}).map(([key, value]) => {
    const scalar = safeScalar(value);
    return [key, scalar !== null ? scalar : sanitizedText(String(value), `evidence.${key}`)];
  }).filter(([, value]) => value !== null)),
  sourceTool: sanitizedText(entry.sourceTool, "evidence.sourceTool"),
})).filter((entry) => entry.evidenceId && entry.subjectId);

export function buildAllowlistedShadowAiContext({ envelope, deterministic, toolResults = [], round = 0, message }) {
  const messageVerification = verifyPreModelPayload({ message });
  if (!messageVerification.allowed) throw new PreModelSanitizationBlockedError(messageVerification.reasons);
  const interactionDirection = ["inbound_customer_action", "internal_instruction_about_customer", "outbound_system_echo", "ambiguous_actor"].includes(deterministic?.interactionDirection)
    ? deterministic.interactionDirection : "ambiguous_actor";
  const tools = toolResults.slice(0, 30).map((tool) => ({
    name: sanitizedText(tool?.name, "tool.name"),
    args: allowlistedArguments(tool?.args),
    result: Array.isArray(tool?.result) ? tool.result.slice(0, 25).map(allowlistedToolRow) : [],
    ok: tool?.ok === true,
    error: tool?.error ? sanitizedText(String(tool.error), "tool.error") : null,
  }));
  return {
    inputKind: envelope?.providerMetadata?.operationalEvent ? "operational_event" : "conversational_message",
    message,
    metadata: allowlistedMetadata(envelope?.providerMetadata || {}),
    deterministic: {
      intent: sanitizedText(deterministic?.intent, "deterministic.intent"),
      interactionDirection,
      requiresHuman: deterministic?.requiresHuman === true,
      reasonCodes: Array.isArray(deterministic?.reasonCodes) ? deterministic.reasonCodes.slice(0, 20).map((item) => sanitizedText(item, "deterministic.reasonCodes")).filter(Boolean) : [],
    },
    tools,
    evidenceLedger: allowlistedEvidence(toolResults),
    round: round + 1,
    remainingRounds: Math.max(0, SHADOW_AI_LIMITS.maxToolRounds - round - 1),
  };
}

export async function invokeShadowPhase3A({ envelope, deterministic, toolResults = [], round = 0, systemPrompt, toolGuide, modelCall = createAnthropicShadowResponse, modelOptions = {} }) {
  const outcome = await invokeSanitizedPhase3A({ text: envelope?.sanitizedText }, async ({ message }) => {
    const context = buildAllowlistedShadowAiContext({ envelope, deterministic, toolResults, round, message });
    return modelCall([
      { role: "system", content: `${systemPrompt}\n\n${toolGuide}` },
      { role: "user", content: JSON.stringify(context) },
    ], modelOptions);
  });
  if (!outcome.invoked) throw new PreModelSanitizationBlockedError(outcome.sanitization.reasons);
  return outcome.result;
}

export async function invokeShadowPhase3ARepair(invalidText, { repairModelCall = createAnthropicShadowRepairResponse, modelOptions = {} } = {}) {
  const verification = verifyPreModelPayload({ message: String(invalidText || "") });
  if (!verification.allowed) throw new PreModelSanitizationBlockedError(verification.reasons.map((reason) => `repair:${reason}`));
  return repairModelCall(invalidText, modelOptions);
}
