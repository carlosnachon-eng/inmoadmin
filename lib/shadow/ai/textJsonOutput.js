import { validateShadowAiDecision } from "./schema.js";

const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i;

export function stripDeterministicJsonFence(value) {
  const text = String(value ?? "").trim();
  const match = text.match(fenced);
  return match ? match[1].trim() : text;
}

export function parseAndValidateShadowAiText(value) {
  const telemetry = { parse_success: false, schema_success: false, repair_attempted: false, repair_success: false, invalid_output: false };
  let parsed;
  try {
    parsed = JSON.parse(stripDeterministicJsonFence(value));
    telemetry.parse_success = true;
  } catch {
    telemetry.invalid_output = true;
    const error = new Error("invalid_structured_output:json_parse_error");
    error.diagnosticCode = "json_parse_error"; error.outputStage = "json_parsing"; error.outputTelemetry = telemetry;
    throw error;
  }
  try {
    const decision = validateShadowAiDecision(parsed);
    telemetry.schema_success = true;
    return { decision, telemetry };
  } catch (error) {
    telemetry.invalid_output = true; error.outputTelemetry = telemetry; throw error;
  }
}

export async function validateWithSingleRepair(value, { repair = null } = {}) {
  try { return parseAndValidateShadowAiText(value); }
  catch (firstError) {
    if (typeof repair !== "function") throw firstError;
    const telemetry = { ...firstError.outputTelemetry, repair_attempted: true };
    const repaired = await repair(String(value ?? ""));
    try {
      const result = parseAndValidateShadowAiText(repaired?.text);
      return { ...result, repairResult: repaired, telemetry: { ...result.telemetry, repair_attempted: true, repair_success: true, invalid_output: false } };
    } catch (repairError) {
      repairError.outputTelemetry = { ...repairError.outputTelemetry, repair_attempted: true, repair_success: false, invalid_output: true };
      repairError.repairResult = repaired; throw repairError;
    }
  }
}
