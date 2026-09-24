import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createHistoricalReplayHandler } from "../pages/api/operaciones/shadow-historical-replay.js";
import { executeHistoricalReplayCase, historicalReplayMetrics, selectHistoricalReplayCohort } from "../lib/shadow/ai/historicalReplay.js";
import { HISTORICAL_REPLAY_SOURCE_LIMITS as LIMITS, loadHistoricalReplaySource, prepareHistoricalReplaySelection, previewHistoricalReplaySource } from "../lib/shadow/ai/historicalReplaySource.js";
import { historicalReplayConversationResult, storedHistoricalReplayConversationResult } from "../lib/shadow/ai/historicalReplayResult.js";
import { buildConversationAction } from "../lib/shadow/ai/conversationAction.js";
import { createAnthropicShadowResponse } from "../lib/shadow/ai/anthropic.js";
import { opaqueProviderRequestRef } from "../lib/shadow/ai/providerHttpDiagnostics.js";

const NOW = Date.parse("2026-09-22T18:00:00Z");
const env = { SHADOW_HISTORICAL_REPLAY_ENABLED: "true", SHADOW_HISTORICAL_REPLAY_ANTHROPIC_ENABLED: "true", SHADOW_IDENTITY_BRIDGE_ENABLED: "true",
  SHADOW_CLIENT_RECONCILIATION_PREPARE_ENABLED: "false", SHADOW_CLIENT_RECONCILIATION_WRITE_ENABLED: "false", SHADOW_IDENTITY_CONFIRMATION_ENABLED: "false",
  SHADOW_ADMIN_OUTBOUND_ENABLED: "false", SHADOW_OUTBOUND_ENABLED: "false", SHADOW_ADMIN_WORK_R1_ENABLED: "false", SHADOW_ADMIN_OUTBOUND_CANARY_ENABLED: "false" };
const conversation = (id, last = "2026-09-22T12:01:00Z") => ({ id, provider: "respond_admin", channel: "544519", respond_contact_id: `contact-${id}`, last_message_at: last });
const message = (id, c, at, text = "Hay humedad en la pared", direction = "inbound", attachments = []) => ({ id, conversation_id: c, external_message_id: `ext-${id}`, direction, occurred_at: at, created_at: at, sanitized_text: text, message_type: "text", attachment_metadata: attachments, provider_metadata: {} });
const tableSeed = () => ({
  shadow_conversations: [conversation("old", "2026-08-20T12:00:00Z"), conversation("recent"), conversation("yesterday", "2026-09-21T12:01:00Z")],
  shadow_messages: [
    ...Array.from({ length: 2501 }, (_, i) => message(`old-${i}`, "old", new Date(Date.parse("2026-08-01T00:00:00Z") + i * 60000).toISOString())),
    ...Array.from({ length: 260 }, (_, i) => message(`prior-${String(i).padStart(4, "0")}`, "recent", new Date(Date.parse("2026-09-01T00:00:00Z") + i * 60000).toISOString(), `Contexto anterior ${i}`, "outbound_human")),
    message("r1", "recent", "2026-09-22T12:00:00Z", "Hay humedad en la pared", "inbound", [{ type: "image", mimeType: "image/jpeg" }]),
    message("r2", "recent", "2026-09-22T12:00:20Z", "Se ve una mancha"),
    message("rh", "recent", "2026-09-22T12:01:00Z", "Respuesta humana posterior", "outbound_human"),
    message("y1", "yesterday", "2026-09-21T12:00:00Z", "Tengo un pendiente administrativo"),
  ],
  shadow_media_interpretations: [
    ...Array.from({ length: 501 }, (_, i) => ({ id: `oldmedia-${i}`, provider: "respond_admin", external_message_id: `other-${i}`, status: "completed", interpreted_at: "2026-08-20T00:00:00Z", result_safe: {} })),
    { id: "media-recent", provider: "respond_admin", external_message_id: "ext-r1", status: "completed", interpreted_at: "2026-09-22T12:00:30Z", result_safe: { interpretation_status: "completed", category: "maintenance", summary: "Mancha visible", confidence: .9 } },
  ],
  shadow_historical_replay_cohorts: [], shadow_historical_replay_cases: [], shadow_historical_replay_reviews: [],
});

// In-memory PostgREST contract: ordered/ranged SELECTs and isolated replay writes.
// No actual Supabase, Respond, model transport or environment credentials.
function database(seed = tableSeed(), { rowCap = Infinity, failCompletedSave = false } = {}) {
  const reads = [], writes = []; let serial = 0;
  return { tables: seed, reads, writes, from(table) {
    const filters = [], orders = []; let bounds, limit, mutation, payload, single = false, columns = "*";
    const q = {
      select(value = "*") { columns = value; return q; },
      eq(key, value) { filters.push((r) => r[key] === value); return q; },
      gte(key, value) { filters.push((r) => r[key] >= value); return q; },
      lte(key, value) { filters.push((r) => r[key] <= value); return q; },
      in(key, values) { filters.push((r) => values.includes(r[key])); return q; },
      order(key, options) { orders.push([key, options.ascending]); return q; },
      range(a, b) { bounds = [a, b]; return q; }, limit(n) { limit = n; return q; },
      maybeSingle() { single = true; return q; }, single() { single = true; return q; },
      insert(value) { mutation = "insert"; payload = value; return q; }, update(value) { mutation = "update"; payload = value; return q; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        seed[table] ||= [];
        let rows = seed[table].filter((r) => filters.every((f) => f(r)));
        if (mutation) {
          assert.ok(["shadow_historical_replay_cohorts", "shadow_historical_replay_cases", "shadow_historical_replay_reviews"].includes(table), `unexpected write: ${table}`);
          if (failCompletedSave && mutation === "update" && payload.status === "completed") return { data: null, error: { code: "synthetic_save_error" } };
          writes.push({ table, mutation, payload: structuredClone(payload) });
          if (mutation === "insert") { rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: `row-${++serial}`, ...structuredClone(r) })); seed[table].push(...rows); }
          else rows.forEach((r) => Object.assign(r, structuredClone(payload)));
        } else reads.push({ table, bounds, limit, orders, rows: rows.length });
        rows = rows.slice().sort((a, b) => { for (const [key, asc] of orders) { const n = String(a[key]).localeCompare(String(b[key])); if (n) return asc ? n : -n; } return 0; });
        if (limit != null) rows = rows.slice(0, limit);
        if (bounds) rows = rows.slice(bounds[0], bounds[1] + 1);
        rows = rows.slice(0, rowCap);
        if (columns !== "*") rows = rows.map((r) => Object.fromEntries(columns.split(",").map((c) => [c, r[c]])));
        return { data: structuredClone(single ? rows[0] || null : rows), error: null };
      }).then(resolve, reject); },
    }; return q;
  } };
}
function endpoint(admin, overrides = {}) {
  const handler = createHistoricalReplayHandler({ createAdmin: () => admin, authorize: async () => ({ id: "actor-local" }), sameOrigin: () => true, env, now: () => NOW, ...overrides });
  return async (body, method = "POST") => {
    const res = { setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; } };
    await handler({ method, headers: {}, body }, res); return res;
  };
}

