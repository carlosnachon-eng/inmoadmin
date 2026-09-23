import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCondominiumIdentityReviewHandler } from "../lib/shadow/condominiumIdentityApi.js";
import { condominiumIdentityRef } from "../lib/shadow/condominiumIdentity.js";
import { checkCondominiumResolver } from "../lib/shadow/condominiumResolverCheck.js";
import { sameOriginAdminRequest } from "../lib/shadow/identityBootstrap.js";
import { confirmedCondoTables, condoActor, fixtureUuid } from "./helpers/condominiumIdentityFixture.mjs";

const gatesOff = Object.freeze(Object.fromEntries([
  "SHADOW_CLIENT_RECONCILIATION_PREPARE_ENABLED", "SHADOW_CLIENT_RECONCILIATION_WRITE_ENABLED",
  "SHADOW_IDENTITY_CONFIRMATION_ENABLED", "SHADOW_ADMIN_OUTBOUND_ENABLED", "SHADOW_OUTBOUND_ENABLED",
  "SHADOW_ADMIN_WORK_R1_ENABLED", "SHADOW_ADMIN_OUTBOUND_CANARY_ENABLED",
].map((key) => [key, "false"])));
const candidateId = fixtureUuid(301);
const candidateRef = await condominiumIdentityRef("candidate", candidateId);
const body = { action: "condominium_resolver_check", candidateRef };
const headers = { origin: "https://synthetic.example", host: "synthetic.example" };
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
function fixture() {
  const t = confirmedCondoTables();
  t.client_reconciliation_candidates = [{ id: candidateId, candidate_status: "confirmed", evidence_version: "condominium_owner_review_v1",
    role_kind: "owner", client_identity_id: t.client_identities[0].id, respond_contact_id: t.respond_identity_links[0].respond_contact_id }];
  t.client_reconciliation_candidate_sources = [{ candidate_id: candidateId, source_type: "condominium_unit_owner", source_id: t.unidades_condominio[0].id, condominium_id: t.condominios[0].id }];
  return t;
}
// Execute the real resolver against SELECT-only synthetic storage. Every write/RPC fails.
function readOnlyAdmin(tables, failRead = false) {
  const reads = [], writes = [];
  const forbidden = (method) => () => { writes.push(method); throw new Error(`unexpected_${method}`); };
  return { reads, writes, rpc: forbidden("rpc"), from(table) {
    let matches = [...(tables[table] || [])], fields = null;
    const q = {
      select(columns) { fields = columns.split(","); reads.push({ table, columns }); return q; },
      eq(k, v) { matches = matches.filter((r) => r[k] === v); return q; },
      in(k, values) { matches = matches.filter((r) => values.includes(r[k])); return q; },
      order(k) { matches.sort((a, b) => String(a[k]).localeCompare(String(b[k]))); return q; },
      range(a, b) { matches = matches.slice(a, b + 1); return q; },
      then(ok, fail) {
        return Promise.resolve(failRead ? { data: null, error: { message: "private-record-value", details: "private-token" } }
          : { data: matches.map((row) => Object.fromEntries(fields.map((key) => [key, row[key]]))), error: null }).then(ok, fail);
      },
      ...Object.fromEntries(["insert", "update", "delete", "upsert"].map((method) => [method, forbidden(method)])),
    };
    return q;
  } };
}
async function invoke({ tables = fixture(), actor = condoActor, method = "POST", requestBody = body, requestHeaders = headers, failRead = false } = {}) {
  const admin = readOnlyAdmin(tables, failRead), res = response(); let adminCreated = 0, respondCalls = 0;
  await createCondominiumIdentityReviewHandler({ authorize: async () => actor, isSameOrigin: sameOriginAdminRequest, env: gatesOff,
    createAdminClient() { adminCreated++; return admin; }, fetchContact() { respondCalls++; throw new Error("must_not_call_respond"); },
  })({ method, headers: requestHeaders, body: requestBody }, res);
  assert.deepEqual(admin.writes, []); assert.equal(respondCalls, 0);
  assert.equal(res.headers["Cache-Control"], "private, no-store, max-age=0");
  return { res, admin, adminCreated };
}

