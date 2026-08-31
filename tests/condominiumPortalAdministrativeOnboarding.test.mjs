import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  PORTAL_ACCESS_STATES,
  assessOwnerPortalIdentity,
  classifyUnitPortalState,
  isValidPortalEmail,
  maskPortalEmail,
  normalizePortalEmail,
  ownerPortalAuthMetadata,
  portalStateForBackendCode,
  requiresMultiUnitConfirmation,
} from "../lib/condominios/portalAccess.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const endpoint = await read("../pages/api/condominios/portal-access.js");
const adminPage = await read("../pages/condominio/[id].js");
const portalMigration = await read("../supabase/migrations/202608270002_condominium_owner_portal.sql");

test("normaliza y valida correo sin conservar variantes ambiguas", () => {
  assert.equal(normalizePortalEmail("  Owner@Example.COM "), "owner@example.com");
  assert.equal(isValidPortalEmail("owner@example.com"), true);
  assert.equal(isValidPortalEmail("owner example.com"), false);
  assert.equal(maskPortalEmail("owner@example.com"), "ow***@example.com");
});

test("clasifica estados de unidad sin convertir correo en autorización", () => {
  assert.equal(classifyUnitPortalState({ email: "", accesses: [] }), PORTAL_ACCESS_STATES.SIN_CORREO);
  assert.equal(classifyUnitPortalState({ email: "owner@example.com", accesses: [] }), PORTAL_ACCESS_STATES.CORREO_PENDIENTE_CONFIRMAR);
  assert.equal(classifyUnitPortalState({
    email: "owner@example.com",
    accesses: [{ email_normalized: "owner@example.com", active: true, revoked_at: null }],
  }), PORTAL_ACCESS_STATES.HABILITADO);
  assert.equal(classifyUnitPortalState({
    email: "owner@example.com",
    accesses: [{ email_normalized: "owner@example.com", active: false, revoked_at: "2026-08-27T00:00:00Z" }],
  }), PORTAL_ACCESS_STATES.REVOCADO);
  assert.equal(classifyUnitPortalState({
    email: "owner@example.com",
    accesses: [],
    overrideState: PORTAL_ACCESS_STATES.IDENTIDAD_AUTH_EN_REVISION,
  }), PORTAL_ACCESS_STATES.IDENTIDAD_AUTH_EN_REVISION);
});

test("conserva cada estado específico devuelto por backend", () => {
  assert.equal(portalStateForBackendCode("AUTH_IDENTITY_REVIEW_REQUIRED"), PORTAL_ACCESS_STATES.IDENTIDAD_AUTH_EN_REVISION);
  assert.equal(portalStateForBackendCode("MULTIUNIT_CONFIRMATION_REQUIRED"), PORTAL_ACCESS_STATES.MULTIUNIDAD_POR_CONFIRMAR);
  assert.equal(portalStateForBackendCode("SHARED_EMAIL_REVIEW_REQUIRED"), PORTAL_ACCESS_STATES.CORREO_COMPARTIDO);
  assert.equal(portalStateForBackendCode("LEGACY_TENANT_REVIEW_REQUIRED"), PORTAL_ACCESS_STATES.COINCIDENCIA_LEGACY_EN_REVISION);
  assert.equal(portalStateForBackendCode("UNEXPECTED_ERROR"), PORTAL_ACCESS_STATES.ERROR);
});

test("alta Auth solicita al trigger el rol externo propietario sin enviar invitación", () => {
  assert.deepEqual(ownerPortalAuthMetadata(), {
    app_metadata: { identity_type: "condominium_owner" },
    user_metadata: { rol_pretendido: "propietario" },
  });
  assert.match(endpoint, /email_confirm:\s*true/);
  assert.match(endpoint, /\.\.\.ownerPortalAuthMetadata\(\)/);
  assert.doesNotMatch(endpoint, /inviteUserByEmail|generateLink|password\s*:/);
});

const compatibleAuth = {
  id: "synthetic-owner",
  email_confirmed_at: "2026-08-31T12:00:00Z",
  app_metadata: { identity_type: "condominium_owner" },
};
const compatibleProfile = { id: "synthetic-owner", role_id: "propietario", active: true };

