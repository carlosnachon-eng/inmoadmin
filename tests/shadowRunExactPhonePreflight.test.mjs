import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { evaluateRunContactExactPhoneReadOnly, loadVerifiedRunContacts } from "../lib/shadow/runExactPhonePreflight.js";
import { sanitizeRunExactPhonePreflightResults } from "../lib/shadow/runExactPhonePreflightApi.js";
import { RUN_EXACT_PHONE_PREFLIGHT_REFS } from "../lib/shadow/runExactPhonePreflightRefs.js";

const identityId = "22222222-2222-4222-8222-222222222222";
const propertyId = "33333333-3333-4333-8333-333333333333";
const contractId = "44444444-4444-4444-8444-444444444444";
const contactId = "respond-contact-safe";
const phone = "+52 222 123 4567";

function query(result) {
  const chain = { select: () => chain, eq: () => chain, in: () => chain, gte: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: async () => result, then: (resolve) => resolve(result) };
  return chain;
}
function queuedAdmin(queues) {
  const calls = [];
  return { calls, from(table) { calls.push(table); const value = queues[table]?.shift(); if (value === undefined) throw new Error(`unexpected_table:${table}`); return query({ data: value, error: null }); } };
}
const roleContext = (identityRows) => queuedAdmin({
  client_identities: [identityRows],
  respond_identity_links: [[], []],
  client_identity_roles: [[{ role_kind: "tenant", status: "active" }]],
  client_source_links: [[{ source_type: "active_contract_tenant", source_id: contractId, link_status: "confirmed", revoked_at: null }]],
  contracts: [[{ id: contractId, property_id: propertyId, status: "active", start_date: "2026-01-01", end_date: "2027-01-01" }]],
  properties: [[], { id: propertyId, status: "active" }],
});

test("run con asociación estructurada y candidato único queda confirmable sin PII", async () => {
  const admin = roleContext([{ id: identityId, status: "active" }]);
  const result = await evaluateRunContactExactPhoneReadOnly(admin, { runRef: RUN_EXACT_PHONE_PREFLIGHT_REFS[0], contactId, currentContact: { id: contactId, phone, firstName: "PII" }, effectiveAt: "2026-09-17T18:00:00Z" });
  assert.equal(result.exactPhoneUnique, true); assert.equal(result.oneToOne, true); assert.equal(result.confirmable, true);
  assert.equal(result.role, "tenant"); assert.equal(result.propertyRelationshipResolved, true); assert.equal(result.contractCurrent, true);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${contactId}|${identityId}|${propertyId}|${contractId}|PII|2221234567`));
});

test("múltiples candidatos exactos fallan cerrado", async () => {
  const admin = queuedAdmin({ client_identities: [[{ id: identityId }, { id: "55555555-5555-4555-8555-555555555555" }]] });
  const result = await evaluateRunContactExactPhoneReadOnly(admin, { runRef: RUN_EXACT_PHONE_PREFLIGHT_REFS[0], contactId, currentContact: { id: contactId, phone } });
  assert.equal(result.confirmable, false); assert.equal(result.exactPhoneUnique, false); assert.equal(result.conflict, true); assert.equal(result.blocker, "multiple_exact_phone_candidates");
});

test("run sin candidato exacto permanece fail-closed", async () => {
  const admin = queuedAdmin({ client_identities: [[]] });
  const result = await evaluateRunContactExactPhoneReadOnly(admin, { runRef: RUN_EXACT_PHONE_PREFLIGHT_REFS[1], contactId, currentContact: { id: contactId, phone } });
  assert.equal(result.confirmable, false); assert.equal(result.blocker, "no_exact_phone_candidate");
});

test("run sin asociación verificable se marca unattributed sin consultar conversaciones ni Respond", async () => {
  const admin = queuedAdmin({ shadow_ai_runs: [[]] });
  const results = await loadVerifiedRunContacts(admin, RUN_EXACT_PHONE_PREFLIGHT_REFS);
  assert.equal(results.length, 4); assert.ok(results.every((row) => row.blocker === "unattributed" && row.contactId === null));
  assert.deepEqual(admin.calls, ["shadow_ai_runs"]);
});

test("asociación usa exclusivamente run → message → conversation → Respond contact", async () => {
  const runs = RUN_EXACT_PHONE_PREFLIGHT_REFS.map((reference, index) => ({ id: `run-${index}`, message_id: `message-${index}`, created_at: "2026-09-18T00:00:00Z", reference }));
  const admin = queuedAdmin({
    shadow_ai_runs: [runs],
    shadow_messages: runs.map((_, index) => ({ id: `message-${index}`, conversation_id: `conversation-${index}` })),
    shadow_conversations: runs.map((_, index) => ({ id: `conversation-${index}`, provider: "respond_admin", channel: "544519", respond_contact_id: `contact-${index}` })),
  });
  const results = await loadVerifiedRunContacts(admin, RUN_EXACT_PHONE_PREFLIGHT_REFS, (id) => runs.find((run) => run.id === id).reference);
  assert.deepEqual(results.map((row) => row.runRef), RUN_EXACT_PHONE_PREFLIGHT_REFS);
  assert.deepEqual(results.map((row) => row.contactId), ["contact-0", "contact-1", "contact-2", "contact-3"]);
});

test("arquitectura del preflight es admin, POST, cohorte fija y cero escrituras", () => {
  const files = [
    "../lib/shadow/runExactPhonePreflight.js",
    "../lib/shadow/runExactPhonePreflightApi.js",
    "../pages/api/operaciones/shadow-run-exact-phone-preflight.js",
  ].map((path) => fs.readFileSync(new URL(path, import.meta.url), "utf8"));
  const source = files.join("\n");
  assert.match(source, /authorizeShadowAdministrator/); assert.match(source, /sameOriginAdminRequest/); assert.match(source, /role_id !== "admin"/);
  assert.match(source, /RUN_EXACT_PHONE_PREFLIGHT_REFS/); assert.doesNotMatch(source, /req\.body/);
  assert.doesNotMatch(source, /\.(?:insert|upsert|delete|rpc)\(/);
  assert.equal((source.match(/\.update\(/g) || []).length, 1); // createHash().update(), no datastore update.
  assert.doesNotMatch(source, /respond_identity_audit|generateIdentityCandidates|reviewIdentityLink/);
});

test("respuesta pública conserva sólo campos sanitizados", () => {
  const [result] = sanitizeRunExactPhonePreflightResults([{ runRef: "85ced7b69096", contactRef: "abcdef123456", exactPhoneUnique: true, oneToOne: true, conflict: false, role: "tenant", propertyRelationshipResolved: true, contractCurrent: true, confirmable: true, blocker: null, phone: phone, clientIdentityId: identityId }]);
  assert.deepEqual(Object.keys(result), ["run", "contact_ref", "exact_phone_unique", "one_to_one", "conflict", "role", "property_relationship_resolved", "contract_current", "confirmable", "blocker"]);
  assert.doesNotMatch(JSON.stringify(result), /2221234567|22222222-2222/);
});
