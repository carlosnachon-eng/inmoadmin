// Wire adapter for the isolated Historical Replay path. General 3A retains its
// original schema/decoder; the validated internal decision contract is unchanged.
import { SHADOW_TOOL_ARGUMENT_SCHEMAS, validateShadowToolArguments } from "../context.js";
import { anthropicShadowAiDecisionJsonSchema, validateShadowAiDecision, ShadowAiStructuredOutputError } from "./schema.js";
import { decodeModelDecisionReferences } from "./finalModelPrivacy.js";

const invalid = (code) => { throw new ShadowAiStructuredOutputError(`reduced_arguments_${code}`); };
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function argumentKeys() {
  const definitions = Object.values(SHADOW_TOOL_ARGUMENT_SCHEMAS).flatMap((schema) => Object.entries(schema.properties));
  // Do not silently stringify a future non-string argument type.
  if (definitions.some(([, definition]) => definition.type !== "string")) invalid("unsupported_contract");
  return [...new Set(definitions.map(([key]) => key))];
}

export function buildReducedAnthropicDecisionSchema() {
  const schema = structuredClone(anthropicShadowAiDecisionJsonSchema);
  schema.properties.proposedToolCalls.items.properties.arguments = {
    type: "array",
    items: {
      type: "object", additionalProperties: false, required: ["key", "value"],
      properties: { key: { type: "string", enum: argumentKeys() }, value: { type: "string" } },
    },
  };
  return schema;
}

// Input: JSON-parsed wire decision + ORIGINAL result bound by the gateway to
// its in-memory privacy scope. No unverified/partially decoded result escapes.
// All calls validate before the caller can execute even the first tool.
export function decodeReducedShadowAiDecision(wireDecision, modelResult) {
  if (!isRecord(wireDecision) || !Array.isArray(wireDecision.proposedToolCalls)) invalid("shape");
  if (wireDecision.proposedToolCalls.length > 10) invalid("call_limit");
  const maxArguments = argumentKeys().length;
  const expanded = {
    ...wireDecision,
    proposedToolCalls: wireDecision.proposedToolCalls.map((call) => {
      if (!isRecord(call) || !Object.hasOwn(SHADOW_TOOL_ARGUMENT_SCHEMAS, call.tool)) invalid("tool");
      if (!Array.isArray(call.arguments) || call.arguments.length > maxArguments) invalid("shape");
      const args = {};
      for (const pair of call.arguments) {
        if (!isRecord(pair) || Object.keys(pair).length !== 2 || !Object.hasOwn(pair, "key") || !Object.hasOwn(pair, "value")) invalid("pair_shape");
        if (typeof pair.key !== "string" || !Object.hasOwn(SHADOW_TOOL_ARGUMENT_SCHEMAS[call.tool].properties, pair.key)) invalid("key_not_allowed_for_tool");
        if (Object.hasOwn(args, pair.key)) invalid("duplicate_key");
        if (typeof pair.value !== "string") invalid("value_type");
        args[pair.key] = pair.value;
      }
      return { ...call, arguments: args };
    }),
  };
  validateShadowAiDecision(expanded);
  // Reconstruct named fields BEFORE the existing privacy/type/round checks.
  // Raw IDs and aliases in free text must still fail, not bypass via pair.value.
  const decoded = decodeModelDecisionReferences(expanded, modelResult);
  for (const call of decoded.proposedToolCalls) {
    call.arguments = validateShadowToolArguments(call.tool, call.arguments);
  }
  return decoded;
}

// Reproducible structural metrics, NOT the provider's compiled grammar size.
// Presence combinations count independent optional-property subsets only;
// array lengths, enum choices, recursion and compiler optimizations are excluded.
export function measureOutputSchema(schema) {
  const stats = { bytes: Buffer.byteLength(JSON.stringify(schema), "utf8"), schemaNodes: 0,
    objects: 0, arrays: 0, properties: 0, optionalProperties: 0, unionParameters: 0,
    unionAlternatives: 0, combinatorBranches: 0, enumValues: 0, maxContainerDepth: 0 };
  function visit(node, depth) {
    if (!isRecord(node)) return;
    stats.schemaNodes++;
    const container = node.type === "object" || node.type === "array";
    const nextDepth = depth + Number(container);
    stats.maxContainerDepth = Math.max(stats.maxContainerDepth, nextDepth);
    if (node.type === "object") {
      stats.objects++;
      const keys = Object.keys(node.properties || {});
      stats.properties += keys.length;
      stats.optionalProperties += keys.filter((key) => !(node.required || []).includes(key)).length;
    }
    if (node.type === "array") stats.arrays++;
    if (Array.isArray(node.type)) { stats.unionParameters++; stats.unionAlternatives += node.type.length; }
    for (const combinator of ["anyOf", "oneOf", "allOf"]) {
      if (Array.isArray(node[combinator])) {
        if (combinator !== "allOf") stats.unionParameters++;
        stats.combinatorBranches += node[combinator].length;
        node[combinator].forEach((child) => visit(child, nextDepth));
      }
    }
    stats.enumValues += node.enum?.length || 0;
    Object.values(node.properties || {}).forEach((child) => visit(child, nextDepth));
    if (node.items) visit(node.items, nextDepth);
  }
  visit(schema, 0);
  return { ...stats, optionalPresenceCombinations: (2n ** BigInt(stats.optionalProperties)).toString() };
}
