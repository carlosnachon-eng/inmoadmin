import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildConversationAction, persistConversationAction,
  supersedeConversationActionsForHumanResponses,
} from "../lib/shadow/ai/conversationAction.js";

const env = { SHADOW_CONVERSATION_ACTIONS_ENABLED: "true", SHADOW_OUTBOUND_ENABLED: "false", SHADOW_ADMIN_OUTBOUND_ENABLED: "false" };
const resolution = {
  case_domain: "maintenance", case_status: "existing_open_case",
  interaction_direction: "inbound_customer_action", operational_follow_up: null,
  identity_context: { status: "trusted_link_available" }, evidence: [{ evidenceId: "synthetic-evidence" }],
  missing_information: [], action_confidence: .82, requires_human: false,
};
const action = (overrides = {}) => ({
  id: "synthetic-action", message_id: "synthetic-inbound", conversation_id: "synthetic-conversation",
  status: "proposed", auto_send_eligible: true, requires_human: false,
  created_at: "2026-01-01T00:00:00Z", expires_at: "2026-01-02T00:00:00Z",
  proposed_message: "Mensaje sintético", evidence_refs: ["synthetic-evidence"], ...overrides,
});
const messages = [
  { id: "synthetic-inbound", conversation_id: "synthetic-conversation", direction: "inbound", occurred_at: "2026-01-01T00:00:00Z" },
  { id: "synthetic-human", conversation_id: "synthetic-conversation", direction: "outbound_human", occurred_at: "2026-01-01T00:01:00Z" },
];
const satisfiesCheck2 = row => !row.auto_send_eligible
  || (!row.requires_human && ["proposed", "approved_for_future_auto", "sent"].includes(row.status));

function memoryAdmin(rows, { beforeUpdate, tables = {} } = {}) {
  const updates = [], inserts = [];
  return { rows, updates, inserts, from(table) {
    const filters = []; let patch, inserted, single = false;
    const query = {
      select() { return query; }, limit() { return query; }, order() { return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      gte(key, value) { filters.push(row => row[key] >= value); return query; },
      in(key, values) { filters.push(row => values.includes(row[key])); return query; },
      update(value) { assert.equal(table, "shadow_conversation_actions"); patch = value; return query; },
      insert(value) { assert.equal(table, "shadow_conversation_actions"); inserted = value; return query; },
      single() { single = true; return query; },
      async then(ok, fail) {
        try {
          if (patch) { updates.push(structuredClone(patch)); await beforeUpdate?.(rows); }
          if (inserted) {
            assert.equal(satisfiesCheck2(inserted), true);
            const row = { id: "synthetic-insert", ...inserted }; rows.push(row); inserts.push(row);
            return ok({ data: single ? row : [row], error: null });
          }
          const source = table === "shadow_conversation_actions" ? rows : tables[table];
          assert.ok(source, `Unexpected table: ${table}`);
          const selected = source.filter(row => filters.every(matches => matches(row)));
          if (patch) for (const row of selected) {
            assert.equal(satisfiesCheck2({ ...row, ...patch }), true, "shadow_conversation_actions_check2");
            Object.assign(row, patch);
          }
          return ok({ data: structuredClone(selected), error: null });
        } catch (error) { return fail ? fail(error) : Promise.reject(error); }
      },
    };
    return query;
  } };
}

for (const eligible of [true, false]) {
  test(`expired clears eligibility atomically; initially eligible=${eligible}`, async () => {
    const row = action({ auto_send_eligible: eligible }), original = structuredClone(row);
    const db = memoryAdmin([row]);
    await supersedeConversationActionsForHumanResponses(db, [], env);
    assert.deepEqual(db.updates.map(({ updated_at, ...patch }) => patch), [{ status: "expired", auto_send_eligible: false }]);
    assert.deepEqual(row, { ...original, status: "expired", auto_send_eligible: false, updated_at: row.updated_at });
    await supersedeConversationActionsForHumanResponses(db, [], env);
    assert.equal(db.updates.length, 1, "repeated housekeeping must not update terminal rows");
  });

  test(`human response supersedes atomically; initially eligible=${eligible}`, async () => {
    const row = action({ auto_send_eligible: eligible, expires_at: "2099-01-01T00:00:00Z" });
    const original = structuredClone(row), db = memoryAdmin([row]);
    await supersedeConversationActionsForHumanResponses(db, messages, env);
    assert.deepEqual(row, { ...original, status: "superseded", auto_send_eligible: false,
      superseded_by_message_id: "synthetic-human", superseded_at: row.superseded_at });
    assert.equal(db.updates.length, 1);
    assert.equal(db.updates[0].auto_send_eligible, false);
  });
}

test("direct superseded creation changes only status/link/eligibility", async () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const proposed = buildConversationAction({ resolution, now });
  assert.equal(proposed.auto_send_eligible, true);
  const superseded = buildConversationAction({ resolution, now, turn: { humanResponseId: "synthetic-human" } });
  assert.deepEqual(superseded, { ...proposed, status: "superseded", auto_send_eligible: false, superseded_by_message_id: "synthetic-human" });
  const db = memoryAdmin([]);
  const result = await persistConversationAction(db, { run: { id: "synthetic-run" },
    message: { id: "synthetic-inbound", conversation_id: "synthetic-conversation" }, resolution, env, now,
    telemetry: { turn_key: "synthetic-turn", human_response_id: "synthetic-human" } });
  assert.equal(result.status, "superseded");
  assert.equal(db.inserts[0].auto_send_eligible, false);
  assert.equal(db.inserts[0].superseded_at, new Date(now).toISOString());
});

