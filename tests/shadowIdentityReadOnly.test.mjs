import test from "node:test";
import assert from "node:assert/strict";
import { executeShadowReadOnlyTool } from "../lib/shadow/context.js";
import { resolveConfirmedContactIdentity } from "../lib/shadow/identityBridge.js";
import { condominiumIdentityToolRows } from "../lib/shadow/condominiumIdentity.js";
import { confirmedCondoTables, condominiumCases, fixtureUuid } from "./helpers/condominiumIdentityFixture.mjs";
import { instrumentIdentityAdmin } from "./helpers/identityReadOnlyFixture.mjs";

const contact = "synthetic-read-only-contact";
const identityId = fixtureUuid(10), linkId = fixtureUuid(30), propertyId = fixtureUuid(40), contractId = fixtureUuid(50);
const rentalTables = () => ({
  respond_identity_links: [{ id: linkId, respond_contact_id: contact, client_identity_id: identityId,
    link_source: "exact_phone_unique", link_status: "confirmed", confidence: 100 }],
  contracts: [{ id: contractId, tenant_client_id: identityId, property_id: propertyId, status: "active", start_date: "2026-01-01", end_date: "2026-12-31" }],
  properties: [{ id: propertyId, owner_client_id: identityId, status: "active" }],
});
const expectedRentalRows = [
  { entityType: "contact_identity", internalId: identityId, linkId, status: "confirmed", resolved: true,
    linkSource: "exact_phone_unique", roles: ["tenant", "owner"], ambiguousPropertyContext: false },
  { entityType: "contract", internalId: contractId, propertyId, status: "active", active: true,
    method: "confirmed_identity_link", confidence: 100, reasonCode: "confirmed_identity_contract" },
  { entityType: "property", internalId: propertyId, method: "confirmed_identity_link", confidence: 100, reasonCode: "confirmed_identity_property" },
];

test("instrumentation catches every mutation at client/query level, even after SELECT", () => {
  const { admin, mutations } = instrumentIdentityAdmin();
  for (const method of ["insert", "upsert", "update", "delete", "rpc"]) {
    assert.throws(() => admin.from("synthetic").select("id")[method]({}), /unexpected_mutation/);
  }
  assert.throws(() => admin.rpc("synthetic"), /unexpected_mutation/);
  assert.equal(mutations.length, 6);
});

for (const kind of ["confirmed", "absent", "candidate", "revoked", "conflict"]) {
  const tablesForCase = () => {
    const tables = rentalTables();
    if (kind === "absent") tables.respond_identity_links = [];
    if (["candidate", "revoked"].includes(kind)) tables.respond_identity_links[0].link_status = kind;
    if (kind === "conflict") tables.respond_identity_links.push({ ...tables.respond_identity_links[0], id: fixtureUuid(31) });
    return tables;
  };
  test(`Shadow identity ${kind}: unchanged result/reason and zero mutations`, async () => {
    const tables = tablesForCase(), before = structuredClone(tables);
    const { admin, mutations } = instrumentIdentityAdmin(tables);
    const result = await executeShadowReadOnlyTool(admin, "resolve_contact_identity", { respondContactId: contact });
    assert.deepEqual(result, kind === "confirmed" ? expectedRentalRows : [{
      entityType: "contact_identity", internalId: contact, resolved: false,
      status: kind === "conflict" ? "identity_conflict" : "insufficient_identity_context", conflicts: kind === "conflict",
    }]);
    assert.deepEqual(mutations, []);
    assert.equal(admin.reads.includes("respond_identity_links"), true);
    assert.equal(admin.reads.includes("respond_identity_audit"), false);
    assert.deepEqual(tables, before);
  });
  test(`non-Shadow ${kind}: default audit remains enabled; audit:false changes only the write`, async () => {
    const tables = tablesForCase(), before = structuredClone(tables);
    const audited = instrumentIdentityAdmin(tables, { allowAudit: true });
    const readOnly = instrumentIdentityAdmin(tables);
    const original = await resolveConfirmedContactIdentity(audited.admin, contact);
    const noAudit = await resolveConfirmedContactIdentity(readOnly.admin, contact, { audit: false });
    assert.deepEqual(noAudit, original);
    assert.deepEqual(audited.mutations, [{ table: "respond_identity_audit", method: "insert" }]);
    assert.equal(audited.auditEvents.length, 1);
    assert.equal(audited.auditEvents[0].event_type, kind === "confirmed" ? "resolved" : "unresolved");
    assert.equal(audited.auditEvents[0].respond_contact_id, contact);
    assert.deepEqual(readOnly.mutations, []);
    assert.deepEqual(tables, before);
  });
}

for (const [kind, change, reason] of [
  ["confirmed", () => {}, null],
  ["ambiguous_units", () => {}, null],
  ["inactive_identity", (t) => { t.client_identities[0].status = "inactive"; }, "canonical_identity_inactive"],
  ["inactive_unit", (t) => { t.unidades_condominio[0].activo = false; }, "inactive_or_changed_condominium_relationship"],
  ["inactive_condominium", (t) => { t.condominios[0].activo = false; }, "inactive_or_changed_condominium_relationship"],
  ["revoked_source", (t) => { t.client_source_links[0].link_status = "revoked"; }, "no_approved_condominium_relationship"],
  ["changed_phone", (t) => { t.unidades_condominio[0].propietario_telefono = "525550199998"; }, "approved_source_phone_changed"],
]) {
  test(`Shadow condominium ${kind}: real delegated resolver is read-only and functionally unchanged`, async () => {
    const tables = confirmedCondoTables({ count: kind === "ambiguous_units" ? 2 : 1 }); change(tables);
    const before = structuredClone(tables), c = condominiumCases[0];
    const originalClient = instrumentIdentityAdmin(tables), readOnlyClient = instrumentIdentityAdmin(tables), shadowClient = instrumentIdentityAdmin(tables);
    const original = await resolveConfirmedContactIdentity(originalClient.admin, c.contactId);
    const noAudit = await resolveConfirmedContactIdentity(readOnlyClient.admin, c.contactId, { audit: false });
    const rows = await executeShadowReadOnlyTool(shadowClient.admin, "resolve_contact_identity", { respondContactId: c.contactId });
    assert.deepEqual(noAudit, original);
    assert.equal(original.identityDomain, "condominium");
    assert.equal(original.resolved, !reason);
    if (reason) assert.equal(original.reason, reason);
    else {
      assert.deepEqual(original.roles, ["owner"]);
      assert.equal(original.ambiguousUnitContext, kind === "ambiguous_units");
      assert.equal(original.units.length, kind === "ambiguous_units" ? 2 : 1);
    }
    assert.deepEqual(rows, condominiumIdentityToolRows(original, c.contactId));
    for (const client of [originalClient, readOnlyClient, shadowClient]) {
      assert.deepEqual(client.mutations, []);
      assert.equal(client.admin.reads.includes("client_identities"), true);
      assert.equal(client.admin.reads.includes("contracts"), false);
      assert.equal(client.admin.reads.includes("properties"), false);
    }
    assert.deepEqual(tables, before);
  });
}
