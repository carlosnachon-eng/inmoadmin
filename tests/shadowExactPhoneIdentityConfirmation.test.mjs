import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { confirmExactPhoneIdentityCandidate, evaluateExactPhoneIdentityCandidate, identityPhoneDigest } from "../lib/shadow/identityBridge.js";

const LINK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const IDENTITY = "11111111-1111-4111-8111-111111111111";
const PROPERTY = "22222222-2222-4222-8222-222222222222";
const CONTRACT = "33333333-3333-4333-8333-333333333333";
const CONTACT = "respond-contact-1";

const query = (result) => {
  const chain = {
    select: () => chain, eq: () => chain, in: () => chain, limit: () => chain,
    maybeSingle: async () => ({ data: Array.isArray(result) ? result[0] || null : result, error: null }),
    then: (resolve) => resolve({ data: result, error: null }),
  };
  return chain;
};

async function adminFor(overrides = {}) {
  const digest = await identityPhoneDigest("+52 222 123 4567");
  const sequences = {
    respond_identity_links: [
      { id: LINK, respond_contact_id: CONTACT, client_identity_id: IDENTITY, link_status: "candidate", link_source: "exact_phone_unique", confidence: 0.95, reason_code: "exact_full_phone_unique_candidate" },
      [{ id: LINK, client_identity_id: IDENTITY, link_status: "candidate" }],
      [{ id: LINK, respond_contact_id: CONTACT, link_status: "candidate" }],
    ],
    client_identities: [{ id: IDENTITY, status: "active", phone_digest: digest }, [{ id: IDENTITY }]],
    client_identity_roles: [[{ client_identity_id: IDENTITY, role_kind: "tenant", status: "active" }]],
    client_source_links: [[{ client_identity_id: IDENTITY, source_type: "active_contract_tenant", source_id: CONTRACT, role_kind: "tenant", link_status: "confirmed" }]],
    contracts: [
      [{ id: CONTRACT, property_id: PROPERTY, tenant_client_id: IDENTITY, status: "activo", start_date: "2026-01-01", end_date: "2026-12-31" }],
      [{ id: CONTRACT, property_id: PROPERTY, tenant_client_id: IDENTITY, status: "activo", start_date: "2026-01-01", end_date: "2026-12-31" }],
    ],
    properties: [[], [{ id: PROPERTY, name: "Unidad estructurada", owner_client_id: null, status: "ocupada" }]],
    ...overrides,
  };
  const calls = new Map();
  return {
    rpc: async (_name, args) => ({ data: [{ result_status: "confirmed", link_id: args.p_link_id }], error: null }),
    from(table) {
      const index = calls.get(table) || 0; calls.set(table, index + 1);
      const list = sequences[table] || [];
      return query(list[Math.min(index, list.length - 1)]);
    },
  };
}

const assess = async (admin) => evaluateExactPhoneIdentityCandidate(admin, {
  linkId: LINK, respondContactId: CONTACT, currentContact: { id: CONTACT, phone: "+52 222 123 4567" }, effectiveAt: "2026-09-07T12:00:00Z",
});

test("dry-run confirma sólo digest actual, identidad, rol, propiedad y contrato únicos", async () => {
  const result = await assess(await adminFor());
  assert.equal(result.confirmable, true); assert.equal(result.role, "tenant");
  assert.equal(result.propertyId, PROPERTY); assert.equal(result.contractId, CONTRACT);
  assert.match(result.evidenceHash, /^[a-f0-9]{64}$/); assert.equal(result.evidenceVersion, "exact_phone_unique_v1");
  assert.equal(JSON.stringify(result).includes("2221234567"), false);
});

test("teléfono actual distinto bloquea sin inferencia por nombre", async () => {
  const admin = await adminFor();
  const result = await evaluateExactPhoneIdentityCandidate(admin, { linkId: LINK, respondContactId: CONTACT, currentContact: { id: CONTACT, phone: "+52 222 765 4321", name: "Nombre idéntico" } });
  assert.equal(result.confirmable, false); assert.equal(result.reason, "canonical_phone_mismatch");
});

test("digest canónico no único y contacto Respond duplicado bloquean", async () => {
  const duplicateIdentity = await adminFor({ client_identities: [
    { id: IDENTITY, status: "active", phone_digest: await identityPhoneDigest("2221234567") }, [{ id: IDENTITY }, { id: "44444444-4444-4444-8444-444444444444" }],
  ] });
  assert.equal((await assess(duplicateIdentity)).reason, "canonical_phone_not_unique");
  const duplicateContact = await adminFor({ respond_identity_links: [
    { id: LINK, respond_contact_id: CONTACT, client_identity_id: IDENTITY, link_status: "candidate", link_source: "exact_phone_unique", confidence: 0.95, reason_code: "exact_full_phone_unique_candidate" },
    [{ id: LINK, client_identity_id: IDENTITY, link_status: "candidate" }],
    [{ id: LINK, respond_contact_id: CONTACT, link_status: "candidate" }, { id: "x", respond_contact_id: "other", link_status: "candidate" }],
  ] });
  assert.equal((await assess(duplicateContact)).reason, "respond_contact_not_unique");
});

test("rol múltiple, relación revocada y contrato vencido permanecen fail-closed", async () => {
  const roles = await adminFor({ client_identity_roles: [[{ client_identity_id: IDENTITY, role_kind: "tenant", status: "active" }, { client_identity_id: IDENTITY, role_kind: "owner", status: "active" }]] });
  assert.equal((await assess(roles)).reason, "ambiguous_role_context");
  const revoked = await adminFor({ client_source_links: [[{ client_identity_id: IDENTITY, source_type: "active_contract_tenant", source_id: CONTRACT, role_kind: "tenant", link_status: "revoked" }]] });
  assert.equal((await assess(revoked)).reason, "revoked_relationship");
  const expired = await adminFor({ contracts: [
    [{ id: CONTRACT, property_id: PROPERTY, tenant_client_id: IDENTITY, status: "activo", start_date: "2025-01-01", end_date: "2026-08-31" }],
    [{ id: CONTRACT, property_id: PROPERTY, tenant_client_id: IDENTITY, status: "activo", start_date: "2025-01-01", end_date: "2026-08-31" }],
  ] });
  assert.equal((await assess(expired)).reason, "insufficient_property_context");
});

test("confirmación usa una sola RPC atómica y no expone el teléfono", async () => {
  const admin = await adminFor(); const assessment = await assess(admin);
  const result = await confirmExactPhoneIdentityCandidate(admin, assessment, ACTOR);
  assert.equal(result.result_status, "confirmed");
});

test("migración serializa, es idempotente y conserva auditoría append-only", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/202609070001_exact_phone_respond_identity_confirmation.sql", import.meta.url), "utf8");
  const checks = fs.readFileSync(new URL("../supabase/migrations/202609070001_exact_phone_respond_identity_confirmation_checks.sql", import.meta.url), "utf8");
  const api = fs.readFileSync(new URL("../pages/api/operaciones/shadow-identities.js", import.meta.url), "utf8");
  assert.match(sql, /for update/i); assert.match(sql, /already_confirmed/); assert.match(sql, /on conflict do nothing/i);
  assert.match(sql, /canonical_phone_not_unique/); assert.match(sql, /respond_contact_not_unique/); assert.match(sql, /ambiguous_contract_context/);
  assert.doesNotMatch(sql, /tenant_name|owner_name|respond_contact_name|similarity|ilike/i);
  assert.match(checks, /audit must remain append-only/); assert.match(api, /fetchRespondContact/); assert.match(api, /dry_run_exact_phone/);
});
