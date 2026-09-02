import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertAdminOutboundEnvironment,
  processOneAdminOutbound,
  validateAdminOutboundClaim,
  SHADOW_ADMIN_CANARY_ACTION,
  SHADOW_ADMIN_CANARY_MESSAGE,
} from "../lib/shadow/ai/adminOutbound.js";

const cutoff = "2026-09-01T23:00:00.000Z";
const canaryId = "10000000-0000-4000-8000-000000000001";
const canaryEnv = {
  SHADOW_ADMIN_OUTBOUND_ENABLED: "true",
  SHADOW_ADMIN_OUTBOUND_CANARY_ENABLED: "true",
  SHADOW_ADMIN_OUTBOUND_CANARY_ID: canaryId,
  SHADOW_ADMIN_OUTBOUND_NOT_BEFORE: cutoff,
  SHADOW_OUTBOUND_ENABLED: "false",
  SHADOW_ADMIN_WORK_R1_ENABLED: "false",
  SHADOW_RESPOND_ADMIN_CHANNEL_ID: "544519",
  RESPOND_IO_TOKEN: "fixture-only",
};
const eligible = {
  canary_id: canaryId,
  canary_content_eligible: true,
  outbound_id: "20000000-0000-4000-8000-000000000001",
  action_id: "30000000-0000-4000-8000-000000000001",
  message_id: "40000000-0000-4000-8000-000000000001",
  conversation_id: "50000000-0000-4000-8000-000000000001",
  respond_contact_id: "synthetic-contact",
  channel_id: "544519",
  conversation_action: SHADOW_ADMIN_CANARY_ACTION,
  case_domain: "administrative_pending",
  interaction_direction: "inbound_customer_action",
  proposed_message: SHADOW_ADMIN_CANARY_MESSAGE,
  confidence: 0.94,
  requires_human: false,
  auto_send_eligible: true,
  expires_at: "2099-01-01T00:00:00.000Z",
  anchor_occurred_at: cutoff,
  action_created_at: cutoff,
};

function fakeAdmin() {
  const calls = [];
  const chain = { error: null, update(value) { calls.push(value); return this; }, eq() { return this; } };
  return { calls, from() { return chain; } };
}

function atomicCanaryClaim(initial = eligible) {
  let state = "open";
  let claims = 0;
  return {
    async claim(_admin, _worker, _notBefore, requestedCanaryId) {
      if (requestedCanaryId !== canaryId || state !== "open") return null;
      state = "closed";
      claims += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return initial;
    },
    snapshot: () => ({ state, claims }),
    disable: () => { if (state === "open") state = "disabled"; },
  };
}

test("canary exige UUID durable y R1/global outbound OFF", () => {
  assert.equal(assertAdminOutboundEnvironment(canaryEnv).canaryId, canaryId);
  assert.throws(() => assertAdminOutboundEnvironment({ ...canaryEnv, SHADOW_ADMIN_OUTBOUND_CANARY_ID: "no" }), /canary_id_invalid/);
  assert.throws(() => assertAdminOutboundEnvironment({ ...canaryEnv, SHADOW_ADMIN_WORK_R1_ENABLED: "true" }), /r1_must_remain_disabled/);
  assert.throws(() => assertAdminOutboundEnvironment({ ...canaryEnv, SHADOW_OUTBOUND_ENABLED: "true" }), /global_outbound/);
});

test("claim canary válido acepta únicamente acknowledgement neutral", () => {
  assert.equal(validateAdminOutboundClaim(eligible, { notBefore: cutoff, canaryEnabled: true, canaryId }).allowed, true);
  assert.equal(validateAdminOutboundClaim({ ...eligible, conversation_action: "ask_missing_information" }, { notBefore: cutoff, canaryEnabled: true, canaryId }).reason, "canary_action_not_allowlisted");
  assert.equal(validateAdminOutboundClaim({ ...eligible, proposed_message: "Quedó validado." }, { notBefore: cutoff, canaryEnabled: true, canaryId }).reason, "canary_message_not_neutral_acknowledgement");
  assert.equal(validateAdminOutboundClaim({ ...eligible, case_domain: "payment" }, { notBefore: cutoff, canaryEnabled: true, canaryId }).reason, "canary_domain_not_allowlisted");
});

test("action posterior con inbound anterior al cutoff se rechaza", () => {
  const result = validateAdminOutboundClaim({ ...eligible, anchor_occurred_at: "2026-09-01T22:59:59.999Z" }, { notBefore: cutoff, canaryEnabled: true, canaryId });
  assert.equal(result.reason, "canary_inbound_before_activation");
});

test("action e inbound exactamente en cutoff son elegibles", () => {
  assert.equal(validateAdminOutboundClaim(eligible, { notBefore: cutoff, canaryEnabled: true, canaryId }).allowed, true);
});

test("dos workers concurrentes obtienen exactamente un claim y un send", async () => {
  const gate = atomicCanaryClaim();
  let sends = 0;
  const run = (workerId) => processOneAdminOutbound(fakeAdmin(), {
    env: canaryEnv,
    workerId,
    claim: gate.claim,
    recheck: async () => null,
    send: async () => { sends += 1; return { providerMessageId: "provider-canary-1" }; },
    reconcileOrigin: async () => ({}),
  });
  const results = await Promise.all([run("canary-worker-0001"), run("canary-worker-0002")]);
  assert.equal(results.filter((item) => item.status === "sent").length, 1);
  assert.equal(results.filter((item) => item.status === "no_work").length, 1);
  assert.equal(sends, 1);
  assert.deepEqual(gate.snapshot(), { state: "closed", claims: 1 });
});

