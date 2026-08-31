export const PORTAL_ACCESS_STATES = Object.freeze({
  SIN_CORREO: "SIN_CORREO",
  CORREO_PENDIENTE_CONFIRMAR: "CORREO_PENDIENTE_CONFIRMAR",
  LISTO_PARA_HABILITAR: "LISTO_PARA_HABILITAR",
  HABILITANDO: "HABILITANDO",
  HABILITADO: "HABILITADO",
  PORTAL_GENERAL_APAGADO: "PORTAL_GENERAL_APAGADO",
  MULTIUNIDAD_POR_CONFIRMAR: "MULTIUNIDAD_POR_CONFIRMAR",
  CORREO_COMPARTIDO: "CORREO_COMPARTIDO",
  COINCIDENCIA_LEGACY_EN_REVISION: "COINCIDENCIA_LEGACY_EN_REVISION",
  IDENTIDAD_AUTH_EN_REVISION: "IDENTIDAD_AUTH_EN_REVISION",
  REVOCADO: "REVOCADO",
  ERROR: "ERROR",
});

export const OWNER_PORTAL_IDENTITY_TYPE = "condominium_owner";
export const OWNER_PORTAL_ROLE = "propietario";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePortalEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function isValidPortalEmail(value) {
  const normalized = normalizePortalEmail(value);
  return normalized.length <= 254 && EMAIL_PATTERN.test(normalized);
}

export function maskPortalEmail(value) {
  const normalized = normalizePortalEmail(value);
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return "correo no disponible";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export function activePortalAccess(rows = []) {
  return rows.filter((row) => row?.active === true && !row?.revoked_at);
}

export function portalStateForBackendCode(code) {
  return ({
    AUTH_IDENTITY_REVIEW_REQUIRED: PORTAL_ACCESS_STATES.IDENTIDAD_AUTH_EN_REVISION,
    MULTIUNIT_CONFIRMATION_REQUIRED: PORTAL_ACCESS_STATES.MULTIUNIDAD_POR_CONFIRMAR,
    SHARED_EMAIL_REVIEW_REQUIRED: PORTAL_ACCESS_STATES.CORREO_COMPARTIDO,
    LEGACY_TENANT_REVIEW_REQUIRED: PORTAL_ACCESS_STATES.COINCIDENCIA_LEGACY_EN_REVISION,
    REACTIVATION_REVIEW_REQUIRED: PORTAL_ACCESS_STATES.REVOCADO,
  })[code] || PORTAL_ACCESS_STATES.ERROR;
}

export function classifyUnitPortalState({ email, accesses = [], busy = false, overrideState = null, error = false }) {
  if (busy) return PORTAL_ACCESS_STATES.HABILITANDO;
  if (overrideState && Object.values(PORTAL_ACCESS_STATES).includes(overrideState)) return overrideState;
  if (error) return PORTAL_ACCESS_STATES.ERROR;
  if (!normalizePortalEmail(email)) return PORTAL_ACCESS_STATES.SIN_CORREO;

  const normalized = normalizePortalEmail(email);
  const exact = accesses.find((row) => normalizePortalEmail(row?.email_normalized) === normalized);
  if (exact?.active === true && !exact?.revoked_at) return PORTAL_ACCESS_STATES.HABILITADO;
  if (exact && exact.active === false) return PORTAL_ACCESS_STATES.REVOCADO;
  return PORTAL_ACCESS_STATES.CORREO_PENDIENTE_CONFIRMAR;
}

export function ownerPortalAuthMetadata() {
  return {
    app_metadata: { identity_type: OWNER_PORTAL_IDENTITY_TYPE },
    user_metadata: { rol_pretendido: OWNER_PORTAL_ROLE },
  };
}

export function assessOwnerPortalIdentity({
  authUser,
  profile,
  roleIsExternal = false,
  activePartner = false,
  activeMemberships = 0,
  hasInternalPermissions = false,
  knownPortalIdentity = false,
} = {}) {
  const identityMarked = authUser?.app_metadata?.identity_type === OWNER_PORTAL_IDENTITY_TYPE;
  const recognized = identityMarked || knownPortalIdentity === true;
  const authReady = Boolean(
    authUser?.id
    && !authUser.deleted_at
    && !authUser.banned_until
    && authUser.email_confirmed_at,
  );
  const ownerProfile = Boolean(
    profile?.id
    && profile.active === true
    && profile.role_id === OWNER_PORTAL_ROLE
    && roleIsExternal === true,
  );
  const compatible = Boolean(
    authReady
    && recognized
    && ownerProfile
    && activePartner !== true
    && Number(activeMemberships || 0) === 0
    && hasInternalPermissions !== true,
  );

  return { compatible, identityMarked, recognized, authReady, ownerProfile };
}

export function requiresMultiUnitConfirmation({ activeAccesses = [], unidadId, confirmMultiUnit = false }) {
  const otherUnits = activeAccesses.filter((row) => row?.unidad_id && row.unidad_id !== unidadId);
  return otherUnits.length > 0 && confirmMultiUnit !== true;
}
