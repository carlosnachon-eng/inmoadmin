import assert from "node:assert/strict";
import test from "node:test";

import { classifyShadowMessage } from "../lib/shadow/coordinator.js";
import { processShadowEnvelope } from "../lib/shadow/pipeline.js";
import { RESPOND_ADMIN_FIXTURE_CHANNELS, RESPOND_ADMIN_FIXTURES } from "../lib/shadow/providers/respondAdmin.fixtures.js";
import {
  captureRespondAdminShadowIsolated,
  respondChannelId,
  shouldCaptureRespondAdmin,
  transformRespondAdminPayload,
} from "../lib/shadow/providers/respondAdmin.js";

const config = { enabled: "true", adminChannelId: RESPOND_ADMIN_FIXTURE_CHANNELS.admin };

function pipelineAdmin() {
  const state = { messages: new Map(), matches: [], audits: [] };
  return {
    state,
    db: {
      async rpc(_name, { p_envelope }) {
        const key = `${p_envelope.provider}:${p_envelope.externalMessageId || p_envelope.payloadFingerprint}`;
        if (state.messages.has(key)) return { data: { status: "duplicate", messageId: state.messages.get(key) }, error: null };
        const messageId = `shadow-${state.messages.size + 1}`;
        state.messages.set(key, messageId);
        return { data: { status: "accepted", messageId, conversationId: "shadow-conversation" }, error: null };
      },
      from(table) {
        return {
          async upsert(rows) { state.matches.push(...rows); return { error: null }; },
          async insert(rows) { state.audits.push(...rows); return { error: null }; },
          select() {
            const query = {
              eq() { return query; },
              ilike() { return query; },
              async limit() {
                return table === "properties"
                  ? { data: [{ id: "property-qa", name: "Inmueble QA" }], error: null }
                  : { data: [], error: null };
              },
            };
            return query;
          },
        };
      },
    },
  };
}

test("propaga channelId desde las formas soportadas", () => {
  assert.equal(respondChannelId({ message: { channelId: "message-channel" } }), "message-channel");
  assert.equal(respondChannelId({ conversation: { channelId: "conversation-channel" } }), "conversation-channel");
  assert.equal(respondChannelId({ channelId: "root-channel" }), "root-channel");
  assert.equal(respondChannelId({ channel: { id: "object-channel" } }), "object-channel");
});

test("normaliza eventos nativos y etiquetas New Incoming/Outgoing", () => {
  const incoming = structuredClone(RESPOND_ADMIN_FIXTURES.inboundAdmin);
  incoming.event_type = "New Incoming Message";
  assert.equal(transformRespondAdminPayload(incoming).direction, "inbound");
  const outgoing = structuredClone(RESPOND_ADMIN_FIXTURES.outboundAdmin);
  outgoing.event_type = "New Outgoing Message";
  assert.equal(transformRespondAdminPayload(outgoing).direction, "outbound_human");
});

test("allowlist estricta captura sólo Administración", () => {
  assert.equal(shouldCaptureRespondAdmin(RESPOND_ADMIN_FIXTURES.inboundAdmin, config).capture, true);
  for (const payload of [
    RESPOND_ADMIN_FIXTURES.inboundSales,
    RESPOND_ADMIN_FIXTURES.outboundSales,
    RESPOND_ADMIN_FIXTURES.missingChannel,
    RESPOND_ADMIN_FIXTURES.unknownChannel,
  ]) assert.equal(shouldCaptureRespondAdmin(payload, config).capture, false);
  assert.equal(shouldCaptureRespondAdmin(RESPOND_ADMIN_FIXTURES.inboundAdmin, { ...config, enabled: "false" }).reason, "disabled");
});

test("inbound administrativo produce envelope neutral y pseudonimizado", () => {
  const envelope = transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.inboundAdmin);
  assert.equal(envelope.provider, "respond_admin");
  assert.equal(envelope.direction, "inbound");
  assert.equal(envelope.channel, RESPOND_ADMIN_FIXTURE_CHANNELS.admin);
  assert.equal(envelope.externalMessageId, "msg-admin-in-1");
  assert.equal(envelope.externalContactHash.length, 64);
  assert.equal(Object.hasOwn(envelope, "externalContactId"), false);
});

test("A: inbound Admin recorre pipeline P0 y persiste matches/audits", async () => {
  const admin = pipelineAdmin();
  const envelope = transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.inboundAdmin);
  const result = await processShadowEnvelope(admin.db, envelope, {
    contextResolver: async () => ({
      matches: [
        { entityType: "property", internalId: "property-qa", label: "FASE2A-QA Casa Nube", method: "reference", confidence: 100, reasonCode: "property_reference" },
        { entityType: "maintenance_ticket", internalId: "ticket-qa", label: "Fuga Casa Nube", method: "reference", confidence: 95, reasonCode: "maintenance_reference" },
      ],
      audit: [
        { tool: "find_properties", resultCount: 1, ok: true, durationMs: 2 },
        { tool: "get_maintenance_ticket_summary", resultCount: 1, ok: true, durationMs: 3 },
      ],
      ambiguous: false,
    }),
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.context.matches.length, 2);
  assert.equal(admin.state.matches.length, 2);
  assert.equal(admin.state.audits.length, 2);
  assert.ok(admin.state.audits.every((item) => item.result_count <= 5));
  assert.equal(result.contextStatus, "resolved");
  assert.equal(result.semanticContextNeeded, false);
});

