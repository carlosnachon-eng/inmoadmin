import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { captureSocialRoute, classifySocialRoute } from "../lib/social/routing.js";
import { readSocialContinuity, socialAssignmentBarrier, readSocialAppointment, anchorHistoricalText, absoluteAppointmentLabel, ownerContinuityResponse, assertNoUngroundedAppointment } from "../lib/social/continuity.js";
import { createSalesHandoffIfNeeded, createSalesAutomationFallbackHandoff, dispatchSalesHandoff, processSalesHandoffSla } from "../lib/agentsV2/salesHandoff.js";
import { processSalesAutoOutboundRun } from "../lib/agentsV2/salesAutoOutbound.js";
import { memoryDb, importWithStubs } from "./helpers/socialFixtures.mjs";

// Equivalent two-day regression. No real contact/name/address/profile IDs in fixtures.
const contact = "synthetic-owner-two-days", advisor = "synthetic-existing-advisor";
const day1 = "2026-09-30T16:00:00.000Z", day2 = "2026-10-01T14:00:00.000Z", appointmentAt = "2026-10-01T16:30:00.000Z";
const env = { SOCIAL_ROUTING_V1_ENABLED: "true", SALES_AGENT_V2_HANDOFF_WORKFLOW_URL: "https://hooks.respond.io/synthetic", RESPOND_IO_TOKEN: "synthetic" };
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => assert.fail("unmocked external API forbidden");
after(() => { globalThis.fetch = originalFetch; });
const snapshot = { respond_contact_id: contact, respond_assignee_id: "synthetic-respond-advisor", mapped_profile_id: advisor, mapping_status: "matched", respond_record_active: true };
function fixture() {
  let n = 0;
  const db = memoryDb({ gv_respond_contact_snapshots: [snapshot],
    respond_appointment_sync: [{ id: "sync", respond_contact_id: contact, status: "created", cita_id: "cita", appointment_at: appointmentAt, source_message_at: day1 }],
    citas: [{ id: "cita", fecha_hora: appointmentAt, estado: "agendada", confirmacion_estado: "confirmada", asesor_id: advisor }],
  }, { capture_social_route_v1: async ({ p_route: r }) => {
    const id = randomUUID(), inboundId = ["OWNER", "SALES", "LEGAL"].includes(r.destination) ? randomUUID() : null;
    (db.tables.social_message_routes ||= []).push({ ...r, id, inbound_id: inboundId });
    if (inboundId) (db.tables[`${{ OWNER: "owner_agent_v1", SALES: "sales_agent_v2", LEGAL: "legal_agent_v1" }[r.destination]}_inbound_messages`] ||= []).push({
      id: inboundId, social_route_id: id, respond_contact_id: contact, channel_id: "498219", occurred_at: r.occurred_at, sanitized_text: r.sanitized_text, status: "captured",
    });
    return { data: { created: true, destination: r.destination, inboundId, routeId: id } };
  } });
  const capture = (text, at) => captureSocialRoute(db, { message: { text } }, { eventType: "message.received", eventId: `event-${++n}`, messageId: `message-${n}`, respondContactId: contact, channelId: "498219", eventOccurredAt: at }, { env });
  return { db, capture };
}

for (const text of ["Buenos días te mando la dirección de mi casa", "Calle Sintética 100 col Prueba", "perfecto", "mañana te mando ubicación", "fotos", "la casa tiene tres habitaciones"])
  test(`OWNER durable precede SALES: ${text}`, () => assert.equal(classifySocialRoute({ text, previousDestination: "OWNER", channelId: "498219" }).destination, "OWNER"));

