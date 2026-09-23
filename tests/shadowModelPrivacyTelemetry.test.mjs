import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createAnthropicShadowResponse } from "../lib/shadow/ai/anthropic.js";
import { invokeShadowPhase3A } from "../lib/shadow/ai/phase3AGateway.js";
import { modelPrivacyReceipt, sanitizedModelPrivacyChecks } from "../lib/shadow/ai/modelPrivacyTelemetry.js";
import { REAL_SHADOW_AI_SYSTEM_PROMPT, REAL_SHADOW_AI_TOOL_GUIDE } from "../lib/shadow/ai/realPrompt.js";

const internalId = "a1100000-0000-4000-8000-000000000001";
const safeMessages = [{ role: "user", content: "Hay humedad en la pared" }];
const pass = (output_mode = "anthropic_json_schema") => ({ final_payload_verified: true, serialized_body_verified: true, output_mode, privacy_stage: "final_model_privacy", provider_invoked: true });
const failure = (privacy_failure_code) => ({ privacy_stage: "final_model_privacy", privacy_failure_code, provider_invoked: false });
const response = { ok: true, json: async () => ({ id: "synthetic-response", content: [{ type: "text", text: "{}" }], usage: { input_tokens: 5, output_tokens: 2 } }) };

test("real gateway/transport receipts contain only booleans/enums in both output modes, never body/aliases/IDs", async () => {
  for (const outputMode of ["anthropic_json_schema", "text_json_local"]) {
    let calls = 0, capturedBody;
    const result = await invokeShadowPhase3A({
      envelope: { sanitizedText: "Hola Ana Perez, hay humedad. Mi correo es ana@example.com.", providerMetadata: { propertyId: internalId } },
      deterministic: { intent: "mantenimiento", requiresHuman: true },
      systemPrompt: REAL_SHADOW_AI_SYSTEM_PROMPT, toolGuide: REAL_SHADOW_AI_TOOL_GUIDE,
      modelOptions: { outputMode, env: { ANTHROPIC_API_KEY: "synthetic-key-only" }, fetchImpl: async (_url, options) => { calls++; capturedBody = options.body; return response; } },
    });
    assert.equal(calls, 1);
    assert.deepEqual(modelPrivacyReceipt(result), pass(outputMode));
    assert.match(capturedBody, /ref_[a-z]+_1/);
    assert.doesNotMatch(capturedBody, /a1100000|Ana Perez|ana@example.com|synthetic-key-only/);
    assert.doesNotMatch(JSON.stringify(modelPrivacyReceipt(result)), /ref_|a1100000|Ana|@|"messages"|"body"|hash|count|synthetic/);
    assert.equal(Object.keys(result).some((key) => /privacy|receipt/i.test(key)), false);
  }
});

test("complete final object failure has fixed failure receipt and zero fetch", async () => {
  for (const value of [internalId, "persona@example.com", "+52 222 123 4567", "CLABE 012345678901234567", "sk-ant-syntheticSecret123456"]) {
    let calls = 0;
    await assert.rejects(createAnthropicShadowResponse([{ role: "user", content: JSON.stringify({ futureMetadata: { nested: value } }) }], {
      fetchImpl: async () => { calls++; return response; },
    }), (error) => {
      assert.equal(error.code, "pre_model_sanitization_blocked");
      assert.deepEqual(modelPrivacyReceipt(error), failure("final_payload_rejected"));
      assert.ok(!JSON.stringify(modelPrivacyReceipt(error)).includes(value));
      return true;
    });
    assert.equal(calls, 0);
  }
});

test("actual serialized string rejection is distinct from object rejection, with zero fetch", async () => {
  const stringify = JSON.stringify; let calls = 0;
  try {
    // Synthetic fault injection only: the object passes unchanged verification,
    // but the exact string produced for fetch now has a forbidden residual.
    JSON.stringify = (value, ...args) => value?.max_tokens === 1400
      ? stringify({ ...value, future: internalId }, ...args) : stringify(value, ...args);
    await assert.rejects(createAnthropicShadowResponse(safeMessages, { fetchImpl: async () => { calls++; return response; } }), (error) => {
      assert.deepEqual(modelPrivacyReceipt(error), failure("serialized_body_rejected"));
      return true;
    });
  } finally { JSON.stringify = stringify; }
  assert.equal(calls, 0);
});

test("serialization exception does not expose its raw message and does not invoke provider", async () => {
  const stringify = JSON.stringify; let calls = 0;
  try {
    JSON.stringify = (value, ...args) => {
      if (value?.max_tokens === 1400) throw new Error(`synthetic serialization fault ${internalId}`);
      return stringify(value, ...args);
    };
    await assert.rejects(createAnthropicShadowResponse(safeMessages, { fetchImpl: async () => { calls++; return response; } }), (error) => {
      assert.deepEqual(modelPrivacyReceipt(error), failure("body_serialization_failed"));
      return true;
    });
  } finally { JSON.stringify = stringify; }
  assert.equal(calls, 0);
});

test("provider errors preserve PASS evidence, not a false pre-provider FAIL", async () => {
  await assert.rejects(createAnthropicShadowResponse(safeMessages, { fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) }), (error) => {
    assert.deepEqual(modelPrivacyReceipt(error), pass());
    assert.equal(error.message, "model_http_429"); return true;
  });
});

test("transport mode validation precedes provider, without leaking invalid mode", async () => {
  await assert.rejects(createAnthropicShadowResponse(safeMessages, { outputMode: internalId, fetchImpl: async () => assert.fail("no fetch") }), (error) => {
    assert.deepEqual(modelPrivacyReceipt(error), failure("pre_provider_failed")); return true;
  });
});

test("telemetry projection drops unknown fields, arbitrary codes/modes, and never infers legacy PASS", () => {
  const contaminated = { ...pass(), body: internalId, aliases: ["ref_private_1"], secret: "sk-ant-synthetic", hash: "f".repeat(64), count: 2 };
  assert.deepEqual(sanitizedModelPrivacyChecks([contaminated]), [pass()]);
  assert.deepEqual(sanitizedModelPrivacyChecks([{ ...failure("final_payload_rejected"), body: internalId }]), [failure("final_payload_rejected")]);
  for (const value of [undefined, null, {}, [], [true], [{ ...pass(), output_mode: internalId }], [{ ...pass(), final_payload_verified: "true" }], [{ ...failure(internalId) }]]) {
    assert.deepEqual(sanitizedModelPrivacyChecks(value), []);
  }
  assert.equal(modelPrivacyReceipt({ privacyReceipt: pass(), privacyChecks: [pass()], outputMode: "anthropic_json_schema" }), null);
});

test("telemetry is emitted at both existing verification sites and fetch uses that same string", () => {
  const privacy = fs.readFileSync(new URL("../lib/shadow/ai/finalModelPrivacy.js", import.meta.url), "utf8");
  const transport = fs.readFileSync(new URL("../lib/shadow/ai/anthropic.js", import.meta.url), "utf8");
  assert.match(privacy, /assertVerified\(body, scope, true\);\s*onVerified\("final_payload_verified"\)/);
  assert.match(privacy, /assertVerified\(JSON\.parse\(serialized\), scope, true\);\s*onVerified\("serialized_body_verified"\)/);
  assert.match(transport, /body: serializedBody/);
  assert.doesNotMatch(transport, /console\.|JSON\.stringify\(body\)/);
});
