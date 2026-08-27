import { normalizeIdentityPhone } from "./identityBridge.js";

const ACTIVE = new Set(["activo", "active"]);
const safeLabel = (value, max = 80) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const unique = (values) => [...new Set(values.map((value) => safeLabel(value)).filter(Boolean))];
const activeRelation = (row) => ACTIVE.has(String(row.status || "").toLowerCase());
const maskedName = (value) => {
  const parts = safeLabel(value, 100).split(" ").filter(Boolean);
  if (!parts.length) return "Sin nombre operativo";
  return [parts[0], ...parts.slice(1, 4).map((part) => `${part[0]}.`)].join(" ");
};

export function buildRespondIdentityReviewModels({ links = [], contracts = [], properties = [], roles = [] } = {}) {
  return links.map((link) => {
    const relatedContracts = contracts.filter((row) => row.tenant_client_id === link.client_identity_id);
    const relatedProperties = properties.filter((row) => row.owner_client_id === link.client_identity_id);
    const propertyNames = unique([...relatedContracts.map((row) => row.property_name), ...relatedProperties.map((row) => row.name)]).slice(0, 12);
    const roleKinds = unique(roles.filter((row) => row.client_identity_id === link.client_identity_id && row.status === "active").map((row) => row.role_kind));
    const tenantPhone = relatedContracts.map((row) => normalizeIdentityPhone(row.tenant_phone)).find(Boolean);
    const ownerPhone = relatedProperties.map((row) => normalizeIdentityPhone(row.owner_phone)).find(Boolean);
    const ownerName = relatedContracts.find((row) => propertyNames.includes(safeLabel(row.property_name)))?.owner_name;
    return {
      displayName: maskedName(relatedContracts[0]?.tenant_name || ownerName),
      phoneLast4: (tenantPhone || ownerPhone)?.slice(-4) || null,
      roleLabels: roleKinds.map((role) => role === "tenant" ? "Inquilino" : role === "owner" ? "Propietario" : "Cliente"),
      propertyNames,
      activeContractCount: relatedContracts.filter(activeRelation).length,
      relatedPropertyCount: relatedProperties.length,
      contractEndDates: unique(relatedContracts.filter(activeRelation).map((row) => row.end_date)).slice(0, 12),
      matchMethodLabel: link.link_source === "exact_phone_unique" ? "Coincidencia exacta y única de teléfono" : "Revisión manual requerida",
    };
  });
}
