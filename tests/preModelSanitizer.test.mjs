import test from "node:test";
import assert from "node:assert/strict";
import { invokeSanitizedPhase3A, sanitizePreModelInput, verifyPreModelPayload } from "../lib/shadow/ai/preModelSanitizer.js";

const safe = (text, metadata) => sanitizePreModelInput({ text, metadata });

test("nombre y propiedad se sustituyen y metadata no llega a 3A", () => {
  const result = safe("Soy María López y escribo por Ocotlán 19.", { contactId: "contact-123", canonicalName: "María López" });
  assert.equal(result.allowed, true); assert.equal(result.payload.message, "[PERSONA] y escribo por [DOMICILIO]."); assert.equal(result.metadataDiscarded, 2); assert.deepEqual(Object.keys(result.payload), ["message"]);
});

test("nombre de dos componentes sin etiqueta también se sustituye", () => {
  const result = safe("El aviso lo entregó María López ayer");
  assert.equal(result.allowed, true); assert.equal(result.payload.message, "El aviso lo entregó [PERSONA] ayer");
});

test("teléfono y email quedan eliminados", () => {
  const result = safe("Llámame al +52 222 123 4567 o escribe a maria@example.com");
  assert.equal(result.allowed, true); assert.match(result.payload.message, /\[TELEFONO\]/); assert.match(result.payload.message, /\[EMAIL\]/); assert.doesNotMatch(result.payload.message, /222|example/);
});

test("dirección completa queda sustituida", () => {
  const result = safe("La fuga está en calle Reforma 123, colonia Centro, C.P. 72000");
  assert.equal(result.allowed, true); assert.match(result.payload.message, /\[DOMICILIO\]/); assert.match(result.payload.message, /\[CP\]/); assert.doesNotMatch(result.payload.message, /Reforma|72000/);
});

test("comprobante conserva intención pero elimina monto, folio y operación", () => {
  const result = safe("Adjunto comprobante de pago por $12,500, folio ABC-99881 y operación 88442211");
  assert.equal(result.allowed, true); assert.match(result.payload.message, /comprobante de pago/i); assert.match(result.payload.message, /\[MONTO\]/); assert.equal((result.payload.message.match(/\[FOLIO\]/g) || []).length, 2);
});

test("CLABE y cuenta se sustituyen", () => {
  const result = safe("La CLABE 012345678901234567 y cuenta 1234567890 aparecen en el recibo");
  assert.equal(result.allowed, true); assert.equal((result.payload.message.match(/\[CUENTA\]/g) || []).length, 2); assert.doesNotMatch(result.payload.message, /012345|123456/);
});

test("texto mixto elimina identificadores directos", () => {
  const result = safe("Hola, Juan Pérez. Soy Ana Ruiz, vivo en Avenida Juárez 45, tel 5512345678, ana@x.test, folio ZX-7788, https://x.test/a y token=secret123456");
  assert.equal(result.allowed, true); assert.doesNotMatch(result.payload.message, /Juan|Ana|Juárez|5512|@|https|ZX-7788|secret123456/); assert.equal(verifyPreModelPayload(result.payload).allowed, true);
});

test("mensaje sin PII permanece semánticamente intacto", () => {
  const text = "¿Ya recibieron el comprobante de pago?"; const result = safe(text);
  assert.equal(result.allowed, true); assert.equal(result.payload.message, text); assert.deepEqual(result.replacements, {});
});

test("frases razonables no generan falsos positivos", () => {
  for (const text of ["La llave no funciona", "Cuenta con humedad desde ayer", "Pago de renta pendiente", "Necesito reparar la fuga de agua"]) assert.equal(safe(text).payload.message, text);
});

test("verificador independiente bloquea residuos y payload con metadata", () => {
  assert.deepEqual(verifyPreModelPayload({ message: "Escribe a persona@example.com" }), { allowed: false, reasons: ["residual_email"] });
  assert.equal(verifyPreModelPayload({ message: "Sin PII", contactId: "x" }).allowed, false);
});

test("la puerta no invoca 3A si el verificador independiente encuentra un residual", async () => {
  let calls = 0;
  const result = await invokeSanitizedPhase3A({ text: "Es para María" }, async () => { calls += 1; });
  assert.equal(result.invoked, false); assert.equal(calls, 0); assert.equal(result.sanitization.payload, null); assert.ok(result.sanitization.reasons.includes("residual_explicit_person"));
});

test("3A recibe exclusivamente el payload mínimo ya verificado", async () => {
  let received;
  const result = await invokeSanitizedPhase3A({ text: "Llámame al 5512345678", metadata: { contactId: "contact-123" } }, async (payload) => { received = payload; return { intent: "contact_request" }; });
  assert.equal(result.invoked, true); assert.deepEqual(received, { message: "Llámame al [TELEFONO]" }); assert.deepEqual(result.result, { intent: "contact_request" });
});
