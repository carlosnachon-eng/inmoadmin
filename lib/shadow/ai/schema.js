export const SHADOW_AI_INTENTS = [
  "mantenimiento", "pago_renta", "servicio", "propietario_liquidacion", "contrato",
  "llaves", "juridico_conflicto", "saludo", "spam", "multintencion", "no_determinado",
];

export const SHADOW_AI_URGENCIES = ["low", "normal", "high", "critical"];

export const shadowAiDecisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "secondaryIntents", "urgency", "summary", "entitiesMentioned", "resolvedEntities", "entityResolutionStatus", "informationNeeded", "proposedToolCalls", "contextAssessment", "proposedAction", "proposedResponse", "confidence", "requiresHuman", "escalationReason", "safetyFlags"],
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
    proposedResponse: { type: "string", maxLength: 1000 },
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

const isStringArray = (value, max, itemMax) => Array.isArray(value) && value.length <= max && value.every((item) => typeof item === "string" && item.length <= itemMax);
export function validateShadowAiDecision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_structured_output");
  const keys = Object.keys(shadowAiDecisionJsonSchema.properties);
  if (Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) throw new Error("invalid_structured_output");
  if (!SHADOW_AI_INTENTS.includes(value.intent) || !SHADOW_AI_URGENCIES.includes(value.urgency)) throw new Error("invalid_structured_output");
  if (!isStringArray(value.secondaryIntents, 5, 80) || value.secondaryIntents.some((x) => !SHADOW_AI_INTENTS.includes(x))) throw new Error("invalid_structured_output");
  for (const [field, max, itemMax] of [["entitiesMentioned",10,120],["informationNeeded",8,200],["safetyFlags",10,80]]) if (!isStringArray(value[field], max, itemMax)) throw new Error("invalid_structured_output");
  const resolvedLimits = { entityType: 60, internalId: 120, label: 160 };
  if (!Array.isArray(value.resolvedEntities) || value.resolvedEntities.length > 10 || value.resolvedEntities.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some((key) => !Object.hasOwn(resolvedLimits, key)) || Object.entries(resolvedLimits).some(([key, max]) => typeof entry[key] !== "string" || !entry[key].length || entry[key].length > max))) throw new Error("invalid_structured_output");
  if (!["resolved","ambiguous","unresolved","not_applicable"].includes(value.entityResolutionStatus)) throw new Error("invalid_structured_output");
  if (!Array.isArray(value.proposedToolCalls) || value.proposedToolCalls.length > 10 || value.proposedToolCalls.some((call) => !call || typeof call !== "object" || Array.isArray(call) || Object.keys(call).some((key) => !["tool","arguments","reason"].includes(key)) || !READ_ONLY_SHADOW_TOOLS.includes(call.tool) || !call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments) || typeof call.reason !== "string" || call.reason.length > 240)) throw new Error("invalid_structured_output");
  for (const [field, max] of [["summary",500],["contextAssessment",1000],["proposedAction",500],["proposedResponse",1000]]) if (typeof value[field] !== "string" || value[field].length > max) throw new Error("invalid_structured_output");
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1 || typeof value.requiresHuman !== "boolean") throw new Error("invalid_structured_output");
  if (value.escalationReason !== null && (typeof value.escalationReason !== "string" || value.escalationReason.length > 500)) throw new Error("invalid_structured_output");
  return value;
}
import { READ_ONLY_SHADOW_TOOLS, SHADOW_TOOL_ARGUMENT_SCHEMAS } from "../context.js";
