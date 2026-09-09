import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  evaluateExactPhoneCandidateReadOnly,
  evaluateExactPhoneCohortReadOnly,
  exactPhoneCandidateRef,
  validateExactPhoneCandidateRefs,
} from "../lib/shadow/exactPhoneReadOnlyEvaluator.js";
import { EXACT_PHONE_VALIDATED_CANDIDATE_REFS } from "../lib/shadow/exactPhoneValidatedRefs.js";

const linkId = "11111111-1111-4111-8111-111111111111";
const identityId = "22222222-2222-4222-8222-222222222222";
const propertyId = "33333333-3333-4333-8333-333333333333";
const contractId = "44444444-4444-4444-8444-444444444444";
const contactId = "opaque-contact-1";
const candidateRef = exactPhoneCandidateRef(linkId);
const phone = "+52 222 123 4567";

const digest = async (value) => {
  const normalized = String(value).replace(/\D/g, "");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

function query(result) {
  const chain = {
    select: () => chain, eq: () => chain, in: () => chain, limit: () => chain,
    maybeSingle: async () => result,
    then: (resolve) => resolve(result),
  };
  return chain;
}

function queuedAdmin(queues) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const value = queues[table]?.shift();
      if (value === undefined) throw new Error(`unexpected_table:${table}`);
      return query({ data: value, error: null });
    },
  };
}

const link = { id: linkId, respond_contact_id: contactId, client_identity_id: identityId, link_status: "candidate", link_source: "exact_phone_unique", confidence: 0.95, reason_code: "exact_full_phone_unique_candidate" };

async function tenantAdmin(overrides = {}) {
  const phoneDigest = await digest(phone);
  return queuedAdmin({
    client_identities: [[{ id: identityId, status: "active", phone_digest: phoneDigest }][0], [{ id: identityId }]],
    respond_identity_links: [[{ id: linkId, client_identity_id: identityId, link_status: "candidate" }], [{ id: linkId, respond_contact_id: contactId, link_status: "candidate" }]],
    client_identity_roles: [overrides.roles || [{ role_kind: "tenant", status: "active" }]],
    client_source_links: [overrides.sources || [{ source_type: "active_contract_tenant", source_id: contractId, role_kind: "tenant", link_status: "confirmed", revoked_at: null }]],
    contracts: [overrides.contracts || [{ id: contractId, property_id: propertyId, tenant_client_id: identityId, status: "active", start_date: "2026-01-01", end_date: "2027-01-01" }]],
    properties: [overrides.owned || [], overrides.property === undefined ? { id: propertyId, status: "active" } : overrides.property],
  });
}

test("fixture conserva exactamente las siete referencias opacas certificadas", () => {
  assert.deepEqual(EXACT_PHONE_VALIDATED_CANDIDATE_REFS, ["41e6ed66d3d1", "ed8a9ccc90bf", "6cc445029b1f", "ef4acc9b3ae8", "410cdab75f6f", "8cff19a394fc", "535a7956cd78"]);
  assert.equal(new Set(EXACT_PHONE_VALIDATED_CANDIDATE_REFS).size, 7);
  assert.ok(EXACT_PHONE_VALIDATED_CANDIDATE_REFS.every((ref) => /^[a-f0-9]{12}$/.test(ref)));
});

test("sólo acepta una lista explícita, única y contenida en la cohorte certificada", () => {
  assert.deepEqual(validateExactPhoneCandidateRefs(EXACT_PHONE_VALIDATED_CANDIDATE_REFS), EXACT_PHONE_VALIDATED_CANDIDATE_REFS);
  assert.throws(() => validateExactPhoneCandidateRefs([]), /invalid_exact_phone_candidate_refs/);
  assert.throws(() => validateExactPhoneCandidateRefs([EXACT_PHONE_VALIDATED_CANDIDATE_REFS[0], EXACT_PHONE_VALIDATED_CANDIDATE_REFS[0]]), /invalid_exact_phone_candidate_refs/);
  assert.throws(() => validateExactPhoneCandidateRefs(["aaaaaaaaaaaa"]), /invalid_exact_phone_candidate_refs/);
});