test("perfil externo propietario marcado es compatible y un rol inesperado aborta", () => {
  assert.equal(assessOwnerPortalIdentity({
    authUser: compatibleAuth,
    profile: compatibleProfile,
    roleIsExternal: true,
  }).compatible, true);
  assert.equal(assessOwnerPortalIdentity({
    authUser: compatibleAuth,
    profile: { ...compatibleProfile, role_id: "asesor" },
    roleIsExternal: false,
  }).compatible, false);
});

test("identidad interna, partner, membresía o permiso incompatible se rechazan", () => {
  const base = { authUser: compatibleAuth, profile: compatibleProfile, roleIsExternal: true };
  assert.equal(assessOwnerPortalIdentity({ ...base, roleIsExternal: false }).compatible, false);
  assert.equal(assessOwnerPortalIdentity({ ...base, activePartner: true }).compatible, false);
  assert.equal(assessOwnerPortalIdentity({ ...base, activeMemberships: 1 }).compatible, false);
  assert.equal(assessOwnerPortalIdentity({ ...base, hasInternalPermissions: true }).compatible, false);
});

test("preexistente compatible puede completar primera relación; C-24 sin marcador sigue en revisión", () => {
  const partialFromEndpoint = assessOwnerPortalIdentity({
    authUser: compatibleAuth,
    profile: compatibleProfile,
    roleIsExternal: true,
    knownPortalIdentity: false,
  });
  assert.equal(partialFromEndpoint.compatible, true);

  const ambiguousPreexisting = assessOwnerPortalIdentity({
    authUser: { ...compatibleAuth, app_metadata: {} },
    profile: compatibleProfile,
    roleIsExternal: true,
    knownPortalIdentity: false,
  });
  assert.equal(ambiguousPreexisting.compatible, false);
});

test("multiunidad requiere confirmación explícita", () => {
  const activeAccesses = [{ unidad_id: "unit-one", active: true, revoked_at: null }];
  assert.equal(requiresMultiUnitConfirmation({ activeAccesses, unidadId: "unit-two", confirmMultiUnit: false }), true);
  assert.equal(requiresMultiUnitConfirmation({ activeAccesses, unidadId: "unit-two", confirmMultiUnit: true }), false);
  assert.equal(requiresMultiUnitConfirmation({ activeAccesses, unidadId: "unit-one", confirmMultiUnit: false }), false);
});

