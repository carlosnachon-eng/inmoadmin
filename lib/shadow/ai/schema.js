import { READ_ONLY_SHADOW_TOOLS, SHADOW_TOOL_ARGUMENT_SCHEMAS } from "../context.js";
import { CRITICAL_FACT_TYPES } from "./grounding.js";

export const SHADOW_AI_INTENTS = [
  "mantenimiento", "pago_renta", "devolucion_deposito", "servicio", "propietario_liquidacion", "contrato",
  "llaves", "juridico_conflicto", "saludo", "spam", "multintencion", "no_determinado",
];

export const SHADOW_AI_URGENCIES = ["low", "normal", "high", "critical"];
export const SHADOW_AI_OUTPUT_SCHEMA_VERSION = "shadow-ai-decision-v8";

export const shadowAiDecisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "secondaryIntents", "urgency", "summary", "entitiesMentioned", "resolvedEntities", "entityResolutionStatus", "informationNeeded", "proposedToolCalls", "contextAssessment", "proposedAction", "factualClaims", "conversationalResponseParts", "executionCommitment", "confidence", "requiresHuman", "escalationReason", "safetyFlags"],
  properties: {
    intent: { type: "string", enum: SHADOW_AI_INTENTS },
    secondaryIntents: { type: "array", maxItems: 5, items: { type: "string", enum: SHADOW_AI_INTENTS } },
    urgency: { type: "string", enum: SHADOW_AI_URGENCIES },
    summary: { type: "string", maxLength: 500 },
    entitiesMentioned: { type: "array", maxItems: 10, items: { type: "string", maxLength: 120 } },
    resolvedEntities: { type: "array", maxItems: 10, items: { type: "object", additionalProperties: false, required: ["entityType", "internalId", "label"], properties: {
      entityType: { type: "string", maxLength: 60 }, internalId: { type: "string", maxLength: 120 }, label: { type: "string", maxLength: 160 },
    } } },
    entityResolutionStatus: { type: "string", enum: ["resolved", "ambiguous", "unresolved", "not_applicable"] },
    informationNeeded: { type: "array", maxItems: 8, items: { type: "string", maxLength: 200 } },
    proposedToolCalls: { type: "array", maxItems: 10, items: { type: "object", additionalProperties: false, required: ["tool", "arguments", "reason"], properties: {
      tool: { type: "string", enum: READ_ONLY_SHADOW_TOOLS },
      arguments: { type: "object", additionalProperties: false, properties: Object.assign({}, ...Object.values(SHADOW_TOOL_ARGUMENT_SCHEMAS).map((schema) => schema.properties)) },
      reason: { type: "string", maxLength: 240 },
    } } },
    contextAssessment: { type: "string", maxLength: 1000 },
    proposedAction: { type: "string", maxLength: 500 },
    factualClaims: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["factType", "value", "evidenceIds"], properties: {
      factType: { type: "string", enum: CRITICAL_FACT_TYPES }, value: { type: ["string", "number", "boolean"] }, evidenceIds: { type: "array", maxItems: 5, items: { type: "string", maxLength: 180 } },
    } } },
    conversationalResponseParts: { type: "object", additionalProperties: false, required: ["acknowledgement", "verifiedFactReferences", "clarificationQuestion", "escalationMessage"], properties: {
      acknowledgement: { type: ["string", "null"], maxLength: 300 }, verifiedFactReferences: { type: "array", maxItems: 20, items: { type: "string", maxLength: 180 } },
      clarificationQuestion: { type: ["string", "null"], maxLength: 400 }, escalationMessage: { type: ["string", "null"], maxLength: 400 },
    } },
    executionCommitment: { type: "string", enum: ["none", "implied", "explicit"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    requiresHuman: { type: "boolean" },
    escalationReason: { type: ["string", "null"], maxLength: 500 },
    safetyFlags: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
  },
};

// Anthropic Structured Outputs accepts a deliberately smaller JSON Schema
// subset. Keep business constraints in validateShadowAiDecision and send only
// the grammar constraints supported by the provider.
const anthropicSchema = (value) => {
  if (Array.isArray(value)) return value.map(anthropicSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["maxItems","maxLength","minLength","minimum","maximum","format","oneOf"].includes(key))
    .map(([key, child]) => [key, anthropicSchema(child)]));
};
export const anthropicShadowAiDecisionJsonSchema = anthropicSchema(shadowAiDecisionJsonSchema);

export class ShadowAiStructuredOutputError extends Error {
  constructor(diagnosticCode) {
    super(`invalid_structured_output:${diagnosticCode}`);
    this.name = "ShadowAiStructuredOutputError";
    this.diagnosticCode = diagnosticCode;
    this.outputStage = "structured_validation";
  }
}

const invalid = (code) => { throw new ShadowAiStructuredOutputError(code); };
const requireStringArray = (value, max, itemMax, enumValues = null) => {
  if (!Array.isArray(value)) invalid("invalid_type");
  if (value.length > max) invalid("array_limit_exceeded");
  if (value.some((item) => typeof item !== "string")) invalid("invalid_type");
  if (value.some((item) => item.length > itemMax)) invalid("string_limit_exceeded");
  if (enumValues && value.some((item) => !enumValues.includes(item))) invalid("invalid_enum");
};

