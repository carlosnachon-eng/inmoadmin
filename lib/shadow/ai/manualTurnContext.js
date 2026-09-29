// A server-only, execution-scoped capability. Neither request JSON nor an env
// flag can select the reduced contract on the general Shadow entry point.
import { MANUAL_PROD_MODE, MANUAL_PROD_GATE, manualProductionRuntime } from "./manualTurnProductionPolicy.js";
export const MANUAL_TURN_MODE = "manual_dev_one_turn";
export const MANUAL_TURN_PROMPT = "manual-dev-one-turn-v1";
export const MANUAL_TURN_DEV_REF = "hjfwjnejbcpmknvfpdcq";
export const MANUAL_TURN_OFF_GATES = Object.freeze([
  "SHADOW_ADMIN_OUTBOUND_ENABLED", "SHADOW_OUTBOUND_ENABLED", "SHADOW_ADMIN_WORK_R1_ENABLED",
  "SHADOW_ADMIN_OUTBOUND_CANARY_ENABLED", "SHADOW_CLIENT_RECONCILIATION_PREPARE_ENABLED",
  "SHADOW_CLIENT_RECONCILIATION_WRITE_ENABLED", "SHADOW_IDENTITY_CONFIRMATION_ENABLED",
  "SHADOW_AI_AUTO_REAL_ENABLED", "SHADOW_HISTORICAL_REPLAY_ANTHROPIC_ENABLED",
  "SHADOW_AI_ENABLED", "SHADOW_AI_PRODUCTION_ENABLED", "SHADOW_AI_ALLOW_REAL_MESSAGES",
  "SHADOW_AI_MANUAL_REAL_ENABLED",
  "SHADOW_IDENTITY_LINK_REVIEW_WRITE_ENABLED", "SHADOW_AI_BACKFILL_REAL_ENABLED", "SHADOW_AI_ALLOW_OPERATIONAL_EVENTS",
  "SHADOW_AI_EXPLICIT_RETRY_ENABLED",
]);
const active = new WeakSet();
const production = new WeakMap();
export const isManualTurnMode = (mode) => [MANUAL_TURN_MODE, MANUAL_PROD_MODE].includes(mode);
export function assertManualTurnProduction(env) {
  const runtime=manualProductionRuntime(env);
  if (env[MANUAL_PROD_GATE] !== "true" || env.SHADOW_CONVERSATION_ACTIONS_ENABLED !== "true"
    || env.SHADOW_AI_OUTPUT_MODE !== "anthropic_json_schema"
    || MANUAL_TURN_OFF_GATES.some((key) => env[key] !== "false")) throw new Error("manual_prod_window_disabled");
  return runtime;
}
export function manualProductionGates(env) {
  return Object.fromEntries([...MANUAL_TURN_OFF_GATES, MANUAL_PROD_GATE, "SHADOW_MANUAL_TURN_DEV_ENABLED", "SHADOW_CONVERSATION_ACTIONS_ENABLED"]
    .map(key=>[key, env[key] === "true" ? true : env[key] === "false" ? false : null]));
}
export function assertManualTurnDev(env = process.env) {
  if (env.VERCEL_ENV || env.VERCEL || env.SHADOW_MANUAL_TURN_DEV_ENABLED !== "true"
    || env.NEXT_PUBLIC_SUPABASE_URL !== `https://${MANUAL_TURN_DEV_REF}.supabase.co`
    || env.SHADOW_CONVERSATION_ACTIONS_ENABLED !== "true"
    || env.SHADOW_AI_OUTPUT_MODE !== "anthropic_json_schema"
    || MANUAL_TURN_OFF_GATES.some((key) => env[key] !== "false")) throw new Error("manual_turn_dev_isolation_required");
}
export function assertManualTurnContext(context) {
  if (!context || !active.has(context)) throw new Error("manual_turn_context_required");
}
export function assertManualTurnExecution(context, env) {
  assertManualTurnContext(context);
  if (production.has(context)) { assertManualTurnProduction(env); return MANUAL_PROD_MODE; }
  assertManualTurnDev(env); return MANUAL_TURN_MODE;
}
export async function withManualProductionContext(env, reserve, callback) {
  assertManualTurnProduction(env);
  if (typeof reserve !== "function") throw new Error("manual_prod_reservation_required");
  const context=Object.freeze({}); active.add(context); production.set(context,{env,reserve,round:0});
  try { return await callback(context); } finally { active.delete(context); production.delete(context); }
}
// Invoked only by the bound manual transport AFTER both privacy checks and
// immediately BEFORE fetch. Failed/uncertain reservations are never retried.
export async function reserveManualTurnTransmission(context, signal) {
  assertManualTurnContext(context);
  const state=production.get(context);
  if (!state) return; // Certified DEV path is unchanged.
  assertManualTurnProduction(state.env);
  if (signal?.aborted) throw new Error("manual_turn_timeout");
  if (++state.round > 2) throw new Error("manual_prod_transmission_limit");
  await state.reserve(state.round);
  assertManualTurnContext(context);
  assertManualTurnProduction(state.env);
  if (signal?.aborted) throw new Error("manual_turn_timeout");
}
export async function withManualTurnContext(env, callback) {
  assertManualTurnDev(env);
  const context = Object.freeze({}); active.add(context);
  try { return await callback(context); } finally { active.delete(context); }
}

// Supabase builders are thenables; preserve chaining/await without exposing
// their client, schema, RPC or mutation methods to any Shadow tool/preloader.
export function readOnlyShadowDatabase(db) {
  const allowed = new Set(["select", "eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "not", "or", "filter", "match", "like", "ilike", "contains", "containedBy", "overlaps", "order", "limit", "range", "single", "maybeSingle", "abortSignal", "then", "catch", "finally"]);
  const wrap = (builder) => new Proxy(Object.create(null), { get(_target, key) {
    if (key === Symbol.toStringTag) return "ReadOnlyShadowQuery";
    if (!allowed.has(key) || typeof builder[key] !== "function") throw new Error("manual_tool_write_forbidden");
    return (...args) => {
      const value = builder[key](...args);
      return ["then", "catch", "finally"].includes(key) ? value : wrap(value);
    };
  } });
  return Object.freeze({ from: (table) => wrap(db.from(table)), rpc: () => { throw new Error("manual_tool_write_forbidden"); } });
}
