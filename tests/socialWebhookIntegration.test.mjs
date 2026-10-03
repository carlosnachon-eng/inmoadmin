import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import { extractRespondWebhookEvent, isValidRespondWebhookSignature } from "../lib/ejecutivo/respondWebhook.js";
import { captureSocialRoute, socialEligible } from "../lib/social/routing.js";
import { captureSocialRouteSafely } from "../lib/social/captureReceipt.js";
import { processSocialRouteImmediate } from "../lib/social/immediate.js";
import { memoryDb, importWithStubs, response } from "./helpers/socialFixtures.mjs";

const oldFetch = globalThis.fetch;
globalThis.fetch = async () => assert.fail("real provider API forbidden");
after(() => { globalThis.fetch = oldFetch; });
const tables = { SALES: "sales_agent_v2_inbound_messages", OWNER: "owner_agent_v1_inbound_messages", LEGAL: "legal_agent_v1_inbound_messages" };
async function setup(enabled = true) {
  const routes = [], calls = [], legacy = [];
  const db = memoryDb({}, { begin_social_capture_v1: async () => ({ data: { state: "pending" } }), capture_social_route_v1: async ({ p_route: r }) => {
    const prior = routes.find(x => x.source_channel_id === r.source_channel_id && x.respond_contact_id === r.respond_contact_id && x.source_message_id === r.source_message_id);
    if (prior) return { data: { created: false, destination: prior.destination, inboundId: prior.inboundId } };
    const inboundId = tables[r.destination] ? randomUUID() : null;
    routes.push({ ...r, inboundId });
    if (inboundId) (db.tables[tables[r.destination]] ||= []).push({ id: inboundId, respond_contact_id: r.respond_contact_id, created_at: "2026-10-01", debounce_until: "2026-10-01", status: "captured" });
    return { data: { created: true, destination: r.destination, inboundId } };
  } });
  const env = { SOCIAL_ROUTING_V1_ENABLED: enabled ? "true" : "false", SALES_AGENT_V2_AUTO_SHADOW_ENABLED: "true" };
  const skipped = name => async () => { legacy.push(name); return { status: "skipped" }; };
  const processor = destination => async (_db, id) => {
    assert.equal(routes.filter(r => r.inboundId === id).length, 1, "routing already persisted before agent");
    calls.push(destination); return { status: "synthetic_complete_no_send" };
  };
  const loaded = await importWithStubs(new URL("../pages/api/webhooks/respond.js", import.meta.url), {
    "../../../lib/ejecutivo/workCenter": { assertSupabaseEnvironment() {}, getAdminSupabase: () => db },
    "../../../lib/ejecutivo/respondSync": { assertRespondIncrementalWebhooksEnabled() {} },
    "../../../lib/ejecutivo/respondWebhook": { extractRespondWebhookEvent, isValidRespondWebhookSignature, readRespondWebhookBody: async req => req.body, resolveRespondWebhookSigningKeys: () => ["synthetic-signing-only"] },
    "../../../lib/shadow/providers/respondAdmin": { captureRespondAdminShadowIsolated: skipped("admin") },
    "../../../lib/respond/channelRouter": { routeRespondMessageIsolated: skipped("legacy-router") },
    "../../../lib/shadow/media/reference": { captureRespondMediaReferenceIsolated: skipped("media") },
    "../../../lib/agentsV2/salesCapture": { captureRespondSalesV2InboundIsolated: skipped("sales-capture") },
    "../../../lib/agentsV2/ownerCapture": { captureRespondOwnerInboundIsolated: skipped("owner-capture") },
    "../../../lib/agentsV2/legalCapture": { captureRespondLegalInboundIsolated: skipped("legal-capture") },
    "../../../lib/agentsV2/processSalesInbound": { processSalesInboundById: processor("SALES") },
    "../../../lib/agentsV2/processOwnerInbound": { processOwnerInboundById: processor("OWNER") },
    "../../../lib/agentsV2/processLegalInbound": { processLegalInboundById: processor("LEGAL") },
    "../../../lib/agentsV2/respondAppointmentSync": { captureRespondAppointmentLifecycleIsolated: skipped("appointment") },
    "../../../lib/social/routing.js": { socialEligible: e => socialEligible(e, env) },
    "../../../lib/social/captureReceipt.js": { captureSocialRouteSafely: (db, body, e) => captureSocialRouteSafely(db, body, e, { env }) },
    "../../../lib/social/immediate.js": { processSocialRouteImmediate: (db, r, p) => processSocialRouteImmediate(db, r, p, { env, sleep: async () => {} }) },
  });
  const deliver = async (text, channel = "497382", extra = {}) => {
    const body = { event_type: "message.received", event_id: "synthetic-event", contact: { id: "synthetic-contact" }, message: { id: "synthetic-message", text, channelId: channel, timestamp: 1790856000 }, ...extra };
    const signature = createHmac("sha256", "synthetic-signing-only").update(JSON.stringify(body)).digest("base64");
    const res = response(); await loaded.default({ method: "POST", headers: { "x-webhook-signature": signature }, body }, res); return res;
  };
  return { db, routes, calls, legacy, deliver };
}
for (const [label, channel, message, destination] of [
  ["A IG DM", "497382", "Busco casa en renta", "SALES"],
  ["B Facebook DM", "515318", "Quiero comprar una casa", "SALES"],
  ["C captación", "497382", "Soy propietario y quiero vender mi propiedad", "OWNER"],
  ["D póliza", "515318", "Qué incluye Blindaje Legal", "LEGAL"],
  ["E admin social no privilegios", "497382", "Consulta de mantenimiento", "ADMINISTRATION"],
  ["F queja", "515318", "Tengo una queja", "HUMAN_REVIEW"],
  ["G desconocido", "497382", "Hola", "UNKNOWN"],
]) test(`webhook firmado → ${label} → una sola ruta persistida`, async () => {
  const f = await setup(); const res = await f.deliver(message, channel);
  assert.equal(res.statusCode, 200); assert.equal(f.routes.length, 1); assert.equal(f.routes[0].destination, destination);
  assert.equal(f.routes[0].source_channel_id, channel); assert.deepEqual(f.calls, tables[destination] ? [destination] : []); assert.deepEqual(f.legacy, []);
});
test("H webhook duplicado y doble entrega concurrente no repiten respuesta ni lead", async () => {
  const f = await setup(); await Promise.all([f.deliver("Busco casa"), f.deliver("Busco casa")]);
  assert.equal(f.routes.length, 1); assert.deepEqual(f.calls, ["SALES"]);
  assert.equal(f.db.operations.filter(o => ["clientes", "leads_respond", "gv_opportunities"].includes(o.table) && o.op !== "select").length, 0);
});
test("L/M webhook conserva atribución explícita sin inventar ausente", async () => {
  const f = await setup(); await f.deliver("Busco casa", "497382", { source: { post_id: "p", campaign_id: "campaign" } });
  assert.equal(f.routes[0].source_post_id, "p"); assert.equal(f.routes[0].source_campaign_id, "campaign"); assert.equal(f.routes[0].source_comment_id, null);
});
test("N flag OFF entrega WhatsApp exactamente al camino anterior", async () => {
  const f = await setup(false); const res = await f.deliver("Busco casa", "498219");
  assert.equal(res.statusCode, 200); assert.equal(f.routes.length, 0); assert.deepEqual(f.legacy, ["legacy-router", "admin", "media", "appointment", "legal-capture", "owner-capture", "sales-capture"]);
});
test("O canal administrativo conserva cadena anterior incluso con Social ON", async () => {
  const f = await setup(); await f.deliver("Mantenimiento", "544519");
  assert.equal(f.routes.length, 0); assert.deepEqual(f.legacy, ["legacy-router", "admin", "media", "appointment", "legal-capture", "owner-capture", "sales-capture"]); assert.deepEqual(f.calls, []);
});
test("P1 signed webhook failure: transport durable, four deliveries → one visible review and zero agents",async()=>{
  const f=await setup(),rpc=f.db.rpc.bind(f.db);let state="pending",captures=0,failures=0;
  f.db.rpc=async(name,args)=>{
    if(name==="begin_social_capture_v1")return{data:{state}};
    if(name==="capture_social_route_v1"){captures++;return{error:{code:"23514",message:"private provider text"}};}
    if(name==="fail_social_capture_v1"){failures++;state="review_required";assert.equal(args.p_reason,"capture_rpc_failed");return{data:{state}};}
    return rpc(name,args);
  };
  for(let i=0;i<4;i++){
    const res=await f.deliver("Busco casa");assert.equal(res.statusCode,200);assert.equal(res.body.commercial,"review_required");
    assert.doesNotMatch(JSON.stringify(res.body),/private/);
  }
  assert.equal(captures,1);assert.equal(failures,1);assert.equal(f.routes.length,0);assert.deepEqual(f.calls,[]);assert.deepEqual(f.legacy,[]);
  assert.ok(f.db.tables.gv_respond_webhook_events.every(e=>e.payload_meta.social_capture_required===true));
});
