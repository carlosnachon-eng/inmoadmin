import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { assessAdminObservation } from "../lib/messaging/correlation/observer.js";
import { realObservations } from "./fixtures/messagingCorrelation.mjs";

const metaEventId = "00000000-0000-4000-8000-000000000001";
const verdict = (state = "ambiguous") => ({ state, observer_only: true, business_dedupe_allowed: false, human_authorship_proven: false });
for (const state of ["matched", "unmatched", "ambiguous"]) {
  test(`wrapper requests only journal ID; ${state} is never business permission`, async () => {
    const calls = [];
    const data = verdict(state);
    assert.equal(await assessAdminObservation({ metaEventId, db: { async rpc(...args) { calls.push(args); return { data }; } } }), data);
    assert.deepEqual(calls, [["assess_messaging_admin_correlation_v1", { p_meta_event_id: metaEventId }]]);
  });
}
test("invalid input does not call a database", async () => {
  for (const id of [null, "", "not-uuid", "wamid.SYNTHETIC_1", 1]) {
    await assert.rejects(assessAdminObservation({ metaEventId: id, db: { rpc() { assert.fail("unexpected RPC"); } } }), /input_invalid/);
  }
});
test("database error is sanitized, never converted to unmatched", async () => {
  await assert.rejects(assessAdminObservation({ metaEventId, db: { async rpc() { return { error: { message: "PRIVATE SOURCE" } }; } } }),
    e => e.message === "messaging_correlation_evaluation_failed");
  await assert.rejects(assessAdminObservation({ metaEventId, db: { async rpc() { throw new Error("PRIVATE SOURCE"); } } }),
    e => e.message === "messaging_correlation_evaluation_failed");
});
test("malformed or business-authorizing results fail closed", async () => {
  for (const data of [null, {}, verdict("guessed"), { ...verdict(), observer_only: false },
    { ...verdict(), business_dedupe_allowed: true }, { ...verdict(), human_authorship_proven: true }]) {
    await assert.rejects(assessAdminObservation({ metaEventId, db: { async rpc() { return { data }; } } }), /evaluation_failed/);
  }
});
test("sanitized real trio has no exact identity claim and a revoke mismatch", () => {
  assert.equal(realObservations.length, 3);
  for (const row of realObservations) assert.notEqual(row.metaMessageRef, row.respondMessageRef);
  assert.equal(realObservations[1].originalRef, realObservations[0].metaMessageRef);
  assert.notEqual(realObservations[1].metaType, realObservations[1].respondType);
  assert.notEqual(realObservations[2].metaMessageRef, realObservations[0].metaMessageRef);
});
test("only three new tables; no global defaults or source journal DML/DDL", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261008193245_messaging_admin_correlation.sql", import.meta.url), "utf8");
  assert.deepEqual([...sql.matchAll(/create table public\.(\w+)/g)].map(x => x[1]),
    ["messaging_correlation_assessments", "messaging_correlation_candidates", "messaging_message_equivalences"]);
  assert.doesNotMatch(sql, /alter default privileges|security definer|create extension/i);
  assert.doesNotMatch(sql, /(?:update|delete from|insert into|alter table) public\.(?:meta_observer|gv_respond)/i);
  assert.doesNotMatch(sql, /(?:sales_agent|owner_agent|legal_agent|social_message_routes|respond_ai_resumptions)/i);
});
test("no runtime entrypoint imports correlation; module has no effect dependencies", async () => {
  const module = await readFile(new URL("../lib/messaging/correlation/observer.js", import.meta.url), "utf8");
  assert.doesNotMatch(module, /^import |fetch\(|process\.env/m);
  for (const root of ["../pages/", "../lib/"]) {
    async function scan(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
        if (entry.isDirectory()) { if (entry.name !== "correlation") await scan(url); }
        else if (/\.[jm]?[st]sx?$/.test(entry.name)) {
          assert.doesNotMatch(await readFile(url, "utf8"), /(?:import|require)[^\n]*messaging\/correlation|assessAdminObservation\s*\(/);
        }
      }
    }
    await scan(new URL(root, import.meta.url));
  }
});
