import { createHash } from "node:crypto";
export const fixtureUuid = (n) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
export const fixtureDigest = (phone) => createHash("sha256").update(phone).digest("hex");
export const condominiumCases = [
  { runRef: "85ced7b69096", sourceRef: "a0faedc4233c", unitId: fixtureUuid(101), contactId: "synthetic-condo-1", phone: "525550100001" },
  { runRef: "2b7e03328a31", sourceRef: "772c16cb082e", unitId: fixtureUuid(102), contactId: "synthetic-condo-2", phone: "525550100002" },
  { runRef: "620988e68436", sourceRef: "9c7c70b2be1f", unitId: fixtureUuid(103), contactId: "synthetic-condo-3", phone: "525550100003" },
  { runRef: "503f06b3cbdd", sourceRef: null, unitId: fixtureUuid(104), contactId: "synthetic-unmatched", phone: "525550199999" },
];
export const condoActor = { id: fixtureUuid(1), role_id: "admin", active: true };
export const condoEnv = { SHADOW_CLIENT_RECONCILIATION_PREPARE_ENABLED: "true", SHADOW_CLIENT_RECONCILIATION_WRITE_ENABLED: "true", SHADOW_IDENTITY_CONFIRMATION_ENABLED: "true" };

export function memoryAdmin(tables = {}, rpc = async () => ({ data: null, error: null })) {
  const reads = [];
  return { reads, rpc, from(table) {
    let matches = [...(tables[table] || [])], single = false;
    const query = { select() { reads.push(table); return query; }, eq(k, v) { matches = matches.filter((r) => r[k] === v); return query; },
      in(k, vs) { matches = matches.filter((r) => vs.includes(r[k])); return query; }, order() { return query; }, limit(n) { matches = matches.slice(0, n); return query; },
      maybeSingle() { single = true; return query; }, then(ok, fail) { return Promise.resolve({ data: single ? matches[0] || null : matches, error: null }).then(ok, fail); } };
    return query;
  } };
}

export function confirmedCondoTables({ count = 1, status = "confirmed" } = {}) {
  const id = fixtureUuid(10), condo = fixtureUuid(20), c = condominiumCases[0];
  return {
    respond_identity_links: [{ id: fixtureUuid(30), respond_contact_id: c.contactId, client_identity_id: id, link_source: "condominium_owner_admin_review", link_status: status }],
    client_identities: [{ id, status: "active", revoked_at: null, phone_digest: fixtureDigest(c.phone) }],
    client_identity_roles: [{ client_identity_id: id, role_kind: "owner", status: "active" }],
    client_source_links: Array.from({ length: count }, (_, i) => ({ client_identity_id: id, source_id: fixtureUuid(101 + i), condominium_id: condo, source_version:1, source_type: "condominium_unit_owner", link_status: "confirmed", role_kind: "owner", revoked_at: null })),
    unidades_condominio: Array.from({ length: count }, (_, i) => ({ id: fixtureUuid(101 + i), condominio_id: condo, activo: true, propietario_telefono: c.phone, identity_owner_version:1 })),
    condominios: [{ id: condo, activo: true }],
  };
}
