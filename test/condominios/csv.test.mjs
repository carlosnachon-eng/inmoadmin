import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv, validateUnitCsv } from "../../lib/server/csv.js";

test("parsea RFC 4180: comas, comillas, saltos CRLF y BOM", () => {
  const rows = parseCsv('\uFEFFnumero,propietario_nombre,notas\r\n101,"Pérez, Ana","Dijo ""sí"""\r\n102,Luis,"línea 1\nlínea 2"');
  assert.deepEqual(rows, [
    ["numero", "propietario_nombre", "notas"],
    ["101", "Pérez, Ana", 'Dijo "sí"'],
    ["102", "Luis", "línea 1\nlínea 2"],
  ]);
});

test("rechaza CSV con comillas abiertas", () => {
  assert.throws(() => parseCsv('numero,nombre\n1,"Ana'), /comillas sin cerrar/);
});

test("detecta unidades duplicadas y correos inválidos", () => {
  const result = validateUnitCsv(
    "numero,propietario_nombre,propietario_email\nA-1,Ana,ana@example.com\nA-1,Luis,no-es-correo",
  );
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].propietario_nombre, "Ana");
  assert.ok(result.errors.some((error) => error.mensaje.includes("duplicada")));
  assert.ok(result.errors.some((error) => error.mensaje.includes("Correo inválido")));
});

test("round-trip de exportación conserva delimitadores", () => {
  const csv = toCsv([{ numero: "1", notas: 'agua, "torre A"' }], ["numero", "notas"]);
  assert.deepEqual(parseCsv(csv), [["numero", "notas"], ["1", 'agua, "torre A"']]);
});