test("fallo del sender no reabre y no existe retry automático", async () => {
  const gate = atomicCanaryClaim();
  let sends = 0;
  const options = {
    env: canaryEnv,
    claim: gate.claim,
    recheck: async () => null,
    send: async () => { sends += 1; throw new Error("respond_delivery_unknown"); },
  };
  const first = await processOneAdminOutbound(fakeAdmin(), { ...options, workerId: "canary-worker-0001" });
  const second = await processOneAdminOutbound(fakeAdmin(), { ...options, workerId: "canary-worker-0002" });
  assert.equal(first.status, "delivery_unknown");
  assert.equal(second.status, "no_work");
  assert.equal(sends, 1);
  assert.deepEqual(gate.snapshot(), { state: "closed", claims: 1 });
});

test("segunda acción de la misma u otra conversación queda fuera tras el primer claim", async () => {
  for (const secondConversation of [eligible.conversation_id, "50000000-0000-4000-8000-000000000002"]) {
    const gate = atomicCanaryClaim();
    const first = await gate.claim(null, "canary-worker-0001", cutoff, canaryId);
    const second = await gate.claim(null, "canary-worker-0002", cutoff, canaryId, { ...eligible, conversation_id: secondConversation });
    assert.equal(first.action_id, eligible.action_id);
    assert.equal(second, null);
    assert.deepEqual(gate.snapshot(), { state: "closed", claims: 1 });
  }
});

test("kill switch durable impide claim nuevo", async () => {
  const gate = atomicCanaryClaim();
  gate.disable();
  assert.equal(await gate.claim(null, "canary-worker-0001", cutoff, canaryId), null);
  assert.deepEqual(gate.snapshot(), { state: "disabled", claims: 0 });
});

test("sin modo canary el validador conserva el comportamiento normal", () => {
  const normal = { ...eligible, conversation_action: "ask_missing_information", case_domain: "maintenance", proposed_message: "¿En qué parte se presenta el problema?", canary_content_eligible: false };
  assert.equal(validateAdminOutboundClaim(normal, { notBefore: cutoff }).allowed, true);
});

test("migración impone atomicidad, temporalidad, acción y contenido en SQL", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202609010002_shadow_admin_outbound_canary_1of1.sql", import.meta.url), "utf8");
  assert.match(sql, /for update/);
  assert.match(sql, /single_open_uidx/);
  assert.match(sql, /max_claims\s*=\s*1/);
  assert.match(sql, /claimed_count=1/);
  assert.match(sql, /close_reason='first_claim_consumed'/);
  assert.match(sql, /a\.created_at>=v_canary\.not_before/);
  assert.match(sql, /anchor\.occurred_at>=v_canary\.not_before/);
  assert.match(sql, /a\.conversation_action='acknowledge_received_information'/);
  assert.match(sql, /a\.case_domain='administrative_pending'/);
  assert.match(sql, /Gracias, recibí la información que compartiste\./);
  assert.match(sql, /disable_shadow_admin_outbound_canary/);
  assert.match(sql, /sync_shadow_admin_outbound_canary_result/);
  assert.match(sql, /sin seeds ni activación/);
});

test("checks SQL validan índices, constraints, trigger exacto y estado inicial sin escribir", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202609010002_shadow_admin_outbound_canary_1of1_checks.sql", import.meta.url), "utf8");
  for (const index of [
    "shadow_admin_outbound_canaries_single_open_uidx",
    "shadow_admin_outbound_canaries_claimed_action_uidx",
    "shadow_admin_outbound_canaries_claimed_outbound_uidx",
    "shadow_admin_outbound_messages_canary_uidx",
  ]) assert.match(sql, new RegExp(index));
  assert.match(sql, /pg_get_constraintdef/);
  assert.match(sql, /max_claims=1/);
  assert.match(sql, /acknowledge_received_information/);
  assert.match(sql, /canary claim\/state coherence constraint missing/);
  assert.match(sql, /tgfoid='public\.sync_shadow_admin_outbound_canary_result\(\)'::regprocedure/);
  assert.match(sql, /t\.tgrelid='public\.shadow_admin_outbound_messages'::regclass/);
  assert.match(sql, /t\.tgtype=21/);
  assert.match(sql, /cardinality\(t\.tgattr::smallint\[\]\)=2/);
  assert.match(sql, /migration must not arm or seed a canary/);
  assert.match(sql, /migration must not claim outbound work/);
  assert.doesNotMatch(sql, /\b(insert into|update public\.|delete from|truncate table)\b/i);
});

test("canary no incorpora escrituras ERP/R1 ni retry", () => {
  const source = readFileSync(new URL("../lib/shadow/ai/adminOutbound.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /administrative_work_history|maintenance_tickets|payments|contracts.*update|properties.*update/i);
  assert.doesNotMatch(source, /retry|setInterval/);
});
