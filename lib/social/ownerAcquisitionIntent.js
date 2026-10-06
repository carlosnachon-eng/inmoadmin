// Social-only acquisition evidence. No fallback, model or assignment authority.
const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
const PROPERTY = "(?:casas?|departamentos?|depas?|lofts?|local(?:es)?|oficinas?|bodegas?|terrenos?|inmuebles?|propiedad(?:es)?)";
const OWN_PROPERTY = new RegExp(`\\b(?:mi|mis|nuestr[oa]s?) ${PROPERTY}\\b`);
const OWN_INVENTORY = new RegExp(`\\b(?:tengo|tenemos) (?:disponibilidad de )?(?:(?:un|una|unos|unas|varios|varias) )?${PROPERTY}\\b`);
const OWN_LISTING_REQUEST = new RegExp(`\\b(?:vender|rentar|alquilar|publicar|promover|comercializar|colocar|promocionar) (?:mi|mis|nuestr[oa]s?) ${PROPERTY}\\b`);
const LISTING_SERVICE = /\b(?:comercializacion|colocacion|promocion|publicacion|(?:comercializar|colocar|promocionar|promover|publicar)(?:lo|la|los|las)?|promocionen)\b/;
const NEW_PROPERTY_SEARCH = new RegExp(`\\bahora busco (?:(?:un|una|otro|otra) )?${PROPERTY}\\b`);

export function hasOwnerAcquisitionRequest(text) {
  const t = normalize(text);
  if (/\b(?:no|tampoco) (?:tengo|tenemos|quiero|necesito|busco)\b/.test(t)) return false;
  // "comisión", "colaboración", "inmobiliaria" or "renta" alone do not
  // establish an owner: require a request about one's own property/inventory.
  return OWN_LISTING_REQUEST.test(t)
    || ((OWN_PROPERTY.test(t) || OWN_INVENTORY.test(t)) && LISTING_SERVICE.test(t));
}

export function isExplicitOwnerToBuyerChange(text) {
  const t = normalize(text);
  if (hasOwnerAcquisitionRequest(t)) return false;
  // Searching for an agency to market the owner's units is NOT a buyer change.
  return /\b(?:quiero comprar|quiero rentar (?:una|un|otra|otro)|ahora busco (?:comprar|rentar))\b/.test(t)
    || NEW_PROPERTY_SEARCH.test(t);
}