test("preview reaches Sep21–22 despite >2000 older messages; paging preserves full earlier context and attachments", async () => {
  const db = database(); const api = endpoint(db);
  const response = await api({ action: "preview" }); assert.equal(response.statusCode, 200);
  const { preview } = response.body;
  assert.deepEqual(preview.cases.map((r) => r.occurredAt), ["2026-09-22T12:00:20Z", "2026-09-21T12:00:00Z"]);
  assert.equal(preview.selected, 2); assert.deepEqual(preview.counts, { maintenance: 1, payment: 0, administrative_pending: 1 });
  assert.equal(preview.cases[0].messageCount, 2);
  assert.equal(preview.cases[0].turnSnapshot.priorConversation.length, 8);
  assert.equal(preview.cases[0].turnSnapshot.priorConversation[0].sanitizedText, "Contexto anterior 252");
  assert.equal(preview.cases[0].turnSnapshot.attachmentContext.items[0].interpretation.summary, "Mancha visible");
  assert.equal(preview.cases[0].humanResponseAvailable, true);
  assert.doesNotMatch(JSON.stringify(preview.cases[0]), /Respuesta humana posterior/);
  assert.equal(db.reads.some((r) => r.table === "shadow_messages" && r.bounds?.[0] === 250), true);
  assert.equal(db.reads.filter((r) => r.table === "shadow_messages").every((r) => r.rows < 2000), true);
  assert.equal(db.reads.filter((r) => r.table === "shadow_media_interpretations").every((r) => r.rows === 1), true);
  assert.equal(db.writes.length, 0);
});

test("unchanged turn builder semantics, QA/channel exclusion and recency before domain caps", async () => {
  const seed = tableSeed();
  seed.shadow_conversations.push({ ...conversation("sales"), channel: "498219" }, conversation("qa"));
  seed.shadow_messages.push(message("s1", "sales", "2026-09-22T12:00:00Z"), message("q1", "qa", "2026-09-22T12:00:00Z", "PRUEBA SHADOW FASE2A-1"));
  for (const [c, text] of [["maintenance", "Hay humedad en la pared"], ["payment", "Adjunto comprobante de renta"], ["pending", "Tengo un pendiente administrativo"]]) {
    seed.shadow_conversations.push(conversation(c));
    for (let i = 0; i < 12; i++) seed.shadow_messages.push(message(`${c}-${i}`, c, new Date(Date.parse("2026-09-22T10:00:00Z") + i * 360000).toISOString(), text));
  }
  const source = await loadHistoricalReplaySource(database(seed), { asOf: new Date(NOW).toISOString() });
  const preview = await previewHistoricalReplaySource(database(seed), { env, now: NOW });
  const baseline = selectHistoricalReplayCohort({ messages: seed.shadow_messages, conversations: seed.shadow_conversations, mediaInterpretations: seed.shadow_media_interpretations, env, now: NOW, occurredSince: source.occurredSince });
  assert.deepEqual(preview.cases, baseline.cases);
  assert.deepEqual(preview.counts, { maintenance: 10, payment: 10, administrative_pending: 10 });
  assert.equal(preview.selected, 30);
  assert.ok(preview.cases.every((row, i, rows) => !i || row.occurredAt <= rows[i - 1].occurredAt));
});

test("oversized conversation is wholly excluded, not chopped into a false settled turn", async () => {
  const seed = tableSeed(); seed.shadow_conversations.push(conversation("large"));
  seed.shadow_messages.push(...Array.from({ length: LIMITS.messagesPerConversation + 1 }, (_, i) => message(`large-${i}`, "large", "2026-09-22T12:00:00Z")));
  const db = database(seed), preview = await previewHistoricalReplaySource(db, { env, now: NOW });
  assert.equal(preview.sourceInfo.excluded.context_read_limit, 1);
  assert.equal(preview.selected, 2); assert.equal(preview.sourceInfo.conversationsLoaded, 2);
  assert.ok(db.reads.filter((r) => r.bounds).every((r) => r.bounds[1] - r.bounds[0] + 1 <= LIMITS.pageSize));
  assert.equal(db.reads.filter((r) => r.table === "shadow_messages" && r.rows === 2001).length, 9);
  assert.equal(db.writes.length, 0);
});

