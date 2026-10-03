import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { captureSocialRoute, classifySocialRoute, socialAttribution, socialEligible, socialRouteReview, readSocialIdentity } from "../lib/social/routing.js";
import { processSocialRouteImmediate } from "../lib/social/immediate.js";
import { resolveSocialAppointmentClient } from "../lib/social/appointmentIdentity.js";
import { createSocialRoutingReviewHandler } from "../pages/api/operaciones/social-routing.js";
import { memoryDb, response, importWithStubs } from "./helpers/socialFixtures.mjs";

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("real_network_forbidden_in_social_tests"); };
after(() => { globalThis.fetch = originalFetch; });
const env = { SOCIAL_ROUTING_V1_ENABLED: "true", SALES_AGENT_V2_AUTO_SHADOW_ENABLED: "true" };
const event = (channelId = "497382", extras = {}) => ({ eventId: "event-test", messageId: "message-test", respondContactId: "contact-test", eventType: "message.received", channelId, eventOccurredAt: "2026-10-01T12:00:00.000Z", ...extras });

for (const [label, text, channel, destination] of [
  ["A Instagram DM", "Busco casa en renta", "497382", "SALES"],
  ["B Messenger", "Quiero comprar departamento", "515318", "SALES"],
  ["C captación", "Soy propietario, quiero vender mi casa", "497382", "OWNER"],
  ["D Blindaje", "Qué incluye la póliza jurídica", "515318", "LEGAL"],
  ["E administración social", "Consulta sobre mantenimiento del condominio", "497382", "ADMINISTRATION"],
  ["F queja", "Tengo una queja sobre mi inmueble", "497382", "HUMAN_REVIEW"],
  ["G desconocido", "Hola", "497382", "UNKNOWN"],
  ["cliente existente", "Ya soy cliente", "515318", "EXISTING_CLIENT"],
  ["N WhatsApp fallback compatible", "Hola", "498219", "SALES"],
]) test(label, () => assert.equal(classifySocialRoute({ text, channelId: channel }).destination, destination));

for (const text of ["demanda por contrato", "mi expediente", "amenaza", "excepción de póliza", "me rechazaron", "fraude", "negociar contrato"])
  test(`riesgo tiene precedencia: ${text}`, () => assert.equal(classifySocialRoute({ text, channelId: "498219", recentOwner: true }).destination, "HUMAN_REVIEW"));
