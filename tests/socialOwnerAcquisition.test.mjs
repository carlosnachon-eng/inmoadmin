import test, { after } from "node:test";
import assert from "node:assert/strict";
import { captureSocialRoute, classifySocialRoute, SOCIAL_CHANNELS } from "../lib/social/routing.js";
import { readSocialContinuity } from "../lib/social/continuity.js";
import { processSocialRouteImmediate } from "../lib/social/immediate.js";
import { processSalesAutoOutboundRun } from "../lib/agentsV2/salesAutoOutbound.js";
import { memoryDb, importWithStubs } from "./helpers/socialFixtures.mjs";
import { alanRecordedSource, alanRecordedTurns, syntheticOwnerFollowups } from "./fixtures/ownerAcquisitionAlan.mjs";

const originalFetch = globalThis.fetch;
const forbiddenNetwork = async () => assert.fail("real network forbidden");
globalThis.fetch = forbiddenNetwork;
after(() => { globalThis.fetch = originalFetch; });
const env = { SOCIAL_ROUTING_V1_ENABLED: "true", SALES_AGENT_V2_AUTO_SHADOW_ENABLED: "true", RESPOND_IO_TOKEN: "synthetic-intercepted-only" };
const tables = { OWNER: "owner_agent_v1_inbound_messages", SALES: "sales_agent_v2_inbound_messages", LEGAL: "legal_agent_v1_inbound_messages" };
const syntheticRequests = [
  "Quiero que me ayuden a vender mi casa",
  "Tengo departamento y quiero que lo promocionen",
  "Tenemos disponibilidad de departamentos en renta y buscamos apoyo para su comercialización.",
  "Tengo lofts en renta, ¿pueden apoyarme con su colocación?",
];

function conversation(channelId, { paused = false } = {}) {
  const contact = `synthetic-owner-acquisition-${channelId}`;
  let sequence = 0;
  const history = [], inputs = [], sent = [];
  const db = memoryDb({ gv_respond_contact_snapshots: [{ respond_contact_id: contact, respond_channel_id: channelId, respond_assignee_id: "synthetic-existing-advisor", respond_record_active: true }] }, {
    read_respond_human_pause_v1: async () => ({ data: { blocked: paused, reason: paused ? "human_attention_active" : null } }),
    capture_social_route_v1: async ({ p_route: r }) => {
      const previous = (db.tables.social_message_routes || []).find(row => row.source_event_id === r.source_event_id);
      if (previous) return { data: { created: false, routeId: previous.id, inboundId: previous.inbound_id, destination: previous.destination } };
      const routeId = `synthetic-route-${sequence}`, inboundId = tables[r.destination] ? `synthetic-inbound-${sequence}` : null;
      (db.tables.social_message_routes ||= []).push({ ...r, id: routeId, created_at: r.occurred_at, inbound_id: inboundId });
      if (inboundId) (db.tables[tables[r.destination]] ||= []).push({ id: inboundId, social_route_id: routeId, event_id: r.source_event_id,
        respond_contact_id: contact, channel_id: channelId, sanitized_text: r.sanitized_text, occurred_at: r.occurred_at,
        created_at: r.occurred_at, debounce_until: r.occurred_at, status: "captured" });
      return { data: { created: true, destination: r.destination, routeId, inboundId } };
    },
  });
  const capture = async (text, at = new Date(Date.parse(alanRecordedTurns[1].at) + (++sequence + 1) * 60000).toISOString()) => {
    const event = { eventType: "message.received", eventId: `synthetic-event-${++sequence}`, messageId: `synthetic-message-${sequence}`,
      respondContactId: contact, channelId, eventOccurredAt: at };
    history.push({ text, at, traffic: "incoming" });
    return captureSocialRoute(db, { message: { text } }, event, { env });
  };
  return { db, contact, history, inputs, sent, capture };
}