test("message paging handles a server row cap smaller than requested and includes exact-limit histories", async () => {
  const seed = tableSeed();
  seed.shadow_messages.push(...Array.from({ length: LIMITS.messagesPerConversation - 263 }, (_, i) => message(`extra-old-${i}`, "recent", "2026-09-01T00:00:00Z", "Contexto", "outbound_unknown")));
  const expected = await previewHistoricalReplaySource(database(seed), { env, now: NOW });
  const actual = await previewHistoricalReplaySource(database(seed, { rowCap: 100 }), { env, now: NOW });
  assert.deepEqual(actual, expected); assert.equal(actual.sourceInfo.excluded.context_read_limit, 0);
});

test("media overflow excludes full conversation; recent-conversation cap is visible", async () => {
  const seed = tableSeed();
  seed.shadow_media_interpretations.push(...Array.from({ length: LIMITS.interpretationsPerConversation }, (_, i) => ({ ...seed.shadow_media_interpretations.at(-1), id: `m-${i}` })));
  for (let i = 0; i < 30; i++) seed.shadow_conversations.push(conversation(`empty-${i}`, "2026-09-21T13:00:00Z"));
  const db = database(seed), preview = await previewHistoricalReplaySource(db, { env, now: NOW });
  assert.equal(preview.sourceInfo.excluded.media_context_read_limit, 1);
  assert.equal(preview.sourceInfo.conversationLimitReached, true);
  assert.equal(preview.sourceInfo.conversationsConsidered, LIMITS.conversations);
  assert.equal(db.writes.length, 0);
});

test("preview → prepare uses identical frozen universe, context and domain selection", async () => {
  const db = database(), api = endpoint(db);
  const preview = (await api({ action: "preview" })).body.preview;
  const response = await api({ action: "prepare", turnKeys: preview.cases.map((r) => r.historicalTurnKey), sourceSnapshot: preview.sourceSnapshot });
  assert.equal(response.statusCode, 201);
  const rows = db.tables.shadow_historical_replay_cases;
  assert.deepEqual(rows.map((r) => r.historical_turn_key), preview.cases.map((r) => r.historicalTurnKey));
  for (const row of rows) {
    const expected = preview.cases.find((c) => c.historicalTurnKey === row.historical_turn_key);
    const { envelope, ...snapshot } = row.turn_snapshot;
    assert.deepEqual(snapshot, expected.turnSnapshot);
    assert.deepEqual(envelope.providerMetadata.priorConversation, expected.turnSnapshot.priorConversation);
    assert.equal(row.case_domain, expected.domain);
  }
  assert.equal(rows[0].human_response_snapshot, "Respuesta humana posterior");
  assert.doesNotMatch(JSON.stringify(rows[0].turn_snapshot), /Respuesta humana posterior/);
  assert.equal(db.writes.length, 2);
});

test("missing/stale preview and changed context fail before any cohort write", async () => {
  for (const change of ["missing", "expired", "context", "media", "mapping", "new_message", "arbitrary_turn"]) {
    const db = database(), api = endpoint(db);
    const preview = (await api({ action: "preview" })).body.preview;
    let sourceSnapshot = preview.sourceSnapshot, turnKeys = [preview.cases[0].historicalTurnKey];
    if (change === "missing") sourceSnapshot = null;
    if (change === "expired") sourceSnapshot = { ...sourceSnapshot, asOf: "2026-09-21T00:00:00Z" };
    if (change === "context") db.tables.shadow_messages.find((r) => r.id === "prior-0259").sanitized_text = "Contexto corregido";
    if (change === "media") db.tables.shadow_media_interpretations.at(-1).result_safe.summary = "Nueva interpretación";
    if (change === "mapping") db.tables.shadow_conversations.find((r) => r.id === "recent").respond_contact_id = "changed";
    if (change === "new_message") db.tables.shadow_conversations.find((r) => r.id === "recent").last_message_at = "2026-09-22T18:01:00Z";
    if (change === "arbitrary_turn") turnKeys = ["arbitrary"];
    const result = await api({ action: "prepare", sourceSnapshot, turnKeys });
    assert.ok([400, 409].includes(result.statusCode), change);
    assert.equal(db.writes.length, 0, change);
  }
});

test("prepare cannot bypass preview's per-domain cap using another eligible turn", async () => {
  const seed = tableSeed();
  for (let i = 0; i < 12; i++) seed.shadow_messages.push(message(`extra-${i}`, "recent", new Date(Date.parse("2026-09-22T13:00:00Z") + i * 360000).toISOString()));
  const db = database(seed), preview = await previewHistoricalReplaySource(db, { env, now: NOW });
  const oldKey = selectHistoricalReplayCohort({ messages: seed.shadow_messages.filter((r) => r.id === "extra-0"), conversations: seed.shadow_conversations, env, now: NOW }).cases[0].historicalTurnKey;
  assert.equal(preview.cases.some((r) => r.historicalTurnKey === oldKey), false);
  await assert.rejects(prepareHistoricalReplaySelection(db, { turnKeys: [oldKey], sourceSnapshot: preview.sourceSnapshot, env, now: NOW }), /cohort_contains_ineligible_turn/);
  assert.equal(db.writes.length, 0);
});

const decision = { intent: "mantenimiento", secondaryIntents: [], urgency: "normal", summary: "Fuga", entitiesMentioned: [], resolvedEntities: [], entityResolutionStatus: "not_applicable", informationNeeded: ["location"], proposedToolCalls: [], contextAssessment: "Falta ubicación", proposedAction: "Pedir ubicación", factualClaims: [], conversationalResponseParts: { acknowledgement: "Entiendo.", verifiedFactReferences: [], clarificationQuestion: "¿Dónde ocurre?", escalationMessage: null }, executionCommitment: "none", confidence: .8, requiresHuman: false, escalationReason: null, safetyFlags: [] };

