import test from "node:test";
import assert from "node:assert/strict";
import { classifySafeSalesOutbound, processSalesAutoOutboundRun } from "../lib/agentsV2/salesAutoOutbound.js";
import { memoryDb } from "./helpers/socialFixtures.mjs";

const classify = (text, side = "output") => classifySafeSalesOutbound({
  messageText: side === "input" ? `Me interesa una casa. ${text}` : "Hola",
  proposedResponse: side === "output" ? text : "¿Qué zona te interesa?",
  calledTools: [],
});

// No exemptions for a whole sentence: an informational confirmation does not
// authorize a signature/contract mentioned elsewhere in that same sentence.
const safe = [
  "Puedo confirmar disponibilidad.", "Confirmación de disponibilidad.",
  "Confirmar", "confirmas", "confirmamos", "confirmaré", "confirmaría", "confirmado",
  "confirmada", "confirmando", "confirmaciones", "reconfirmar", "reconfirmación",
  "afirmar", "afirmación", "reafirmar", "acredito", "desacredito",
  "reescritura de la descripción",
];
for (const text of safe) {
  for (const side of ["input", "output"]) test(`safe embedded root (${side}): ${text}`, () => {
    assert.equal(classify(text, side).eligible, true);
  });
}

// Every alternative in RISKY is covered, with the original stem-based inflections.
const sensitive = [
  "apartado", "apartados", "depósito", "deposito", "depósitos", "póliza", "polizas",
  "jurídico", "juridica", "contrato", "contratos", "subcontrato", "demanda", "demandas",
  "PROFECO", "descuento", "descuentos", "rebaja", "rebajar", "contraoferta", "contraofertas",
  "negociar", "negociación", "negociable", "renegociar", "renegociación", "crédito", "creditos",
  "hipoteca", "hipotecas", "firma", "firmas", "firmar", "firmarlo", "firmando", "firmado",
  "escritura", "escrituras", "escriturar", "promesa", "promesas", "garantía", "garantias",
  "penalización", "penalizar", "cancelación", "cancelaciones", "rescisión", "rescisiones", "abogado", "abogados",
  "firma el contrato", "quiero firmar hoy", "(FIRMA)", "¿Firmar?", "firma/contrato", "pre-contrato",
  "Puedo confirmar la firma del contrato.", "Confirmación de un descuento.",
];
for (const text of sensitive) {
  for (const side of ["input", "output"]) test(`sensitive root still blocked (${side}): ${text}`, () => {
    assert.deepEqual(classify(text, side), { eligible: false, reason: "risky_topic" });
  });
}

test("confirming a visit is no longer risky_topic; independent appointment input guard remains", () => {
  assert.equal(classify("quiero confirmar una visita").eligible, true);
  assert.deepEqual(classify("quiero confirmar una visita", "input"), {
    eligible: false, reason: "appointment_requires_validation",
  });
});

for (const text of [
  "te confirmo disponibilidad", "Te confirmo disponibilidad.", "Te confirmo la disponibilidad.",
  "TE CONFIRMO DISPONIBILIDAD.", "Te confirmo disponibilidad. ¿Qué zona te interesa?",
  "Te confirmo disponibilidad; ¿qué zona prefieres?", "Te confirmo disponibilidad. Te confirmo la disponibilidad.",
]) {
  test(`informational availability is allowed: ${text}`, () => {
    assert.equal(classify(text).eligible, true);
  });
}

for (const text of [
  "Te confirmo", "Te confirmo la cita", "Te confirmo el horario", "Te confirmo mañana a las diez",
  "Te confirmo disponibilidad para una visita", "Te confirmo disponibilidad el sábado", "Te confirmo disponibilidad a las 10:30",
  "Te confirmo disponibilidad. La visita está confirmada.", "Te confirmo disponibilidad. Te agendo.",
  "Te confirmo disponibilidad. Nos vemos mañana.", "Te confirmo disponibilidad. A las diez.",
  "Te confirmo disponibilidad. El viernes.", "Te confirmo disponibilidad. Este fin de semana.",
  "Te confirmo disponibilidad. Horario confirmado.", "Te confirmo disponibilidad. Puedes venir a verlo.",
  "Te confirmo disponibilidad. Te espero.", "Te confirmo disponibilidad. El 5/10.",
  "Te confirmo disponibilidad. Día confirmado.", "Te confirmo disponibilidad. Podemos conocer la casa.",
  "Te confirmo disponibilidad. Reunión confirmada.", "Te confirmo disponibilidad. Te confirmo el horario.",
  "Te confirmo disponibilidad. Te confirmo.", "Te confirmo disponibilidadX", "Te confirmo disponibilidades",
]) {
  test(`availability does not bypass appointment review: ${text}`, () => {
    assert.deepEqual(classify(text), { eligible: false, reason: "appointment_commitment_requires_validation" });
  });
}

test("availability does not bypass another sensitive statement", () => {
  for (const text of ["Te confirmo disponibilidad. Firma el contrato.", "Te confirmo disponibilidad. Quiero firmar hoy."]) {
    assert.deepEqual(classify(text), { eligible: false, reason: "risky_topic" });
  }
});