test("legacy Owner de días atrás persiste; no búsqueda por nombre ni TTL", async () => {
  const db = memoryDb({ owner_agent_v1_inbound_messages: [{ id: "legacy-owner", respond_contact_id: contact, channel_id: "498219", occurred_at: "2025-01-01" }] });
  assert.equal((await readSocialContinuity(db, contact, "498219", day2)).owner, true);
  assert.equal((await readSocialContinuity(db, contact, "497382", day2)).owner, false);
  assert.ok(db.operations.every(op => op.op === "select" || op.table === "read_social_route_context_v1"));
});
test("captación explícita en snapshot conservada sin inferir identidad por nombre", async () => {
  const db=memoryDb({gv_respond_contact_snapshots:[{respond_contact_id:contact,respond_channel_id:"498219",atn_servicio:"Captación",atn_estado:"en atención"}]});
  assert.equal((await readSocialContinuity(db,contact,"498219",day2)).owner,true);
  db.tables.gv_respond_contact_snapshots[0].atn_estado="cerrado";
  assert.equal((await readSocialContinuity(db,contact,"498219",day2)).owner,false);
});
test("transición/cierre explícito documentado; riesgo no borra intención", async () => {
  const { db, capture } = fixture();
  await capture("Soy propietaria, quiero vender mi casa", day1);
  assert.equal((await capture("Tengo una queja", "2026-09-30T17:00:00Z")).destination, "HUMAN_REVIEW");
  assert.equal((await capture("perfecto", day2)).destination, "OWNER");
  assert.equal((await capture("Ahora quiero comprar una casa", "2026-10-01T15:00:00Z")).destination, "SALES");
  assert.equal(db.tables.social_message_routes.at(-1).reason, "explicit_intent_change");
  assert.equal((await readSocialContinuity(db, contact, "498219", "2026-10-02")).owner, false);
  assert.deepEqual(classifySocialRoute({ text: "Quiero cerrar mi captación", previousDestination: "OWNER" }), { destination: "UNKNOWN", reason: "owner_explicit_closure" });
});
test("cierre social no resucita evidencia Owner legacy", async () => {
  const db = memoryDb({ owner_agent_v1_inbound_messages: [{ respond_contact_id: contact, channel_id: "498219", occurred_at: day1 }], social_message_routes: [{ id: "closed", respond_contact_id: contact, source_channel_id: "498219", occurred_at: day2, destination: "UNKNOWN", reason: "owner_explicit_closure" }] });
  assert.equal((await readSocialContinuity(db, contact, "498219", "2026-10-02")).owner, false);
});
test("foto sin caption conserva OWNER sin inventar interpretación o URL", async () => {
  const { db, capture } = fixture(); await capture("Soy propietaria", day1);
  const result = await captureSocialRoute(db, { message: { attachment: { type: "image", url: "https://synthetic.invalid/private-photo" } } }, {
    eventType: "message.received", eventId: "photo-event", messageId: "photo-message", respondContactId: contact, channelId: "498219", eventOccurredAt: day2,
  }, { env });
  assert.equal(result.destination, "OWNER");
  assert.equal(db.tables.owner_agent_v1_inbound_messages.at(-1).sanitized_text, "[Adjunto recibido; contenido no interpretado]");
  assert.doesNotMatch(JSON.stringify(db.tables.social_message_routes), /private-photo/);
});

test("relative text is anchored to original Mexico date, never replay date", () => {
  assert.equal(anchorHistoricalText("mañana a las 10:30", day1), "01/10/2026 a las 10:30");
  assert.equal(anchorHistoricalText("mañana te mando ubicación", day1), "01/10/2026 te mando ubicación");
  assert.equal(anchorHistoricalText("hoy / ayer / mañana", "2026-10-01T02:00:00Z"), "30/09/2026 / 29/09/2026 / 01/10/2026");
  assert.equal(absoluteAppointmentLabel(appointmentAt), "01/10/2026 a las 10:30 (America/Mexico_City)");
});
for (const text of ["Nos vemos mañana a las 10:30", "Nos vemos el dos de octubre", "Visita confirmada el viernes", "Cita a las 10"])
  test(`modelo no puede inventar fecha: ${text}`, () => assert.throws(() => assertNoUngroundedAppointment(text), /requires_review/));