test("actual 3B output → execute response → result_safe → GET is lossless (synthetic provider only)", async () => {
  const db = database(); let actual;
  const api = endpoint(db, { executeCase: async (admin, replayCase, options) => {
    actual = await executeHistoricalReplayCase(admin, replayCase, { ...options, now: () => NOW, modelCall: async () => ({ id: "local-only", text: JSON.stringify(decision), usage: { input_tokens: 1, output_tokens: 1 } }), executeTool: async () => { throw new Error("unexpected_tool"); } });
    return actual;
  } });
  const preview = (await api({ action: "preview" })).body.preview;
  await api({ action: "prepare", sourceSnapshot: preview.sourceSnapshot, turnKeys: [preview.cases[1].historicalTurnKey] });
  const row = db.tables.shadow_historical_replay_cases[0];
  const executed = await api({ action: "execute_one", caseId: row.id }); assert.equal(executed.statusCode, 200);
  const expected = historicalReplayConversationResult(actual.conversationAction);
  assert.deepEqual(row.result_safe.conversationAction, expected);
  assert.deepEqual(historicalReplayConversationResult(executed.body), expected);
  db.tables.shadow_historical_replay_reviews.push({ replay_case_id: row.id, rating: "correct", human_auto_send_eligible: !expected.auto_send_eligible });
  const get = await api({}, "GET"); assert.equal(get.statusCode, 200);
  assert.deepEqual(historicalReplayConversationResult(get.body.cases[0]), expected);
  assert.equal(get.body.metrics.autoSendEligible, Number(expected.auto_send_eligible));
  assert.ok(db.writes.every((w) => w.table.startsWith("shadow_historical_replay_")));
});

test("metrics use exact persisted true, never action type, operational or human eligibility; legacy unknown", () => {
  const values = [
    { requires_human: false, auto_send_eligible: true, blocked_reason: null, conversation_action: "acknowledge_received_information" },
    { requires_human: true, auto_send_eligible: false, blocked_reason: "financial_sensitive", conversation_action: "request_document" },
    { requires_human: true, auto_send_eligible: false, blocked_reason: "identity_unresolved", conversation_action: "ask_missing_information" },
  ];
  const rows = values.map((conversationAction) => ({ status: "completed", result_safe: { conversationAction }, human_auto_send_eligible: !conversationAction.auto_send_eligible, auto_send_eligible: !conversationAction.auto_send_eligible }));
  rows.push({ status: "completed", conversation_action: "request_document", human_auto_send_eligible: true, would_resolve_without_human: true });
  rows.push({ status: "completed", result_safe: { conversationAction: { auto_send_eligible: "true" } } });
  const metrics = historicalReplayMetrics(rows);
  assert.equal(metrics.firstOutboundCandidates, 1); assert.equal(metrics.autoSendEligible, 1);
  assert.equal(metrics.requiresHuman, 2); assert.equal(metrics.doesNotRequireHuman, 1); assert.equal(metrics.eligibilityNotRecorded, 1);
  assert.deepEqual(storedHistoricalReplayConversationResult(rows[3]), { requires_human: null, auto_send_eligible: null, blocked_reason: null, conversation_action: "request_document" });
  for (const value of values) assert.deepEqual(historicalReplayConversationResult(value), value);
});

test("real 3B eligible, financial and legal decisions survive API roundtrip without reinterpretation", async () => {
  const base = { case_domain: "maintenance", case_status: "existing_open_case", interaction_direction: "inbound_customer_action", identity_context: { status: "trusted_link_available", roles: ["tenant"] }, evidence: [{ evidenceId: "tool:local" }], missing_information: [], action_confidence: .95, requires_human: false, conflict_detected: false, technical_error: false };
  const examples = [
    [base, { intent: "mantenimiento" }],
    [{ ...base, case_domain: "payment", sensitive_financial_case: true, requires_human: true, human_reason: "financial_sensitive" }, { intent: "pago_renta" }],
    [{ ...base, requires_human: true, human_reason: "legal_risk" }, { intent: "juridico_conflicto" }],
  ];
  const actions = examples.map(([resolution, decision]) => buildConversationAction({ resolution, decision, turn: { settled: true }, now: NOW }));
  assert.deepEqual(actions.map((a) => a.auto_send_eligible), [true, false, false]);
  for (let i = 0; i < examples.length; i++) {
    const db = database();
    db.tables.shadow_historical_replay_cases.push({ id: "case-local", status: "pending", turn_snapshot: {} });
    const api = endpoint(db, { executeCase: async () => ({ operationalResolution: examples[i][0], conversationAction: actions[i] }) });
    const result = await api({ action: "execute_one", caseId: "case-local" }); assert.equal(result.statusCode, 200);
    const listed = (await api({}, "GET")).body.cases[0];
    for (const field of ["requires_human", "auto_send_eligible", "blocked_reason", "conversation_action"]) {
      assert.equal(result.body[field], actions[i][field]); assert.equal(listed[field], actions[i][field]);
      assert.equal(db.tables.shadow_historical_replay_cases[0].result_safe.conversationAction[field], actions[i][field]);
    }
  }
});

test("failed persistence cannot return completed with unpersisted 3B flags", async () => {
  const db = database(tableSeed(), { failCompletedSave: true });
  db.tables.shadow_historical_replay_cases.push({ id: "case-local", status: "pending", turn_snapshot: {} });
  const api = endpoint(db, { executeCase: async () => ({ operationalResolution: {}, conversationAction: { requires_human: false, auto_send_eligible: true, conversation_action: "provide_verified_status", blocked_reason: null } }) });
  const result = await api({ action: "execute_one", caseId: "case-local" });
  assert.equal(result.statusCode, 422); assert.equal(db.tables.shadow_historical_replay_cases[0].status, "error");
  assert.equal(db.tables.shadow_historical_replay_cases[0].error_code, "historical_replay_result_not_saved");
});

