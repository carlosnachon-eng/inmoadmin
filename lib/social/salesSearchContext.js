// Bounded, explicit constraints only. Unrecognized language remains in the model's
// conversation history; it is not permission to widen a search.
const norm = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export const concreteSalesReference = value => /\[URL\]|https?:\/\/|\b(?:esa|ese|esta|este)\s+(?:casa|departamento|depa|propiedad|inmueble|publicacion|anuncio)|\b(?:publicacion|anuncio|codigo|folio)|\b(?:casa|propiedad) que (?:indicas|publicaste|vi)\b/i.test(norm(value));

export function explicitSalesSearch(history = []) {
  const result = {};
  let intent = "general_search";
  for (const row of history) {
    const raw = String(row?.sanitized_text ?? row ?? "").slice(0,2000), t = norm(raw);
    if (concreteSalesReference(raw)) intent = "specific_reference";
    else if (/\b(?:busco|buscando|quiero|necesito|opciones de)\b/.test(t) && /\b(?:casa|departamento|terreno|inmueble)s?\b/.test(t)) intent = "general_search";
    if (/\b(?:renta|rentar|alquilar)\b/.test(t)) result.operation = "rental";
    else if (/\b(?:compra|comprar|venta)\b/.test(t)) result.operation = "sale";
    const type = t.match(/\b(casa|departamento|terreno|local|oficina|bodega)s?\b/);
    if (type) result.propertyType = type[1][0].toUpperCase() + type[1].slice(1);
    const budget = t.match(/\b(?:maximo|hasta|presupuesto(?: de)?|tope(?: de)?)\s*\$?\s*(\d[\d,]*(?:\.\d{1,2})?)(?:\s*(mil))?/);
    if (budget) result.maxPrice = Number(budget[1].replaceAll(",", "")) * (budget[2] ? 1000 : 1);
    if (/\b(?:pet[ -]?friendly|(?:acept[ae]n?|permit[ae]n?) mascotas|con (?:mascotas?|perros?|gatos?)|tengo (?:un |una |dos )?(?:mascota|perro|gato))\b/.test(t)) result.petsAllowed = true;
    // Stop geography before non-location constraints. 'Alrededores' is retained
    // as a request, but is NOT converted into an arbitrary geographic expansion.
    const location = [...raw.matchAll(/\b(?:en|por|zona(?: de)?)\s+/ig)]
      .map(m => raw.slice(m.index + m[0].length)).find(v => !/^(?:renta|venta|compra)\b/i.test(v));
    if (location) {
      const zone = location.split(/\b(?:pet[ -]?friendly|m[aá]ximo|hasta|presupuesto|con mascotas|que acept|que permit)|\$|[;\n?¿]/i)[0]
        .replace(/\s+o\s+alrededores\b.*$/i, "").replace(/[,.\s]+$/, "").trim();
      if (zone && !/\d{4,}/.test(zone)) {
        result.zone = zone.slice(0,120);
        result.nearbyRequested = /\bo alrededores\b/i.test(location);
      }
    }
  }
  return { intent, filters: result };
}

export function socialSearchFilters(args, context) {
  const known = context.search?.filters || explicitSalesSearch([context.messageText]).filters;
  const filters = { ...args, ...known };
  delete filters.nearbyRequested;
  // A municipality in the user's zone is not necessarily the inventory's city
  // column. Do not add a model-inferred city that makes the explicit zone empty.
  if (known.zone) delete filters.city;
  context.search = { ...(context.search || explicitSalesSearch([context.messageText])), filters: known };
  if (context.sourcePropertyId) context.search.intent = "specific_reference";
  return filters;
}

export function salesSearchSummary(filters = {}) {
  return [filters.propertyType?.toLowerCase(), filters.operation === "rental" ? "en renta" : filters.operation === "sale" ? "en venta" : "",
    filters.zone ? `en ${filters.zone}` : filters.city ? `en ${filters.city}` : "",
    Number.isFinite(filters.maxPrice) ? `con presupuesto máximo de $${filters.maxPrice.toLocaleString("es-MX")} MXN` : "",
    filters.petsAllowed === true ? "que acepte mascotas" : ""].filter(Boolean).join(" ") || "los criterios indicados";
}

export function salesSearchNextQuestion(filters = {}) {
  const missing = [!filters.operation && "si buscas renta o compra", !filters.propertyType && "el tipo de inmueble",
    !filters.zone && !filters.city && "la zona", !Number.isFinite(filters.maxPrice) && "el presupuesto máximo"].filter(Boolean);
  return missing.length ? `¿Me confirmas ${missing.join(" y ")}?` : "Mantengo estos requisitos; sólo los cambiaré si tú me lo indicas.";
}
