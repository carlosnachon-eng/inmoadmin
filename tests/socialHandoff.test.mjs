import test, { after } from "node:test";
import assert from "node:assert/strict";
import { dispatchSalesHandoff, processSalesHandoffSla } from "../lib/agentsV2/salesHandoff.js";
import { onceSocialHandoffEffect } from "../lib/social/handoffEffects.js";
import { memoryDb } from "./helpers/socialFixtures.mjs";

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
const env = { SALES_AGENT_V2_HANDOFF_WORKFLOW_URL: "https://hooks.respond.io/synthetic-only", RESPOND_IO_TOKEN: "synthetic-not-a-secret" };
function fixture() {
  const receipts = new Map(); let token = 0;
  const db = memoryDb({ gv_respond_contact_snapshots: [{ respond_contact_id: "synthetic", respond_record_active: true, metadata: { mapping_method: "current_assignee_unassigned" } }], sales_agent_v2_handoffs: [{ id: "h", social_route_id: "r", respond_contact_id: "synthetic", channel_id: "497382", status: "ready_for_advisor", reason: "appointment_intent" }] }, {
    reserve_social_effect_v1: async ({ p_kind, p_handoff_id, p_phase }) => {
      const key = `${p_kind}:${p_handoff_id}:${p_phase}`, found = receipts.get(key);
      if (found) return { data: { owned: false, ...found } };
      const receipt = { token: `synthetic-${++token}`, status: "reserved", resultRef: null }; receipts.set(key, receipt);
      return { data: { owned: true, ...receipt } };
    },
    finish_social_effect_v1: async ({ p_token, p_status, p_result_ref }) => {
      const found = [...receipts.values()].find(r => r.token === p_token);
      assert.equal(found.status, "reserved"); Object.assign(found, { status: p_status, resultRef: p_result_ref }); return { error: null };
    },
  });
  db.tables.sales_agent_v2_handoffs[0].inbound_message_id="inbound";
  db.tables.sales_agent_v2_inbound_messages=[{id:"inbound",respond_contact_id:"synthetic",channel_id:"497382",social_route_id:"r",sanitized_text:"Quiero visitar la casa"}];
  return { db, receipts };
}
test("I workflow y ACK interceptados por separado: retry = una asignación y un ACK", async () => {
  const { db } = fixture(), calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ kind: url.startsWith("https://hooks.respond.io/") ? "workflow" : "ack", body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ messageId: "synthetic-message" }) };
  };
  await Promise.allSettled([dispatchSalesHandoff(db, { handoffId: "h", env }), dispatchSalesHandoff(db, { handoffId: "h", env })]);
  await dispatchSalesHandoff(db, { handoffId: "h", env });
  assert.deepEqual(calls.map(c => c.kind), ["workflow", "ack"]);
  assert.equal(calls[0].body.routingDecision, "sales_v2_handoff"); assert.equal(calls[1].body.channelId, 497382);
});
test("reserva sobrevive incertidumbre: ningún segundo workflow ni ACK", async () => {
  const { db, receipts } = fixture(); let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("synthetic_transport_timeout"); };
  await assert.rejects(dispatchSalesHandoff(db, { handoffId: "h", env }), /uncertain_manual_review/);
  await assert.rejects(dispatchSalesHandoff(db, { handoffId: "h", env }), /uncertain_manual_review/);
  assert.equal(calls, 1); assert.equal(receipts.size, 1); assert.equal([...receipts.values()][0].status, "uncertain");
});
test("ACK fallido no redispara workflow ni segundo ACK", async () => {
  const { db } = fixture(), calls = [];
  globalThis.fetch = async url => { const kind = url.includes("hooks.respond.io") ? "workflow" : "ack"; calls.push(kind); if (kind === "ack") throw new Error("synthetic_timeout"); return { ok: true }; };
  await assert.rejects(dispatchSalesHandoff(db, { handoffId: "h", env }));
  await assert.rejects(dispatchSalesHandoff(db, { handoffId: "h", env }));
  assert.deepEqual(calls, ["workflow", "ack"]);
});
test("receipt incierto no vuelve a ejecutar transporte", async () => {
  const { db } = fixture(); const original = db.rpc.bind(db); let calls = 0;
  db.rpc = async (name, args) => name === "finish_social_effect_v1" ? { error: new Error("synthetic_write_failure") } : original(name, args);
  const operation = () => onceSocialHandoffEffect(db, { kind: "legal", handoff: { id: "h", social_route_id: "r" }, phase: "assignment", effect: async () => { calls++; } });
  await assert.rejects(operation(), /receipt_uncertain/); await assert.rejects(operation(), /uncertain/); assert.equal(calls, 1);
});
test("legacy sin marker no exige tabla/RPC nueva", async () => {
  let calls = 0;
  const result = await onceSocialHandoffEffect({ rpc() { assert.fail(); } }, { handoff: {}, effect: async () => { calls++; return "legacy"; } });
  assert.equal(result, "legacy"); assert.equal(calls, 1);
});
test("SLA conserva política existente, pero cada escalón se reserva una vez", async () => {
  const { db } = fixture(); let calls = 0;
  Object.assign(db.tables.sales_agent_v2_handoffs[0], { status: "assignment_requested", assignment_requested_at: "2026-01-01", sla_due_at: "2026-01-01", reassignment_count: 0 });
  globalThis.fetch = async (_url, options) => { calls++; assert.equal(JSON.parse(options.body).routingDecision, "sales_v2_handoff_sla_reassignment"); return { ok: true }; };
  await Promise.allSettled([processSalesHandoffSla(db, { env }), processSalesHandoffSla(db, { env })]);
  assert.equal(calls, 1); assert.equal(db.tables.sales_agent_v2_handoffs[0].reassignment_count, 1);
});
