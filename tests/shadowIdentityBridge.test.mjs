import test from "node:test";
import assert from "node:assert/strict";
import {
  contactPhoneFromRespondPayload, generateIdentityCandidates, normalizeIdentityPhone,
  resolveConfirmedContactIdentity, validateRespondContactId,
} from "../lib/shadow/identityBridge.js";
import { READ_ONLY_SHADOW_TOOLS, executeShadowReadOnlyTool } from "../lib/shadow/context.js";
import { createShadowAiInputSnapshot } from "../lib/shadow/ai/stateMachine.js";
import { deriveRequiredTools } from "../lib/shadow/ai/toolPolicy.js";
import { realShadowTurnEnvelope } from "../lib/shadow/ai/conversationTurns.js";
import fs from "node:fs";

const resultQuery = (result) => {
  const query = {
    select: () => query, eq: () => query, in: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => result, single: async () => result,
    then: (resolve) => resolve(result),
  };
  return query;
};

test("normalización exacta admite únicamente teléfono mexicano completo", () => {
  assert.equal(normalizeIdentityPhone("+52 222 123 4567"), "522221234567");
  assert.equal(normalizeIdentityPhone("2221234567"), "522221234567");
  assert.equal(normalizeIdentityPhone("123456"), null);
  assert.equal(contactPhoneFromRespondPayload({ contact: { phone: "+52 222 123 4567" } }), "522221234567");
});

test("IDs opacos estrictos: fuzzy/name/email/teléfono parcial no son argumentos de identidad", () => {
  assert.equal(validateRespondContactId("respond:abc_123"), "respond:abc_123");
  for (const value of ["Juan Pérez", "foo@example.com", "+52 222 123", "../contact", "https://x"]) assert.throws(() => validateRespondContactId(value));
});

test("candidato único exacto permanece candidate y nunca confirmed", async () => {
  const inserted = [];
  const admin = { rpc: async () => ({ data: [{ contract_id: "c1", inmoadmin_client_id: "11111111-1111-4111-8111-111111111111", property_id: "22222222-2222-4222-8222-222222222222", role_kind: "tenant" }], error: null }), from(table) {
    if (table === "respond_identity_links") return { select: () => resultQuery({ data: null, error: null }), insert(row) { inserted.push(row); return { select: () => ({ single: async () => ({ data: { id: "link-1" }, error: null }) }) }; } };
    if (table === "respond_identity_audit") return { insert: async () => ({ error: null }) };
    throw new Error(table);
  } };
  const result = await generateIdentityCandidates(admin, { respondContactId: "contact-1", normalizedPhone: "2221234567" });
  assert.deepEqual(result, { status: "candidate", candidates: 1 });
  assert.equal(inserted[0].link_status, "candidate");
  assert.notEqual(inserted[0].link_status, "confirmed");
});

test("múltiples coincidencias exactas producen conflict", async () => {
  const statuses = [];
  const rows = ["11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333"].map((inmoadmin_client_id, i) => ({ contract_id: `c${i}`, inmoadmin_client_id, property_id: null, role_kind: "tenant" }));
  const admin = { rpc: async () => ({ data: rows, error: null }), from(table) {
    if (table === "respond_identity_links") return { select: () => resultQuery({ data: null, error: null }), insert(row) { statuses.push(row.link_status); return { select: () => ({ single: async () => ({ data: { id: `l${statuses.length}` }, error: null }) }) }; } };
    return { insert: async () => ({ error: null }) };
  } };
  const result = await generateIdentityCandidates(admin, { respondContactId: "contact-2", normalizedPhone: "2221234567" });
  assert.equal(result.status, "conflict"); assert.deepEqual(statuses, ["conflict", "conflict"]);
});

