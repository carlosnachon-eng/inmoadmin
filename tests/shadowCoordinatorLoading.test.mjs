import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");

test("la UI no representa una carga pendiente como cero mensajes", () => {
  assert.match(page, /if \(!data && !error\) return <Layout[\s\S]*Cargando datos Shadow/);
  assert.match(page, /setData\(json\)/);
});

test("un fallo de lectura se muestra sin reemplazarlo por un dataset vacío", () => {
  assert.match(page, /catch \{\s*setError\("No se pudo cargar Coordinador IA — Sombra\."\)/);
  assert.doesNotMatch(page, /catch[\s\S]{0,120}setData\(\{[^}]*messages:\s*\[\]/);
});
