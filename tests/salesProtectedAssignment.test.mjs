import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { dispatchSalesHandoff } from "../lib/agentsV2/salesHandoff.js";
import { safeSalesAttentionReason } from "../lib/agentsV2/salesAttentionView.js";
import { memoryDb } from "./helpers/socialFixtures.mjs";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const ago = seconds => new Date(Date.now() - seconds * 1000).toISOString();
function fixture() {
  const env = { SOCIAL_ROUTING_V1_ENABLED: "true", SALES_AGENT_V2_HANDOFF_SLA_ENABLED: "false",
    SALES_AGENT_V2_PROTECTED_ASSIGNMENT_NOT_BEFORE: ago(3600),
    SALES_AGENT_V2_HANDOFF_WORKFLOW_URL: "https://hooks.respond.io/synthetic-only",
    RESPOND_IO_TOKEN: "synthetic-only" };
  const inbound = { id: "inbound", social_route_id: "route", respond_contact_id: "synthetic", channel_id: "497382",
    occurred_at: ago(20), created_at: ago(19), sanitized_text: "Quiero hablar con una persona sobre la casa", status: "processed" };
  const route = { id: "route", inbound_id: inbound.id, respond_contact_id: inbound.respond_contact_id, source_channel_id: inbound.channel_id,
    occurred_at: inbound.occurred_at, created_at: ago(18), destination: "SALES" };
  const handoff = { id: "handoff", inbound_message_id: inbound.id, social_route_id: route.id, respond_contact_id: inbound.respond_contact_id,
    channel_id: inbound.channel_id, created_at: ago(15), status: "ready_for_advisor", reason: "human_requested" };
  const db = memoryDb({ sales_agent_v2_inbound_messages: [inbound], social_message_routes: [route], sales_agent_v2_handoffs: [handoff],
    social_handoff_effects: [], gv_respond_contact_snapshots: [{ respond_contact_id: inbound.respond_contact_id, respond_assignee_id: null,
      mapped_profile_id: null, respond_record_active: true, metadata: { mapping_method: "current_assignee_unassigned" } }] }, {
    reserve_social_effect_v1: async args => {
      const found = db.tables.social_handoff_effects.find(row => row.handoff_id === args.p_handoff_id && row.phase === args.p_phase);
      if (found) return { data: { owned: false, status: found.status, resultRef: found.result_ref } };
      if (args.p_phase === "ack") assert.ok(db.tables.social_handoff_effects.some(row => row.phase === "assignment" && row.status === "completed"));
      const row = { kind: args.p_kind, handoff_id: args.p_handoff_id, phase: args.p_phase, status: "reserved", token: `synthetic-${args.p_phase}` };
      db.tables.social_handoff_effects.push(row); return { data: { ...row, owned: true } };
    },
    finish_social_effect_v1: async args => {
      const row = db.tables.social_handoff_effects.find(row => row.token === args.p_token);
      assert.equal(row.status, "reserved"); Object.assign(row, { status: args.p_status, result_ref: args.p_result_ref }); return {};
    },
  });
  const calls = [], reads = [];
  const remote = { assignee: null, onRead: () => {}, onPost: () => {} };
  globalThis.fetch = async (url, options) => {
    assert.ok(options.signal, "every remote request is bounded");
    if (options.method === "GET") {
      assert.equal(url, "https://api.respond.io/v2/contact/id:synthetic"); reads.push(url); remote.onRead(reads.length);
      return { ok: true, json: async () => ({ id: "synthetic", assignee: remote.assignee }) };
    }
    assert.equal(options.method, "POST"); assert.ok([env.SALES_AGENT_V2_HANDOFF_WORKFLOW_URL, "https://api.respond.io/v2/contact/id:synthetic/message"].includes(url));
    const kind = url === env.SALES_AGENT_V2_HANDOFF_WORKFLOW_URL ? "assignment" : "ack";
    calls.push({ kind, body: JSON.parse(options.body) }); remote.onPost(kind);
    return { ok: true, status: 200, json: async () => ({ messageId: "synthetic-ack" }) };
  };
  return { db, env, calls, reads, remote, handoff: db.tables.sales_agent_v2_handoffs[0], inbound: db.tables.sales_agent_v2_inbound_messages[0],
    route: db.tables.social_message_routes[0], run: () => dispatchSalesHandoff(db, { handoffId: handoff.id, env }) };
}
async function blocked(f, reason) {
  const originalStatus = f.handoff.status;
  const result = await f.run(); assert.equal(result.status, "requires_review"); assert.equal(result.assignmentConfirmed, false);
  assert.equal(result.reason, reason); assert.equal(f.handoff.assignment_error_code, reason);
  assert.equal(safeSalesAttentionReason(reason), reason); assert.equal(f.calls.length, 0);
  assert.equal(f.handoff.status, originalStatus, "review/state is retained, not completed/dismissed/reopened");
}