test("cita persistida prevalece; cancelada/ambigua no se confirma", async () => {
  const { db } = fixture();
  assert.equal((await readSocialAppointment(db, contact)).appointment.fecha_hora, appointmentAt);
  db.tables.citas[0].estado = "cancelada";
  assert.deepEqual(await readSocialAppointment(db, contact), { status: "missing", appointment: null });
  assert.doesNotMatch(ownerContinuityResponse("Te envío la ubicación", null), /visita|mañana|10:30/);
  db.tables.citas[0].estado = "agendada";
  db.tables.respond_appointment_sync.push({ respond_contact_id: contact, status: "created", cita_id: "other" });
  db.tables.citas.push({ ...db.tables.citas[0], id: "other" });
  assert.deepEqual(await readSocialAppointment(db, contact), { status: "ambiguous", appointment: null });
});

const loadOwner = async (history, inputs, output) => importWithStubs(new URL("../lib/agentsV2/processOwnerInbound.js", import.meta.url), {
  "../ejecutivo/respondSync": { readRespondMessages: async () => ({ messages: history }), respondMessageTimestamp: m => m.at },
  "../shadow/coordinator": { sanitizeShadowText: text => ({ text, rejected: false }) },
  "./openaiOwnerAgent": { createOwnerSession: async ({ input }) => { inputs.push(input); return { id: "synthetic-session" }; }, getOwnerSession: async () => ({ id: "synthetic-session", status: "idle" }), fulfillOwnerActions: async () => assert.fail("no tools"), ownerOutput: async () => typeof output==="function"?output():output },
  "./agentUsage": { safeAgentUsage: async () => ({ inputTokens: 0, outputTokens: 0 }) },
});
test("regresión integrada dos días: OWNER + responsable + cita intactos, cero handoff/assignment/ACK", async () => {
  const { db, capture } = fixture(), sent = [], inputs = [];
  const immutable = JSON.stringify([db.tables.gv_respond_contact_snapshots, db.tables.citas]);
  assert.equal((await capture("Soy propietaria, quiero vender mi casa", day1)).destination, "OWNER");
  await capture("mañana te mando ubicación", "2026-09-30T18:00:00.000Z");
  const loaded = await loadOwner([{ at: day1, traffic: "outgoing", text: "Visita acordada mañana a las 10:30" }], inputs, "Gracias, nos vemos mañana a las 10:30.");
  globalThis.fetch = async (url, options) => {
    assert.ok(url.startsWith("https://api.respond.io/"), "no assignment workflow");
    sent.push(JSON.parse(options.body).message.text); return { ok: true, json: async () => ({ messageId: "synthetic-sent" }) };
  };
  try {
    for (const [text, at] of [["Buenos días te mando la dirección de mi casa", day2], ["Calle Sintética 100 col Prueba", "2026-10-01T14:01:00.000Z"]]) {
      const routed = await capture(text, at); assert.equal(routed.destination, "OWNER");
      const result = await loaded.processOwnerInboundById(db, routed.inboundId, { env });
      assert.equal(result.status, "sent");
      const inbound = db.tables.owner_agent_v1_inbound_messages.find(r => r.id === routed.inboundId);
      assert.equal(inbound.sanitized_text, text, "property detail preserved in existing Owner journal");
      assert.equal((await createSalesAutomationFallbackHandoff(db, { inbound, env })).created, false);
      assert.equal((await createSalesHandoffIfNeeded(db, { inbound, env })).created, false);
    }
  } finally { globalThis.fetch = async () => assert.fail("external API forbidden"); }
  assert.equal(sent.length, 2);
  for (const message of sent) { assert.match(message, /01\/10\/2026 a las 10:30/); assert.doesNotMatch(message, /mañana|asignar|asesor|02\/10/); }
  for (const input of inputs) { assert.match(input, /01\/10\/2026 a las 10:30/); assert.doesNotMatch(input, /mañana/); }
  assert.equal(JSON.stringify([db.tables.gv_respond_contact_snapshots, db.tables.citas]), immutable);
  assert.equal(db.tables.sales_agent_v2_inbound_messages?.length || 0, 0);
  assert.equal(db.tables.sales_agent_v2_handoffs?.length || 0, 0);
  assert.ok(db.operations.filter(o => o.op === "insert").every(o => ["owner_agent_v1_runs", "owner_agent_v1_auto_outbound"].includes(o.table)));
});