test("authorization/origin and existing isolation gates remain enforced with zero source reads/writes", async () => {
  for (const overrides of [{ authorize: async () => null }, { sameOrigin: () => false }]) {
    const db = database(), res = await endpoint(db, overrides)({ action: "preview" });
    assert.equal(res.statusCode, 403); assert.equal(db.reads.length, 0); assert.equal(db.writes.length, 0);
  }
  const db = database();
  await assert.rejects(previewHistoricalReplaySource(db, { env: { ...env, SHADOW_OUTBOUND_ENABLED: "true" }, now: NOW }), /outbound_fail_closed/);
  assert.equal(db.reads.length, 0);
});

test("UI sends preview snapshot and exposes actual 3B booleans/blocker separately from human review", () => {
  const ui = fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");
  const section = ui.slice(ui.indexOf("Evaluación histórica 3B"), ui.indexOf("</details>}", ui.indexOf("Evaluación histórica 3B")));
  assert.match(section, /sourceSnapshot:historicalReplayPreview.sourceSnapshot/);
  for (const field of ["requires_human", "auto_send_eligible", "blocked_reason", "conversation_action"]) assert.ok(section.includes(`item.${field}`));
  assert.match(section, /La valoración humana es independiente/);
  assert.match(section, /autoSendEligible/); assert.match(section, /eligibilityNotRecorded/);
  assert.doesNotMatch(section, /candidatos ask\/request/);
  const loader = fs.readFileSync(new URL("../lib/shadow/ai/historicalReplaySource.js", import.meta.url), "utf8");
  assert.doesNotMatch(loader.replace('createHash("sha256").update(value)', "hash(value)"), /\.(?:insert|update|upsert|delete|rpc)\(/);
});

test("actual replay JSX renders true/false/legacy distinctly and prepare forwards the preview fingerprint", () => {
  const require = createRequire(import.meta.url), ui = fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");
  const heading = ui.indexOf("Evaluación histórica 3B"), start = ui.lastIndexOf("<details", heading), end = ui.indexOf("</details>", heading) + "</details>".length;
  const names = ["card", "brand", "historicalReplay", "historicalReplayBusy", "historicalReplayPreview", "historicalReplayTurnKeys", "historicalReviewDrafts", "operateHistoricalReplay", "setHistoricalReplayTurnKeys", "setHistoricalReviewDrafts", "reviewHistoricalReplay", "REPLAY_RATINGS", "REPLAY_REASONS"];
  const compiled = require("next/dist/build/swc").transformSync(`export default function Section({${names.join(",")}}) { return (${ui.slice(start, end)}); }`, { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } } }, module: { type: "commonjs" } }).code;
  const mod = { exports: {} }; new Function("require", "module", "exports", compiled)(require, mod, mod.exports);
  const snapshot = { asOf: new Date(NOW).toISOString(), fingerprint: "a".repeat(64) }; const calls = [];
  const props = { card: {}, brand: {}, historicalReplayBusy: false, historicalReplayTurnKeys: ["turn1"], historicalReviewDrafts: {}, REPLAY_RATINGS: [], REPLAY_REASONS: [],
    historicalReplayPreview: { cases: [], selected: 1, sourceSnapshot: snapshot, sourceInfo: {} },
    historicalReplay: { metrics: { autoSendEligible: 1, eligibilityNotRecorded: 1 }, cases: [
      { id: "one", status: "completed", requires_human: false, auto_send_eligible: true, blocked_reason: null, conversation_action: "provide_verified_status", review: { rating: "correct", human_auto_send_eligible: false }, privacy_checks: [{ final_payload_verified: true, serialized_body_verified: true, output_mode: "anthropic_json_schema", privacy_stage: "final_model_privacy", provider_invoked: true }] },
      { id: "two", status: "completed", requires_human: true, auto_send_eligible: false, blocked_reason: "financial_sensitive", conversation_action: "human_handoff", review: { rating: "correct", human_auto_send_eligible: true }, privacy_checks: [{ privacy_stage: "final_model_privacy", privacy_failure_code: "serialized_body_rejected", provider_invoked: false }] },
      { id: "legacy", status: "completed", review: { rating: "correct", human_auto_send_eligible: true } },
      { id: "http-error", status: "error", input_tokens: null, output_tokens: null, estimated_cost_usd: null, provider_model_status: "unaccredited", provider_http: { provider_http_status: 400, provider_error_type: "invalid_request_error", provider_error_code: "invalid_json_schema", provider_error_param: "output_config.format.schema", provider_error_message_safe: "invalid_json_schema", provider_request_ref: "a".repeat(64) }, result_safe: { outputDiagnostics: { outputStage: "provider_http" } } },
    ] }, operateHistoricalReplay: (...args) => calls.push(args) };
  const tree = mod.exports.default(props);
  const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const prepare = nodes(tree).find((n) => n.type === "button" && String(n.props.children).includes("Preparar selección"));
  prepare.props.onClick(); assert.deepEqual(calls, [["prepare", { turnKeys: ["turn1"], sourceSnapshot: snapshot }]]);
  const html = require("react-dom/server").renderToStaticMarkup(tree);
  assert.match(html, /requires_human: false.*auto_send_eligible: true/);
  assert.match(html, /requires_human: true.*auto_send_eligible: false.*financial_sensitive/);
  assert.match(html, /requires_human: no registrado.*auto_send_eligible: no registrado/);
  assert.match(html, /final_payload_verified: true.*serialized_body_verified: true.*output_mode: anthropic_json_schema.*provider_invoked: true/);
  assert.match(html, /FAIL: serialized_body_rejected.*provider_invoked: false/);
  assert.match(html, /Sin comprobante registrado; no equivale a PASS/);
  assert.match(html, /Tokens:<\/strong> desconocido\/desconocido · USD desconocido/);
  assert.match(html, /Modelo acreditado:<\/strong> no acreditado/);
  assert.match(html, /Etapa: provider_http · HTTP 400 · tipo: invalid_request_error/);
  assert.match(html, /Categoría: invalid_json_schema · referencia opaca: a{64}/);
});

