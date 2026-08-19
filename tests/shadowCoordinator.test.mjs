import assert from "node:assert/strict";
import test from "node:test";
import { classifyShadowMessage, sanitizeShadowText, syntheticEnvelope, transformRespondFixture, validateShadowEnvelope } from "../lib/shadow/coordinator.js";

test("sanitiza PII antes de construir el envelope", () => {
  const result = sanitizeShadowText("persona@example.com +52 999 123 4567 https://privado.test/x 1234567890123456");
  assert.equal(result.changed, true);
  assert.match(result.text, /\[EMAIL\]/); assert.match(result.text, /\[TELEFONO\]/);
  assert.match(result.text, /\[URL\]/); assert.match(result.text, /\[CUENTA\]/);
  assert.doesNotMatch(result.text, /example\.com|1234567890123456/);
});

test("valida límites y pseudonimiza contacto", () => {
  const envelope = syntheticEnvelope({ id: "one", text: "Hola", metadata: {} });
  assert.equal(envelope.externalContactHash.length, 64);
  assert.equal(Object.hasOwn(envelope, "externalContactId"), false);
  assert.throws(() => validateShadowEnvelope({ provider: "unknown" }), /Provider/);
});

test("clasifica señales administrativas sin convertir no-ventas en administración", () => {
  const admin = syntheticEnvelope({ id: "rent", text: "Te mando el comprobante de la renta", metadata: { area: "administracion" } });
  assert.deepEqual(classifyShadowMessage(admin), { administrativeLikelihood: "high", reasonCodes: ["explicit_admin_area", "message_intent_hint_only"], intent: "enviar_comprobante_renta", requiresHuman: false });
  const unknown = syntheticEnvelope({ id: "unknown", text: "Lo de la casa sigue igual", metadata: {} });
  assert.equal(classifyShadowMessage(unknown).administrativeLikelihood, "unknown");
  const sales = syntheticEnvelope({ id: "sales", text: "Busco comprar una casa", metadata: { area: "ventas", salesRelevant: true } });
  assert.equal(classifyShadowMessage(sales).administrativeLikelihood, "low");
});

test("detecta multintención y conserva revisión humana", () => {
  const envelope = syntheticEnvelope({ id: "multi", text: "Mando comprobante de renta y el técnico nunca llegó", metadata: { area: "administracion" } });
  const result = classifyShadowMessage(envelope);
  assert.equal(result.intent, "multintencion"); assert.equal(result.requiresHuman, true);
});

test("fingerprint es determinístico para reintentos", () => {
  const first = syntheticEnvelope({ id: "same", text: "No tengo luz", metadata: {} });
  const second = syntheticEnvelope({ id: "same", text: "No tengo luz", metadata: {} });
  assert.equal(first.payloadFingerprint, second.payloadFingerprint);
});

test("fixture Respond sólo transforma a envelope neutral sin attachments inventados", () => {
  const envelope = transformRespondFixture({ event: "message.received", eventId: "e1", timestamp: "2026-08-18T12:00:00Z", contact: { id: "c1", customFields: { atn_area: "administracion" } }, conversation: { id: "v1" }, message: { messageId: "m1", text: "Hola" } });
  assert.equal(envelope.provider, "respond"); assert.equal(envelope.direction, "inbound");
  assert.deepEqual(envelope.attachmentMetadata, []);
});

test("guardas de captura Respond quedan apagadas por defecto y aisladas en código", async () => {
  delete process.env.SHADOW_RESPOND_CAPTURE_ENABLED;
  const { captureRespondShadowIsolated } = await import("../lib/shadow/coordinator.js");
  assert.deepEqual(await captureRespondShadowIsolated(null, {}), { status: "disabled" });
});