test("metadata determinística explícita activa resolución ERP y auditoría", async () => {
  const admin = pipelineAdmin();
  const envelope = transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.inboundAdmin);
  envelope.providerMetadata.propertyId = "property-qa";
  const result = await processShadowEnvelope(admin.db, envelope);
  assert.equal(result.contextStatus, "resolved");
  assert.equal(result.semanticContextNeeded, false);
  assert.equal(admin.state.matches.length, 1);
  assert.equal(admin.state.audits.length, 1);
});

test("texto humano sin claves queda unresolved sin sobreconsultar", async () => {
  const admin = pipelineAdmin();
  const result = await processShadowEnvelope(admin.db, transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.inboundAdmin));
  assert.equal(result.classification.intent, "reportar_mantenimiento");
  assert.equal(result.contextStatus, "unresolved");
  assert.equal(result.semanticContextNeeded, true);
  assert.equal(admin.state.matches.length, 0);
  assert.equal(admin.state.audits.length, 0);
});

test("outgoing administrativo queda como contexto humano y nunca solicitud", () => {
  const envelope = transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.outboundAdmin);
  assert.equal(envelope.direction, "outbound_human");
  assert.deepEqual(classifyShadowMessage(envelope), {
    administrativeLikelihood: "unknown",
    reasonCodes: ["human_app_echo"],
    intent: "no_determinado",
    requiresHuman: false,
  });
  assert.equal(envelope.providerMetadata.echoGatePending, "true");
});

test("B: outbound_human se persiste sin resolver contexto ERP", async () => {
  const admin = pipelineAdmin();
  let resolverCalls = 0;
  const result = await processShadowEnvelope(admin.db, transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.outboundAdmin), {
    contextResolver: async () => { resolverCalls += 1; throw new Error("no debe ejecutarse"); },
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.classification.intent, "no_determinado");
  assert.equal(result.context, null);
  assert.equal(result.contextStatus, "not_applicable");
  assert.equal(result.semanticContextNeeded, false);
  assert.equal(resolverCalls, 0);
  assert.equal(admin.state.messages.size, 1);
  assert.equal(admin.state.matches.length, 0);
  assert.equal(admin.state.audits.length, 0);
});

test("C/D/E: Ventas, sin channelId y desconocido producen cero Shadow", async () => {
  const beforeEnabled = process.env.SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED;
  const beforeChannel = process.env.SHADOW_RESPOND_ADMIN_CHANNEL_ID;
  process.env.SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED = "true";
  process.env.SHADOW_RESPOND_ADMIN_CHANNEL_ID = RESPOND_ADMIN_FIXTURE_CHANNELS.admin;
  let pipelineCalls = 0;
  try {
    for (const payload of [RESPOND_ADMIN_FIXTURES.inboundSales, RESPOND_ADMIN_FIXTURES.missingChannel, RESPOND_ADMIN_FIXTURES.unknownChannel]) {
      const result = await captureRespondAdminShadowIsolated({}, payload, { processEnvelope: async () => { pipelineCalls += 1; } });
      assert.equal(result.status, "skipped");
    }
    assert.equal(pipelineCalls, 0);
  } finally {
    if (beforeEnabled === undefined) delete process.env.SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED; else process.env.SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED = beforeEnabled;
    if (beforeChannel === undefined) delete process.env.SHADOW_RESPOND_ADMIN_CHANNEL_ID; else process.env.SHADOW_RESPOND_ADMIN_CHANNEL_ID = beforeChannel;
  }
});

test("idempotencia distingue mensajes legítimos y estabiliza reintentos", () => {
  const first = transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.inboundAdmin);
  const retry = transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.duplicate);
  const second = transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.sameTextDifferentMessage);
  assert.equal(first.payloadFingerprint, retry.payloadFingerprint);
  assert.notEqual(first.payloadFingerprint, second.payloadFingerprint);
  assert.notEqual(first.externalMessageId, second.externalMessageId);
});

test("mismo evento y contenido deduplica aunque cambie messageId", () => {
  const first = transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.inboundAdmin);
  const changedId = structuredClone(RESPOND_ADMIN_FIXTURES.inboundAdmin);
  changedId.message.messageId = "different-message-id";
  const second = transformRespondAdminPayload(changedId);
  assert.equal(first.payloadFingerprint, second.payloadFingerprint);
  assert.equal(first.externalEventId, second.externalEventId);
});