const privacyPass = { final_payload_verified: true, serialized_body_verified: true, output_mode: "anthropic_json_schema", privacy_stage: "final_model_privacy", provider_invoked: true };
const privacyFail = (privacy_failure_code) => ({ privacy_stage: "final_model_privacy", privacy_failure_code, provider_invoked: false });
const syntheticId = "a1100000-0000-4000-8000-000000000001";
function privacyReplayApi({ modelCall, executeTool, failCompletedSave = false, metadata = {} } = {}) {
  const db = database(tableSeed(), { failCompletedSave });
  db.tables.shadow_historical_replay_cases.push({ id: "privacy-case", status: "pending", turn_snapshot: { envelope: { provider: "respond_admin", sanitizedText: "¿Cómo va el mantenimiento?", providerMetadata: { propertyId: syntheticId, ...metadata } } } });
  const api = endpoint(db, { executeCase: (admin, replayCase, options) => executeHistoricalReplayCase(admin, replayCase, { ...options, modelCall, executeTool, now: () => NOW }) });
  return { db, api, row: db.tables.shadow_historical_replay_cases[0] };
}
function syntheticTransport(fetchImpl) {
  return (messages, options) => createAnthropicShadowResponse(messages, { ...options, fetchImpl });
}
const syntheticModelResponse = (value = decision) => ({ ok: true, json: async () => ({ id: "synthetic-provider", content: [{ type: "text", text: JSON.stringify(value) }], usage: { input_tokens: 5, output_tokens: 2 } }) });

test("native transport PASS → Replay → result_safe → POST/GET, with only sanitized metadata", async () => {
  let fetches = 0;
  const { db, api, row } = privacyReplayApi({ modelCall: syntheticTransport(async (_url, options) => {
    fetches++; assert.doesNotMatch(options.body, /a1100000/); return syntheticModelResponse();
  }) });
  const result = await api({ action: "execute_one", caseId: row.id });
  assert.equal(result.statusCode, 200); assert.equal(fetches, 1);
  for (const checks of [result.body.privacy_checks, row.result_safe.privacy_checks, (await api({}, "GET")).body.cases[0].privacy_checks]) {
    assert.deepEqual(checks, [privacyPass]);
    assert.doesNotMatch(JSON.stringify(checks), /a1100000|ref_|"body"|"message"|hash|count|synthetic-provider/);
  }
  assert.ok(db.writes.every((write) => write.table === "shadow_historical_replay_cases"));
});

test("pre-provider final-object and serialization failures persist fixed FAIL, zero provider/tools and no sensitive error text", async () => {
  for (const stage of ["final_payload_rejected", "serialized_body_rejected", "body_serialization_failed"]) {
    const stringify = JSON.stringify; let fetches = 0, toolCalls = 0;
    const { api, row } = privacyReplayApi({ executeTool: async () => { toolCalls++; return []; },
      modelCall: async (messages, options) => createAnthropicShadowResponse(messages, {
        ...options, env: stage === "final_payload_rejected" ? { ...env, SHADOW_AI_MODEL: syntheticId } : env,
        fetchImpl: async () => { fetches++; return syntheticModelResponse(); },
      }),
    });
    let result;
    try {
      if (stage !== "final_payload_rejected") JSON.stringify = (value, ...args) => {
        if (value?.max_tokens === 1400) {
          if (stage === "body_serialization_failed") throw new Error(`synthetic serialization fault ${syntheticId}`);
          return stringify({ ...value, unexpected: syntheticId }, ...args);
        }
        return stringify(value, ...args);
      };
      result = await api({ action: "execute_one", caseId: row.id });
    } finally { JSON.stringify = stringify; }
    assert.equal(result.statusCode, 422, stage); assert.equal(row.status, "error");
    assert.equal(fetches, 0); assert.equal(toolCalls, 0);
    assert.equal(row.error_code, stage);
    assert.deepEqual(row.result_safe.privacy_checks, [privacyFail(stage)]);
    assert.deepEqual(result.body.privacy_checks, [privacyFail(stage)]);
    assert.deepEqual((await api({}, "GET")).body.cases[0].privacy_checks, [privacyFail(stage)]);
    assert.equal(row.result_safe.outputDiagnostics.outputStage, "final_model_privacy");
    assert.doesNotMatch(JSON.stringify(row.result_safe), /a1100000|ref_|synthetic serialization/);
  }
});

test("gateway rejection before transport gets no invented verification PASS or provider invocation", async () => {
  let calls = 0;
  const { api, row } = privacyReplayApi({ metadata: { subject: "019aaaaa-aaaa-7aaa-aaaa-123456789abc" }, modelCall: async () => { calls++; assert.fail("no provider"); } });
  const result = await api({ action: "execute_one", caseId: row.id });
  assert.equal(result.statusCode, 422); assert.equal(calls, 0);
  assert.deepEqual(row.result_safe.privacy_checks, [privacyFail("pre_transport_privacy_blocked")]);
});

