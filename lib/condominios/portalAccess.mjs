export const PORTAL_ACCESS_STATES = Object.freeze({
  SIN_CORREO: "SIN_CORREO",
  CORREO_PENDIENTE_CONFIRMAR: "CORREO_PENDIENTE_CONFIRMAR",
  LISTO_PARA_HABILITAR: "LISTO_PARA_HABILITAR",
  HABILITANDO: "HABILITANDO",
  HABILITADO: "HABILITADO",
  PORTAL_GENERAL_APAGADO: "PORTAL_GENERAL_APAGADO",
  MULTIUNIDAD_POR_CONFIRMAR: "MULTIUNIDAD_POR_CONFIRMAR",
  CORREO_COMPARTIDO: "CORREO_COMPARTIDO",
  IDENTIDAD_AUTH_EN_REVISION: "IDENTIDAD_AUTH_EN_REVISION",
  REVOCADO: "REVOCADO",
  ERROR: "ERROR",
});

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

export function classifyUnitPortalState({ email, accesses = [], busy = false, error = false }) {
  if (busy) return PORTAL_ACCESS_STATES.HABILITANDO;
  if (error) return PORTAL_ACCESS_STATES.ERROR;
  if (!normalizePortalEmail(email)) return PORTAL_ACCESS_STATES.SIN_CORREO;

  const normalized = normalizePortalEmail(email);
  const exact = accesses.find((row) => normalizePortalEmail(row?.email_normalized) === normalized);
  if (exact?.active === true && !exact?.revoked_at) return PORTAL_ACCESS_STATES.HABILITADO;
  if (exact && exact.active === false) return PORTAL_ACCESS_STATES.REVOCADO;
  return PORTAL_ACCESS_STATES.CORREO_PENDIENTE_CONFIRMAR;
}

export function requiresMultiUnitConfirmation({ activeAccesses = [], unidadId, confirmMultiUnit = false }) {
  const otherUnits = activeAccesses.filter((row) => row?.unidad_id && row.unidad_id !== unidadId);
  return otherUnits.length > 0 && confirmMultiUnit !== true;
}