test("endpoint lee correo de unidad, valida tenant y sólo usa Auth Admin server-side", () => {
  assert.match(endpoint, /select\("id, condominio_id, activo, propietario_email"\)/);
  assert.match(endpoint, /\.eq\("id", unidadId\)[\s\S]*\.eq\("condominio_id", condominioId\)/);
  assert.match(endpoint, /const email = normalizePortalEmail\(scope\.unit\.propietario_email\)/);
  assert.match(endpoint, /authAdmin\.auth\.admin\.createUser/);
  assert.match(endpoint, /operatorDb[\s\S]*\.from\("condominium_unit_portal_access"\)[\s\S]*\.insert/);
  assert.doesNotMatch(endpoint, /inviteUserByEmail|generateLink/);
  assert.doesNotMatch(endpoint, /console\.(?:log|error)\([^\n]*(?:email|token|authUser)/i);
});

test("endpoint aplica permisos internos y excluye Antive, propietarios y condominios legacy", () => {
  assert.match(endpoint, /profile\.active === false/);
  assert.match(endpoint, /profile\.roles\?\.es_externo === true/);
  assert.match(endpoint, /profile\.role_id !== "admin"/);
  assert.match(endpoint, /\.eq\("modulo", "condominios"\)/);
  assert.match(endpoint, /permission\?\.puede_ver !== true \|\| permission\?\.puede_editar !== true/);
  assert.match(endpoint, /CONTROLLED_CONDOMINIUM_REQUIRED/);
});

test("alta cubre confirmación, duplicado, doble clic, identidad ambigua y fallos seguros", () => {
  assert.match(endpoint, /emailConfirmed !== true/);
  assert.match(endpoint, /MULTIUNIT_CONFIRMATION_REQUIRED/);
  assert.match(endpoint, /AUTH_IDENTITY_REVIEW_REQUIRED/);
  assert.match(endpoint, /ALREADY_ENABLED/);
  assert.match(endpoint, /insertError\?\.code === "23505"/);
  assert.match(endpoint, /AUTH_CREATE_FAILED/);
  assert.match(endpoint, /RELATION_WRITE_FAILED/);
  assert.match(endpoint, /cleanupNewOwnerIdentity\(authAdmin, authUser\.id\)/);
});

test("una identidad relacionada con otro condominio no puede cruzar tenants", () => {
  assert.match(endpoint, /crossTenantAccess/);
  assert.match(endpoint, /row\.condominio_id !== condominioId/);
  assert.match(endpoint, /AUTH_IDENTITY_REVIEW_REQUIRED/);
});

test("coincidencia legacy de otro tenant se bloquea antes de crear Auth, como A-06", () => {
  const legacyCheck = endpoint.indexOf("await hasLegacyTenantEmailCollision");
  const createIdentity = endpoint.indexOf("auth.admin.createUser");
  assert.ok(legacyCheck >= 0);
  assert.ok(createIdentity > legacyCheck);
  assert.match(endpoint, /LEGACY_TENANT_REVIEW_REQUIRED/);
  assert.match(endpoint, /\.neq\("condominio_id", condominioId\)/);
  assert.match(endpoint, /condominium_operation_controls/);
});

test("el backend revisa efectos secundarios después de crear la identidad Auth", () => {
  const createIndex = endpoint.indexOf("auth.admin.createUser");
  const postCreateReviewIndex = endpoint.indexOf(
    "assessAuthIdentity(authAdmin, authUser)",
    createIndex,
  );
  assert.ok(createIndex >= 0);
  assert.ok(postCreateReviewIndex > createIndex);
  const catchIndex = endpoint.indexOf("} catch (error) {", postCreateReviewIndex);
  const catchCleanupIndex = endpoint.indexOf("cleanupNewOwnerIdentity(authAdmin, authUser.id)", catchIndex);
  assert.ok(catchCleanupIndex > catchIndex);
});

test("una falla posterior a Auth limpia también el perfil creado por el trigger", () => {
  assert.match(endpoint, /async function cleanupNewOwnerIdentity/);
  assert.match(endpoint, /authAdmin\.auth\.admin\.deleteUser\(authUserId\)/);
  assert.match(endpoint, /\.from\("profiles"\)[\s\S]*\.delete\(\)[\s\S]*\.eq\("id", authUserId\)/);
  assert.match(endpoint, /PROFILE_CLEANUP_FAILED/);
});

test("revocación conserva relación y datos administrativos", () => {
  assert.match(endpoint, /action === "revoke"/);
  assert.match(endpoint, /update\(\{ active: false, revoked_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.doesNotMatch(endpoint, /from\("condominium_unit_portal_access"\)[\s\S]{0,120}\.delete\(/);
});

test("UI confirma correo, muestra estados reales y no envía PII libremente", () => {
  for (const state of Object.values(PORTAL_ACCESS_STATES)) assert.match(adminPage, new RegExp(state));
  assert.match(adminPage, /Confirmo que este correo fue proporcionado o validado directamente/);
  assert.match(adminPage, /confirmMultiUnit/);
  assert.match(adminPage, /result\.code === "ALREADY_ENABLED"/);
  assert.match(adminPage, /action: "enable"/);
  assert.match(adminPage, /PORTAL_ACCESS_STATES\.PORTAL_GENERAL_APAGADO/);
  assert.match(adminPage, /PORTAL_ACCESS_STATES\.LISTO_PARA_HABILITAR/);
  assert.match(adminPage, /Revoca primero el acceso activo antes de cambiar el correo/);
  assert.match(adminPage, /portalStateForBackendCode\(result\.code\)/);
  assert.match(adminPage, /COINCIDENCIA_LEGACY_EN_REVISION/);
  assert.doesNotMatch(adminPage, /setPortalUnitErrors/);
  assert.match(adminPage, /if \(result\.error\)/);
  assert.doesNotMatch(adminPage, /action: "enable"[\s\S]{0,180}(?:email|correo):/i);
});

test("Tecaxco conserva fallback legacy y UI nueva sólo aparece en controlados", () => {
  assert.match(adminPage, /isControlledCondominium &&/);
  assert.match(adminPage, /legacy_uncontrolled/);
  assert.match(portalMigration, /not public\.condominium_is_controlled/);
  assert.match(portalMigration, /propietario_email/);
  assert.match(portalMigration, /public\.condominium_is_controlled\(u\.condominio_id\)[\s\S]*condominium_unit_portal_access/);
});