test("identidad ambigua jamás dispara especialista", () => assert.equal(classifySocialRoute({ text: "Busco casa", identityStatus: "ambiguous" }).destination, "HUMAN_REVIEW"));
test("continuidad reutiliza exclusivamente destino previo", () => assert.equal(classifySocialRoute({ text: "Gracias", previousDestination: "OWNER" }).destination, "OWNER"));
test("OFF y O Administración no tocan el router nuevo", async () => {
  for (const [e, config] of [[event(), {}], [event("544519"), env], [event(null), env], [event("497382", { eventType: "message.sent" }), env]]) {
    assert.equal(socialEligible(e, config), false);
    assert.deepEqual(await captureSocialRoute({ from() { assert.fail("no DB with OFF/admin"); } }, {}, e, { env: config }), { handled: false });
  }
});
test("L atribución explícita conservada sin contenido arbitrario", () => {
  const a = socialAttribution({ source: { post_id: "post-1", comment_id: "comment-1", ad_id: "ad-1", campaign_id: "campaign-1", property_id: "not-verified", email: "secret@example.invalid" } }, event());
  assert.equal(a.source_post_id, "post-1"); assert.equal(a.source_comment_id, "comment-1"); assert.equal(a.source_ad_id, "ad-1"); assert.equal(a.source_campaign_id, "campaign-1"); assert.equal(a.source_property_id, null);
  assert.doesNotMatch(JSON.stringify(a), /secret|not-verified/);
});
test("M atribución ausente null; plataforma sólo desde canal configurado", () => {
  const a = socialAttribution({}, event());
  for (const k of ["post", "comment", "ad", "campaign", "property"]) assert.equal(a[`source_${k}_id`], null);
  assert.equal(a.source_platform, "instagram");
  assert.equal(a.source_metadata, null);
});
test("metadata sólo enums proporcionados, nunca reconstruida desde texto", () => {
  const a = socialAttribution({ source: { metadata: { origin_kind: "private_reply", media_type: "video", unsafe: "private" } } }, event());
  assert.deepEqual(a.source_metadata, { origin_kind: "private_reply", media_type: "video" });
  assert.equal(socialAttribution({ source_metadata: { origin_kind: "arbitrary", media_type: "untrusted" } }, event()).source_metadata, null);
});
test("ningún identificador estable: fallo cerrado sin escritura", async () => {
  await assert.rejects(captureSocialRoute({}, {}, event("497382", { messageId: null }), { env }), /stable_message_identity/);
});
test("captura persiste sólo una decisión antes del despacho; propiedad sólo verificada", async () => {
  let saved;
  const db = memoryDb({ propiedades: [{ id: "verified-property", public_id: "public-property", status:"published" }] }, { capture_social_route_v1: async args => { saved = args.p_route; return { data: { created: true, destination: args.p_route.destination, inboundId: "inbound" } }; } });
  const result = await captureSocialRoute(db, { message: { text: "Busco casa" }, source: { property_id: "public-property" } }, event(), { env, now: () => new Date("2026-10-01T12:00:01Z") });
  assert.equal(result.destination, "SALES"); assert.equal(saved.source_property_id, "verified-property"); assert.equal(saved.respond_contact_id, "contact-test");
  assert.equal(db.operations.filter(o => o.op === "rpc" && o.table === "capture_social_route_v1").length, 1); assert.equal(db.operations.filter(o => o.op === "insert").length, 0);
});
test("fallo transaccional no deriva a otro agente", async () => {
  const db = memoryDb({}, { capture_social_route_v1: async () => ({ error: new Error("fixture_tx_failure") }) });
  await assert.rejects(captureSocialRoute(db, { message: { text: "Busco casa" } }, event(), { env }), /fixture_tx_failure/);
});
test("vínculo canónico confirmado se lee sin escrituras", async () => {
  const db = memoryDb({ respond_identity_links: [{ respond_contact_id: "c", client_identity_id: "canonical", link_status: "confirmed" }], client_identities: [{ id: "canonical", status: "active" }] });
  assert.deepEqual(await readSocialIdentity(db, "c"), { status: "confirmed", canonicalId: "canonical" });
  assert.ok(db.operations.every(o => o.op === "select"));
});
test("K homónimos no se fusionan ni crean clientes", async () => {
  const db = memoryDb({ clientes: [{ id: "other-person", nombre: "Nombre Sintético" }], gv_opportunities: [{ respond_contact_id: "contact-A", cliente_id: "client-A" }] });
  assert.equal((await resolveSocialAppointmentClient(db, "contact-A")).clientId, "client-A");
  assert.deepEqual(await resolveSocialAppointmentClient(db, "contact-B"), { clientId: null, reason: "client_link_missing" });
  assert.ok(db.operations.every(o => o.op === "select" && o.table !== "clientes"));
});
test("citas rechazan enlaces múltiples o conflicto explícito", async () => {
  assert.equal((await resolveSocialAppointmentClient(memoryDb({ gv_opportunities: [{ respond_contact_id: "c", cliente_id: "a" }, { respond_contact_id: "c", cliente_id: "b" }] }), "c")).reason, "client_link_ambiguous");
  assert.equal((await resolveSocialAppointmentClient(memoryDb({ respond_identity_links: [{ respond_contact_id: "c", link_status: "conflict" }] }), "c")).reason, "identity_ambiguous");
});
test("H duplicado y destinos humanos no ejecutan especialistas", async () => {
  const forbidden = new Proxy({}, { get() { assert.fail("agent called"); } });
  assert.equal((await processSocialRouteImmediate({}, { created: false }, forbidden)).status, "duplicate");
  for (const destination of ["ADMINISTRATION", "HUMAN_REVIEW", "UNKNOWN", "EXISTING_CLIENT"]) assert.equal((await processSocialRouteImmediate({}, { created: true, destination }, forbidden)).status, "requires_human_review");
});
for (const destination of ["SALES", "OWNER", "LEGAL"]) test(`un solo dispatcher: ${destination}`, async () => {
  const tables = { SALES: "sales_agent_v2_inbound_messages", OWNER: "owner_agent_v1_inbound_messages", LEGAL: "legal_agent_v1_inbound_messages" }, calls = [];
  const db = memoryDb({ [tables[destination]]: [{ id: "i", respond_contact_id: "c", created_at: "2026-01-01", debounce_until: "2026-01-01" }] });
  const processors = Object.fromEntries(Object.keys(tables).map(d => [d, async () => { calls.push(d); return { status: "synthetic_only" }; }]));
  await processSocialRouteImmediate(db, { created: true, destination, inboundId: "i" }, processors, { env, sleep: async () => {} });
  assert.deepEqual(calls, [destination]);
});
test("GET sólo admin activo, sanitizado, read-only y funciona OFF", async () => {
  const db = memoryDb({ social_message_routes: [{ id: "private-id", respond_contact_id: "private-contact", destination: "HUMAN_REVIEW", reason: "sensitive_or_complaint", source_channel_id: "497382", source_platform: "instagram", sanitized_text: "not-for-ui" }] });
  const handler = createSocialRoutingReviewHandler({ createAdmin: () => db, authorize: async () => ({ active: true, role_id: "admin" }), env: {} });
  const res = response(); await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.enabled, false); assert.doesNotMatch(JSON.stringify(res.body), /private-id|private-contact|not-for-ui/); assert.ok(db.operations.every(o => o.op === "select"));
  for (const actor of [null, { active: false, role_id: "admin" }, { active: true, role_id: "asesor" }, { active: true, role_id: "coord_operaciones" }]) {
    const denied = response(); await createSocialRoutingReviewHandler({ authorize: async () => actor })({ method: "GET", headers: {} }, denied); assert.equal(denied.statusCode, 403);
  }
  const denied = response(); await handler({ method: "GET", headers: { origin: "https://foreign.invalid", host: "app.invalid" } }, denied); assert.equal(denied.statusCode, 403);
});
test("proyección no expone source_metadata ni IDs", () => {
  const view = socialRouteReview({ id: "raw", source_metadata: { arbitrary: "private" }, destination: "injected", reason: "unknown bad text" });
  assert.equal(view.destination, "UNKNOWN"); assert.equal(view.reason, "unknown"); assert.doesNotMatch(JSON.stringify(view), /private|raw/);
});
test("webhook: decisión nueva precede todos los agentes y no reescribe canal admin", async () => {
  const source = await readFile(new URL("../pages/api/webhooks/respond.js", import.meta.url), "utf8");
  const route = source.indexOf("await captureSocialRoute");
  for (const old of ["await routeRespondMessageIsolated(event)", "const legalCapture=", "const ownerCapture=", "salesCapture=await"]) assert.ok(route < source.indexOf(old));
  assert.match(source.slice(route, source.indexOf('if (error?.code === "23505")')), /return res\.status\(200\)/);
});
test("lifecycle sin canal usa snapshot; desconocido fail-closed; OFF y admin intactos", async () => {
  const module = await importWithStubs(new URL("../lib/agentsV2/respondAppointmentSync.js", import.meta.url), { "../ejecutivo/respondSync.js": { fetchRespondContact: async () => assert.fail(), readRespondMessages: async () => assert.fail(), respondMessageTimestamp: () => null } });
  const body = { event_type: "contact.lifecycle.updated", event_id: "e", contact: { id: "c", lifecycle: { name: "Visita agendada" } } };
  for (const [channel, config, version] of [["497382", env, 1], ["544519", env, undefined], [null, {}, undefined]]) {
    const db = memoryDb({ gv_respond_contact_snapshots: [{ respond_contact_id: "c", respond_channel_id: channel }] });
    assert.equal((await module.captureRespondAppointmentLifecycleIsolated(db, body, { env: config })).status, "captured");
    assert.equal(db.tables.respond_appointment_sync[0].social_routing_version, version);
  }
  const db = memoryDb();
  assert.equal((await module.captureRespondAppointmentLifecycleIsolated(db, body, { env })).reason, "appointment_channel_unresolved");
  assert.ok(db.operations.every(o => o.op === "select"));
});
async function appointmentModule() {
  return importWithStubs(new URL("../lib/agentsV2/respondAppointmentSync.js", import.meta.url), {
    "../ejecutivo/respondSync.js": {
      fetchRespondContact: async () => assert.fail("no name/profile fetching for social booking"),
      readRespondMessages: async () => ({ messages: [{ at: new Date().toISOString(), text: "Mañana a las 10:00 am", traffic: "outgoing", sender: { source: "user" } }] }),
      respondMessageTimestamp: m => m.at,
    },
  });
}
const bookingSeed = () => ({
  respond_appointment_sync: [{ id: "sync", respond_contact_id: "c", social_routing_version: 1, status: "pending", created_at: "2026-01-01", lifecycle: "Visita agendada" }],
  gv_respond_contact_snapshots: [{ respond_contact_id: "c", mapped_profile_id: "mapped-advisor", respond_lifecycle: "Visita agendada" }],
  gv_opportunities: [{ respond_contact_id: "c", cliente_id: "linked-client", propiedad_id: "existing-property", asesor_id: "existing-advisor" }],
});
test("cita social usa mismo advisor/fecha/propiedad y RPC atómica, nunca INSERT directo", async () => {
  const module = await appointmentModule(); let parameters;
  const db = memoryDb(bookingSeed(), { commit_social_appointment_v1: async p => { parameters = p; return { data: { status: "created", citaId: "synthetic-booking" } }; } });
  const result = await module.processOneRespondAppointmentSync(db);
  assert.equal(result.status, "created"); assert.equal(parameters.p_advisor_id, "existing-advisor"); assert.equal(parameters.p_client_id, "linked-client"); assert.equal(parameters.p_property_id, "existing-property");
  assert.ok(parameters.p_at.endsWith("T16:00:00.000Z"));
  assert.equal(db.operations.filter(o => ["citas", "clientes"].includes(o.table)).length, 0);
});
test("cita social sin vínculo explícito queda en revisión sin buscar por nombre", async () => {
  const module = await appointmentModule(), seed = bookingSeed(); seed.gv_opportunities[0].cliente_id = null;
  const db = memoryDb(seed); const result = await module.processOneRespondAppointmentSync(db);
  assert.equal(result.status, "needs_confirmation"); assert.equal(result.reason, "client_link_missing");
  assert.equal(db.operations.filter(o => ["clientes", "leads_respond"].includes(o.table) || o.op === "rpc").length, 0);
});
test("fallo tardío de worker perdedor nunca sobrescribe una cita ya confirmada", async () => {
  const module = await appointmentModule(); let db;
  db = memoryDb(bookingSeed(), { commit_social_appointment_v1: async () => { db.tables.respond_appointment_sync[0].status = "created"; return { error: new Error("synthetic_losing_worker") }; } });
  await assert.rejects(module.processOneRespondAppointmentSync(db), /synthetic_losing_worker/);
  assert.equal(db.tables.respond_appointment_sync[0].status, "created");
});