test("responsable existente bloquea creación, fallback, dispatch y SLA aun si ruta SALES", async () => {
  const { db } = fixture();
  const inbound = { id: "inbound", social_route_id: "route", respond_contact_id: contact, channel_id: "498219", sanitized_text: "Quiero una visita mañana" };
  assert.equal(await socialAssignmentBarrier(db, inbound, { env }), "existing_responsible_preserved");
  for (const create of [createSalesHandoffIfNeeded, createSalesAutomationFallbackHandoff]) assert.equal((await create(db, { inbound, env })).created, false);
  db.tables.sales_agent_v2_handoffs = [{ ...inbound, id: "h", status: "assigned", assignment_requested_at: day1, sla_due_at: day1 }];
  assert.equal((await dispatchSalesHandoff(db, { handoffId: "h", env })).assignmentTriggered, false);
  assert.equal((await processSalesHandoffSla(db, { env })).status, "idle");
  assert.equal(db.tables.sales_agent_v2_handoffs[0].status,"assigned");
  assert.ok(db.operations.every(o => o.op === "select" || o.table === "read_social_route_context_v1" ||
    (o.table==="sales_agent_v2_handoffs"&&o.op==="update"&&Object.keys(o.payload).every(k=>["assignment_error_code","updated_at"].includes(k)))));
});
test("fecha no sustentada fuera del acuse de continuidad falla cerrada antes de enviar", async () => {
  const {db,capture}=fixture(); const r=await capture("Soy propietaria, quiero vender mi casa",day1);
  const loaded=await loadOwner([],[],"Nos vemos mañana a las 10:30");
  assert.equal((await loaded.processOwnerInboundById(db,r.inboundId,{env})).status,"failed");
  assert.equal(db.tables.owner_agent_v1_runs[0].error_code,"social_appointment_output_requires_review");
  assert.equal(db.tables.owner_agent_v1_runs[0].proposed_response,null);
  assert.equal(db.tables.owner_agent_v1_auto_outbound?.length||0,0);
});
test("cancelación durante modelo no reintroduce la cita obsoleta", async () => {
  const {db,capture}=fixture(); await capture("Soy propietaria",day1);
  const r=await capture("Te mando la ubicación",day2);
  const loaded=await loadOwner([],[],()=>{db.tables.citas[0].estado="cancelada";return "Nos vemos mañana a las 10:30";});
  const sent=[];globalThis.fetch=async(_url,options)=>{sent.push(JSON.parse(options.body).message.text);return{ok:true,json:async()=>({messageId:"synthetic"})};};
  try{assert.equal((await loaded.processOwnerInboundById(db,r.inboundId,{env})).status,"sent");}
  finally{globalThis.fetch=async()=>assert.fail("external API forbidden");}
  assert.deepEqual(sent,["Gracias, recibí la información para la captación."]);
});
test("asignación desconocida no equivale a sin responsable; OFF legacy sin nuevas lecturas", async () => {
  const row = { respond_contact_id: contact, channel_id: "498219" };
  assert.equal(await socialAssignmentBarrier(memoryDb(), row, { env }), "assignment_state_requires_review");
  assert.equal(await socialAssignmentBarrier({ from() { assert.fail(); } }, row, { env: {} }), null);
});
test("responsable del caso preservado aun si snapshot Respond dice unassigned", async () => {
  const db=memoryDb({gv_respond_contact_snapshots:[{respond_contact_id:contact,respond_record_active:true,metadata:{mapping_method:"current_assignee_unassigned"}}],gv_opportunities:[{respond_contact_id:contact,asesor_id:advisor}]});
  assert.equal(await socialAssignmentBarrier(db,{respond_contact_id:contact,channel_id:"498219"},{env}),"existing_responsible_preserved");
});
test("watchdog no envía resultado Sales viejo de una conversación Owner", async () => {
  const { db, capture } = fixture(); await capture("Soy propietaria", day1);
  db.tables.sales_agent_v2_shadow_runs = [{ id: "old", status: "idle", completed_at: new Date().toISOString(), proposed_response: "Nos vemos mañana a las 10:30", sales_agent_v2_inbound_messages: { id: "i", respond_contact_id: contact, channel_id: "498219", sanitized_text: "casa" } }];
  const beforeOperations=db.operations.length;
  const result = await processSalesAutoOutboundRun(db, "old", { env: { ...env, SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED: "true", VERCEL_ENV: "production", SUPABASE_ENVIRONMENT: "production" } });
  assert.equal(result.reason, "owner_continuity_no_sales_outbound");
  assert.equal(db.tables.sales_agent_v2_auto_outbound[0].status,"blocked");
  assert.ok(db.operations.slice(beforeOperations).filter(o=>o.op!=="select"&&o.table!=="read_social_route_context_v1").every(o=>o.table==="sales_agent_v2_auto_outbound"));
});
test("cita existente evita releer historia o crear cita; relativa nueva se ancla una sola vez", async () => {
  const module = await importWithStubs(new URL("../lib/agentsV2/respondAppointmentSync.js", import.meta.url), {
    "../ejecutivo/respondSync.js": { fetchRespondContact: async () => assert.fail(), readRespondMessages: async () => assert.fail("existing appointment must not reread historical words"), respondMessageTimestamp: () => assert.fail() },
  });
  assert.equal(module.parseAppointment("mañana a las 10:30", day1, { now: new Date(day1).getTime() }), appointmentAt);
  const { db } = fixture(); db.tables.gv_respond_contact_snapshots[0].respond_lifecycle = "Visita agendada";
  db.tables.respond_appointment_sync.push({ id: "pending", respond_contact_id: contact, social_routing_version: 1, status: "pending", lifecycle: "Visita agendada", created_at: day2 });
  const result = await module.processOneRespondAppointmentSync(db);
  assert.equal(result.status, "already_exists"); assert.equal(result.appointmentAt, appointmentAt);
  assert.equal(db.tables.citas.length, 1); assert.equal(db.tables.citas[0].fecha_hora, appointmentAt);
  assert.ok(db.operations.every(o => o.op !== "insert"));
});
test("día 1: sync real normaliza mañana contra mensaje original y persiste absoluto mediante RPC existente", async () => {
  const module=await importWithStubs(new URL("../lib/agentsV2/respondAppointmentSync.js",import.meta.url),{
    "../ejecutivo/respondSync.js":{fetchRespondContact:async()=>assert.fail(),readRespondMessages:async()=>({messages:[{at:day1,text:"Visita acordada mañana a las 10:30",traffic:"outgoing",sender:{source:"user"}}]}),respondMessageTimestamp:m=>m.at},
  });
  const db=memoryDb({gv_respond_contact_snapshots:[{...snapshot,respond_lifecycle:"Visita agendada"}],gv_opportunities:[{respond_contact_id:contact,cliente_id:"linked-client",propiedad_id:"linked-property",asesor_id:advisor}],respond_appointment_sync:[{id:"initial-sync",respond_contact_id:contact,status:"pending",social_routing_version:1,lifecycle:"Visita agendada",created_at:day1}]},{commit_social_appointment_v1:async args=>{
    assert.equal(args.p_at,appointmentAt);assert.equal(args.p_source_at,day1);
    db.tables.citas=[{id:"stored-cita",fecha_hora:args.p_at,asesor_id:args.p_advisor_id,estado:"agendada",confirmacion_estado:"confirmada"}];
    Object.assign(db.tables.respond_appointment_sync[0],{status:"created",cita_id:"stored-cita",appointment_at:args.p_at,source_message_at:args.p_source_at});
    return{data:{status:"created",citaId:"stored-cita"}};
  }});
  const clock=Date.now;Date.now=()=>new Date(day1).getTime();
  try{assert.equal((await module.processOneRespondAppointmentSync(db)).status,"created");}finally{Date.now=clock;}
  assert.equal((await readSocialAppointment(db,contact)).appointment.fecha_hora,appointmentAt);
  assert.equal(db.tables.respond_appointment_sync[0].source_message_at,day1);
  assert.equal(db.operations.filter(o=>o.op==="rpc").length,1);
  assert.ok(db.operations.every(o=>o.op!=="insert"),"no alternate scheduler/client creation");
});
