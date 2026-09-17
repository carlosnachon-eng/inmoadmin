// Sanitized, persisted evidence only; no lookup or inference in the browser.
export default function RunIdentityScope({ item }) {
  if (item.identityDomain !== "condominium") return <>propiedad: {item.propertyResolved ? "resuelta" : "no resuelta"}</>;
  return <>dominio: Condominios · unidad: {item.unitResolved ? item.unitRef : "no determinada"}
    {item.condominiumRef ? ` · condominio: ${item.condominiumRef}` : ""}
    {item.unitCount > 1 ? ` · ${item.unitCount} unidades aprobadas (sin selección)` : ""}</>;
}
