import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_AGENT_V2_TOOL_NAMES,
  assertAdminAgentV2Environment,
  assertAdminAgentV2ShadowEnvironment,
  buildAdminAgentV2Config,
  buildAdminAgentV2Tools,
  pendingFunctionCalls,
} from "../lib/agentsV2/openaiAdminAgent.js";

const safeEnv = {
  ADMIN_AGENT_V2_ENABLED: "true",
  VERCEL_ENV: "development",
  SUPABASE_ENVIRONMENT: "dev",
  SHADOW_OUTBOUND_ENABLED: "false",
  SHADOW_ADMIN_OUTBOUND_ENABLED: "false",
  OPENAI_API_KEY: "test-only",
  OPENAI_ADMIN_AGENT_MODEL: "test-model",
};

test("V2 only exposes the intended read-only tools", () => {
  const tools = buildAdminAgentV2Tools();
  assert.deepEqual(tools.map((tool) => tool.name), [...ADMIN_AGENT_V2_TOOL_NAMES]);
  assert.ok(tools.every((tool) => tool.type === "function"));
  assert.ok(tools.every((tool) => tool.parameters?.additionalProperties === false));
});

test("V2 is fail-closed in production", () => {
  assert.throws(() => assertAdminAgentV2Environment({ ...safeEnv, VERCEL_ENV: "production" }), /production_forbidden/);
  assert.throws(() => assertAdminAgentV2Environment({ ...safeEnv, SUPABASE_ENVIRONMENT: "production" }), /production_forbidden/);
});

test("V2 refuses any outbound-enabled environment", () => {
  assert.throws(() => assertAdminAgentV2Environment({ ...safeEnv, SHADOW_OUTBOUND_ENABLED: "true" }), /outbound_forbidden/);
  assert.throws(() => assertAdminAgentV2Environment({ ...safeEnv, SHADOW_ADMIN_OUTBOUND_ENABLED: "true" }), /outbound_forbidden/);
});

test("V2 requires an explicit OpenAI model and key", () => {
  assert.throws(() => assertAdminAgentV2Environment({ ...safeEnv, OPENAI_API_KEY: "" }), /api_key_required/);
  assert.throws(() => assertAdminAgentV2Environment({ ...safeEnv, OPENAI_ADMIN_AGENT_MODEL: "" }), /model_required/);
});

test("agent configuration has no sandbox and no mutation tools", () => {
  const config = buildAdminAgentV2Config(safeEnv);
  assert.equal(config.model, "test-model");
  assert.deepEqual(config.tools.map((tool) => tool.name), [...ADMIN_AGENT_V2_TOOL_NAMES]);
  assert.match(config.instructions, /read-only/i);
  assert.doesNotMatch(config.tools.map((tool) => tool.name).join(" "), /create|update|delete|send|close|approve/i);
});

test("pending action filter ignores unknown function calls", () => {
  const calls = pendingFunctionCalls({
    required_actions: [
      { type: "function_call", name: "resolve_contact_identity", call_id: "1" },
      { type: "function_call", name: "delete_contract", call_id: "2" },
      { type: "environment_connection", name: "resolve_contact_identity", call_id: "3" },
    ],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].call_id, "1");
});


test("production Shadow V2 needs a second explicit gate and outbound stays forbidden", () => {
  const production = {
    ...safeEnv,
    VERCEL_ENV: "production",
    SUPABASE_ENVIRONMENT: "production",
    ADMIN_AGENT_V2_PRODUCTION_SHADOW_ENABLED: "false",
  };
  assert.throws(() => assertAdminAgentV2ShadowEnvironment(production), /production_shadow_disabled/);
  assert.doesNotThrow(() => assertAdminAgentV2ShadowEnvironment({ ...production, ADMIN_AGENT_V2_PRODUCTION_SHADOW_ENABLED: "true" }));
  assert.throws(() => assertAdminAgentV2ShadowEnvironment({
    ...production,
    ADMIN_AGENT_V2_PRODUCTION_SHADOW_ENABLED: "true",
    SHADOW_OUTBOUND_ENABLED: "true",
  }), /outbound_forbidden/);
});


test("provider identity resolver is exposed as read-only V2 tool", () => {
  const tools = buildAdminAgentV2Tools();
  const provider = tools.find((item) => item.name === "resolve_provider_identity");
  assert.ok(provider);
  assert.equal(provider.type, "function");
  assert.equal(provider.parameters.required[0], "respondContactId");
});
