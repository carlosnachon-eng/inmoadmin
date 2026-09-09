import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { confirmCertifiedExactPhoneCohort } from "../lib/shadow/exactPhoneConfirmation.js";
import { createExactPhoneConfirmationHandler } from "../lib/shadow/exactPhoneConfirmationApi.js";
import { EXACT_PHONE_VALIDATED_CANDIDATE_REFS } from "../lib/shadow/exactPhoneValidatedRefs.js";

const ids = EXACT_PHONE_VALIDATED_CANDIDATE_REFS.map((_, i) => `${String(i + 1).padStart(8, "0")}-1111-4111-8111-111111111111`);
const identities = EXACT_PHONE_VALIDATED_CANDIDATE_REFS.map((_, i) => `${String(i + 11).padStart(8, "0")}-2222-4222-8222-222222222222`);
const links = EXACT_PHONE_VALIDATED_CANDIDATE_REFS.map((candidateRef, i) => ({
  id: ids[i], respond_contact_id: `contact-${i}`, client_identity_id: identities[i], link_status: "candidate",
  link_source: "exact_phone_unique", confidence: 0.95, reason_code: "exact_full_phone_unique_candidate", candidateRef,
}));

function adminFixture(rows = links) {
  const rpcCalls = [];
  const query = { select: () => query, in: () => query, eq: () => query, limit: async () => ({ data: rows, error: null }) };
  return { rpcCalls, from: () => query, rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: [{ result_status: "confirmed", result_reason: null }], error: null }; } };
}
const loadCandidates = async () => links.map((link) => ({ candidateRef: link.candidateRef, link }));

test("cohorte server-side es exactamente 7/7 y el digest nunca viene del request", async () => {
  const admin = adminFixture();
  const result = await confirmCertifiedExactPhoneCohort({ admin, loadCandidates, actor: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", active: true, role_id: "admin" }, fetchContact: async (id) => ({ id, phone: "+52 222 123 4567" }), effectiveAt: "2026-09-09T12:00:00Z" });
  assert.equal(result.length, 7); assert.equal(admin.rpcCalls.length, 7);
  assert.deepEqual(admin.rpcCalls.map((call) => call.args.p_candidate_ref), EXACT_PHONE_VALIDATED_CANDIDATE_REFS);
  assert.ok(admin.rpcCalls.every((call) => /^[a-f0-9]{64}$/.test(call.args.p_observed_phone_digest)));
});

test("actor no-admin o inactivo se rechaza antes de leer Respond/RPC", async () => {
  for (const actor of [{ active: true, role_id: "coord_operaciones" }, { active: false, role_id: "admin" }]) {
    const admin = adminFixture(); let reads = 0;
    await assert.rejects(confirmCertifiedExactPhoneCohort({ admin, loadCandidates, actor: { id: "x", ...actor }, fetchContact: async () => { reads++; } }), /actor_not_authorized/);
    assert.equal(reads, 0); assert.equal(admin.rpcCalls.length, 0);
  }
});

test("Respond actual faltante o distinto se transmite sólo como rechazo fail-closed", async () => {
  const admin = adminFixture();
  await confirmCertifiedExactPhoneCohort({ admin, loadCandidates, actor: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", active: true, role_id: "admin" }, fetchContact: async () => null });
  assert.ok(admin.rpcCalls.every((call) => call.args.p_observed_phone_digest === null && call.args.p_server_rejection_reason === "respond_contact_not_found"));
});

test("endpoint exige POST, admin activo, same-origin y gate explícito", async () => {
  const response = () => ({ statusCode: 0, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  process.env.SHADOW_IDENTITY_CONFIRMATION_ENABLED = "true";
  for (const actor of [null, { id: "x", active: false, role_id: "admin" }, { id: "x", active: true, role_id: "coord_operaciones" }]) {
    const res = response(); await createExactPhoneConfirmationHandler({ authorize: async () => actor, isSameOrigin: () => true })({ method: "POST" }, res); assert.equal(res.statusCode, 403);
  }
  const res = response(); await createExactPhoneConfirmationHandler({ authorize: async () => ({ id: "x", active: true, role_id: "admin" }), isSameOrigin: () => false })({ method: "POST" }, res); assert.equal(res.statusCode, 403);
});

test("SQL certifica octava referencia, actor, locks contacto+identidad, idempotencia y cero teléfono persistido", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/202609090001_exact_phone_respond_identity_confirmation_7of7.sql", import.meta.url), "utf8");
  assert.match(sql, /candidate_ref_not_in_certified_cohort/);
  assert.match(sql, /candidate_ref_link_mismatch/);
  assert.match(sql, /confirm_exact_phone_respond_identity_link_core/);
  assert.match(sql, /revoke all on function public\.confirm_exact_phone_respond_identity_link_core[\s\S]*service_role/);
  for (const ref of EXACT_PHONE_VALIDATED_CANDIDATE_REFS) assert.match(sql, new RegExp(ref));
  assert.equal((sql.match(/[a-f0-9]{12}/g) || []).filter((x) => EXACT_PHONE_VALIDATED_CANDIDATE_REFS.includes(x)).length, 7);
  assert.match(sql, /p\.active is true and p\.role_id='admin'/);
  assert.match(sql, /'respond:'[\s\S]*'identity:'/);
  assert.match(sql, /respond_identity_links_confirmed_identity_uidx/);
  assert.match(sql, /already_confirmed/); assert.match(sql, /on conflict do nothing/);
  assert.doesNotMatch(sql, /phone['"]\s*,|phone_number|normalizedPhone/i);
  assert.match(sql, /canonical_phone_mismatch|canonical_phone_not_unique|confirmed_link_conflict|ambiguous_role_context|ambiguous_property_context|ambiguous_contract_context/);
});

test("dos workers se limitan a RPCs individuales; exclusión real queda en locks/índice DB", async () => {
  const admin = adminFixture(links.slice(0, 1));
  const oneCandidate = async () => [{ candidateRef: links[0].candidateRef, link: links[0] }];
  const args = { admin, loadCandidates: oneCandidate, actor: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", active: true, role_id: "admin" }, fetchContact: async (id) => ({ id, phone: "+52 222 123 4567" }) };
  await Promise.all([confirmCertifiedExactPhoneCohort(args), confirmCertifiedExactPhoneCohort(args)]);
  assert.equal(admin.rpcCalls.length, 2);
  assert.ok(admin.rpcCalls.every((call) => call.name === "confirm_exact_phone_respond_identity_link"));
});