test("tenant 1:1 con teléfono, rol, propiedad y contrato vigentes es confirmable sin exponer identificadores", async () => {
  const admin = await tenantAdmin();
  const result = await evaluateExactPhoneCandidateReadOnly(admin, { candidateRef, link, currentContact: { id: contactId, phone, firstName: "PII no usada" }, effectiveAt: "2026-09-08T12:00:00Z" });
  assert.deepEqual(result, { candidateRef, contactExists: true, phoneDigestMatches: true, oneToOne: true, conflict: false, role: "tenant", propertyResolved: true, contractCurrent: true, roleAmbiguous: false, propertyAmbiguous: false, ambiguous: false, confirmable: true, reason: null });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${contactId}|${identityId}|${propertyId}|${contractId}|PII`));
  assert.ok(admin.calls.every((table) => !["respond_identity_audit"].includes(table)));
});

test("mismatch de teléfono y conflicto confirmado fallan cerrado", async () => {
  const mismatchAdmin = await tenantAdmin();
  const mismatch = await evaluateExactPhoneCandidateReadOnly(mismatchAdmin, { candidateRef, link, currentContact: { id: contactId, phone: "+52 222 999 9999" } });
  assert.equal(mismatch.confirmable, false); assert.equal(mismatch.reason, "canonical_phone_mismatch");

  const phoneDigest = await digest(phone);
  const conflictAdmin = queuedAdmin({
    client_identities: [{ id: identityId, status: "active", phone_digest: phoneDigest }, [{ id: identityId }]],
    respond_identity_links: [[{ id: "other", client_identity_id: "55555555-5555-4555-8555-555555555555", link_status: "confirmed" }], [{ id: linkId, respond_contact_id: contactId, link_status: "candidate" }]],
    client_identity_roles: [[]], client_source_links: [[]], contracts: [[]], properties: [[]],
  });
  const conflict = await evaluateExactPhoneCandidateReadOnly(conflictAdmin, { candidateRef, link, currentContact: { id: contactId, phone } });
  assert.equal(conflict.confirmable, false); assert.equal(conflict.reason, "confirmed_link_conflict"); assert.equal(conflict.conflict, true);
});

test("múltiples roles y propiedades permanecen ambiguos", async () => {
  const admin = await tenantAdmin({ roles: [{ role_kind: "tenant", status: "active" }, { role_kind: "owner", status: "active" }] });
  const result = await evaluateExactPhoneCandidateReadOnly(admin, { candidateRef, link, currentContact: { id: contactId, phone } });
  assert.equal(result.confirmable, false); assert.equal(result.reason, "ambiguous_role_context"); assert.equal(result.roleAmbiguous, true); assert.equal(result.ambiguous, true);
});

test("contacto inexistente y contrato vencido fallan cerrado con motivo estable", async () => {
  const missing = await evaluateExactPhoneCandidateReadOnly(await tenantAdmin(), { candidateRef, link, currentContact: null });
  assert.equal(missing.reason, "respond_contact_not_found"); assert.equal(missing.contactExists, false);
  const expiredAdmin = await tenantAdmin({ contracts: [{ id: contractId, property_id: propertyId, tenant_client_id: identityId, status: "expired", start_date: "2025-01-01", end_date: "2026-01-01" }] });
  const expired = await evaluateExactPhoneCandidateReadOnly(expiredAdmin, { candidateRef, link, currentContact: { id: contactId, phone }, effectiveAt: "2026-09-08T12:00:00Z" });
  assert.equal(expired.confirmable, false); assert.equal(expired.reason, "contract_not_current");
});

test("cohorte reporta referencia ausente sin consultar Respond ni intentar escritura", async () => {
  const ref = EXACT_PHONE_VALIDATED_CANDIDATE_REFS[0];
  let respondCalls = 0;
  const admin = queuedAdmin({ respond_identity_links: [[]] });
  const results = await evaluateExactPhoneCohortReadOnly(admin, { references: [ref], fetchContact: async () => { respondCalls += 1; } });
  assert.equal(results[0].reason, "candidate_not_found");
  assert.equal(results[0].contactExists, false);
  assert.equal(respondCalls, 0);
  assert.deepEqual(admin.calls, ["respond_identity_links"]);
});

test("arquitectura del endpoint es POST autenticado, same-origin y estrictamente read-only", () => {
  const endpoint = fs.readFileSync(new URL("../pages/api/operaciones/shadow-exact-phone-preflight.js", import.meta.url), "utf8");
  const evaluator = fs.readFileSync(new URL("../lib/shadow/exactPhoneReadOnlyEvaluator.js", import.meta.url), "utf8");
  assert.match(endpoint, /authorizeShadowAdministrator/);
  assert.match(endpoint, /sameOriginAdminRequest/);
  assert.match(endpoint, /req\.method !== "POST"/);
  for (const source of [endpoint, evaluator]) assert.doesNotMatch(source, /\.(?:insert|upsert|delete|rpc)\(|confirm_exact_phone_respond_identity_link/);
  assert.equal((evaluator.match(/\.update\(/g) || []).length, 1); // createHash().update(), no datastore update.
  assert.doesNotMatch(endpoint, /\.update\(/);
  assert.doesNotMatch(endpoint, /phoneDigest|respondContactId|clientIdentityId|propertyId|contractId/);
});