test("real appointment commitments still require validation", () => {
  for (const text of ["Cita confirmada", "Te confirmo la cita", "Te agendo", "Queda agendada", "Horario confirmado", "Visita confirmada"]) {
    assert.deepEqual(classify(text), { eligible: false, reason: "appointment_commitment_requires_validation" });
  }
});

const env = Object.freeze({
  SOCIAL_ROUTING_V1_ENABLED: "true", SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED: "true",
  SALES_AGENT_V2_RECOVERY_ENABLED: "false", SALES_AGENT_V2_HANDOFF_SLA_ENABLED: "false",
  VERCEL_ENV: "production", SUPABASE_ENVIRONMENT: "production", RESPOND_IO_TOKEN: "synthetic-not-a-secret",
});
function senderFixture(text) {
  const at = new Date().toISOString();
  const inbound = { id: "synthetic-inbound", social_route_id: "synthetic-route", respond_contact_id: "synthetic-contact",
    channel_id: "497382", occurred_at: at, sanitized_text: "Me interesa una casa en renta", status: "processed" };
  const db = memoryDb({
    sales_agent_v2_inbound_messages: [inbound],
    social_message_routes: [{ id: inbound.social_route_id, inbound_id: inbound.id, destination: "SALES", reason: "sales_intent",
      source_channel_id: inbound.channel_id, respond_contact_id: inbound.respond_contact_id, occurred_at: at, source_property_id: null }],
    sales_agent_v2_shadow_runs: [{ id: "synthetic-run", status: "idle", completed_at: at, called_tools: [],
      proposed_response: text, inbound_message_id: inbound.id, sales_agent_v2_inbound_messages: inbound }],
    gv_respond_contact_snapshots: [{ respond_contact_id: inbound.respond_contact_id, respond_assignee_id: "synthetic-current-advisor" }],
  });
  return db;
}

for (const socialEnabled of ["true", "false"]) test(`informational availability reaches actual sender, Social=${socialEnabled}; network intercepted; no resend`, async t => {
  const text = "Te confirmo disponibilidad. ¿Qué zona te interesa?";
  const db = senderFixture(text);
  const testEnv = { ...env, SOCIAL_ROUTING_V1_ENABLED: socialEnabled };
  if (socialEnabled === "false") {
    db.tables.sales_agent_v2_inbound_messages[0].social_route_id = null;
    db.tables.sales_agent_v2_shadow_runs[0].sales_agent_v2_inbound_messages.social_route_id = null;
  }
  const routes = structuredClone(db.tables.social_message_routes);
  const assignment = structuredClone(db.tables.gv_respond_contact_snapshots);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    assert.equal(url, "https://api.respond.io/v2/contact/id:synthetic-contact/message");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { channelId: 497382, message: { type: "text", text } });
    return { ok: true, json: async () => ({ messageId: "synthetic-receipt" }) };
  });
  assert.equal((await processSalesAutoOutboundRun(db, "synthetic-run", { env: testEnv })).status, "sent");
  assert.deepEqual(await processSalesAutoOutboundRun(db, "synthetic-run", { env: testEnv }), { status: "already_handled", outboundStatus: "sent" });
  assert.equal(calls.length, 1);
  assert.equal(db.tables.sales_agent_v2_auto_outbound.length, 1);
  assert.equal(db.tables.sales_agent_v2_auto_outbound[0].provider_message_id, "synthetic-receipt");
  assert.deepEqual(db.tables.social_message_routes, routes);
  assert.deepEqual(db.tables.gv_respond_contact_snapshots, assignment);
  assert.deepEqual(db.tables.sales_agent_v2_handoffs, []);
  assert.ok(db.operations.filter(op => op.op !== "select").every(op => op.table === "sales_agent_v2_auto_outbound"));
});

test("actual sender does not reach transport for signature/contract proposals", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unexpected_external_call"); });
  for (const text of ["firma el contrato", "Podemos firmar", "Puedo confirmar la firma del contrato"]) {
    const db = senderFixture(text);
    assert.deepEqual(await processSalesAutoOutboundRun(db, "synthetic-run", { env }), { status: "blocked", reason: "risky_topic" });
    assert.equal(db.tables.sales_agent_v2_auto_outbound.length, 0);
    assert.ok(db.operations.every(op => op.op === "select"));
  }
  assert.equal(calls, 0);
});

test("availability plus scheduling cannot reach transport even without the independent Social guard", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unexpected_external_call"); });
  for (const text of [
    "Te confirmo disponibilidad. Nos vemos mañana.", "Te confirmo disponibilidad. A las diez.",
    "Te confirmo la cita.", "Te confirmo disponibilidad. Horario confirmado.",
  ]) {
    const db = senderFixture(text);
    db.tables.sales_agent_v2_inbound_messages[0].social_route_id = null;
    db.tables.sales_agent_v2_shadow_runs[0].sales_agent_v2_inbound_messages.social_route_id = null;
    assert.deepEqual(await processSalesAutoOutboundRun(db, "synthetic-run", {
      env: { ...env, SOCIAL_ROUTING_V1_ENABLED: "false" },
    }), { status: "blocked", reason: "appointment_commitment_requires_validation" });
    assert.equal(db.tables.sales_agent_v2_auto_outbound.length, 0);
    assert.ok(db.operations.every(op => op.op === "select"));
  }
  assert.equal(calls, 0);
});
