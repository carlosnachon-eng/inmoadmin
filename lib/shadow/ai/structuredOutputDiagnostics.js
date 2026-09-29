import { READ_ONLY_SHADOW_TOOLS, SHADOW_TOOL_ARGUMENT_SCHEMAS } from "../context.js";

const keyNotAllowed = "reduced_arguments_key_not_allowed_for_tool";
const knownKeys = new Set(Object.values(SHADOW_TOOL_ARGUMENT_SCHEMAS).flatMap((schema) => Object.keys(schema.properties)));
const failures = new WeakMap();

// Diagnostics only: this global vocabulary never authorizes an argument for a
// tool. Reproject at persistence, GET and UI; never echo values or unknown keys.
export function sanitizedStructuredOutputDiagnostics(value) {
  if (value?.outputStage !== "structured_validation" || value?.diagnosticCode !== keyNotAllowed) return null;
  const safe = { outputStage: "structured_validation", diagnosticCode: keyNotAllowed };
  const detail = value.structuredOutput;
  if (READ_ONLY_SHADOW_TOOLS.includes(detail?.tool) && knownKeys.has(detail?.argument_key)
    && !Object.hasOwn(SHADOW_TOOL_ARGUMENT_SCHEMAS[detail.tool].properties, detail.argument_key)) {
    safe.structuredOutput = { tool: detail.tool, argument_key: detail.argument_key };
  }
  return safe;
}

// The decoder supplies only the two structural fields, never the pair/value.
// An error with arbitrary model-supplied properties cannot forge this receipt.
export function recordStructuredOutputFailure(error, tool, argumentKey) {
  const safe = sanitizedStructuredOutputDiagnostics({ outputStage: error.outputStage,
    diagnosticCode: error.diagnosticCode, structuredOutput: { tool, argument_key: argumentKey } });
  if (safe) failures.set(error, safe);
}

export function projectStructuredOutputFailure(error) {
  return sanitizedStructuredOutputDiagnostics(failures.get(error));
}

export function reprojectStructuredOutputDiagnostics(value) {
  if (!value || typeof value !== "object") return value;
  const safe = sanitizedStructuredOutputDiagnostics(value);
  if (safe) return safe;
  const { structuredOutput, ...legacy } = value;
  return legacy;
}
