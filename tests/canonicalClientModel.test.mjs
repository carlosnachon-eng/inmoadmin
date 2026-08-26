import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assertClientReconciliationAction, buildActiveClientReconciliationCohort, buildClientReconciliationReviewModels, canonicalCandidateKey, clientReconciliationCapabilities, maskReconciliationName, selectExplicitReconciliationCohort, validateExplicitReconciliationSelection } from "../lib/shadow/clientIdentity.js";

const migration = fs.readFileSync(new URL("../supabase/migrations/202608260002_fase_3a_canonical_client_model.sql", import.meta.url), "utf8");
const checks = fs.readFileSync(new URL("../supabase/migrations/202608260002_fase_3a_canonical_client_model_checks.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../supabase/rollback/202608260002_fase_3a_canonical_client_model_rollback.sql", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../pages/api/operaciones/client-reconciliation.js", import.meta.url), "utf8");
const bridge = fs.readFileSync(new URL("../lib/shadow/identityBridge.js", import.meta.url), "utf8");

const contract = (overrides = {}) => ({ id: crypto.randomUUID(), status: "activo", tenant_phone: "2221234567", tenant_name: "Persona sintética", tenant_email: "qa@example.test", property_name: "Unidad QA", owner_name: "Propietario QA", ...overrides });
const property = (overrides = {}) => ({ id: crypto.randomUUID(), name: "Unidad QA", owner_phone: "2227654321", owner_email: "owner@example.test", ...overrides });

test("cohorte operativa excluye vencidos y prospectos y enlaza propiedad sólo por nombre exacto único", () => {
  const current = contract(); const expired = contract({ status: "vencido", property_name: "Histórica" });
  const result = buildActiveClientReconciliationCohort({ contracts: [current, expired], properties: [property()] });
  assert.equal(result.metrics.activeContracts, 1); assert.equal(result.metrics.propertyMatches, 1);
  assert.equal(result.candidates.length, 2); assert.ok(result.candidates.every((x) => x.candidateStatus === "auto_safe_candidate"));
  assert.ok(result.candidates.flatMap((x) => x.sources).every((x) => x.sourceId !== expired.id));
});

test("teléfono inválido queda requires_review y jamás se confirma automáticamente", () => {
  const result = buildActiveClientReconciliationCohort({ contracts: [contract({ tenant_phone: "sin teléfono" })], properties: [property()] });
  const tenant = result.candidates.find((x) => x.roleKind === "tenant");
  assert.equal(tenant.candidateStatus, "requires_review"); assert.equal(tenant.reasonCode, "tenant_phone_invalid"); assert.equal(tenant.phoneDigest, null);
});

test("nombre o email contradictorios con teléfono compartido producen conflict, no merge", () => {
  const rows = [contract(), contract({ tenant_name: "Otra persona", tenant_email: "otra@example.test", property_name: "Unidad QA 2" })];
  const result = buildActiveClientReconciliationCohort({ contracts: rows, properties: [property(), property({ name: "Unidad QA 2" })] });
  const tenant = result.candidates.find((x) => x.roleKind === "tenant");
  assert.equal(tenant.candidateStatus, "conflict"); assert.equal(tenant.sources.length, 2);
});

test("misma persona puede tener múltiples contratos y propiedades sin duplicar identidad candidata", () => {
  const rows = [contract(), contract({ tenant_name: "Persona sintética", tenant_email: "qa@example.test", property_name: "Unidad QA 2" })];
  const result = buildActiveClientReconciliationCohort({ contracts: rows, properties: [property(), property({ name: "Unidad QA 2" })] });
  const tenant = result.candidates.find((x) => x.roleKind === "tenant");
  assert.equal(tenant.candidateStatus, "auto_safe_candidate"); assert.equal(tenant.sources.length, 2);
});

test("match de propiedad ausente o ambiguo falla cerrado", () => {
  for (const properties of [[], [property(), property({ id: crypto.randomUUID() })]]) {
    const result = buildActiveClientReconciliationCohort({ contracts: [contract()], properties });
    const tenant = result.candidates.find((x) => x.roleKind === "tenant");
    assert.equal(tenant.candidateStatus, "conflict"); assert.equal(tenant.reasonCode, "property_match_not_unique");
  }
});

test("candidate key es determinística e independiente de nombre/email", () => {
  const input = { roleKind: "tenant", phoneDigest: "a".repeat(64), sourceId: crypto.randomUUID() };
  assert.equal(canonicalCandidateKey(input), canonicalCandidateKey({ ...input, name: "no usado", email: "no@usado.test" }));
});

test("schema canónico desacopla Auth, permite tenant+owner y conserva legacy", () => {
  assert.match(migration, /create table public\.client_identities/);
  assert.match(migration, /auth_user_id uuid null references auth\.users/);
  assert.doesNotMatch(migration, /insert into auth\.users|admin\.createUser|email\s+text\s+not null/i);
  assert.match(migration, /role_kind in \('tenant','owner'\)/);
  assert.match(migration, /primary key \(client_identity_id, role_kind\)/);
  assert.match(migration, /contracts add column tenant_client_id/);
  assert.match(migration, /properties add column owner_client_id/);
  assert.doesNotMatch(migration, /drop column (tenant_phone|owner_phone|tenant_name|owner_name)/i);
});

test("confirmación humana es una RPC transaccional que puebla links y FKs o revierte completa", () => {
  assert.match(migration, /create or replace function public\.confirm_client_reconciliation_candidate/);
  assert.match(migration, /for update/); assert.match(migration, /insert into public\.client_source_links/);
  assert.match(migration, /update public\.contracts set tenant_client_id/); assert.match(migration, /update public\.properties set owner_client_id/);
  assert.match(migration, /get diagnostics v_updated = row_count/); assert.match(migration, /candidate_source_not_found/);
  assert.match(migration, /candidate_status='confirmed'/); assert.match(migration, /insert into public\.client_identity_audit/);
  const fn = migration.match(/create or replace function public\.confirm_client_reconciliation_candidate[\s\S]+?end \$\$;/i)?.[0] || "";
  assert.doesNotMatch(fn, /exception when others|\bcommit\b/i, "la función no debe capturar errores ni hacer commit parcial");
});

test("RLS/grants son mínimos; auditoría append-only y RPC sólo server-side", () => {
  assert.match(migration, /enable row level security/g); assert.match(migration, /revoke all[\s\S]+public,anon,authenticated,service_role/);
  assert.match(migration, /grant select,insert on public\.client_reconciliation_candidate_sources,public\.client_identity_audit to service_role/);
  assert.match(checks, /audit (?:must be|not) append-only/); assert.match(checks, /DELETE,TRUNCATE,REFERENCES,TRIGGER/);
  assert.match(migration, /revoke all on function public\.confirm_client_reconciliation_candidate[\s\S]+from public,anon,authenticated/);
});

test("Identity Bridge converge sólo a client_identity_id confirmed", () => {
  assert.match(migration, /respond_identity_links add column client_identity_id/);
  assert.match(migration, /where ci\.status='active'[\s\S]+sl\.link_status='confirmed'/);
  assert.match(bridge, /\.eq\("link_status", "confirmed"\)/); assert.match(bridge, /tenant_client_id/); assert.match(bridge, /owner_client_id/);
  assert.doesNotMatch(bridge, /fuzzy|similarity|ilike|tenant_phone|owner_phone/);
});

test("superficie administrativa no es una tool de Auto-Real y no contiene vías externas", () => {
  assert.match(api, /authorizeShadowAdministrator/); assert.match(api, /sameOriginAdminRequest/);
  assert.match(api, /clientReconciliationCapabilities/); assert.match(api, /confirm_client_reconciliation_candidate/);
  assert.doesNotMatch(api, /RESPOND_IO_TOKEN|ANTHROPIC_API_KEY|sendMessage|fetchRespond|payments.*update/i);
});

test("prepare y write son capabilities independientes y fail-closed", () => {
  const off = clientReconciliationCapabilities({});
  assert.deepEqual(off, { prepareEnabled: false, writeEnabled: false });
  assert.throws(() => assertClientReconciliationAction(off, "prepare"), /prepare_disabled/);
  const prepareOnly = clientReconciliationCapabilities({ SHADOW_CLIENT_RECONCILIATION_PREPARE_ENABLED: "true" });
  assert.doesNotThrow(() => assertClientReconciliationAction(prepareOnly, "prepare"));
  for (const action of ["confirm", "reject", "conflict", "skip", "revoke"]) assert.throws(() => assertClientReconciliationAction(prepareOnly, action), /write_disabled/);
});

test("selección explícita aplica máximo 5 tenants, 3 owners y 8 fuentes", () => {
  const ids = Array.from({ length: 9 }, () => crypto.randomUUID());
  assert.deepEqual(validateExplicitReconciliationSelection({ tenantSourceIds: ids.slice(0, 5), ownerSourceIds: ids.slice(5, 8) }), { tenantSourceIds: ids.slice(0, 5), ownerSourceIds: ids.slice(5, 8) });
  assert.throws(() => validateExplicitReconciliationSelection({ tenantSourceIds: ids.slice(0, 6) }), /limit_exceeded/);
  assert.throws(() => validateExplicitReconciliationSelection({ ownerSourceIds: ids.slice(0, 4) }), /limit_exceeded/);
  assert.throws(() => validateExplicitReconciliationSelection({}), /empty_reconciliation_selection/);
  assert.throws(() => validateExplicitReconciliationSelection({ tenantSourceIds: ["*"] }), /invalid_reconciliation_source_id/);
});

test("prepare-only filtra cohorte exacta y no arrastra vencidos ni fuentes extra", () => {
  const selectedContract = contract(); const extraContract = contract({ property_name: "Unidad QA 2", tenant_phone: "2221111111" });
  const selectedProperty = property(); const extraProperty = property({ name: "Unidad QA 2", owner_phone: "2223333333" });
  const full = buildActiveClientReconciliationCohort({ contracts: [selectedContract, extraContract, contract({ status: "vencido" })], properties: [selectedProperty, extraProperty], ownerSourceIds: [selectedProperty.id] });
  const selected = selectExplicitReconciliationCohort(full, { tenantSourceIds: [selectedContract.id], ownerSourceIds: [selectedProperty.id] });
  assert.equal(selected.candidates.length, 2);
  assert.deepEqual(new Set(selected.candidates.flatMap((x) => x.sources.map((source) => source.sourceId))), new Set([selectedContract.id, selectedProperty.id]));
});

test("endpoint bloquea mutaciones antes de RPC y UI las oculta en prepare-only", () => {
  const ui = fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");
  assert.match(api, /assertClientReconciliationAction\(capabilities, action\)[\s\S]+confirm_client_reconciliation_candidate/);
  assert.match(ui, /capabilities\?\.writeEnabled &&/);
  assert.match(ui, /Modo revisión:[\s\S]+cambios canónicos deshabilitados/);
  assert.doesNotMatch(api.match(/if \(action === "prepare"\)[\s\S]+?return res\.status\(200\)/)?.[0] || "", /confirm_client_reconciliation_candidate|review_client_reconciliation_candidate|tenant_client_id|owner_client_id|property_id/);
});

test("read model minimizado permite reconocer tenant y owner sin exponer PII completa", () => {
  const tenantId = crypto.randomUUID(); const ownerId = crypto.randomUUID(); const propertyId = crypto.randomUUID();
  const tenantPhone = "2221234567"; const ownerPhone = "2227654321";
  const cohort = buildActiveClientReconciliationCohort({
    contracts: [{ id: tenantId, status: "activo", tenant_phone: tenantPhone, tenant_name: "Persona Sintética Ejemplo", tenant_email: "private@example.test", property_name: "Unidad Operativa Norte", owner_name: "Propietario Sintético", end_date: "2027-08-01" }],
    properties: [{ id: propertyId, name: "Unidad Operativa Norte", owner_phone: ownerPhone, owner_email: "owner@example.test", address: "Domicilio prohibido" }],
    ownerSourceIds: [propertyId],
  });
  const candidates = cohort.candidates.map((item, index) => ({ id: index ? ownerId : tenantId, role_kind: item.roleKind, phone_digest: item.phoneDigest, candidate_status: item.candidateStatus, reason_code: item.reasonCode, source_count: item.sources.length }));
  const sources = cohort.candidates.flatMap((item, index) => item.sources.map((source) => ({ candidate_id: index ? ownerId : tenantId, source_type: source.sourceType, source_id: source.sourceId, matched_property_id: source.matchedPropertyId })));
  const models = buildClientReconciliationReviewModels({ candidates, sources, contracts: [{ id: tenantId, status: "activo", tenant_phone: tenantPhone, tenant_name: "Persona Sintética Ejemplo", tenant_email: "private@example.test", property_name: "Unidad Operativa Norte", owner_name: "Propietario Sintético", end_date: "2027-08-01" }], properties: [{ id: propertyId, name: "Unidad Operativa Norte", owner_phone: ownerPhone, owner_email: "owner@example.test", address: "Domicilio prohibido" }] });
  const tenant = models.find((item) => item.role_kind === "tenant"); const owner = models.find((item) => item.role_kind === "owner");
  assert.equal(tenant.review.displayName, "Persona S. E."); assert.equal(tenant.review.phoneLast4, "4567"); assert.equal(tenant.review.activeContractCount, 1); assert.deepEqual(tenant.review.propertyNames, ["Unidad Operativa Norte"]); assert.deepEqual(tenant.review.contractEndDates, ["2027-08-01"]);
  assert.equal(owner.review.displayName, "Propietario S."); assert.equal(owner.review.phoneLast4, "4321"); assert.equal(owner.review.relatedPropertyCount, 1); assert.deepEqual(owner.review.propertyNames, ["Unidad Operativa Norte"]);
  assert.equal(tenant.review.matchMethodLabel, "Coincidencia exacta y única de teléfono");
  const serialized = JSON.stringify(models);
  for (const forbidden of [tenantPhone, ownerPhone, "private@example.test", "owner@example.test", "Domicilio prohibido", candidates[0].phone_digest]) assert.doesNotMatch(serialized, new RegExp(forbidden));
  assert.equal(maskReconciliationName("Nombre Segundo Tercero"), "Nombre S. T.");
});

test("read endpoint es admin-only, omite digest y no modifica candidatos existentes", () => {
  assert.match(api, /authorizeShadowAdministrator\(req\)[\s\S]+if \(!actor\) return res\.status\(403\)/);
  assert.match(api, /buildClientReconciliationReviewModels/);
  assert.match(api, /const \{ id, \.\.\.reviewOnlyCandidate \} = candidate/);
  assert.match(api, /candidateRef: String\(id\)\.slice\(0, 12\)/);
  const getBlock = api.match(/if \(req\.method === "GET"\)[\s\S]+?return res\.status\(200\)\.json\(\{ ok: true, capabilities, candidates \}\);/)?.[0] || "";
  assert.doesNotMatch(getBlock, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
});

test("rollback conservador se niega ante datos auditables o FKs pobladas", () => {
  assert.match(rollback, /rollback_refused_audit_exists/); assert.match(rollback, /rollback_refused_source_links_exist/);
  assert.match(rollback, /tenant_client_id is not null/); assert.match(rollback, /owner_client_id is not null/);
});
