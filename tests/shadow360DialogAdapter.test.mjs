import assert from "node:assert/strict";
import test from "node:test";
import { classifyShadowMessage } from "../lib/shadow/coordinator.js";
import { DIALOG360_FIXTURES, DIALOG360_FIXTURE_NOW } from "../lib/shadow/providers/360dialog.fixtures.js";
import { assert360DialogInboundOnly, payloadSizeBytes, transform360DialogWebhook } from "../lib/shadow/providers/360dialog.js";

const transform = (fixture) => transform360DialogWebhook(fixture, { now: DIALOG360_FIXTURE_NOW });

test("transforma texto inbound al envelope neutral sin persistir identificadores de contacto", () => {
  const { envelopes } = transform(DIALOG360_FIXTURES.textInbound);
  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0].provider, "360dialog");
  assert.equal(envelopes[0].direction, "inbound");
  assert.equal(envelopes[0].channel, "whatsapp_administracion");
  assert.equal(envelopes[0].externalEventId, "messages:wamid.fase2a.text");
  assert.equal(envelopes[0].externalContactHash.length, 64);
  assert.equal(envelopes[0].externalConversationId.length, 64);
  assert.equal(Object.hasOwn(envelopes[0], "externalContactId"), false);
});

test("echo de la app queda outbound humano y no se clasifica como cliente", () => {
  const envelope = transform(DIALOG360_FIXTURES.appEcho).envelopes[0];
  assert.equal(envelope.direction, "outbound");
  assert.equal(envelope.providerMetadata.humanEcho, "true");
  assert.deepEqual(classifyShadowMessage(envelope), {
    administrativeLikelihood: "unknown", reasonCodes: ["human_app_echo"], intent: "no_determinado", requiresHuman: false,
  });
});

test("attachments conservan sólo metadata permitida y media id pseudonimizado", () => {
  for (const key of ["image", "pdf", "audio"]) {
    const envelope = transform(DIALOG360_FIXTURES[key]).envelopes[0];
    assert.equal(envelope.attachmentMetadata.length, 1);
    assert.equal(envelope.attachmentMetadata[0].exists, "true");
    assert.equal(envelope.attachmentMetadata[0].mediaIdHash.length, 64);
    assert.equal(Object.hasOwn(envelope.attachmentMetadata[0], "url"), false);
    assert.equal(Object.hasOwn(envelope.attachmentMetadata[0], "fileName"), false);
  }
});

test("duplicado produce el mismo mensaje y fingerprint", () => {
  const first = transform(DIALOG360_FIXTURES.textInbound).envelopes[0];
  const duplicate = transform(DIALOG360_FIXTURES.duplicate).envelopes[0];
  assert.equal(first.externalMessageId, duplicate.externalMessageId);
  assert.equal(first.payloadFingerprint, duplicate.payloadFingerprint);
});

test("evento fuera de orden dentro de ventana se conserva marcado", () => {
  const envelope = transform(DIALOG360_FIXTURES.outOfOrder).envelopes[0];
  assert.equal(envelope.providerMetadata.outOfOrder, "true");
});

test("status se ignora y payload malformado o viejo se rechaza", () => {
  assert.deepEqual(transform(DIALOG360_FIXTURES.status), { kind: "status", envelopes: [] });
  assert.throws(() => transform(DIALOG360_FIXTURES.malformed), /identificadores/);
  assert.throws(() => transform360DialogWebhook(DIALOG360_FIXTURES.textInbound, { now: new Date("2026-08-23T06:00:00Z") }), /ventana temporal/);
});

test("sanitiza PII y conserva multintención", () => {
  const pii = transform(DIALOG360_FIXTURES.pii).envelopes[0];
  assert.match(pii.sanitizedText, /\[EMAIL\].*\[TELEFONO\].*\[URL\].*\[CUENTA\]/);
  assert.doesNotMatch(pii.sanitizedText, /example\.invalid|1234567890123456/);
  const multi = transform(DIALOG360_FIXTURES.multiIntent).envelopes[0];
  assert.equal(classifyShadowMessage(multi).intent, "multintencion");
});

test("payload grande es detectable y P1 no implementa outbound/media/LLM", () => {
  assert.ok(payloadSizeBytes(DIALOG360_FIXTURES.oversized) > 256 * 1024);
  assert.deepEqual(assert360DialogInboundOnly(), { outboundImplemented: false, mediaDownloadImplemented: false, llmImplemented: false });
});
