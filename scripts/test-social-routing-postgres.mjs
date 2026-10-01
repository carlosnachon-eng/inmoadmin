// Disposable loopback PostgreSQL. Never loads .env or accesses Supabase/Respond/models.
import assert from "node:assert/strict";
import { readFile, mkdtemp, access, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import net from "node:net";
import { randomUUID } from "node:crypto";

const runtime = process.env.SOCIAL_LOCAL_PG_RUNTIME;
if (!runtime) throw new Error("SOCIAL_LOCAL_PG_RUNTIME must point to local pg/embedded-postgres packages");
const { default: EmbeddedPostgres } = await import(pathToFileURL(resolve(runtime, "node_modules/embedded-postgres/dist/index.js")));
const { default: pg } = await import(pathToFileURL(resolve(runtime, "node_modules/pg/lib/index.js")));
const directory = await mkdtemp(join(tmpdir(), "social-routing-pg-"));
const socket = net.createServer(); await new Promise(ok => socket.listen(0, "127.0.0.1", ok)); const port = socket.address().port; await new Promise(ok => socket.close(ok));
const cluster = new EmbeddedPostgres({ databaseDir: join(directory, "data"), user: "postgres", password: "local-synthetic-only", port, persistent: false,
  postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", `unix_socket_directories=${directory}`], onLog() {}, onError() {} });
const clients = [], checks = [];
const connect = async role => { const c = new pg.Client({ host: "127.0.0.1", port, database: "postgres", user: "postgres", password: "local-synthetic-only", statement_timeout: 10000 }); await c.connect(); clients.push(c); if (role) await c.query(`set role ${role}`); return c; };
const check = (label, fn) => { fn(); checks.push(label); };
const reject = async (label, fn, pattern) => { await assert.rejects(fn, pattern); checks.push(label); };
const file = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const route = (n, destination = "SALES", extras = {}) => ({ source_event_id: `event-${n}`, source_message_id: `message-${n}`, source_channel_id: "497382", source_platform: "instagram", respond_contact_id: `contact-${n}`, source_metadata: null, destination, reason: "synthetic_intent", identity_status: "unresolved", canonical_identity_id: null, occurred_at: "2026-10-01T12:00:00Z", sanitized_text: "Consulta sintética", ...extras });
const capture = (c, r) => c.query("select public.capture_social_route_v1($1) result", [r]).then(r => r.rows[0].result);
const waitBlocked = async (db, a, b) => { let blocked = false; for (let i = 0; i < 80; i++) { if ((await db.query("select $1::int=any(pg_blocking_pids($2::int)) blocked", [a.processID, b.processID])).rows[0].blocked) { blocked = true; break; } await new Promise(ok => setTimeout(ok, 10)); } assert.equal(blocked, true, "independent transaction must actually wait"); };
try {
  await cluster.initialise(); await cluster.start(); const db = await connect();
  await db.query(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    create table profiles(id uuid primary key); create table clientes(id uuid primary key,nombre text);
    create table propiedades(id uuid primary key,public_id text); create table client_identities(id uuid primary key,status text);
    create table gv_respond_webhook_events(event_id text primary key);
    create table respond_identity_links(respond_contact_id text,client_identity_id uuid,link_status text);
    create table gv_opportunities(respond_contact_id text,cliente_id uuid);
    create table citas(id uuid primary key default gen_random_uuid(),cliente_id uuid references clientes,propiedad_id uuid references propiedades,asesor_id uuid references profiles,
      fecha_hora timestamptz,estado text,notas text,confirmacion_estado text,confirmacion_actualizada_at timestamptz,confirmacion_actualizada_por uuid references profiles);`);
  // Reuse actual checked-in lane schemas; only upstream catalog dependencies are fixtures.
  for (const name of ["202609300009_sales_agent_v2_shadow_lane.sql", "202610010002_sales_agent_v2_handoffs.sql", "202610010003_sales_agent_v2_handoff_dispatch.sql", "202610010004_sales_agent_v2_handoff_sla.sql", "202610010005_sales_agent_v2_handoff_escalated_status.sql", "202610010006_sales_agent_v2_immediate_processing_status.sql", "202610010007_sales_agent_v2_message_debounce.sql", "202610010008_owner_agent_v1_base.sql", "202610010009_legal_agent_v1_base.sql", "202610010010_legal_agent_v1_handoffs.sql", "202610010012_respond_appointment_sync.sql"]) await db.query(await file(name));
  await db.query("grant select,insert,update on all tables in schema public to service_role");
  const historical = randomUUID();
  await db.query("insert into sales_agent_v2_inbound_messages(id,event_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status) values($1,'historical','historical-contact','498219',now(),'Synthetic historical row','processed')", [historical]);
  const before = (await db.query("select row_to_json(t)::text data from sales_agent_v2_inbound_messages t where id=$1", [historical])).rows[0].data;
  await db.query(await file("20261001134913_social_routing_v1.sql"));
  const postcheck = await readFile(new URL("../supabase/checks/social_routing_v1.sql", import.meta.url), "utf8");
  const catalog = await db.query(postcheck);
  check("catalog RLS/ACL RPC/trigger postchecks", () => {
    assert.equal(catalog[0].rowCount, 3); assert.equal(catalog[1].rowCount, 4);
    for (const result of catalog.slice(0, 3)) for (const row of result.rows) for (const value of Object.values(row)) if (typeof value === "boolean") assert.equal(value, true);
  });
  const uninstall = await readFile(new URL("../supabase/rollback/social_routing_v1_empty_only.sql", import.meta.url), "utf8");
  await db.query(uninstall);
  const rolledBackHistory = (await db.query("select row_to_json(t)::text data from sales_agent_v2_inbound_messages t where id=$1", [historical])).rows[0].data;
  check("empty-only rollback preserves original schema/history", () => assert.equal(rolledBackHistory, before));
  await db.query(await file("20261001134913_social_routing_v1.sql"));
  const after = (await db.query("select to_jsonb(t)-'social_route_id' data from sales_agent_v2_inbound_messages t where id=$1", [historical])).rows[0].data;
  check("historical row unchanged (new nullable binding only)", () => assert.deepEqual(after, JSON.parse(before)));
  const a = await connect("service_role"), b = await connect("service_role"), anon = await connect("anon"), authenticated = await connect("authenticated");
  const seedEvent = async r => { await db.query("insert into gv_respond_webhook_events values($1)", [r.source_event_id]); return r; };
  const r = await seedEvent(route(1)); await a.query("begin"); const first = await capture(a, r); const pending = capture(b, r); await waitBlocked(db, a, b); await a.query("commit"); const second = await pending;
  check("H independent concurrent capture: 1 decision / 1 inbound", () => { assert.equal(first.created, true); assert.equal(second.created, false); assert.equal(first.inboundId, second.inboundId); });
  const counts = (await db.query("select (select count(*) from social_message_routes)::int routes,(select count(*) from sales_agent_v2_inbound_messages where social_route_id is not null)::int inbounds")).rows[0];
  check("no duplicate queue row", () => assert.deepEqual(counts, { routes: 1, inbounds: 1 }));
  const deliveredAgain = await seedEvent(route(1, "LEGAL", { source_event_id: "event-alias" }));
  check("same message different event never routes to another specialist", () => assert.equal(second.destination, "SALES"));
  assert.equal((await capture(a, deliveredAgain)).created, false);
  await reject("event collision rejected", () => capture(a, route(1, "SALES", { respond_contact_id: "someone-else" })), /social_event_collision/);
  await reject("cross-agent direct insertion rejected", () => a.query("insert into legal_agent_v1_inbound_messages(event_id,external_message_id,respond_contact_id,channel_id,occurred_at,sanitized_text) values('event-1','message-1','contact-1','497382',now(),'Synthetic')"), /social_exclusive_route_violation/);
  await a.query("update sales_agent_v2_inbound_messages set status='processing' where id=$1", [first.inboundId]);
  await reject("uncertain execution cannot reset to captured", () => a.query("update sales_agent_v2_inbound_messages set status='captured' where id=$1", [first.inboundId]), /social_reexecution_requires_review/);
  await reject("binding cannot be cleared", () => a.query("update sales_agent_v2_inbound_messages set social_route_id=null where id=$1", [first.inboundId]), /immutable/);
  for (const destination of ["OWNER", "LEGAL", "ADMINISTRATION", "HUMAN_REVIEW", "EXISTING_CLIENT", "UNKNOWN"]) {
    const result = await capture(a, await seedEvent(route(destination, destination)));
    check(`exclusive destination ${destination}`, () => assert.equal(Boolean(result.inboundId), ["OWNER", "LEGAL"].includes(destination)));
  }
  const attributed = await seedEvent(route("attributed", "SALES", { source_post_id: "post", source_comment_id: "comment", source_ad_id: "ad", source_campaign_id: "campaign", source_metadata: { origin_kind: "private_reply" } }));
  const attributedResult = await capture(a, attributed);
  const attributionRow = (await db.query("select source_post_id,source_comment_id,source_ad_id,source_campaign_id,source_metadata from social_message_routes where id=$1", [attributedResult.routeId])).rows[0];
  check("L explicit attribution persisted exactly", () => assert.deepEqual(attributionRow, { source_post_id: "post", source_comment_id: "comment", source_ad_id: "ad", source_campaign_id: "campaign", source_metadata: { origin_kind: "private_reply" } }));
  const absent = (await db.query("select source_post_id,source_comment_id,source_ad_id,source_campaign_id,source_property_id,source_metadata from social_message_routes where id=$1", [first.routeId])).rows[0];
  check("M absent attribution is SQL NULL, not invented", () => assert.ok(Object.values(absent).every(v => v === null)));
  const invalidMetadata = await seedEvent(route("invalid-meta", "UNKNOWN", { source_metadata: { private: "must-not-persist" } }));
  await reject("metadata rejects arbitrary provider content", () => capture(a, invalidMetadata), /check constraint/);
  // Legacy and new capture racing use the same advisory lock, not a read-before-write illusion.
  const legacyRoute = await seedEvent(route("legacy-race"));
  await a.query("begin"); await a.query("insert into owner_agent_v1_inbound_messages(event_id,external_message_id,respond_contact_id,channel_id,occurred_at,sanitized_text) values($1,$2,$3,$4,now(),'Synthetic')", [legacyRoute.source_event_id, legacyRoute.source_message_id, legacyRoute.respond_contact_id, legacyRoute.source_channel_id]);
  const racing = capture(b, legacyRoute).then(() => null, error => error); await waitBlocked(db, a, b); await a.query("commit");
  const raceError = await racing;
  check("legacy/new race fails closed, never duplicates", () => assert.match(raceError.message, /social_preexisting_legacy_message/));
  for (const role of [anon, authenticated]) for (const table of ["social_message_routes", "social_handoff_effects", "social_appointment_keys"]) await reject("unauthorized read rejected", () => role.query(`select * from ${table}`), /permission denied/);
  await reject("authenticated RPC denied", () => capture(authenticated, r), /permission denied/);
  await reject("service cannot rewrite decision", () => a.query("update social_message_routes set destination='OWNER' where id=$1", [first.routeId]), /permission denied/);
  const handoffId = randomUUID();
  await a.query("insert into sales_agent_v2_handoffs(id,respond_contact_id,channel_id,inbound_message_id,reason,summary) values($1,'contact-1','497382',$2,'appointment_intent','Synthetic')", [handoffId, first.inboundId]);
  const reserve = (c, phase) => c.query("select reserve_social_effect_v1('sales',$1,$2) result", [handoffId, phase]).then(r => r.rows[0].result);
  await reject("ACK requires persisted assignment receipt", () => reserve(a, "ack"), /assignment_not_completed/);
  await a.query("begin"); const reservation = await reserve(a, "assignment"); const contending = reserve(b, "assignment"); await waitBlocked(db, a, b); await a.query("commit"); const loser = await contending;
  check("assignment reservation one owner; loser cannot send", () => { assert.equal(reservation.owned, true); assert.equal(loser.owned, false); assert.equal(loser.token, null); });
  await a.query("select finish_social_effect_v1($1,'completed',null)", [reservation.token]);
  const ack = await reserve(a, "ack"); await a.query("select finish_social_effect_v1($1,'uncertain',null)", [ack.token]);
  const ackAgain = await reserve(b, "ack"); check("uncertain ACK remains consumed", () => { assert.equal(ackAgain.owned, false); assert.equal(ackAgain.status, "uncertain"); });
  await reject("completed effect cannot reset", () => a.query("select finish_social_effect_v1($1,'completed','other')", [ack.token]), /already_consumed/);
  await reject("handoff target immutable", () => a.query("update sales_agent_v2_handoffs set respond_contact_id='another' where id=$1", [handoffId]), /immutable/);
  const advisor = randomUUID(), client = randomUUID(), property = randomUUID();
  await db.query("insert into profiles values($1);", [advisor]); await db.query("insert into clientes values($1,'Same Synthetic Name')", [client]); await db.query("insert into propiedades values($1,'public-synthetic')", [property]);
  await db.query("insert into gv_opportunities values('booking-contact',$1)", [client]);
  const sync = async n => { const id = randomUUID(); await db.query("insert into respond_appointment_sync(id,event_id,respond_contact_id,lifecycle,social_routing_version) values($1,$2,'booking-contact','Visita agendada',1)", [id, `booking-${n}`]); return id; };
  const syncA = await sync(1), syncB = await sync(2);
  await reject("appointment mode cannot be cleared for legacy fallback", () => a.query("update respond_appointment_sync set social_routing_version=null where id=$1", [syncA]), /binding_immutable/);
  const book = (c, id, at = "2026-10-02T18:00:00Z", clientId = client) => c.query("select commit_social_appointment_v1($1,$2,$3,$4,$5,null,'Synthetic human confirmation') result", [id, advisor, clientId, property, at]).then(r => r.rows[0].result);
  await a.query("begin"); const booked = await book(a, syncA); const concurrentBooking = book(b, syncB, "2026-10-02T18:15:00Z"); await waitBlocked(db, a, b); await a.query("commit"); const bookedB = await concurrentBooking;
  check("J distinct events within original +/-30m interval create one cita", () => { assert.equal(booked.status, "created"); assert.equal(bookedB.status, "already_exists"); assert.equal(booked.citaId, bookedB.citaId); });
  const sameBooking = await book(a, syncA);
  check("same sync key is permanently idempotent", () => assert.equal(sameBooking.status, "already_exists"));
  const total = (await db.query("select (select count(*) from citas)::int citas,(select count(*) from social_appointment_keys)::int keys")).rows[0];
  check("one cita / two linked event keys", () => assert.deepEqual(total, { citas: 1, keys: 2 }));
  const missing = await sync(3); await reject("wrong client link never joins by name", () => book(a, missing, undefined, randomUUID()), /client_link_not_unique/);
  await reject("rollback refuses to delete protected evidence", () => db.query(uninstall), /social_rollback_refused_evidence_exists/); await db.query("rollback");
  const security = (await db.query("select relname,relrowsecurity from pg_class where relname=any($1)", [["social_message_routes", "social_handoff_effects", "social_appointment_keys"]])).rows;
  check("RLS enabled on all new tables", () => { assert.equal(security.length, 3); assert.ok(security.every(r => r.relrowsecurity)); });
  console.log(JSON.stringify({ result: "SOCIAL_ROUTING_LOCAL_PG_PASS", checks: checks.length, tests: checks, isolation: "loopback disposable PostgreSQL; no Supabase DEV/Production", externalCalls: 0 }, null, 2));
} finally {
  for (const c of clients) { try { await c.query("rollback"); } catch {} try { await c.end(); } catch {} }
  await cluster.stop(); await assert.rejects(access(join(directory, "data")), { code: "ENOENT" }); await rmdir(directory);
  console.log("LOCAL_SYNTHETIC_CLUSTER_STOPPED_AND_REMOVED");
}
