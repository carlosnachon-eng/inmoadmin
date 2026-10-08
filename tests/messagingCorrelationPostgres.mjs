// LOCAL only, fresh embedded PostgreSQL. No DB URL, Supabase keys or network
// services accepted. Deps: embedded-postgres@18.4.0-beta.17 + pg@8.23.1.
// MESSAGING_CORRELATION_TEST_DEPS=/absolute/node_modules node tests/messagingCorrelationPostgres.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { assessAdminObservation } from "../lib/messaging/correlation/observer.js";
import { realObservations, syntheticScope as scope, syntheticNative as native } from "./fixtures/messagingCorrelation.mjs";

assert.ok(path.isAbsolute(process.env.MESSAGING_CORRELATION_TEST_DEPS || ""), "explicit local deps required");
const require = createRequire(path.join(process.env.MESSAGING_CORRELATION_TEST_DEPS, "test.cjs"));
const EmbeddedPostgres = require("embedded-postgres").default;
const { Client } = require("pg");
const directory = await mkdtemp(path.join(tmpdir(), "messaging-correlation-pg-"));
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once("error", reject);
  socket.listen(0, "127.0.0.1", () => { const p = socket.address().port; socket.close(() => resolve(p)); });
});
const password = randomBytes(24).toString("hex");
const server = new EmbeddedPostgres({ databaseDir: path.join(directory, "db"), port, user: "postgres", password,
  persistent: false, postgresFlags: ["-h", "127.0.0.1", "-k", directory], onLog() {}, onError() {} });
const clients = [], results = [], started = performance.now();
const beforeFetch = globalThis.fetch;
globalThis.fetch = () => assert.fail("external traffic forbidden");
let root, service, cleaned = false;
const tables = ["messaging_message_equivalences", "messaging_correlation_candidates", "messaging_correlation_assessments"];
const functions = ["assess_messaging_admin_correlation_v1(uuid)", "messaging_equivalence_proof_guard_v1()",
  "messaging_correlation_semantics_v1(text,text,text,text,text)"];
