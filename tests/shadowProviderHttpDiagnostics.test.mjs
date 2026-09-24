import test from "node:test";
import assert from "node:assert/strict";
import { projectProviderHttpError, sanitizedProviderHttpDiagnostics, opaqueProviderRequestRef, replayProviderUsage, replayUsageColumns, storedReplayProviderAccounting } from "../lib/shadow/ai/providerHttpDiagnostics.js";
import { createAnthropicShadowResponse } from "../lib/shadow/ai/anthropic.js";
import { anthropicShadowAiDecisionJsonSchema } from "../lib/shadow/ai/schema.js";
import { modelPrivacyReceipt } from "../lib/shadow/ai/modelPrivacyTelemetry.js";

const requestId = "req_011CSHoEeqs5C35K2UUqR7Fy";
const forbidden = ["a1100000-0000-4000-8000-000000000001", "ref_synthetic_1", "+52 222 123 4567", "ana@example.com", "012345678901234567", "sk-ant-privateSyntheticKey123", "Ana Perez", "Calle Privada 15"];
const details = { provider_status: 400, provider_error_type: "invalid_request_error", provider_error_code: "invalid_json_schema", provider_error_field: "output_config.format.schema", provider_request_id: requestId };

test("HTTP error projection only emits fixed enums, status and a one-way provider request reference", () => {
  const projected = projectProviderHttpError({ ...details, provider_error_message: `Invalid JSON schema: ${forbidden.join(" / ")}`, body: forbidden, headers: { authorization: "Bearer private" }, usage: { input_tokens: 100 }, model: "untrusted" });
  assert.deepEqual(projected, { provider_http_status: 400, provider_error_type: "invalid_request_error", provider_error_code: "invalid_json_schema", provider_error_param: "output_config.format.schema", provider_request_ref: opaqueProviderRequestRef(requestId), provider_error_message_safe: "invalid_json_schema" });
  for (const value of [...forbidden, requestId, "Bearer", "untrusted"]) assert.ok(!JSON.stringify(projected).includes(value));
  assert.match(projected.provider_request_ref, /^[a-f0-9]{64}$/);
  assert.deepEqual(sanitizedProviderHttpDiagnostics({ ...projected, body: forbidden, headers: forbidden, aliases: forbidden }), projected);
});

test("PII, IDs and secrets in every provider error string are omitted, not weakly regex-cleaned", () => {
  for (const value of [...forbidden, "unknown_future_code", "req_ana@example.com", "req_" + forbidden[0]]) {
    const projected = projectProviderHttpError(Object.fromEntries(Object.keys(details).map((key) => [key, key === "provider_status" ? 400 : value])));
    assert.deepEqual(projected, { provider_http_status: 400, provider_error_type: null, provider_error_code: null, provider_error_param: null, provider_request_ref: null });
    const stored = sanitizedProviderHttpDiagnostics({ provider_http_status: 400, provider_error_type: value, provider_error_code: value, provider_error_param: value, provider_request_ref: value, provider_error_message_safe: value });
    assert.deepEqual(stored, projected);
  }
  assert.equal(projectProviderHttpError({ ...details, provider_error_message: forbidden.join(" ") }).provider_error_message_safe, undefined);
  for (const status of [200, 399, 600, "400", null, undefined, {}, NaN]) assert.equal(projectProviderHttpError({ ...details, provider_status: status }), null);
});

test("safe parameter paths canonicalize indexes without preserving their values", () => {
  for (const field of ["messages.12.content.3.text", "messages[12].content[3].text"]) {
    assert.equal(projectProviderHttpError({ ...details, provider_error_field: field }).provider_error_param, "messages[].content[].text");
  }
  assert.equal(projectProviderHttpError({ ...details, provider_error_field: "metadata.clientId" }).provider_error_param, null);
  assert.equal(projectProviderHttpError({ ...details, provider_error_field: "output_config.format.schema.properties.ana@example.com" }).provider_error_param, "output_config.format.schema");
});

test("known message categories do not preserve any provider prose; unmatched messages are omitted", () => {
  for (const [message, expected] of [["Schema compilation timed out", "schema_compilation_timeout"], ["Unsupported JSON schema", "unsupported_json_schema"], ["Prompt is too long", "context_limit_exceeded"], ["Credit balance is too low", "spend_limit_reached"]]) {
    assert.equal(projectProviderHttpError({ ...details, provider_error_message: `${message} ${forbidden.join(" ")}` }).provider_error_message_safe, expected);
  }
  assert.equal(projectProviderHttpError({ ...details, provider_error_message: "Some new reason we do not recognize" }).provider_error_message_safe, undefined);
});

const compilationMessages = [
  ["Schema is too complex for compilation.", "schema_too_complex"],
  ["JSON schema is too complex for compilation", "schema_too_complex"],
  ["Schema too complex for compilation", "schema_too_complex"],
  ["SCHEMA IS TOO COMPLEX FOR COMPILATION", "schema_too_complex"],
  ["Schema compilation timeout", "schema_compilation_timeout"],
  ["Schema compilation timed out", "schema_compilation_timeout"],
  ["Timeout compiling JSON schema", "schema_compilation_timeout"],
  ["Timeout while compiling the JSON schema", "schema_compilation_timeout"],
  ["Timed out compiling schema", "schema_compilation_timeout"],
  ["Timed out while compiling the JSON schema", "schema_compilation_timeout"],
];