test("sólo vínculo confirmed resuelve contratos vigentes/históricos y propiedades múltiples", async () => {
  const admin = { from(table) {
    if (table === "respond_identity_links") return resultQuery({ data: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", inmoadmin_client_id: "11111111-1111-4111-8111-111111111111", link_status: "confirmed", link_source: "human_confirmation", confidence: 1 }], error: null });
    if (table === "contracts") return resultQuery({ data: [{ id: "c1", property_id: "p1", status: "activo" }, { id: "c2", property_id: "p2", status: "vencido" }], error: null });
    if (table === "properties") return resultQuery({ data: [{ id: "p3", status: "ocupada" }], error: null });
    if (table === "respond_identity_audit") return { insert: async () => ({ error: null }) };
    throw new Error(table);
  } };
  const resolved = await resolveConfirmedContactIdentity(admin, "contact-3");
  assert.equal(resolved.resolved, true); assert.equal(resolved.contracts.filter((x) => x.active).length, 1);
  assert.equal(resolved.properties.length, 3); assert.equal(resolved.ambiguousPropertyContext, true);
  assert.deepEqual(resolved.missingInformation, ["insufficient_property_context"]);
});

test("candidate, revoked, conflict o ausencia nunca son utilizables por Auto-Real", async () => {
  for (const links of [[], [{ link_status: "candidate" }], [{ link_status: "revoked" }], [{ link_status: "conflict" }]]) {
    const admin = { from(table) { if (table === "respond_identity_links") return resultQuery({ data: links.filter((x) => x.link_status === "confirmed"), error: null }); return { insert: async () => ({ error: null }) }; } };
    const value = await resolveConfirmedContactIdentity(admin, "contact-4"); assert.equal(value.resolved, false); assert.equal(value.reason, "insufficient_identity_context");
  }
});

test("tool read-only está allowlisted y policy la deriva sólo con ID server-side", () => {
  assert.ok(READ_ONLY_SHADOW_TOOLS.includes("resolve_contact_identity"));
  const withId = deriveRequiredTools({ intent: "mantenimiento", message: "hay humedad", metadata: { respondContactId: "contact-5" } });
  assert.equal(withId.requiredNowTools[0].name, "resolve_contact_identity");
  const withoutId = deriveRequiredTools({ intent: "mantenimiento", message: "hay humedad", metadata: { contactName: "Juan" } });
  assert.ok(!withoutId.requiredNowTools.some((x) => x.name === "resolve_contact_identity"));
});

test("snapshot conserva contact ID opaco y no incorpora teléfono/email/nombre", () => {
  const snapshot = createShadowAiInputSnapshot({ provider: "respond_admin", direction: "inbound", sanitizedText: "Hay humedad", providerMetadata: { channelId: "544519", respondContactId: "contact-6", phone: "+522221234567", email: "x@y.test", name: "Persona" } });
  assert.equal(snapshot.providerMetadata.respondContactId, "contact-6");
  assert.equal(JSON.stringify(snapshot).includes("2221234567"), false); assert.equal(JSON.stringify(snapshot).includes("x@y.test"), false);
});

test("kill switch de Identity Bridge evita cambiar Auto-Real vigente", () => {
  const turn = { sanitizedText: "Seguimiento", lastInboundAt: "2026-08-25T12:00:00.000Z", turnKey: "t", messageIds: ["m"], priorContextMessages: [] };
  const conversation = { channel: "544519", respond_contact_id: "contact-6" };
  assert.equal(realShadowTurnEnvelope(turn, conversation, {}).providerMetadata.respondContactId, undefined);
  assert.equal(realShadowTurnEnvelope(turn, conversation, { SHADOW_IDENTITY_BRIDGE_ENABLED: "true" }).providerMetadata.respondContactId, "contact-6");
});

test("tool rechaza argumentos de escritura/no allowlisted", async () => {
  await assert.rejects(() => executeShadowReadOnlyTool({}, "update_contract", { contractId: "11111111-1111-4111-8111-111111111111" }), /tool_not_allowlisted/);
});

test("contrato ambiguo no selecciona inmueble arbitrariamente", async () => {
  const admin = { from(table) {
    if (table === "respond_identity_links") return resultQuery({ data: [{ id: "l", inmoadmin_client_id: "11111111-1111-4111-8111-111111111111", link_status: "confirmed", link_source: "human_confirmation", confidence: 1 }], error: null });
    if (table === "contracts") return resultQuery({ data: [{ id: "c1", property_id: "p1", status: "activo" }, { id: "c2", property_id: "p2", status: "activo" }], error: null });
    if (table === "properties") return resultQuery({ data: [], error: null });
    return { insert: async () => ({ error: null }) };
  } };
  const rows = await executeShadowReadOnlyTool(admin, "resolve_contact_identity", { respondContactId: "contact-7" });
  assert.equal(rows.filter((x) => x.entityType === "property").length, 2);
  assert.equal(rows[0].ambiguousPropertyContext, true);
});

test("migración aplica RLS/grants cerrados y audit append-only", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/202608250004_fase_3a_respond_identity_bridge.sql", import.meta.url), "utf8");
  const checks = fs.readFileSync(new URL("../supabase/migrations/202608250004_fase_3a_respond_identity_bridge_checks.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/i); assert.match(sql, /revoke all[\s\S]+anon, authenticated/i);
  assert.match(sql, /grant select, insert, update[\s\S]+service_role/i); assert.match(sql, /grant select, insert on public\.respond_identity_audit/i);
  assert.match(checks, /DELETE,TRUNCATE,REFERENCES,TRIGGER/); assert.match(checks, /audit must be append-only/);
  assert.match(sql, /find_respond_identity_candidates/); assert.match(sql, /p_phone_digest/); assert.doesNotMatch(sql, /returns table\([^)]*(?:phone|email|name)/i);
});

test("superficie humana está separada de Auto-Real y no expone credenciales/PII", () => {
  const api = fs.readFileSync(new URL("../pages/api/operaciones/shadow-identities.js", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");
  assert.match(api, /authorizeShadowAdministrator/); assert.match(api, /fetchRespondContact/);
  assert.doesNotMatch(api, /RESPOND_IO_TOKEN|respond.*(?:send|write)|\.from\(["']payments["']\)\.update/i);
  assert.doesNotMatch(ui, /SUPABASE_SERVICE_ROLE_KEY|RESPOND_IO_TOKEN/);
  assert.match(ui, /Sólo vínculos confirmados/); assert.match(ui, /Confirmar/); assert.match(ui, /Rechazar/); assert.match(ui, /Marcar conflicto/);
});

test("allowlist mantiene outbound, Respond writes y ERP writes fuera de Identity Bridge", () => {
  const context = fs.readFileSync(new URL("../lib/shadow/context.js", import.meta.url), "utf8");
  const bridge = fs.readFileSync(new URL("../lib/shadow/identityBridge.js", import.meta.url), "utf8");
  assert.doesNotMatch(context, /send|outbound|respondRequest/);
  assert.doesNotMatch(bridge, /\.from\(["'](?:payments|maintenance_tickets|contracts|properties)["']\)\.(?:insert|update|upsert|delete)/);
  assert.doesNotMatch(bridge, /fuzzy|similarity|ilike/);
});