test("current SALES/new intent/explicit unassigned: one requested effect; HTTP 200 is not assigned", async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.status, "assignment_requested"); assert.equal(result.assignmentConfirmed, false);
  assert.deepEqual(f.calls.map(c => c.kind), ["assignment", "ack"]);
  assert.match(f.calls[1].body.message.text, /pendiente de confirmar/);
  assert.doesNotMatch(f.calls[1].body.message.text, /te voy a asignar|visita confirmada/);
  assert.equal(f.handoff.sla_due_at, null); assert.equal(f.db.tables.social_handoff_effects.length, 2);
  await f.run(); assert.equal(f.calls.length, 2);
});

for (const place of ["snapshot", "case", "remote"])
  test(`existing responsible ${place}: no assignment/ACK; follow-up visible`, async () => {
    const f = fixture();
    if (place === "snapshot") f.db.tables.gv_respond_contact_snapshots[0].respond_assignee_id = "synthetic-advisor";
    if (place === "case") f.db.tables.gv_opportunities = [{ respond_contact_id: "synthetic", asesor_id: "synthetic-advisor" }];
    if (place === "remote") f.remote.assignee = { id: "synthetic-advisor" };
    await blocked(f, "existing_responsible_preserved");
  });
for (const destination of ["OWNER", "LEGAL", "ADMINISTRATION", "EXISTING_CLIENT", "HUMAN_REVIEW", "UNKNOWN"])
  for (const timing of ["before", "during-live-read"])
    test(`current ${destination} ${timing}: old SALES does not authorize`, async () => {
      const f = fixture(); const change = () => f.db.tables.social_message_routes.push({ ...f.route, id: "newer", destination, occurred_at: ago(1) });
      if (timing === "before") change(); else f.remote.onRead = n => { if (n === 2) change(); };
      await blocked(f, timing === "before" ? "protected_assignment_current_route_not_sales" : "social_effect_uncertain_manual_review");
      await f.run(); assert.equal(f.calls.length, 0);
    });
for (const [name, change, reason] of [
  ["Social OFF", f => { f.env.SOCIAL_ROUTING_V1_ENABLED = "false"; }, "protected_assignment_social_off"],
  ["no marker/legacy", f => { f.handoff.social_route_id = null; }, "protected_assignment_route_unverified"],
  ["route missing", f => { f.db.tables.social_message_routes = []; }, "protected_assignment_route_unverified"],
  ["other contact", f => { f.route.respond_contact_id = "another"; }, "protected_assignment_route_unverified"],
  ["other channel", f => { f.route.source_channel_id = "498219"; }, "protected_assignment_route_unverified"],
  ["unknown snapshot", f => { f.db.tables.gv_respond_contact_snapshots = []; }, "assignment_state_requires_review"],
  ["unknown remote", f => { f.remote.assignee = undefined; }, "assignment_live_state_unverified"],
  ["routing not terminal", f => { f.db.tables.social_capture_receipts = [{ respond_contact_id: "synthetic", source_channel_id: "497382", routing_state: "pending" }]; }, "protected_assignment_route_unverified"],
  ["missing cutover", f => { delete f.env.SALES_AGENT_V2_PROTECTED_ASSIGNMENT_NOT_BEFORE; }, "protected_assignment_cutover_unconfigured"],
  ["invalid cutover", f => { f.env.SALES_AGENT_V2_PROTECTED_ASSIGNMENT_NOT_BEFORE = "yesterday"; }, "protected_assignment_cutover_unconfigured"],
  ["future cutover", f => { f.env.SALES_AGENT_V2_PROTECTED_ASSIGNMENT_NOT_BEFORE = ago(-3600); }, "protected_assignment_cutover_unconfigured"],
  ["old handoff", f => { f.handoff.created_at = ago(7200); }, "protected_assignment_before_cutover"],
  ["old inbound arriving now", f => { f.inbound.occurred_at = ago(7200); }, "protected_assignment_before_cutover"],
  ["old persisted inbound", f => { f.inbound.created_at = ago(7200); }, "protected_assignment_before_cutover"],
  ["equal cutoff", f => { f.handoff.created_at = f.env.SALES_AGENT_V2_PROTECTED_ASSIGNMENT_NOT_BEFORE; }, "protected_assignment_before_cutover"],
  ["no current intent", f => { f.inbound.sanitized_text = "Gracias"; }, "handoff_intent_unverified"],
  ["closed handoff", f => { f.handoff.status = "taken"; }, "protected_assignment_handoff_not_pending"],
  ["fallback is not buying intent", f => { f.handoff.reason = "automation_fallback"; }, "automation_fallback_requires_review"],
  ["other open handoff", f => { f.db.tables.sales_agent_v2_handoffs.push({ ...f.handoff, id: "other" }); }, "protected_assignment_other_handoff_requires_review"],
]) test(`fail closed: ${name}`, async () => { const f = fixture(); change(f); await blocked(f, reason); });

