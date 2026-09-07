import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalIdentityResolution, contractTemporalStatus } from "../lib/shadow/identityBridge.js";

const ID = "11111111-1111-4111-8111-111111111111";
const link = { id: "link-1", client_identity_id: ID, link_status: "confirmed", link_source: "human_confirmation", confidence: 1 };
const identity = { id: ID, status: "active" };
const role = (role_kind, status = "active") => ({ client_identity_id: ID, role_kind, status });
const source = (source_type, source_id, link_status = "confirmed") => ({ client_identity_id: ID, source_type, source_id, link_status });
const property = (id, name, owner_client_id = null) => ({ id, name, owner_client_id, status: "active" });
const contract = (id, property_id, { tenant = ID, start = "2026-01-01", end = "2027-01-01", status = "activo" } = {}) => ({ id, property_id, tenant_client_id: tenant, start_date: start, end_date: end, status });
const resolve = (overrides = {}) => buildCanonicalIdentityResolution({ link, identity, roles: [role("tenant")], sourceLinks: [source("active_contract_tenant", "c1")], contracts: [contract("c1", "p1")], properties: [property("p1", "Residencial Ocotlán Departamento 19")], effectiveAt: "2026-09-06", ...overrides });

test("propietario con una propiedad resuelve relación y contrato aplicable", () => {
  const value = resolve({ roles: [role("owner")], sourceLinks: [source("managed_property_owner", "p1")], contracts: [contract("c2", "p1", { tenant: "22222222-2222-4222-8222-222222222222" })], properties: [property("p1", "Unidad Uno", ID)] });
  assert.equal(value.relationshipCurrent, true); assert.deepEqual(value.roles, ["owner"]); assert.equal(value.contracts[0].id, "c2");
});

test("propietario con varias propiedades queda ambiguo sin elegir arbitrariamente", () => {
  const value = resolve({ roles: [role("owner")], sourceLinks: [source("managed_property_owner", "p1"), source("managed_property_owner", "p2")], contracts: [], properties: [property("p1", "Uno", ID), property("p2", "Dos", ID)] });
  assert.equal(value.relationshipCurrent, false); assert.equal(value.failClosedReason, "ambiguous_property_context"); assert.equal(value.properties.length, 0);
});

test("inquilino con contrato temporal vigente resuelve canónicamente", () => {
  const value = resolve();
  assert.equal(value.canonicalContactId, ID); assert.equal(value.identityConfirmed, true); assert.equal(value.contracts[0].temporalStatus, "active");
});

test("nombre libre de Respond no interviene en la resolución", () => {
  const canonical = resolve();
  const differentRespondName = resolve({ respondDisplayName: "Nombre distinto no confiable" });
  assert.deepEqual(differentRespondName, canonical);
});

test("referencia abreviada Ocotlan 19 selecciona únicamente dentro de relaciones estructuradas", () => {
  const value = resolve({ propertyReference: "Ocotlan 19", sourceLinks: [source("active_contract_tenant", "c1"), source("active_contract_tenant", "c2")], contracts: [contract("c1", "p1"), contract("c2", "p2")], properties: [property("p1", "Residencial Ocotlán Departamento 19"), property("p2", "Residencial Ocotlán Departamento 20")] });
  assert.equal(value.relationshipCurrent, true); assert.equal(value.properties[0].id, "p1");
});

test("contacto sin vínculo suficiente falla cerrado", () => {
  const value = resolve({ sourceLinks: [] });
  assert.equal(value.relationshipCurrent, false); assert.equal(value.failClosedReason, "insufficient_property_context");
});

test("relación revocada e histórica no se toma como vigente", () => {
  const value = resolve({ sourceLinks: [source("active_contract_tenant", "c1", "revoked")] });
  assert.equal(value.relationshipCurrent, false); assert.equal(value.properties.length, 0);
});

test("propiedad inactiva no se toma como relación vigente", () => {
  const value = resolve({ properties: [{ ...property("p1", "Unidad histórica"), status: "inactive" }] });
  assert.equal(value.relationshipCurrent, false); assert.equal(value.failClosedReason, "insufficient_property_context");
});

test("propiedad ambigua por referencia compartida queda fail-closed", () => {
  const value = resolve({ propertyReference: "Ocotlan", sourceLinks: [source("active_contract_tenant", "c1"), source("active_contract_tenant", "c2")], contracts: [contract("c1", "p1"), contract("c2", "p2")], properties: [property("p1", "Ocotlán 19"), property("p2", "Ocotlán 20")] });
  assert.equal(value.relationshipCurrent, false); assert.equal(value.failClosedReason, "ambiguous_property_context");
});

test("contrato vencido por fecha efectiva no se perpetúa por status activo", () => {
  assert.equal(contractTemporalStatus(contract("c1", "p1", { end: "2026-08-31" }), "2026-09-01"), "expired");
  const value = resolve({ contracts: [contract("c1", "p1", { end: "2026-08-31" })], effectiveAt: "2026-09-01" });
  assert.equal(value.relationshipCurrent, false); assert.equal(value.failClosedReason, "insufficient_property_context");
});

test("contacto con roles simultáneos contradictorios sobre la misma propiedad queda fail-closed", () => {
  const value = resolve({ roles: [role("tenant"), role("owner")], sourceLinks: [source("active_contract_tenant", "c1"), source("managed_property_owner", "p1")], properties: [property("p1", "Uno", ID)] });
  assert.equal(value.relationshipCurrent, false); assert.equal(value.failClosedReason, "ambiguous_role_context");
});