test("direct noneligible superseded keeps the same decision and message", () => {
  const now = Date.parse("2026-01-01T00:00:00Z"), input = { ...resolution, requires_human: true };
  const proposed = buildConversationAction({ resolution: input, now });
  const superseded = buildConversationAction({ resolution: input, now, turn: { humanResponseId: "synthetic-human" } });
  assert.equal(proposed.auto_send_eligible, false);
  assert.deepEqual(superseded, { ...proposed, status: "superseded", superseded_by_message_id: "synthetic-human" });
});

for (const transition of ["expired", "superseded"]) {
  test(`${transition} does not overwrite a concurrent status change`, async () => {
    const row = action({ expires_at: transition === "expired" ? "2026-01-02T00:00:00Z" : "2099-01-01T00:00:00Z" });
    let concurrent;
    const db = memoryAdmin([row], { beforeUpdate() {
      row.status = "rejected"; row.auto_send_eligible = false; row.blocked_reason = "synthetic_concurrent_review";
      concurrent = structuredClone(row);
    } });
    await supersedeConversationActionsForHumanResponses(db, messages, env);
    assert.deepEqual(row, concurrent);
  });
}

test("unexpired proposed without a human response is untouched", async () => {
  const row = action({ expires_at: "2099-01-01T00:00:00Z" }), original = structuredClone(row), db = memoryAdmin([row]);
  await supersedeConversationActionsForHumanResponses(db, [], env);
  assert.deepEqual(row, original); assert.equal(db.updates.length, 0);
});

test("disabled/global outbound guards remain unchanged", async () => {
  const db = memoryAdmin([action()]);
  await supersedeConversationActionsForHumanResponses(db, [], {});
  await assert.rejects(() => supersedeConversationActionsForHumanResponses(db, [], { ...env, SHADOW_OUTBOUND_ENABLED: "true" }), /global_outbound_blocked/);
  assert.equal(db.updates.length, 0);
});

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const absoluteImports = (source, file) => source.replace(/from "(\.[^"]+)"/g, (_, path) => `from "${new URL(path, file).href}"`);

