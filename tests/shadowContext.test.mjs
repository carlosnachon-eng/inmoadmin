import assert from "node:assert/strict";
import test from "node:test";
import { resolveShadowContext } from "../lib/shadow/context.js";
import { classifyShadowMessage, syntheticEnvelope } from "../lib/shadow/coordinator.js";
import { SHADOW_SYNTHETIC_FIXTURES } from "../lib/shadow/fixtures.js";

function fakeDb(rowsByTable) {
  const calls = [];
  return {
    calls,
    from(table) {
      const state = { table, eq: [], in: [] };
      const query = {
        select() { return query; },
        eq(column, value) { state.eq.push([column, value]); return query; },
        in(column, values) { state.in.push([column, values]); return query; },
        ilike(column, value) { state.ilike = [column, value]; return query; },
        order() { return query; },
        async limit(limit) {
          calls.push({ table, limit, state });
          let rows = [...(rowsByTable[table] || [])];
          for (const [column, value] of state.eq) rows = rows.filter((row) => row[column] === value);
          for (const [column, values] of state.in) rows = rows.filter((row) => values.includes(row[column]));
          if (state.ilike) { const needle = state.ilike[1].replaceAll("%", "").toLowerCase(); rows = rows.filter((row) => String(row[state.ilike[0]] || "").toLowerCase().includes(needle)); }
          return { data: rows.slice(0, limit), error: null };
        },
      };
      return query;
    },
  };
}

const fixture = (id) => SHADOW_SYNTHETIC_FIXTURES.find(([fixtureId]) => fixtureId === id);
const envelopeFor = (id) => { const [, text, metadata] = fixture(id); return syntheticEnvelope({ id, text, metadata }); };

test("pipeline selecciona contexto exacto y no toma contrato terminado", async () => {
  const db = fakeDb({
    properties: [{ id: "f2a00000-0000-4000-8200-000000000001", name: "FASE2A-QA Casa Nube 101" }],
    contracts: [{ id: "f2a10000-0000-4000-8200-000000000001", property_id: "p", status: "activo" }, { id: "f2a10000-0000-4000-8200-000000000002", property_id: "p", status: "terminado" }],
    payments: [{ id: "f2a20000-0000-4000-8200-000000000001", contract_id: "c", status: "pagado", due_date: "2026-08-05", amount: 11000 }],
  });
  const envelope = envelopeFor("p0-01");
  const result = await resolveShadowContext(db, envelope, classifyShadowMessage(envelope));
  assert.deepEqual(result.matches.map((x) => x.entityType), ["property", "contract", "payment"]);
  assert.equal(result.audit.length, 3);
  assert.equal(result.audit.every((x) => x.ok && x.resultCount <= 5), true);
});

test("referencia múltiple queda ambigua y limitada a cinco", async () => {
  const db = fakeDb({ properties: Array.from({ length: 7 }, (_, index) => ({ id: `p${index}`, name: `FASE2A-QA Casa Nube ${index}` })) });
  const envelope = envelopeFor("p0-20");
  const result = await resolveShadowContext(db, envelope, classifyShadowMessage(envelope));
  assert.equal(result.matches.length, 5);
  assert.equal(result.ambiguous, true);
  assert.equal(result.requiresHuman, true);
});

test("saludo y spam no consultan ERP; mensaje sin vínculo queda unresolved", async () => {
  for (const id of ["p0-17", "p0-18"]) {
    const db = fakeDb({}); const envelope = envelopeFor(id);
    const result = await resolveShadowContext(db, envelope, classifyShadowMessage(envelope));
    assert.equal(db.calls.length, 0); assert.equal(result.matches.length, 0);
  }
  const db = fakeDb({}); const envelope = syntheticEnvelope({ id: "unresolved", text: "Lo de la casa sigue igual", metadata: { area: "administracion" } });
  const result = await resolveShadowContext(db, envelope, classifyShadowMessage(envelope));
  assert.equal(result.matches.length, 0); assert.equal(result.requiresHuman, true);
});

test("una herramienta fallida queda auditada y no impide los demás matches", async () => {
  const db = fakeDb({ properties: [{ id: "f2a00000-0000-4000-8200-000000000001", name: "FASE2A-QA Casa Nube 101" }] });
  const originalFrom = db.from.bind(db);
  db.from = (table) => {
    const query = originalFrom(table);
    if (table === "maintenance_tickets") query.limit = async () => ({ data: null, error: new Error("isolated") });
    return query;
  };
  const envelope = envelopeFor("p0-02");
  const result = await resolveShadowContext(db, envelope, classifyShadowMessage(envelope));
  assert.equal(result.matches.some((x) => x.entityType === "property"), true);
  assert.equal(result.audit.find((x) => x.tool === "get_maintenance_ticket_summary").ok, false);
});

test("fixture vivo conserva 20 casos y sanitiza PII antes de persistir", () => {
  assert.equal(SHADOW_SYNTHETIC_FIXTURES.length, 20);
  const envelope = envelopeFor("p0-01");
  assert.match(envelope.sanitizedText, /\[EMAIL\].*\[TELEFONO\].*\[URL\].*\[CUENTA\]/);
  assert.doesNotMatch(envelope.sanitizedText, /example\.invalid|1234567890123456/);
});

test("UX distingue revisión, ambigüedad, likelihood y responsive móvil", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");
  assert.match(source, /Revisión humana/); assert.match(source, /Contexto ambiguo/);
  assert.match(source, /High/); assert.match(source, /Medium/); assert.match(source, /Unknown/);
  assert.match(source, /@media \(max-width: 720px\)/); assert.match(source, /grid-template-columns: minmax\(0,1fr\)/);
});

test("UX humaniza Respond/Admin y distingue la respuesta humana", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");
  assert.match(source, /WhatsApp Administración/);
  assert.match(source, /Respuesta humana desde WhatsApp Business App/);
  assert.match(source, /provider=respond_admin/);
});

test("UX muestra el contexto semántico pendiente sin inventar una entidad", async () => {
  const page = await (await import("node:fs/promises")).readFile(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");
  const api = await (await import("node:fs/promises")).readFile(new URL("../pages/api/operaciones/shadow-coordinator.js", import.meta.url), "utf8");
  assert.match(page, /semantic_context_needed/);
  assert.match(page, /Contexto por identificar/);
  assert.match(api, /shadowContextState/);
  assert.match(api, /semantic_context_needed/);
  assert.match(api, /context_status/);
});

test("pipeline contextual sólo persiste telemetría shadow", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../lib/shadow/pipeline.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\(["'](?:payments|contracts|maintenance_tickets|servicios_inmueble|pagos_servicios|llaves|owner_payments)["']\)\.(?:insert|update|upsert|delete)/);
  assert.match(source, /shadow_context_matches/); assert.match(source, /shadow_context_query_audit/);
});
