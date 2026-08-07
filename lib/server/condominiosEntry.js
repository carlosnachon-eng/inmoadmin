export function resolveCondominiosEntry({ profile, memberships = [] }) {
  const hasInternalAccess = Boolean(
    profile
    && profile.active !== false
    && profile.role_id
    && profile.roles?.es_externo !== true
  );
  if (hasInternalAccess) return "internal";

  const hasPortalAccess = memberships.some((membership) =>
    membership.activo !== false
    && membership.unidad_id
    && ["condomino", "residente"].includes(membership.rol)
  );
  if (hasPortalAccess) return "portal";

  const hasTenantPortalAccess = Boolean(
    profile
    && profile.active !== false
    && profile.role_id === "inquilino"
    && profile.roles?.es_externo === true
  );
  if (hasTenantPortalAccess) return "tenant_portal";

  return "unassigned";
}