test("multiple real transport rounds retain each receipt: a later failure cannot be hidden by an earlier PASS", async () => {
  for (const secondFails of [false, true]) {
    let rounds = 0, fetches = 0, toolCalls = 0;
    const { api, row } = privacyReplayApi({
      modelCall: (messages, options) => {
        rounds++;
        return createAnthropicShadowResponse(messages, { ...options, env: secondFails && rounds === 2 ? { ...env, SHADOW_AI_MODEL: syntheticId } : env,
          fetchImpl: async (_url, options) => {
            fetches++; const next = structuredClone(decision);
            const context = JSON.parse(JSON.parse(options.body).messages[0].content);
            if (rounds === 1) next.proposedToolCalls = [{ tool: "get_maintenance_ticket_summary", arguments: { propertyId: context.metadata.propertyId }, reason: "Consultar estado" }];
            return syntheticModelResponse(next);
          },
        });
      },
      executeTool: async (_db, name, args) => { toolCalls++; assert.equal(name, "get_maintenance_ticket_summary"); assert.equal(args.propertyId, syntheticId); return [{ entityType: "maintenance_ticket", internalId: "a1100000-0000-4000-8000-000000000002", status: "abierto", priority: "normal" }]; },
    });
    const result = await api({ action: "execute_one", caseId: row.id });
    assert.equal(result.statusCode, secondFails ? 422 : 200);
    assert.equal(rounds, 2); assert.equal(fetches, secondFails ? 1 : 2); assert.equal(toolCalls, 1);
    assert.deepEqual(row.result_safe.privacy_checks, [privacyPass, secondFails ? privacyFail("final_payload_rejected") : privacyPass]);
  }
});

test("provider response properties and simulated model output cannot forge native transport receipts", async () => {
  const { api, row } = privacyReplayApi({ modelCall: async () => ({ text: JSON.stringify(decision), privacyChecks: [privacyPass], privacyReceipt: privacyPass, outputMode: "anthropic_json_schema" }) });
  assert.equal((await api({ action: "execute_one", caseId: row.id })).statusCode, 200);
  assert.deepEqual(row.result_safe.privacy_checks, []);
});

test("GET projects stored receipts again, removes accidental extra fields, leaves legacy unmeasured", async () => {
  const { api, row } = privacyReplayApi();
  row.status = "completed";
  assert.deepEqual((await api({}, "GET")).body.cases[0].privacy_checks, []);
  row.result_safe = { privacy_checks: [{ ...privacyPass, body: syntheticId, alias: "ref_private_1", hash: "a".repeat(64) }, { ...privacyPass, output_mode: syntheticId }] };
  const listed = (await api({}, "GET")).body.cases[0];
  assert.deepEqual(listed.privacy_checks, [privacyPass]);
  assert.deepEqual(listed.result_safe.privacy_checks, [privacyPass]);
});

test("post-provider failure keeps native PASS receipts without claiming execution completion", async () => {
  for (const failCompletedSave of [false, true]) {
    const { api, row } = privacyReplayApi({ failCompletedSave, modelCall: syntheticTransport(async () => failCompletedSave ? syntheticModelResponse() : { ok: true, json: async () => ({ content: [{ type: "text", text: "invalid JSON" }] }) }) });
    const result = await api({ action: "execute_one", caseId: row.id });
    assert.equal(result.statusCode, 422); assert.equal(row.status, "error");
    assert.deepEqual(row.result_safe.privacy_checks, [privacyPass]);
    assert.equal(row.error_code, failCompletedSave ? "historical_replay_result_not_saved" : "invalid_structured_output_json_parse_error");
  }
});

test("400 native HTTP → Replay → persistence → POST/GET: only sanitized diagnostics, unknown usage/model, no retry/tools", async () => {
  const requestId = "req_011CSHoEeqs5C35K2UUqR7Fy";
  const dangerous = `${syntheticId} ref_private_1 Ana Perez ana@example.com +52 222 123 4567 CLABE 012345678901234567 sk-ant-private123 Calle Privada 15`;
  let fetches = 0, tools = 0;
  const { db, api, row } = privacyReplayApi({
    modelCall: syntheticTransport(async (_url, options) => {
      fetches++; assert.doesNotMatch(options.body, /a1100000|ana@example/);
      return { ok: false, status: 400, headers: { get: () => requestId }, json: async () => ({ type: "error", request_id: requestId,
        error: { type: "invalid_request_error", code: "invalid_json_schema", param: "output_config.format.schema", message: `Invalid JSON schema: ${dangerous}` },
        body: dangerous, headers: { authorization: dangerous }, usage: { input_tokens: 999 }, model: "untrusted-model",
      }) };
    }), executeTool: async () => { tools++; assert.fail("no tools after HTTP error"); },
  });
  const response = await api({ action: "execute_one", caseId: row.id });
  assert.equal(response.statusCode, 422); assert.equal(fetches, 1); assert.equal(tools, 0);
  assert.equal(row.status, "error"); assert.equal(row.error_code, "model_http_400");
  assert.deepEqual(row.result_safe.outputDiagnostics, { outputStage: "provider_http", diagnosticCode: "model_http_400", truncatedFields: [] });
  assert.deepEqual(row.result_safe.privacy_checks, [privacyPass]);
  const expected = { provider_http_status: 400, provider_error_type: "invalid_request_error", provider_error_code: "invalid_json_schema", provider_error_param: "output_config.format.schema", provider_request_ref: opaqueProviderRequestRef(requestId), provider_error_message_safe: "invalid_json_schema" };
  assert.deepEqual(row.result_safe.providerHttp, expected);
  assert.deepEqual(response.body.provider_http, expected);
  assert.deepEqual(row.result_safe.providerRequestRefs, [expected.provider_request_ref]);
  assert.deepEqual(row.result_safe.providerModels, []);
  assert.equal(row.result_safe.providerModelStatus, "unaccredited");
  assert.deepEqual(row.result_safe.providerUsage, { input_tokens: null, output_tokens: null, usage_status: "unknown", estimated_cost_usd: null });
  assert.equal(Object.hasOwn(db.writes.at(-1).payload, "input_tokens"), false); // no false zero, no NOT NULL violation
  row.input_tokens = 0; row.output_tokens = 0; row.estimated_cost_usd = 0; // existing DB column defaults
  const listed = (await api({}, "GET")).body.cases[0];
  assert.equal(listed.input_tokens, null); assert.equal(listed.output_tokens, null); assert.equal(listed.estimated_cost_usd, null);
  assert.equal(listed.provider_model_status, "unaccredited"); assert.deepEqual(listed.provider_http, expected);
  for (const value of [row.result_safe, response.body, listed.result_safe]) {
    assert.doesNotMatch(JSON.stringify(value), /a1100000|ref_private|Ana Perez|ana@example|222 123|0123456789|sk-ant|Calle|req_011CS|untrusted-model|authorization|"body"/);
  }
  assert.ok(db.writes.every((write) => write.table === "shadow_historical_replay_cases"));
});

