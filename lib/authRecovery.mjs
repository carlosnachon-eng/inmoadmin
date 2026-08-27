export const PASSWORD_RECOVERY_MESSAGE =
  "Si existe una cuenta activa elegible para ese correo, recibirás instrucciones para restablecer tu contraseña.";

export const INTERNAL_PASSWORD_ROLES = Object.freeze([
  "admin",
  "asesor",
  "chofer",
  "coord_operaciones",
  "gerente_ventas",
  "juridico",
]);

export const isEligibleInternalProfile = (profile) =>
  Boolean(profile?.active && INTERNAL_PASSWORD_ROLES.includes(profile?.role_id));

export const validateNewPassword = (password, confirmation) => {
  if (String(password || "").length < 10) {
    return "La contraseña debe tener al menos 10 caracteres.";
  }
  if (password !== confirmation) return "Las contraseñas no coinciden.";
  return "";
};

export const recoveryRedirectUrl = (origin) =>
  `${String(origin || "").replace(/\/$/, "")}/auth/reset-password`;