test("cron expires old eligible proposal then processes next turn; second invocation is HTTP 200 idle", async t => {
  // Only the state machine/provider boundary and DB factory are synthetic. The cron,
  // turn selection, origin reconciliation and action cleanup run the current source.
  const key = Symbol.for("shadow-terminal-eligibility-test");
  const now = Date.now(), inboundAt = new Date(now - 10 * 60_000).toISOString();
  const rows = [action()], tables = {
    shadow_messages: [{ ...messages[0], occurred_at: inboundAt, sanitized_text: "Consulta de mantenimiento", provider_metadata: {}, attachment_metadata: [], external_message_id: "local-opaque-event" }],
    shadow_conversations: [{ id: "synthetic-conversation", provider: "respond_admin", channel: "544519" }],
    shadow_ai_runs: [], shadow_media_interpretations: [], shadow_media_retrieval_queue: [], shadow_admin_outbound_messages: [],
  };
  const db = memoryAdmin(rows, { tables });
  const state = { admin: db, starts: 0 };
  globalThis[key] = state;
  let externalCalls = 0;
  t.mock.method(globalThis, "fetch", async () => { externalCalls++; throw new Error("external_network_forbidden"); });
  const fixtureEnv = { ...env, CRON_SECRET: "synthetic-local-only", VERCEL_ENV: "preview", SUPABASE_ENVIRONMENT: "dev",
    NEXT_PUBLIC_SUPABASE_URL: "https://hjfwjnejbcpmknvfpdcq.supabase.co", SHADOW_AI_AUTO_REAL_DEV_TEST_ENABLED: "true",
    SHADOW_AI_AUTO_REAL_ENABLED: "true", SHADOW_AI_ENABLED: "true", SHADOW_AI_PRODUCTION_ENABLED: "true",
    SHADOW_AI_ALLOW_REAL_MESSAGES: "true", SHADOW_AI_ALLOW_OPERATIONAL_EVENTS: "false", SHADOW_RESPOND_ADMIN_CHANNEL_ID: "544519",
    SHADOW_AI_AUTO_REAL_NOT_BEFORE: new Date(now - 3600_000).toISOString(), SHADOW_AI_MODEL: "synthetic-local-only" };
  const previous = Object.fromEntries(Object.keys(fixtureEnv).map(key => [key, process.env[key]]));
  Object.assign(process.env, fixtureEnv);
  t.after(() => {
    delete globalThis[key];
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const machine = dataModule(`
    export async function startShadowAiStateMachine(admin, input, options) {
      const state = globalThis[Symbol.for("shadow-terminal-eligibility-test")];
      if (options.env.SHADOW_OUTBOUND_ENABLED !== "false" || options.allowRetry !== false) throw Error("unsafe_test_options");
      state.starts++;
      const run = { id:"synthetic-run", message_id:input.messageId, status:"completed", model:"synthetic-local-only", created_at:new Date().toISOString(), telemetry_json:{} };
      await admin.from("shadow_ai_runs").syntheticComplete(run);
      return { status:"completed", runId:run.id };
    }
    export function continueShadowAiStateMachine() { throw Error("unexpected_continuation"); }
    export function terminateAwaitingShadowAiRun() { throw Error("unexpected_termination"); }
  `);
  const originalFrom = db.from;
  db.from = table => table === "shadow_ai_runs"
    ? { ...originalFrom(table), syntheticComplete: async row => { tables.shadow_ai_runs.push(row); } }
    : originalFrom(table);
  const autoFile = new URL("../lib/shadow/ai/autoReal.js", import.meta.url);
  let autoSource = readFileSync(autoFile, "utf8");
  assert.equal(autoSource.split('from "./stateMachine.js"').length, 2);
  autoSource = absoluteImports(autoSource.replace('from "./stateMachine.js"', `from "${machine}"`), autoFile);
  const autoModule = dataModule(autoSource);
  const cronFile = new URL("../pages/api/cron/shadow-ai-real-auto.js", import.meta.url);
  let cronSource = readFileSync(cronFile, "utf8");
  const factoryImport = 'import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";';
  const autoImport = 'from "../../../lib/shadow/ai/autoReal"';
  assert.ok(cronSource.includes(factoryImport)); assert.ok(cronSource.includes(autoImport));
  cronSource = cronSource.replace(factoryImport, 'const getAdminSupabase = () => globalThis[Symbol.for("shadow-terminal-eligibility-test")].admin;')
    .replace(autoImport, `from "${autoModule}"`);
  const { default: handler } = await import(dataModule(cronSource));
  const invoke = async () => {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: "GET", headers: { authorization: "Bearer synthetic-local-only" } }, res);
    assert.equal(res.code, 200); return res.body;
  };
  assert.equal((await invoke()).status, "completed");
  assert.equal(rows[0].status, "expired"); assert.equal(rows[0].auto_send_eligible, false);
  assert.equal((await invoke()).status, "idle");
  assert.equal(state.starts, 1); assert.equal(externalCalls, 0); assert.equal(tables.shadow_admin_outbound_messages.length, 0);
});