// Classifier/continuity/capture/dispatcher/Owner processor/sender are real code.
// Only DB persistence/RPC, provider history, model/usage and HTTP are intercepted.
async function ownerProcessor(f) {
  return importWithStubs(new URL("../lib/agentsV2/processOwnerInbound.js", import.meta.url), {
    "../ejecutivo/respondSync": { readRespondMessages: async contact => { assert.equal(contact, f.contact); return { messages: f.history }; }, respondMessageTimestamp: m => m.at },
    "../shadow/coordinator": { sanitizeShadowText: text => ({ text, rejected: false }) },
    "./openaiOwnerAgent": {
      createOwnerSession: async ({ input }) => { f.inputs.push(input); return { id: `synthetic-owner-session-${f.inputs.length}` }; },
      getOwnerSession: async () => ({ id: "synthetic-owner-session", status: "idle" }),
      fulfillOwnerActions: async () => assert.fail("no remote tools"),
      ownerOutput: async () => "Para revisar la comercialización de tus inmuebles, comparte sus características y el esquema que necesitas. La comisión y las condiciones requieren revisión; no puedo confirmar porcentajes aquí.",
    },
    "./agentUsage": { safeAgentUsage: async () => ({ inputTokens: 0, outputTokens: 0 }) },
  });
}