export function validateShadowAiDecision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("invalid_shape");
  const keys = Object.keys(shadowAiDecisionJsonSchema.properties);
  if (keys.some((key) => !(key in value))) invalid("missing_required_field");
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid("invalid_shape");
  if (typeof value.intent !== "string" || typeof value.urgency !== "string") invalid("invalid_type");
  if (!SHADOW_AI_INTENTS.includes(value.intent) || !SHADOW_AI_URGENCIES.includes(value.urgency)) invalid("invalid_enum");
  requireStringArray(value.secondaryIntents, 5, 80, SHADOW_AI_INTENTS);
  for (const [field, max, itemMax] of [["entitiesMentioned",10,120],["informationNeeded",8,200],["safetyFlags",10,80]]) requireStringArray(value[field], max, itemMax);
  const resolvedLimits = { entityType: 60, internalId: 120, label: 160 };
  if (!Array.isArray(value.resolvedEntities)) invalid("invalid_type");
  if (value.resolvedEntities.length > 10) invalid("array_limit_exceeded");
  for (const entry of value.resolvedEntities) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some((key) => !Object.hasOwn(resolvedLimits, key))) invalid("invalid_shape");
    if (Object.entries(resolvedLimits).some(([key]) => typeof entry[key] !== "string" || !entry[key].length)) invalid("invalid_type");
    if (Object.entries(resolvedLimits).some(([key, max]) => entry[key].length > max)) invalid("string_limit_exceeded");
  }
  if (typeof value.entityResolutionStatus !== "string") invalid("invalid_type");
  if (!["resolved","ambiguous","unresolved","not_applicable"].includes(value.entityResolutionStatus)) invalid("invalid_enum");
  if (!Array.isArray(value.proposedToolCalls)) invalid("invalid_type");
  if (value.proposedToolCalls.length > 10) invalid("array_limit_exceeded");
  for (const call of value.proposedToolCalls) {
    if (!call || typeof call !== "object" || Array.isArray(call) || Object.keys(call).some((key) => !["tool","arguments","reason"].includes(key))) invalid("invalid_shape");
    if (typeof call.tool !== "string" || !call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments) || typeof call.reason !== "string") invalid("invalid_type");
    if (!READ_ONLY_SHADOW_TOOLS.includes(call.tool)) invalid("invalid_enum");
    if (call.reason.length > 240) invalid("string_limit_exceeded");
  }
  for (const [field, max] of [["summary",500],["contextAssessment",1000],["proposedAction",500]]) {
    if (typeof value[field] !== "string") invalid("invalid_type");
    if (value[field].length > max) invalid("string_limit_exceeded");
  }
  if (!Array.isArray(value.factualClaims)) invalid("invalid_type");
  if (value.factualClaims.length > 20) invalid("array_limit_exceeded");
  for (const claim of value.factualClaims) {
    if (!claim || typeof claim !== "object" || Array.isArray(claim) || Object.keys(claim).some((key) => !["factType","value","evidenceIds"].includes(key))) invalid("invalid_shape");
    if (typeof claim.factType !== "string" || !["string","number","boolean"].includes(typeof claim.value)) invalid("invalid_type");
    if (!CRITICAL_FACT_TYPES.includes(claim.factType)) invalid("invalid_enum");
    requireStringArray(claim.evidenceIds, 5, 180);
  }
  const parts = value.conversationalResponseParts;
  if (!parts || typeof parts !== "object" || Array.isArray(parts) || Object.keys(parts).some((key) => !["acknowledgement","verifiedFactReferences","clarificationQuestion","escalationMessage"].includes(key))) invalid("invalid_shape");
  if (!["acknowledgement","verifiedFactReferences","clarificationQuestion","escalationMessage"].every((key) => key in parts)) invalid("missing_required_field");
  requireStringArray(parts.verifiedFactReferences,20,180);
  for (const [field,max] of [["acknowledgement",300],["clarificationQuestion",400],["escalationMessage",400]]) {
    if (parts[field] !== null && typeof parts[field] !== "string") invalid("invalid_type");
    if (typeof parts[field] === "string" && parts[field].length > max) invalid("string_limit_exceeded");
  }
  if (typeof value.executionCommitment !== "string") invalid("invalid_type");
  if (!["none","implied","explicit"].includes(value.executionCommitment)) invalid("invalid_enum");
  if (typeof value.confidence !== "number" || typeof value.requiresHuman !== "boolean") invalid("invalid_type");
  if (value.confidence < 0 || value.confidence > 1) invalid("invalid_shape");
  if (value.escalationReason !== null && typeof value.escalationReason !== "string") invalid("invalid_type");
  if (typeof value.escalationReason === "string" && value.escalationReason.length > 500) invalid("string_limit_exceeded");
  return value;
}