test("confirmed candidate -> actual pre-3A resolver PASS with all seven gates OFF, no writes or PII", async () => {
  const t = fixture(), before = JSON.stringify(t);
  const { res, admin } = await invoke({ tables: t });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.result, { candidateRef, resolved: true, identityDomain: "condominium", roles: ["owner"],
    linkSource: "condominium_owner_admin_review", unitRef: await condominiumIdentityRef("unit", t.unidades_condominio[0].id),
    condominiumRef: await condominiumIdentityRef("condominium", t.condominios[0].id), ambiguousUnitContext: false });
  assert.equal(JSON.stringify(t), before);
  assert.ok(admin.reads.some((r) => r.table === "client_identity_roles"));
  assert.ok(admin.reads.some((r) => r.table === "unidades_condominio"));
  assert.ok(admin.reads.some((r) => r.table === "respond_identity_links"));
  assert.ok(!admin.reads.some((r) => /audit|shadow_ai_run|outbound/.test(r.table)));
  assert.doesNotMatch(JSON.stringify(res.body), /respond_contact_id|phone|digest|internalId|client_identity_id|synthetic-condo|525550|1111-4111/);
  assert.ok(Object.values(gatesOff).every((v) => v === "false"));
});

for (const status of ["requires_review", "revoked", "skipped"]) test(`unconfirmed ${status} rejected without resolving`, async () => {
  const t = fixture(); t.client_reconciliation_candidates[0].candidate_status = status;
  const { res, admin } = await invoke({ tables: t });
  assert.equal(res.code, 409); assert.equal(res.body.error, "candidate_not_confirmed");
  assert.ok(!admin.reads.some((r) => r.table === "respond_identity_links"));
});

test("nonexistent or other-domain candidate -> 404", async () => {
  for (const t of [{}, fixture()]) {
    if (t.client_reconciliation_candidates) t.client_reconciliation_candidates[0].evidence_version = "other";
    const { res } = await invoke({ tables: t });
    assert.equal(res.code, 404); assert.equal(res.body.error, "candidate_not_found");
  }
});

for (const actor of [null, { ...condoActor, active: false }, { ...condoActor, role_id: "asesor" }, { ...condoActor, role_id: "coord_operaciones" }]) {
  test(`only active admin: ${actor?.role_id || "no session"}/${actor?.active} -> 403, zero DB`, async () => {
    const { res, adminCreated } = await invoke({ actor });
    assert.equal(res.code, 403); assert.equal(res.body.error, "admin_required"); assert.equal(adminCreated, 0);
  });
}
test("same-origin absent or invalid -> 403, zero DB", async () => {
  for (const requestHeaders of [{}, { ...headers, origin: "https://evil.example" }]) {
    const { res, adminCreated } = await invoke({ requestHeaders });
    assert.equal(res.code, 403); assert.equal(res.body.error, "invalid_origin"); assert.equal(adminCreated, 0);
  }
});
test("POST only, opaque ref only; UUID, contact ID and extra metadata rejected before DB", async () => {
  assert.equal((await invoke({ method: "GET" })).res.code, 405);
  for (const requestBody of [
    { ...body, candidateRef: candidateId }, { ...body, candidateRef: "synthetic-condo-1" }, { ...body, candidateRef: null },
    { ...body, candidateId }, { ...body, respondContactId: "synthetic" }, { ...body, metadata: {} },
  ]) {
    const { res, adminCreated } = await invoke({ requestBody });
    assert.equal(res.code, 400); assert.equal(adminCreated, 0);
  }
});
test("other condominium actions remain disabled with gates OFF, no DB/RPC", async () => {
  for (const action of ["list", "prepare", "confirm", "reject", "revoke", "resolver_check_extra"]) {
    const { res, adminCreated } = await invoke({ requestBody: { action: `condominium_${action}` } });
    assert.equal(res.code, 409); assert.equal(res.body.error, "condominium_review_disabled"); assert.equal(adminCreated, 0);
  }
});