test("PII, URL y attachment real no se persisten", () => {
  const pii = transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.pii);
  assert.match(pii.sanitizedText, /\[EMAIL\].*\[TELEFONO\].*\[URL\]/);
  assert.doesNotMatch(JSON.stringify(pii), /example\.com|privado\.test|222 123 4567/);
  const attachment = transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.attachment);
  assert.deepEqual(attachment.attachmentMetadata, [{ type: "image" }]);
  assert.doesNotMatch(JSON.stringify(attachment), /privado\.test/);
});

test("malformed falla cerrado y multintención conserva revisión", () => {
  assert.throws(() => transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.malformed), /no transformable|timestamp|contacto/i);
  const multi = transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.multiIntent);
  assert.equal(classifyShadowMessage(multi).intent, "multintencion");
  assert.equal(classifyShadowMessage(multi).requiresHuman, true);
});

test("evento fuera de orden conserva su timestamp original", () => {
  const older = structuredClone(RESPOND_ADMIN_FIXTURES.inboundAdmin);
  older.event_id = "evt-older";
  older.message.messageId = "msg-older";
  older.message.timestamp = "2026-08-18T10:00:00.000Z";
  const envelope = transformRespondAdminPayload(older);
  assert.equal(envelope.occurredAt, "2026-08-18T10:00:00.000Z");
});

test("failure isolation no propaga error al webhook comercial", async () => {
  const beforeEnabled = process.env.SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED;
  const beforeChannel = process.env.SHADOW_RESPOND_ADMIN_CHANNEL_ID;
  const beforeEnvironment = process.env.SUPABASE_ENVIRONMENT;
  process.env.SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED = "true";
  process.env.SHADOW_RESPOND_ADMIN_CHANNEL_ID = RESPOND_ADMIN_FIXTURE_CHANNELS.admin;
  process.env.SUPABASE_ENVIRONMENT = "dev";
  const admin = { rpc: async () => ({ data: null, error: new Error("shadow unavailable") }) };
  try {
    assert.deepEqual(await captureRespondAdminShadowIsolated(admin, RESPOND_ADMIN_FIXTURES.inboundAdmin), { status: "isolated_error" });
  } finally {
    if (beforeEnabled === undefined) delete process.env.SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED; else process.env.SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED = beforeEnabled;
    if (beforeChannel === undefined) delete process.env.SHADOW_RESPOND_ADMIN_CHANNEL_ID; else process.env.SHADOW_RESPOND_ADMIN_CHANNEL_ID = beforeChannel;
    if (beforeEnvironment === undefined) delete process.env.SUPABASE_ENVIRONMENT; else process.env.SUPABASE_ENVIRONMENT = beforeEnvironment;
  }
});

test("F: fallo total del resolver queda aislado sin afectar respuesta Respond", async () => {
  const beforeEnabled = process.env.SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED;
  const beforeChannel = process.env.SHADOW_RESPOND_ADMIN_CHANNEL_ID;
  const beforeEnvironment = process.env.SUPABASE_ENVIRONMENT;
  process.env.SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED = "true";
  process.env.SHADOW_RESPOND_ADMIN_CHANNEL_ID = RESPOND_ADMIN_FIXTURE_CHANNELS.admin;
  process.env.SUPABASE_ENVIRONMENT = "dev";
  const admin = pipelineAdmin();
  try {
    const result = await captureRespondAdminShadowIsolated(admin.db, RESPOND_ADMIN_FIXTURES.inboundAdmin, {
      processEnvelope: (db, envelope) => processShadowEnvelope(db, envelope, { contextResolver: async () => { throw new Error("context unavailable"); } }),
    });
    assert.deepEqual(result, { status: "isolated_error" });
    assert.equal(admin.state.messages.size, 1);
  } finally {
    if (beforeEnabled === undefined) delete process.env.SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED; else process.env.SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED = beforeEnabled;
    if (beforeChannel === undefined) delete process.env.SHADOW_RESPOND_ADMIN_CHANNEL_ID; else process.env.SHADOW_RESPOND_ADMIN_CHANNEL_ID = beforeChannel;
    if (beforeEnvironment === undefined) delete process.env.SUPABASE_ENVIRONMENT; else process.env.SUPABASE_ENVIRONMENT = beforeEnvironment;
  }
});

test("G: duplicado conserva una sola shadow_message y no repite contexto", async () => {
  const admin = pipelineAdmin();
  const resolver = async () => ({
    matches: [{ entityType: "property", internalId: "property-qa", label: "Casa Nube", method: "reference", confidence: 100, reasonCode: "property_reference" }],
    audit: [{ tool: "find_properties", resultCount: 1, ok: true, durationMs: 1 }],
    ambiguous: false,
  });
  const first = await processShadowEnvelope(admin.db, transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.inboundAdmin), { contextResolver: resolver });
  const duplicate = await processShadowEnvelope(admin.db, transformRespondAdminPayload(RESPOND_ADMIN_FIXTURES.duplicate), { contextResolver: resolver });
  assert.equal(first.status, "accepted");
  assert.equal(duplicate.status, "duplicate");
  assert.equal(admin.state.messages.size, 1);
  assert.equal(admin.state.matches.length, 1);
  assert.equal(admin.state.audits.length, 1);
});