for (const [channelId, channel] of Object.entries(SOCIAL_CHANNELS)) {
  test(`caso real aportado: solicitud exacta entra OWNER desde saludo previo / ${channel}`, async () => {
    const f = conversation(channelId);
    const greeting = await f.capture(alanRecordedTurns[0].text, alanRecordedTurns[0].at);
    assert.equal(greeting.destination, channelId === "498219" ? "SALES" : "UNKNOWN");
    if (channelId === "498219") assert.equal(f.db.tables.social_message_routes[0].reason, "whatsapp_compatible_fallback");
    const routed = await f.capture(alanRecordedTurns[1].text, alanRecordedTurns[1].at);
    assert.equal(routed.destination, "OWNER");
    assert.equal(f.db.tables.social_message_routes.at(-1).reason, "owner_intent");
    assert.match(f.db.tables.owner_agent_v1_inbound_messages[0].sanitized_text, /comercialización y colocación/);
    assert.notEqual(f.contact, alanRecordedSource.respondContactId, "real source identifier never used for execution");
  });

  test(`conversación completa real + continuación SINTÉTICA: sólo Owner procesa/envía / ${channel}`, async () => {
    const f = conversation(channelId), owner = await ownerProcessor(f);
    const immutableAssignee = JSON.stringify(f.db.tables.gv_respond_contact_snapshots);
    await f.capture(alanRecordedTurns[0].text, alanRecordedTurns[0].at);
    globalThis.fetch = async (url, options) => {
      assert.equal(url, `https://api.respond.io/v2/contact/id:${f.contact}/message`);
      const body = JSON.parse(options.body);
      assert.equal(body.channelId, Number(channelId));
      f.sent.push(body.message.text);
      return { ok: true, json: async () => ({ messageId: `synthetic-provider-${f.sent.length}` }) };
    };
    try {
      for (const [index, text] of [alanRecordedTurns[1].text, ...syntheticOwnerFollowups].entries()) {
        const route = await f.capture(text, index === 0 ? alanRecordedTurns[1].at : undefined);
        assert.equal(route.destination, "OWNER", `turn ${index}`);
        const result = await processSocialRouteImmediate(f.db, route, {
          OWNER: owner.processOwnerInboundById,
          SALES: () => assert.fail("acquisition must not dispatch Sales"),
          LEGAL: () => assert.fail("acquisition must not dispatch Legal"),
        }, { env, sleep: async () => {} });
        assert.equal(result.status, "sent");
        assert.match(f.inputs.at(-1), /Continuidad OWNER/);
        assert.match(f.inputs.at(-1), /comercialización|lofts|inmuebles|propiedad/);
        const duplicate = await processSocialRouteImmediate(f.db, { ...route, created: false }, { OWNER: () => assert.fail("duplicate dispatch") }, { env });
        assert.equal(duplicate.status, "duplicate");
        assert.equal((await owner.processOwnerInboundById(f.db, route.inboundId, { env })).status, "not_claimed");
      }
    } finally { globalThis.fetch = forbiddenNetwork; }
    assert.equal(f.sent.length, 1 + syntheticOwnerFollowups.length);
    assert.equal(f.db.tables.owner_agent_v1_runs.length, f.sent.length);
    assert.equal(f.db.tables.owner_agent_v1_auto_outbound.filter(r => r.status === "sent").length, f.sent.length);
    assert.equal(f.db.tables.sales_agent_v2_auto_outbound?.length || 0, 0);
    assert.equal(f.db.tables.sales_agent_v2_handoffs?.length || 0, 0);
    assert.equal(JSON.stringify(f.db.tables.gv_respond_contact_snapshots), immutableAssignee);
    for (const text of f.sent) assert.doesNotMatch(text, /te asign|\d+\s*%|disponibilidad confirmada/i);
    const buyer = await f.capture("Ahora busco rentar un departamento para mí.");
    assert.equal(buyer.destination, "SALES");
    assert.equal(f.db.tables.social_message_routes.at(-1).reason, "explicit_intent_change");
    assert.equal((await readSocialContinuity(f.db, f.contact, channelId, "2027-01-01")).owner, false);
  });

  for (const text of syntheticRequests) test(`variante SINTÉTICA OWNER / ${channel} / ${text}`, () => {
    assert.equal(classifySocialRoute({ text, channelId, previousDestination: "SALES" }).destination, "OWNER");
  });

  for (const [text, expected] of [
    ["Busco lofts en renta para vivir", "SALES"],
    ["Tengo presupuesto para comprar mi casa, busco opciones", "SALES"],
    ["Tengo disponibilidad para visitar un departamento en renta", "SALES"],
    ["Tengo departamento y busco comprar una casa para mí", "SALES"],
    ["No tengo lofts; sólo quería información de comercialización", channelId === "498219" ? "SALES" : "UNKNOWN"],
    ["No quiero que me ayuden a vender mi casa; busco comprar otra", "SALES"],
    ["Busco una inmobiliaria y quiero información de renta", "SALES"],
    ["Me gustaría conocer su esquema de trabajo, comisión y condiciones", channelId === "498219" ? "SALES" : "UNKNOWN"],
    ["Tengo disponibilidad de lofts para comercialización y necesito póliza jurídica", "LEGAL"],
    ["Tengo lofts para comercialización y necesito administración del condominio", "ADMINISTRATION"],
    ["Soy cliente y tengo lofts para comercialización", "EXISTING_CLIENT"],
    ["Tengo lofts para comercialización y una queja", "HUMAN_REVIEW"],
    ["Tengo lofts para comercialización y ofrezco videos con drones", "HUMAN_REVIEW"],
  ]) test(`prioridad/negativo sin captación previa / ${channel} / ${text}`, () => {
    assert.equal(classifySocialRoute({ text, channelId }).destination, expected);
  });

  for (const [text, destination] of [
    ["Necesito una póliza", "LEGAL"],
    ["Quiero hablar con administración", "ADMINISTRATION"],
    ["Tengo una queja por fraude", "HUMAN_REVIEW"],
    ["Ahora quiero comprar una casa para mí", "SALES"],
    ["Ahora busco una casa en renta para mí", "SALES"],
  ]) test(`transición explícita conserva prioridad desde OWNER / ${channel} / ${text}`, () => {
    assert.equal(classifySocialRoute({ text, channelId, previousDestination: "OWNER" }).destination, destination);
  });

  test(`#168 no se levanta al corregir SALES→OWNER / ${channel}`, async () => {
    const f = conversation(channelId, { paused: true }), owner = await ownerProcessor(f);
    await f.capture(alanRecordedTurns[0].text, alanRecordedTurns[0].at);
    for (const text of [alanRecordedTurns[1].text, "¿Qué comisión manejan?"]) {
      const route = await f.capture(text);
      assert.equal(route.destination, "OWNER");
      const result = await owner.processOwnerInboundById(f.db, route.inboundId, { env });
      assert.equal(result.reason, "human_attention_active");
    }
    assert.equal(f.inputs.length, 0);
    assert.equal(f.db.tables.owner_agent_v1_auto_outbound?.length || 0, 0);
  });
}

test("WhatsApp: salida Sales pendiente del saludo queda bloqueada por continuidad Owner existente", async () => {
  const f = conversation("498219");
  const greeting = await f.capture(alanRecordedTurns[0].text, alanRecordedTurns[0].at);
  await f.capture(alanRecordedTurns[1].text, alanRecordedTurns[1].at);
  const inbound = f.db.tables.sales_agent_v2_inbound_messages.find(r => r.id === greeting.inboundId);
  f.db.tables.sales_agent_v2_shadow_runs = [{ id: "synthetic-old-sales-run", status: "idle", completed_at: new Date().toISOString(), proposed_response: "¿Buscas comprar o rentar?", sales_agent_v2_inbound_messages: inbound }];
  const result = await processSalesAutoOutboundRun(f.db, "synthetic-old-sales-run", { env: { ...env, SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED: "true", VERCEL_ENV: "production", SUPABASE_ENVIRONMENT: "production" } });
  assert.equal(result.reason, "owner_continuity_no_sales_outbound");
  assert.equal(f.db.tables.sales_agent_v2_auto_outbound[0].status, "blocked");
});