test("HTTP errors without parsed body preserve safe header request ref; all 4xx/5xx classify provider_http", async () => {
  for (const status of [401, 403, 429, 500, 503, 529]) {
    const requestId = "req_011CSHoEeqs5C35K2UUqR7Fy";
    let fetches = 0;
    const { api, row } = privacyReplayApi({ modelCall: syntheticTransport(async () => {
      fetches++; return { ok: false, status, headers: { get: (key) => key === "request-id" ? requestId : assert.fail("no other headers" ) }, json: async () => { throw new Error("unparsed private provider body"); } };
    }) });
    assert.equal((await api({ action: "execute_one", caseId: row.id })).statusCode, 422);
    assert.equal(fetches, 1);
    assert.equal(row.result_safe.outputDiagnostics.outputStage, "provider_http");
    assert.equal(row.result_safe.providerHttp.provider_http_status, status);
    assert.deepEqual(row.result_safe.providerRequestRefs, [opaqueProviderRequestRef(requestId)]);
    assert.equal(row.result_safe.providerUsage.input_tokens, null);
    assert.doesNotMatch(JSON.stringify(row.result_safe), /unparsed|private|req_011CS/);
  }
});

test("HTTP failure in second round does not claim earlier round usage/model as the complete total", async () => {
  let fetches = 0, tools = 0;
  const { api, row } = privacyReplayApi({
    modelCall: syntheticTransport(async (_url, options) => {
      fetches++;
      if (fetches === 2) return { ok: false, status: 400, json: async () => ({ request_id: "req_011CSHoEeqs5C35K2UUqR7Fy", error: { type: "invalid_request_error" } }) };
      const next = structuredClone(decision), context = JSON.parse(JSON.parse(options.body).messages[0].content);
      next.proposedToolCalls = [{ tool: "get_maintenance_ticket_summary", arguments: { propertyId: context.metadata.propertyId }, reason: "Consultar estado" }];
      return { ok: true, json: async () => ({ id: "synthetic-round-one", model: "claude-haiku-4-5-20251001", usage: { input_tokens: 25, output_tokens: 8 }, content: [{ type: "text", text: JSON.stringify(next) }] }) };
    }), executeTool: async () => { tools++; return []; },
  });
  assert.equal((await api({ action: "execute_one", caseId: row.id })).statusCode, 422);
  assert.equal(fetches, 2); assert.equal(tools, 1);
  assert.deepEqual(row.result_safe.privacy_checks, [privacyPass, privacyPass]);
  assert.equal(row.result_safe.providerRequestRefs.length, 2);
  assert.equal(row.result_safe.providerUsage.input_tokens, null);
  assert.equal(row.result_safe.providerUsage.output_tokens, null);
  assert.equal(row.result_safe.providerModelStatus, "partial");
  assert.deepEqual(row.result_safe.providerModels, ["claude-haiku-4-5-20251001"]);
});

test("successful response without usage/model stays unaccredited; explicitly reported zero is retained", async () => {
  for (const hasUsage of [false, true]) {
    const { api, row } = privacyReplayApi({ modelCall: syntheticTransport(async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify(decision) }], ...(hasUsage ? { usage: { input_tokens: 0, output_tokens: 0 } } : {}) }) })) });
    assert.equal((await api({ action: "execute_one", caseId: row.id })).statusCode, 200);
    assert.deepEqual(row.result_safe.providerModels, []);
    assert.equal(row.result_safe.providerModelStatus, "unaccredited");
    assert.equal(row.result_safe.providerUsage.input_tokens, hasUsage ? 0 : null);
    assert.equal(row.result_safe.providerUsage.usage_status, hasUsage ? "reported" : "unknown");
  }
});

test("GET reprojects diagnostics and legacy HTTP-error zeros are unknown without rewriting old rows", async () => {
  const { db, api, row } = privacyReplayApi();
  row.status = "error"; row.error_code = "model_http_400"; row.input_tokens = 0; row.output_tokens = 0;
  row.result_safe = { providerHttp: { provider_http_status: 400, provider_error_type: "ana@example.com", provider_error_param: syntheticId, provider_error_message_safe: "sk-ant-private", provider_request_ref: "ref_private_1", body: syntheticId } };
  const listed = (await api({}, "GET")).body.cases[0];
  assert.deepEqual(listed.provider_http, { provider_http_status: 400, provider_error_type: null, provider_error_code: null, provider_error_param: null, provider_request_ref: null });
  assert.deepEqual(listed.result_safe.providerHttp, listed.provider_http);
  assert.equal(listed.input_tokens, null); assert.equal(listed.output_tokens, null);
  assert.equal(listed.provider_model_status, "unaccredited");
  assert.equal(db.writes.length, 0);
});
