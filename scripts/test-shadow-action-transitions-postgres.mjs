// Disposable loopback PostgreSQL only. No .env, hosted DB, Respond or model calls.
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import net from "node:net";
import { buildConversationAction, persistConversationAction, supersedeConversationActionsForHumanResponses } from "../lib/shadow/ai/conversationAction.js";

const runtime = process.env.SHADOW_ACTION_LOCAL_PG_RUNTIME;
if (!runtime) throw Error("SHADOW_ACTION_LOCAL_PG_RUNTIME must point to local embedded-postgres/pg packages");
const { default: EmbeddedPostgres } = await import(pathToFileURL(resolve(runtime, "node_modules/embedded-postgres/dist/index.js")));
const { default: pg } = await import(pathToFileURL(resolve(runtime, "node_modules/pg/lib/index.js")));
const socket = net.createServer();
await new Promise((ok, fail) => { socket.once("error", fail); socket.listen(0, "127.0.0.1", ok); });
const port = socket.address().port;
await new Promise(ok => socket.close(ok));
const directory = await mkdtemp(join(tmpdir(), "shadow-action-transitions-"));
const cluster = new EmbeddedPostgres({ databaseDir: join(directory, "data"), user: "postgres", password: "local-synthetic-only", port,
  persistent: false, postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", `unix_socket_directories=${directory}`], onLog() {}, onError() {} });
const clients = [], checks = [];
let externalCalls = 0;
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { externalCalls++; throw Error("external_network_forbidden"); };
const connect = async () => {
  const client = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "local-synthetic-only", database: "postgres", statement_timeout: 10000 });
  await client.connect(); clients.push(client); return client;
};
const check = (name, assertion) => { assertion(); checks.push({ name, status: "PASS" }); };
const id = n => `ab000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const env = { SHADOW_CONVERSATION_ACTIONS_ENABLED: "true", SHADOW_OUTBOUND_ENABLED: "false", SHADOW_ADMIN_OUTBOUND_ENABLED: "false" };
const resolution = { case_domain: "maintenance", case_status: "existing_open_case", interaction_direction: "inbound_customer_action",
  identity_context: { status: "trusted_link_available" }, evidence: [{ evidenceId: "synthetic-evidence" }],
  missing_information: [], action_confidence: .82, requires_human: false };
const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

// Minimal PostgREST adapter executes the production function's filters and patch
// against the actual migrated action table, not a reimplementation of transitions.
function admin(client) {
  return { from(table) {
    assert.equal(table, "shadow_conversation_actions");
    let fields = "*", where = [], values = [], patch, inserted, single = false, limit = "";
    const column = value => { assert.match(value, /^[a-z_]+$/); return value; };
    const parameter = value => { values.push(value && typeof value === "object" ? JSON.stringify(value) : value); return `$${values.length}`; };
    const query = {
      select(value = "*") { assert.match(value, /^[a-z_,*]+$/); fields = value; return query; },
      eq(key, value) { where.push(`${column(key)}=${parameter(value)}`); return query; },
      limit(value) { assert.ok(Number.isInteger(value)); limit = ` limit ${value}`; return query; },
      update(value) { patch = value; return query; }, insert(value) { inserted = value; return query; },
      single() { single = true; return query; },
      then(ok, fail) {
        let sql;
        if (inserted) {
          const entries = Object.entries(inserted);
          sql = `insert into public.${table} (${entries.map(([key]) => column(key)).join(",")}) values (${entries.map(([,value]) => parameter(value)).join(",")}) returning ${fields}`;
        } else {
          sql = patch ? `update public.${table} set ${Object.entries(patch).map(([key, value]) => `${column(key)}=${parameter(value)}`).join(",")}` : `select ${fields} from public.${table}`;
          sql += (where.length ? ` where ${where.join(" and ")}` : "") + (patch ? ` returning ${fields}` : limit);
        }
        return client.query(sql, values).then(result => ({ data: single ? result.rows[0] : result.rows, error: null }), error => ({ data: null, error })).then(ok, fail);
      },
    };
    return query;
  } };
}

try {
  await cluster.initialise(); await cluster.start();
  const db = await connect(), a = await connect(), b = await connect();
  // Only FK parent fixtures are minimal; the action table, ACL and all its checks
  // are created from the unchanged repository migrations.
  await db.query("create role anon; create role authenticated; create role service_role; create table public.shadow_ai_runs(id uuid primary key); create table public.shadow_messages(id uuid primary key); create table public.shadow_conversations(id uuid primary key);");
  await db.query(await migration("202608270001_fase_3b_shadow_conversation_actions.sql"));
  await db.query(await migration("202608280003_fase_3b_interaction_direction.sql"));
  const constraintSql = "select pg_get_constraintdef(oid) definition,convalidated from pg_constraint where conrelid='public.shadow_conversation_actions'::regclass and conname='shadow_conversation_actions_check2'";
  const constraintBefore = (await db.query(constraintSql)).rows;
  check("original validated check2 installed", () => { assert.equal(constraintBefore.length, 1); assert.equal(constraintBefore[0].convalidated, true); assert.match(constraintBefore[0].definition, /NOT auto_send_eligible/); });
  await db.query("insert into public.shadow_conversations values($1)", [id(1)]);
  await db.query("insert into public.shadow_messages values($1)", [id(2)]);
  const seed = async (n, { human = false, eligible = true, expired = true } = {}) => {
    await db.query("insert into public.shadow_ai_runs values($1)", [id(n)]);
    await db.query("insert into public.shadow_messages values($1)", [id(n)]);
    const now = expired ? Date.parse("2026-01-01T00:00:00Z") : Date.now();
    const result = await persistConversationAction(admin(db), { run: { id: id(n) }, message: { id: id(n), conversation_id: id(1) },
      resolution: { ...resolution, requires_human: !eligible }, env, now,
      telemetry: { turn_key: `synthetic-turn-${n}`, ...(human ? { human_response_id: id(2) } : {}) } });
    assert.equal(result.status, human ? "superseded" : "proposed");
    return result.actionId;
  };
  const row = async actionId => (await db.query("select * from public.shadow_conversation_actions where id=$1", [actionId])).rows[0];
  const messages = n => [{ id: id(n), conversation_id: id(1), direction: "inbound", occurred_at: "2026-01-01T00:00:00Z" },
    { id: id(2), conversation_id: id(1), direction: "outbound_human", occurred_at: new Date().toISOString() }];

  const expired = await seed(10);
  const originalExpired = await row(expired);
  await assert.rejects(() => db.query("update public.shadow_conversation_actions set status='expired' where id=$1", [expired]), error => error.code === "23514" && error.constraint === "shadow_conversation_actions_check2");
  const afterRejectedExpiry = await row(expired);
  check("old expiration reproduced: 23514/check2; original unchanged", () => assert.deepEqual(afterRejectedExpiry, originalExpired));
  await supersedeConversationActionsForHumanResponses(admin(db), [], env);
  const expiredRow = await row(expired);
  check("eligible expired: real UPDATE succeeds with false eligibility", () => { assert.equal(expiredRow.status, "expired"); assert.equal(expiredRow.auto_send_eligible, false); assert.equal(expiredRow.requires_human, false); });

  const human = await seed(11, { expired: false });
  await assert.rejects(() => db.query("update public.shadow_conversation_actions set status='superseded',superseded_by_message_id=$2,superseded_at=now() where id=$1", [human, id(2)]), error => error.code === "23514" && error.constraint === "shadow_conversation_actions_check2");
  checks.push({ name: "old human supersession reproduced: 23514/check2", status: "PASS" });
  await supersedeConversationActionsForHumanResponses(admin(db), messages(11), env);
  const humanRow = await row(human);
  check("human response: real UPDATE succeeds with false eligibility", () => { assert.equal(humanRow.status, "superseded"); assert.equal(humanRow.auto_send_eligible, false); assert.equal(humanRow.superseded_by_message_id, id(2)); });

  const direct = await seed(12, { human: true, expired: false });
  const directRow = await row(direct);
  check("direct superseded real INSERT satisfies all constraints", () => { assert.equal(directRow.status, "superseded"); assert.equal(directRow.auto_send_eligible, false); assert.ok(directRow.superseded_at); });
  for (const [n, expired] of [[13, true], [14, false]]) {
    const actionId = await seed(n, { eligible: false, expired });
    const original = await row(actionId);
    await supersedeConversationActionsForHumanResponses(admin(db), expired ? [] : messages(n), env);
    const result = await row(actionId);
    check(`noneligible ${expired ? "expired" : "superseded"} preserves content and human decision`, () => {
      assert.equal(result.status, expired ? "expired" : "superseded"); assert.equal(result.auto_send_eligible, false);
      for (const field of ["requires_human", "proposed_message", "evidence_refs", "blocked_reason"]) assert.deepEqual(result[field], original[field]);
    });
  }

  for (const [n, expired] of [[15, true], [16, false]]) {
    const actionId = await seed(n, { expired });
    await a.query("begin");
    await a.query("update public.shadow_conversation_actions set status='rejected',auto_send_eligible=false,blocked_reason='synthetic_concurrent_review' where id=$1", [actionId]);
    const concurrent = (await a.query("select row_to_json(a)::text bytes from public.shadow_conversation_actions a where id=$1", [actionId])).rows[0].bytes;
    let finished = false;
    const cleanup = supersedeConversationActionsForHumanResponses(admin(b), expired ? [] : messages(n), env).finally(() => { finished = true; });
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      const result = await db.query("select $1::int=any(pg_blocking_pids($2::int)) blocked", [a.processID, b.processID]);
      if (result.rows[0].blocked) { blocked = true; break; }
      await new Promise(ok => setTimeout(ok, 20));
    }
    check(`${expired ? "expiry" : "human"} concurrent worker waits on row lock`, () => { assert.equal(blocked, true); assert.equal(finished, false); });
    await a.query("commit"); await cleanup;
    const after = (await db.query("select row_to_json(a)::text bytes from public.shadow_conversation_actions a where id=$1", [actionId])).rows[0].bytes;
    check(`${expired ? "expiry" : "human"} status=proposed guard preserves concurrent row byte-for-byte`, () => assert.equal(after, concurrent));
  }
  const beforeRepeat = (await db.query("select row_to_json(a)::text bytes from public.shadow_conversation_actions a order by id")).rows;
  await supersedeConversationActionsForHumanResponses(admin(db), [], env);
  const afterRepeat = (await db.query("select row_to_json(a)::text bytes from public.shadow_conversation_actions a order by id")).rows;
  check("repeated cleanup idempotent", () => assert.deepEqual(afterRepeat, beforeRepeat));
  const constraintAfter = (await db.query(constraintSql)).rows;
  check("constraint remains identical", () => assert.deepEqual(constraintAfter, constraintBefore));
  check("zero external calls; no provider/outbound invoked", () => assert.equal(externalCalls, 0));
  console.log(JSON.stringify({ scope: "disposable loopback PostgreSQL only", checks, total: checks.length, externalCalls }, null, 2));
} finally {
  for (const client of clients) { try { await client.query("rollback"); } catch {} try { await client.end(); } catch {} }
  await cluster.stop();
  await assert.rejects(access(join(directory, "data")), { code: "ENOENT" });
  await rmdir(directory);
  globalThis.fetch = previousFetch;
  console.log("LOCAL_CLUSTER_STOPPED_AND_REMOVED");
}
