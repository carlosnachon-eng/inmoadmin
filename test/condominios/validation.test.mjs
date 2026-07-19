import test from "node:test";
import assert from "node:assert/strict";
import {
  asDate,
  asMoney,
  asPeriod,
  asText,
  asUuid,
  escapeHtml,
  stableHash,
  validateDocumentMetadata,
} from "../../lib/server/condominiosValidation.js";
import { buildObjectPath } from "../../lib/server/condominiosStorage.js";

test("valida identificadores, periodos, fechas y dinero", () => {
  assert.equal(asUuid("11111111-1111-4111-8111-111111111111"), "11111111-1111-4111-8111-111111111111");
  assert.equal(asPeriod("2026-07"), "2026-07");
  assert.equal(asDate("2026-07-17"), "2026-07-17");
  assert.equal(asMoney("10.129"), 10.13);
  assert.throws(() => asPeriod("2026-13"));
  assert.throws(() => asMoney(-1));
});

test("rechaza controles y limita texto", () => {
  assert.equal(asText("  Puebla  ", "ciudad", { required: true }), "Puebla");
  assert.throws(() => asText("a\u0000b", "texto"));
  assert.throws(() => asText("abc", "texto", { max: 2 }));
});

test("escapa HTML y produce hashes estables", () => {
  assert.equal(escapeHtml('<img src=x onerror="x">'), "&lt;img src=x onerror=&quot;x&quot;&gt;");
  assert.equal(stableHash({ b: 2, a: 1 }), stableHash({ a: 1, b: 2 }));
});

test("storage valida tipo, tamaño y ruta aislada", () => {
  validateDocumentMetadata({ mimeType: "application/pdf", sizeBytes: 100, name: "recibo.pdf" });
  assert.throws(() => validateDocumentMetadata({ mimeType: "text/html", sizeBytes: 100, name: "x.html" }));
  assert.throws(() => validateDocumentMetadata({ mimeType: "application/pdf", sizeBytes: 20 * 1024 * 1024, name: "x.pdf" }));
  assert.throws(() => validateDocumentMetadata({ mimeType: "application/pdf", sizeBytes: 100, name: "../../x.pdf" }));
  const path = buildObjectPath("11111111-1111-4111-8111-111111111111", "recibo", "application/pdf");
  assert.match(path, /^11111111-1111-4111-8111-111111111111\/recibo\/\d{4}-\d{2}-\d{2}\/.+\.pdf$/);
});
