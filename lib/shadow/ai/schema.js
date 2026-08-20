export const SHADOW_AI_INTENTS = [
  "mantenimiento", "pago_renta", "servicio", "propietario_liquidacion", "contrato",
  "llaves", "juridico_conflicto", "saludo", "spam", "multintencion", "no_determinado",
];

export const SHADOW_AI_URGENCIES = ["low", "normal", "high", "critical"];

export const shadowAiDecisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "secondaryIntents", "urgency", "summary", "entitiesMentioned", "informationNeeded", "proposedToolCalls", "contextAssessment", "proposedAction", "proposedResponse", "confidence", "requiresHuman", "escalationReason", "safetyFlags"],
  properties: {
    intent: { type: "string", enum: SHADOW_AI_INTENTS },
    secondaryIntents: { type: "array", maxItems: 5, items: { type: "string", enum: SHADOW_AI_INTENTS } },
    urgency: { type: "string", enum: SHADOW_AI_URGENCIES },
    summary: { type: "string", maxLength: 500 },
    entitiesMentioned: { type: "array", maxItems: 10, items: { type: "string", maxLength: 120 } },
    informationNeeded: { type: "array", maxItems: 8, items: { type: "string", maxLength: 200 } },
    proposedToolCalls: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
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
export const anthropicShadowAiDecisionJsonSchema = {
  ...shadowAiDecisionJsonSchema,
  properties: Object.fromEntries(Object.entries(shadowAiDecisionJsonSchema.properties).map(([key, value]) => {
    const { maxItems, maxLength, minimum, maximum, ...supported } = value;
    if (!supported.items) return [key, supported];
    const { maxLength: itemMaxLength, ...supportedItems } = supported.items;
    return [key, { ...supported, items: supportedItems }];
  })),
};

const isStringArray = (value, max, itemMax) => Array.isArray(value) && value.length <= max && value.every((item) => typeof item === "string" && item.length <= itemMax);
export function validateShadowAiDecision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_structured_output");
  const keys = Object.keys(shadowAiDecisionJsonSchema.properties);
  if (Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) throw new Error("invalid_structured_output");
  if (!SHADOW_AI_INTENTS.includes(value.intent) || !SHADOW_AI_URGENCIES.includes(value.urgency)) throw new Error("invalid_structured_output");
  if (!isStringArray(value.secondaryIntents, 5, 80) || value.secondaryIntents.some((x) => !SHADOW_AI_INTENTS.includes(x))) throw new Error("invalid_structured_output");
  for (const [field, max, itemMax] of [["entitiesMentioned",10,120],["informationNeeded",8,200],["proposedToolCalls",10,80],["safetyFlags",10,80]]) if (!isStringArray(value[field], max, itemMax)) throw new Error("invalid_structured_output");
  for (const [field, max] of [["summary",500],["contextAssessment",1000],["proposedAction",500],["proposedResponse",1000]]) if (typeof value[field] !== "string" || value[field].length > max) throw new Error("invalid_structured_output");
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1 || typeof value.requiresHuman !== "boolean") throw new Error("invalid_structured_output");
  if (value.escalationReason !== null && (typeof value.escalationReason !== "string" || value.escalationReason.length > 500)) throw new Error("invalid_structured_output");
  return value;
}