for (const [name, change, reason] of [
  ["inactive identity", (t) => { t.client_identities[0].status = "revoked"; }, "canonical_identity_inactive"],
  ["wrong role", (t) => { t.client_identity_roles[0].role_kind = "tenant"; }, "canonical_role_conflict"],
  ["inactive unit", (t) => { t.unidades_condominio[0].activo = false; }, "inactive_or_changed_condominium_relationship"],
  ["inactive condominium", (t) => { t.condominios[0].activo = false; }, "inactive_or_changed_condominium_relationship"],
  ["source changed", (t) => { t.unidades_condominio[0].identity_owner_version = 2; }, "source_relationship_changed"],
  ["source phone changed", (t) => { t.unidades_condominio[0].propietario_telefono = "5550100088"; }, "approved_source_phone_changed"],
  ["no live link", (t) => { t.respond_identity_links[0].link_status = "revoked"; }, "insufficient_identity_context"],
  ["two live links", (t) => { t.respond_identity_links.push({ ...t.respond_identity_links[0], id: fixtureUuid(55) }); }, "identity_conflict"],
  ["different identity", (t) => { t.client_reconciliation_candidates[0].client_identity_id = fixtureUuid(88); }, "candidate_identity_mismatch"],
  ["different expected unit", (t) => { t.client_reconciliation_candidate_sources[0].source_id = fixtureUuid(88); }, "candidate_unit_mismatch"],
  ["different expected condominium", (t) => { t.client_reconciliation_candidate_sources[0].condominium_id = fixtureUuid(88); }, "candidate_unit_mismatch"],
]) test(`${name}: real resolver fails closed with sanitized reason`, async () => {
  const t = fixture(); change(t);
  const { res } = await invoke({ tables: t });
  assert.equal(res.code, 200); assert.equal(res.body.result.resolved, false); assert.equal(res.body.result.reason, reason);
});

test("multiple approved units are not silently selected", async () => {
  const t = { ...fixture(), ...confirmedCondoTables({ count: 2 }) };
  const { res } = await invoke({ tables: t });
  assert.equal(res.body.result.resolved, false); assert.equal(res.body.result.ambiguousUnitContext, true);
  assert.equal(res.body.result.unitRef, null); assert.equal(res.body.result.reason, "insufficient_unit_context");
});
test("candidate reference lookup paginates beyond the first 200 without loading PII", async () => {
  const t = fixture();
  t.client_reconciliation_candidates.unshift(...Array.from({ length: 220 }, (_, i) => ({ id: fixtureUuid(i + 1), evidence_version: "condominium_owner_review_v1", candidate_status: "requires_review" })));
  const { res, admin } = await invoke({ tables: t });
  assert.equal(res.body.result.resolved, true);
  assert.equal(admin.reads.filter((r) => r.table === "client_reconciliation_candidates" && r.columns === "id").length, 2);
});
test("database errors never leak raw errors, PII or credentials", async () => {
  const { res } = await invoke({ failRead: true });
  assert.equal(res.code, 500); assert.deepEqual(res.body, { ok: false, error: "condominium_resolver_read_failed" });
});
test("architecture: existing endpoint, direct production resolver, no model/gateway/tools or mutation", () => {
  const source = fs.readFileSync(new URL("../lib/shadow/condominiumResolverCheck.js", import.meta.url), "utf8");
  const route = fs.readFileSync(new URL("../pages/api/operaciones/client-reconciliation.js", import.meta.url), "utf8");
  assert.match(source, /await loadCondominiumIdentityBefore3A\(admin, candidate.respond_contact_id\)/);
  assert.doesNotMatch(source, /\.(insert|update|delete|upsert|rpc)\s*\(|fetch\s*\(|console\.|process\.env/);
  assert.doesNotMatch(source, /from ["'][^"']*(phase3A|Gateway|anthropic|toolExecutor)/);
  assert.match(route, /startsWith\("condominium_"\)/);
  assert.match(route, /createCondominiumIdentityReviewHandler/);
});

test("missing or mixed candidate provenance fails closed before resolver", async () => {
  const t = fixture(); t.client_reconciliation_candidate_sources[0].source_type = "property_owner";
  const { res, admin } = await invoke({ tables: t });
  assert.equal(res.code, 409); assert.equal(res.body.error, "candidate_scope_mismatch");
  assert.ok(!admin.reads.some((r) => r.table === "respond_identity_links"));
});