test("human/visit intent survives Plis in current same-channel burst", async () => {
  for (const text of ["Quiero hablar con una persona sobre la casa", "Quiero visitar la casa"]){
    const f = fixture(); f.inbound.sanitized_text = "Plis";
    f.db.tables.sales_agent_v2_inbound_messages.push({ ...f.inbound, id: "earlier", social_route_id: "earlier-route", occurred_at: ago(25), sanitized_text: text });
    f.handoff.reason = text.includes("visitar") ? "appointment_intent" : "human_requested";
    assert.equal((await f.run()).status, "assignment_requested"); assert.equal(f.calls.filter(c => c.kind === "assignment").length, 1);
  }
});
test("four concurrent duplicate deliveries: at most one assignment/ACK", async () => {
  const f = fixture(); await Promise.all(Array.from({ length: 4 }, () => f.run())); await f.run();
  assert.equal(f.calls.filter(c => c.kind === "assignment").length, 1); assert.equal(f.calls.filter(c => c.kind === "ack").length, 1);
});
test("pre-cutover intent cannot authorize a fresh Plis handoff", async () => {
  const f = fixture(); f.env.SALES_AGENT_V2_PROTECTED_ASSIGNMENT_NOT_BEFORE = ago(22);
  f.inbound.sanitized_text = "Plis";
  f.db.tables.sales_agent_v2_inbound_messages.push({ ...f.inbound, id: "old-intent", occurred_at: ago(25), created_at: ago(24), sanitized_text: "Quiero hablar con una persona" });
  await blocked(f, "handoff_intent_unverified");
});
test("SALES after a lane change cannot reuse the earlier handoff", async () => {
  const f = fixture();
  f.db.tables.social_message_routes.push({ ...f.route, id: "legal", destination: "LEGAL", occurred_at: ago(10) }, { ...f.route, id: "sales-again", occurred_at: ago(5) });
  await blocked(f, "protected_assignment_current_route_not_sales");
});
test("malformed owned reservation never permits a remote effect", async () => {
  const f = fixture(); f.db.rpc = async () => ({ data: { owned: true, status: "completed", token: "malformed" } });
  await blocked(f, "social_effect_reservation_failed");
});
test("timeout/uncertain assignment persists visible reason and never retries", async () => {
  const f = fixture(); f.remote.onPost = () => { throw new Error("raw provider secret must not persist"); };
  const first = await f.run(); assert.equal(first.reason, "social_effect_uncertain_manual_review");
  for (let n = 0; n < 3; n++) await f.run();
  assert.deepEqual(f.calls.map(c => c.kind), ["assignment"]); assert.equal(f.db.tables.social_handoff_effects[0].status, "uncertain");
  assert.doesNotMatch(JSON.stringify(f.db.tables), /raw provider secret/);
});
test("uncertain prior effect in a closed handoff also blocks new attempts", async () => {
  const f = fixture(); f.db.tables.sales_agent_v2_handoffs.push({ ...f.handoff, id: "old", status: "taken" });
  f.db.tables.social_handoff_effects.push({ kind: "sales", handoff_id: "old", phase: "assignment", status: "uncertain" });
  await blocked(f, "social_effect_uncertain_manual_review");
});
test("manual assignment during last live read: preserved, no remote writes", async () => {
  const f = fixture(); f.remote.onRead = n => { if (n === 2) f.remote.assignee = { id: "human" }; };
  await blocked(f, "social_effect_uncertain_manual_review"); await f.run(); assert.equal(f.calls.length, 0);
});
test("handoff taken during last live read: reread state blocks dispatch", async () => {
  const f = fixture(); f.remote.onRead = n => { if (n === 2) f.handoff.status = "taken"; };
  const result = await f.run();
  assert.equal(result.reason, "social_effect_uncertain_manual_review");
  assert.equal(f.handoff.status, "taken"); assert.equal(f.calls.length, 0);
});
test("assignee appears after webhook: no new-assignment ACK, review retained", async () => {
  const f = fixture(); f.remote.onPost = kind => { if (kind === "assignment") f.remote.assignee = { id: "human" }; };
  const result = await f.run(); assert.equal(result.reason, "existing_responsible_preserved");
  assert.equal(result.assignmentConfirmed, false); assert.deepEqual(f.calls.map(c => c.kind), ["assignment"]);
  assert.equal(f.handoff.assignment_error_code, "existing_responsible_preserved");
});
test("failed DB read is a safe persisted review, never legacy fallback", async () => {
  const f = fixture(), from = f.db.from.bind(f.db);
  f.db.from = table => table === "social_message_routes" ? (() => { throw new Error("private diagnostic"); })() : from(table);
  await blocked(f, "protected_assignment_verification_failed");
});