for (const [message, category] of compilationMessages) {
  test(`schema diagnostic maps only to a fixed category: ${message}`, () => {
    const projected = projectProviderHttpError({ ...details, provider_error_code: "error", provider_error_field: null, provider_error_message: `${message} ${forbidden.join(" / ")}` });
    const expected = { provider_http_status: 400, provider_error_type: "invalid_request_error", provider_error_code: "error", provider_error_param: null, provider_request_ref: opaqueProviderRequestRef(requestId), provider_error_message_safe: category };
    assert.deepEqual(projected, expected);
    // The same closed projection used by persistence/GET accepts the category,
    // but never free-form messages, bodies, headers, aliases or other additions.
    const stored = sanitizedProviderHttpDiagnostics({ ...projected, message, body: forbidden, headers: forbidden, aliases: forbidden });
    assert.deepEqual(stored, expected);
    for (const value of [message, ...forbidden, requestId]) assert.ok(!JSON.stringify(stored).includes(value));
  });
}

test("unknown or unrelated timeout/complexity messages remain omitted; bounded inspection is unchanged", () => {
  for (const message of [
    "Request timeout", "Timeout compiling a template", "The task is too complex",
    "Schema compilation completed", "Schema is not too complex for compilation",
    "Unknown future schema failure", forbidden.join(" "),
    `${"x".repeat(300)} Schema is too complex for compilation.`,
  ]) {
    const projected = projectProviderHttpError({ ...details, provider_error_message: message });
    assert.equal(Object.hasOwn(projected, "provider_error_message_safe"), false);
    assert.equal(Object.hasOwn(sanitizedProviderHttpDiagnostics({ ...projected, provider_error_message_safe: message }), "provider_error_message_safe"), false);
  }
});

test("compilation diagnostics do not change serialized requests, privacy receipts, HTTP errors or retry behavior", async () => {
  const messages = [{ role: "system", content: "Responde en JSON." }, { role: "user", content: "Hay humedad" }];
  const env = { ANTHROPIC_API_KEY: "synthetic-key-only", SHADOW_AI_MODEL: "claude-haiku-4-5-20251001", SHADOW_AI_MAX_OUTPUT_TOKENS: "1400", SHADOW_AI_OUTPUT_MODE: "anthropic_json_schema" };
  const expectedBody = JSON.stringify({ model: env.SHADOW_AI_MODEL, system: messages[0].content, messages: [messages[1]], max_tokens: 1400,
    output_config: { format: { type: "json_schema", schema: anthropicShadowAiDecisionJsonSchema } } });
  for (const [message, category] of [...compilationMessages, ["Unrecognized synthetic error", undefined]]) {
    let calls = 0;
    await assert.rejects(createAnthropicShadowResponse(messages, { env, fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      assert.equal(options.method, "POST");
      assert.deepEqual(options.headers, { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" });
      assert.equal(options.body, expectedBody);
      return { ok: false, status: 400, headers: { get: () => requestId }, json: async () => ({ type: "error", error: { type: "invalid_request_error", message: `${message} ${forbidden.join(" / ")}` } }) };
    } }), (error) => {
      assert.equal(error.name, "AnthropicProviderError");
      assert.equal(error.message, "model_http_400");
      assert.deepEqual(modelPrivacyReceipt(error), { final_payload_verified: true, serialized_body_verified: true, output_mode: "anthropic_json_schema", privacy_stage: "final_model_privacy", provider_invoked: true });
      const projected = projectProviderHttpError(error.providerError);
      assert.equal(projected.provider_error_message_safe, category);
      assert.equal(projected.provider_error_code, "error");
      for (const value of [message, ...forbidden, env.ANTHROPIC_API_KEY, requestId]) assert.ok(!JSON.stringify(projected).includes(value));
      return true;
    });
    assert.equal(calls, 1); // Mock transport only; no retry and no real provider.
  }
});

test("absent, partial or malformed usage never masquerades as zero; genuine reported zero remains zero", () => {
  for (const value of [null, undefined, "0", -1, NaN, Infinity, {}, 1.5]) {
    const usage = replayProviderUsage(value, value);
    assert.deepEqual(usage, { input_tokens: null, output_tokens: null, usage_status: "unknown", estimated_cost_usd: null });
    assert.deepEqual(replayUsageColumns(usage), {});
  }
  assert.equal(replayProviderUsage(5, null).estimated_cost_usd, null);
  assert.deepEqual(replayUsageColumns(replayProviderUsage(0, 0)), { input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 });
  const row = { error_code: "model_http_400", input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 };
  assert.deepEqual(storedReplayProviderAccounting(row), { input_tokens: null, output_tokens: null, usage_status: "unknown", estimated_cost_usd: null, provider_model_status: "unaccredited" });
  assert.equal(row.input_tokens, 0); // read projection only; no historical rewrite
});

test("native transport distinguishes observed model from config fallback without changing request or decisions", async () => {
  const result = await createAnthropicShadowResponse([{ role: "user", content: "Hay humedad" }], {
    env: { SHADOW_AI_MODEL: "claude-haiku-4-5-20251001" },
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: "{}" }] }) }),
  });
  assert.equal(result.reportedModel, null);
  assert.equal(result.model, "claude-haiku-4-5-20251001"); // legacy natural consumers unchanged
});