async function connection(role) {
  const c = new Client({ host: "127.0.0.1", port, user: "postgres", password, database: "postgres" });
  await c.connect(); clients.push(c); if (role) await c.query(`set role ${role}`); return c;
}
const hash = s => createHash("sha256").update(s).digest("hex");
const migration = await readFile(new URL("../supabase/migrations/20261008193245_messaging_admin_correlation.sql", import.meta.url), "utf8");
async function scenario(name, run) {
  const time = performance.now(); await run(); results.push({ scenario: name, result: "PASS", ms: Math.round(performance.now() - time) });
}
async function sourceSnapshot() {
  return (await root.query(`select jsonb_build_object(
    'meta',(select jsonb_agg(to_jsonb(m) order by id) from public.meta_observer_events m),
    'respond',(select jsonb_agg(to_jsonb(r) order by event_id) from public.gv_respond_webhook_events r)) data`)).rows[0].data;
}
async function assess(id, client = service, checkSources = true) {
  const before = checkSources ? await sourceSnapshot() : null;
  const answer = await assessAdminObservation({ metaEventId: id, db: { async rpc(name, args) {
    assert.equal(name, "assess_messaging_admin_correlation_v1");
    return { data: (await client.query("select public.assess_messaging_admin_correlation_v1($1) result", [args.p_meta_event_id])).rows[0].result };
  } } });
  if (checkSources) assert.deepEqual(await sourceSnapshot(), before, "evaluation mutated a source journal");
  assert.equal(answer.observer_only, true); assert.equal(answer.business_dedupe_allowed, false);
  assert.equal(answer.human_authorship_proven, false); return answer;
}
let tick = 0;
function time() { return new Date(Date.UTC(2026, 0, 1, 0, ++tick)).toISOString(); }
async function meta({ key = randomUUID().replaceAll("-", ""), at = time(), category = "inbound", type = "text",
  status = null, original = null, received = at } = {}) {
  const mid = native(key), eventType = status ? `message.${status}` : ["edit", "revoke"].includes(type)
    ? `message.${type}` : category === "inbound" ? "message.received" : "message.sent";
  const fields = { native_message_id: mid, event_key: `${eventType}:${mid}`, event_type: eventType, category,
    source_field: category === "app_echo" ? "smb_message_echoes" : "messages", occurred_at: at,
    message_type: status ? null : type, status, original_message_id: original, error_codes: [],
    author_evidence: category === "app_echo" ? "smb_message_echoes_app_origin" : "human_authorship_unproven" };
  await service.query("select public.observe_meta_admin_events_v1($1,$2,$3,$4::jsonb)", [scope.waba, scope.phone, "0".repeat(64), JSON.stringify([fields])]);
  // Local fixture ingestion time only; never used against a hosted journal.
  await root.query("update public.meta_observer_events set received_at=$1 where event_key=$2", [received, fields.event_key]);
  const row = (await root.query("select * from public.meta_observer_events where event_key=$1", [fields.event_key])).rows[0];
  return { ...row, at, mid, fields };
}
async function respond(m, { id = randomUUID(), mid = `SYNTHETIC_RESPOND_${randomUUID()}`, at = m.at, received = at,
  type = "message.received", traffic = "incoming", channel = scope.channel, contact = "SYNTHETIC_CONTACT", extra = {} } = {}) {
  await root.query(`insert into public.gv_respond_webhook_events(event_id,event_type,respond_contact_id,event_occurred_at,message_id,payload_meta,received_at)
    values($1,$2,$3,$4,$5,$6,$7)`, [id, type, contact, at, mid, JSON.stringify({ channel_id: channel, traffic, ...extra }), received]);
  return id;
}
async function equivalents() { return (await root.query("select * from public.messaging_message_equivalences order by id")).rows; }
async function cleanup() {
  for (const table of [...tables, "meta_observer_events", "meta_observer_admin_scope", "gv_respond_webhook_events"])
    await root.query(`delete from public.${table}`);
  for (const table of [...tables, "meta_observer_events", "meta_observer_admin_scope", "gv_respond_webhook_events"])
    assert.equal((await root.query(`select count(*)::int n from public.${table}`)).rows[0].n, 0);
  cleaned = true;
}
try {
  await server.initialise(); await server.start(); root = await connection();
  await root.query(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  // Use the actual legacy journal DDL, including its event-type constraint and
  // RLS/ACL. Do NOT invent support for edit/revoke/status events in Respond.
  const legacy = await readFile(new URL("../supabase/migrations/202608100003_fase_2a1a_respond_incremental_webhooks.sql", import.meta.url), "utf8");
  await root.query(legacy.slice(legacy.indexOf("create table if not exists public.gv_respond_webhook_events"), legacy.indexOf("create or replace function public.claim_respond_webhook_contacts")));
  await root.query(await readFile(new URL("../supabase/migrations/20261008162624_meta_admin_observer.sql", import.meta.url), "utf8"));
  const defaults = (await root.query("select * from pg_default_acl order by oid")).rows;
  const sourceDefinitions = (await root.query(`select c.relname,c.relacl,c.relrowsecurity,
    (select jsonb_agg(pg_get_constraintdef(oid) order by oid) from pg_constraint where conrelid=c.oid) constraints,
    (select jsonb_agg(pg_get_triggerdef(oid) order by oid) from pg_trigger where tgrelid=c.oid and not tgisinternal) triggers
    from pg_class c where c.oid in ('public.gv_respond_webhook_events'::regclass,'public.meta_observer_events'::regclass,'public.meta_observer_admin_scope'::regclass) order by c.relname`)).rows;
  await root.query(migration); service = await connection("service_role");
  await root.query("insert into public.meta_observer_admin_scope(waba_id,phone_number_id,enabled) values($1,$2,true)", [scope.waba, scope.phone]);
  await scenario("restrictive effective ACL/RLS under broad production-like defaults", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const table of tables) for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        assert.equal((await root.query("select has_table_privilege($1,$2,$3) ok", [role, `public.${table}`, privilege])).rows[0].ok,
          role === "service_role" && ["SELECT", "INSERT"].includes(privilege), `${role}/${table}/${privilege}`);
      }
      for (const fn of functions) {
        assert.equal((await root.query("select has_function_privilege($1,$2,'EXECUTE') ok", [role, `public.${fn}`])).rows[0].ok, role === "service_role");
      }
    }
    assert.equal((await root.query(`select count(*)::int n from pg_proc p,lateral aclexplode(p.proacl) a
      where p.proname in ('assess_messaging_admin_correlation_v1','messaging_equivalence_proof_guard_v1','messaging_correlation_semantics_v1') and a.grantee=0`)).rows[0].n, 0);
    assert.equal((await root.query("select count(*)::int n from pg_class where relname=any($1) and relrowsecurity", [tables])).rows[0].n, 3);
    assert.equal((await root.query("select count(*)::int n from pg_proc where proname=any($1) and prosecdef", [functions.map(f => f.split("(")[0])])).rows[0].n, 0);
    for (const role of ["anon", "authenticated"]) {
      const client = await connection(role);
      for (const table of tables) await assert.rejects(client.query(`select * from public.${table}`), e => e.code === "42501");
      await assert.rejects(client.query("select public.assess_messaging_admin_correlation_v1($1)", [randomUUID()]), e => e.code === "42501");
    }
    assert.deepEqual((await root.query("select * from pg_default_acl order by oid")).rows, defaults);
  });
  const realMeta = [];
  for (const [i, row] of realObservations.entries()) {
    await scenario(`sanitized real event ${i + 1}: ambiguous, never equivalent`, async () => {
      const m = await meta({ key: row.metaMessageRef, at: row.occurred, received: row.metaReceived,
        type: row.originalRef ? "revoke" : "text", original: row.originalRef ? native(row.originalRef) : null });
      realMeta.push(m);
      await respond(m, { id: row.respondRef, mid: row.respondMessageRef, received: row.respondReceived, type: row.respondType });
      const a = await assess(m.id); assert.equal(a.state, "ambiguous"); assert.equal(a.reason, row.expectedReason); assert.equal(a.candidate_count, 1);
      assert.equal((await equivalents()).length, 0);
      if (i === 1) assert.equal((await root.query("select related_meta_event_id from public.messaging_correlation_assessments where id=$1", [a.assessment_id])).rows[0].related_meta_event_id, realMeta[0].id);
    });
  }
  await scenario("no candidates and new evidence append versions; unchanged evidence reuses", async () => {
    const m = await meta(); const first = await assess(m.id); assert.equal(first.state, "unmatched");
    assert.equal((await assess(m.id)).assessment_id, first.assessment_id);
    await respond(m); const second = await assess(m.id); assert.equal(second.state, "ambiguous"); assert.equal(second.version, 2);
    assert.equal((await root.query("select state from public.messaging_correlation_assessments where id=$1", [first.assessment_id])).rows[0].state, "unmatched");
    assert.equal((await assess(m.id)).reused, true);
  });
  await scenario("multiple candidates / same timestamp distinct messages never matched", async () => {
    const m = await meta(); const n = await meta({ at: m.at }); await respond(m); await respond(m);
    for (const row of [m, n]) { const a = await assess(row.id); assert.equal(a.state, "ambiguous"); assert.equal(a.candidate_count, 2); }
  });
  await scenario("exact journal-native identity is not time-window limited", async () => {
    const m = await meta(); await respond(m, { mid: m.mid, at: "2025-01-01T00:00:00Z" });
    const a = await assess(m.id); assert.equal(a.state, "matched"); assert.equal(a.reason, "exact_native_id");
    assert.equal((await equivalents()).filter(e => e.native_message_id === m.mid).length, 1);
  });
  await scenario("only exact evidence resolves a noisy temporal candidate set", async () => {
    const m = await meta(); await respond(m); await respond(m); await respond(m, { mid: m.mid });
    const a = await assess(m.id); assert.equal(a.candidate_count, 3); assert.equal(a.state, "matched");
    assert.equal((await equivalents()).filter(e => e.native_message_id === m.mid).length, 1);
  });
  await scenario("claimed metadata wamid / phone / text / assignee never certify identity", async () => {
    const m = await meta(); await respond(m, { extra: { wamid: m.mid, native_message_id: m.mid,
      assignee_id: "SYNTHETIC_USER", phone: "SYNTHETIC_PHONE", text: "SYNTHETIC_TEXT" } });
    assert.equal((await assess(m.id)).state, "ambiguous");
  });
  await scenario("wrong Respond channel is excluded even with exact native ID", async () => {
    const m = await meta(); await respond(m, { mid: m.mid, channel: "999999" }); assert.equal((await assess(m.id)).state, "unmatched");
  });
  await scenario("exact ID with conflicting contact or direction fails closed", async () => {
    const m = await meta(); await respond(m, { mid: m.mid }); await respond(m, { mid: m.mid, contact: "SYNTHETIC_OTHER" });
    assert.equal((await assess(m.id)).reason, "identity_conflict");
    const n = await meta(); await respond(n, { mid: n.mid, type: "message.sent", traffic: "outgoing" });
    assert.equal((await assess(n.id)).reason, "semantic_conflict");
  });
  await scenario("edit and late original linkage preserve prior assessments and source rows", async () => {
    const original = native("LATE_ORIGINAL"); const edit = await meta({ type: "edit", original });
    await respond(edit); const a = await assess(edit.id); assert.equal(a.reason, "semantic_conflict");
    assert.equal((await root.query("select related_meta_event_id from public.messaging_correlation_assessments where id=$1", [a.assessment_id])).rows[0].related_meta_event_id, null);
    const base = await meta({ key: "LATE_ORIGINAL" }); const b = await assess(edit.id); assert.equal(b.version, 2);
    assert.equal((await root.query("select related_meta_event_id from public.messaging_correlation_assessments where id=$1", [b.assessment_id])).rows[0].related_meta_event_id, base.id);
    assert.equal((await root.query("select related_meta_event_id from public.messaging_correlation_assessments where id=$1", [a.assessment_id])).rows[0].related_meta_event_id, null);
  });
  await scenario("out-of-order read/delivered/failed/sent observations are not new turns", async () => {
    const at = time(); const key = "STATUSES"; const rows = [];
    for (const status of ["read", "delivered", "failed", "sent"]) {
      const m = await meta({ key, at, category: "status", status }); rows.push(m);
      assert.equal((await assess(m.id)).state, "unmatched");
    }
    const echoAttempt = await meta({ key, at, category: "app_echo" });
    // Existing observer key is event_type:native_id. sent-status and app echo
    // collide: original status survives, never invent an app/human observation.
    assert.equal(echoAttempt.category, "status");
    await respond(echoAttempt, { mid: echoAttempt.mid, type: "message.sent", traffic: "outgoing" });
    const eqBefore = await equivalents();
    for (const m of rows) {
      const a = await assess(m.id); assert.equal(a.state, "ambiguous");
      assert.equal((await root.query("select related_meta_event_id from public.messaging_correlation_assessments where id=$1", [a.assessment_id])).rows[0].related_meta_event_id, null);
    }
    assert.deepEqual(await equivalents(), eqBefore);
    assert.deepEqual((await root.query("select status from public.meta_observer_events where native_message_id=$1 and category='status' order by status", [echoAttempt.mid])).rows.map(r => r.status), ["delivered", "failed", "read", "sent"]);
  });
  await scenario("exact app echo does not infer human authorship or change pause", async () => {
    const m = await meta({ category: "app_echo" }); await respond(m, { mid: m.mid, type: "message.sent", traffic: "outgoing", extra: { assignee_id: "SYNTHETIC_USER" } });
    const a = await assess(m.id); assert.equal(a.state, "matched"); assert.equal(a.human_authorship_proven, false);
  });
  await scenario("concurrent identical evaluations create one assessment/candidate/equivalence", async () => {
    const m = await meta(); await respond(m, { mid: m.mid });
    const sessions = await Promise.all(Array.from({ length: 6 }, () => connection("service_role")));
    const before = await sourceSnapshot();
    const rs = await Promise.all(sessions.map(c => assess(m.id, c, false)));
    assert.deepEqual(await sourceSnapshot(), before);
    assert.equal(new Set(rs.map(r => r.assessment_id)).size, 1); assert.equal(rs.filter(r => !r.reused).length, 1);
    assert.equal((await equivalents()).filter(e => e.native_message_id === m.mid).length, 1);
  });
  await scenario("duplicate provider deliveries reuse observations and no second equivalence", async () => {
    const m = await meta(); const id = await respond(m, { mid: m.mid }); const a = await assess(m.id);
    const dup = (await service.query("select public.observe_meta_admin_events_v1($1,$2,$3,$4::jsonb) r", [scope.waba, scope.phone, "1".repeat(64), JSON.stringify([m.fields])])).rows[0].r;
    assert.equal(dup.duplicates, 1); assert.equal((await assess(m.id)).assessment_id, a.assessment_id);
    await root.query("insert into public.gv_respond_webhook_events select * from public.gv_respond_webhook_events where event_id=$1 on conflict do nothing", [id]);
    assert.equal((await assess(m.id)).assessment_id, a.assessment_id);
    await respond(m, { mid: m.mid }); const b = await assess(m.id); assert.equal(b.state, "matched"); assert.equal(b.version, 2);
    assert.equal((await equivalents()).filter(e => e.native_message_id === m.mid).length, 1);
  });
  await scenario("candidate overflow is explicit, never a truncated matched result", async () => {
    const m = await meta();
    await root.query(`insert into public.gv_respond_webhook_events(event_id,event_type,respond_contact_id,event_occurred_at,message_id,payload_meta)
      select 'SYNTHETIC_OVERFLOW_'||x,'message.received','SYNTHETIC_CONTACT',$1,'SYNTHETIC_MESSAGE_'||x,
      '{"channel_id":"544519","traffic":"incoming"}'::jsonb from generate_series(1,202) x`, [m.at]);
    await respond(m, { mid: m.mid }); const a = await assess(m.id); assert.equal(a.state, "ambiguous"); assert.equal(a.reason, "candidate_limit");
    assert.equal(a.candidate_count, 201);
  });
  await scenario("direct forged equivalence fails its authoritative proof guard", async () => {
    const m = await meta(); const r = await respond(m); const a = await assess(m.id);
    await assert.rejects(service.query(`insert into public.messaging_message_equivalences(waba_id,phone_number_id,respond_channel_id,
      native_message_id,respond_message_id,proof_kind,meta_event_id,respond_event_id,assessment_id)
      values($1,$2,'544519',$3,$3,'journal_native_id_equality',$4,$5,$6)`, [scope.waba, scope.phone, m.mid, m.id, r, a.assessment_id]),
    e => e.code === "23514" && e.message === "messaging_exact_identity_unproven");
  });
  await scenario("lost response reuses committed evaluation; rollback leaves no partial write", async () => {
    const m = await meta(); await respond(m, { mid: m.mid });
    await service.query("begin"); await assess(m.id); await service.query("rollback");
    assert.equal((await root.query("select count(*)::int n from public.messaging_correlation_assessments where meta_event_id=$1", [m.id])).rows[0].n, 0);
    assert.equal((await equivalents()).filter(e => e.native_message_id === m.mid).length, 0);
    const a = await assess(m.id); assert.equal(a.version, 1); const b = await assess(m.id); assert.equal(b.reused, true); assert.equal(b.assessment_id, a.assessment_id);
  });
  await scenario("append-only ACL; journal definitions/grants/defaults unchanged; no business objects", async () => {
    for (const table of tables) {
      for (const sql of [`delete from public.${table}`, `update public.${table} set observer_only=true`, `truncate public.${table}`]) {
        // candidates intentionally has no observer_only; use its key for UPDATE.
        const statement = table.endsWith("candidates") ? sql.replace("observer_only=true", "assessment_id=assessment_id") : sql;
        await assert.rejects(service.query(statement), e => e.code === "42501");
      }
    }
    assert.deepEqual((await root.query(`select c.relname,c.relacl,c.relrowsecurity,
      (select jsonb_agg(pg_get_constraintdef(oid) order by oid) from pg_constraint where conrelid=c.oid) constraints,
      (select jsonb_agg(pg_get_triggerdef(oid) order by oid) from pg_trigger where tgrelid=c.oid and not tgisinternal) triggers
      from pg_class c where c.oid in ('public.gv_respond_webhook_events'::regclass,'public.meta_observer_events'::regclass,'public.meta_observer_admin_scope'::regclass) order by c.relname`)).rows, sourceDefinitions);
    const all = (await root.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(x => x.tablename);
    assert.deepEqual(all, [...tables, "meta_observer_admin_scope", "meta_observer_events", "gv_respond_webhook_events"].sort());
    assert.deepEqual((await root.query("select * from pg_default_acl order by oid")).rows, defaults);
  });
  await scenario("cleanup all local fixtures = 0", cleanup);
  console.log(JSON.stringify({ verdict: "PASS", database: "isolated_local_postgresql", postgres_version: (await root.query("show server_version")).rows[0].server_version,
    results, migration_sha256: hash(migration), elapsed_ms: Math.round(performance.now() - started), cleanup_rows: 0,
    production_connections: 0, hosted_connections: 0, models: 0, sends: 0, workflows: 0, assignments: 0 }, null, 2));
} finally {
  if (root && !cleaned) await cleanup().catch(() => {});
  await Promise.all(clients.map(c => c.end().catch(() => {})));
  await server.stop(); globalThis.fetch = beforeFetch;
}
