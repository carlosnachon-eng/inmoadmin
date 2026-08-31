export const SHADOW_INTERACTION_DIRECTIONS = Object.freeze([
  "inbound_customer_action",
  "internal_instruction_about_customer",
  "verified_status_update",
  "ambiguous_actor",
]);

const STAFF_ROLE = /^(?:admin|administrator|administrador|administradora|staff|internal|employee|empleado|empleada|coordinator|coordinador|coordinadora)$/i;
const INTERNAL_DIRECTIVE = /\b(?:hay\s+que|necesitamos|favor\s+de|por\s+favor)\s+(?:cobrar(?:le)?|recordar(?:le)?|pedir(?:le)?|contactar(?:lo|la|le)?|solicitar(?:le)?|dar\s+seguimiento)\b|\b(?:c[oó]brale|recu[eé]rdale|p[ií]dele|solic[ií]tale|contacta(?:lo|la|le))\b/i;
const INTERNAL_TEMPLATE = /\bte\s+recordamos\s+que\s+tienes\b[\s\S]{0,240}\b(?:pago|adeudo|comisi[oó]n)\b[\s\S]{0,240}\b(?:regulariza|emporio\s+inmobiliario)\b/i;
const THIRD_PARTY_REPORT = /\b(?:el\s+cliente|la\s+clienta|el\s+inquilino|la\s+inquilina|el\s+propietario|la\s+propietaria|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\s+(?:pag[oó]|envi[oó]|debe|adeuda|tiene\s+pendiente)(?:\s|$|[.,;:!?])/;
const CUSTOMER_SELF_ACTION = /\b(?:ya\s+pagu[eé]|env[ií]o|te\s+(?:mando|env[ií]o|comparto)|adjunto|cu[aá]nto\s+debo|mi\s+(?:pago|renta|contrato|propiedad)|sigue\s+(?:la|el)\s+(?:humedad|fuga|problema)|tengo\s+(?:humedad|una\s+fuga|un\s+problema)|recib[ií]|necesito|quisiera|me\s+puedes)(?=\s|$|[.,;:!?])/i;
const IDENTITY_INDEPENDENT_CUSTOMER_SIGNAL = /\b(?:les?\s+)?(?:paso|mando|env[ií]o|comparto|adjunto)\b|\bsoy\s+del\s+[a-z0-9-]+\b/i;
const CUSTOMER_MAINTENANCE_REPORT = /\b(?:encontr[eé]|reporto|tengo|tuve\s+que\s+cambiar|se\s+rompi[oó]|se\s+dañ[oó]|se\s+inund[oó]|inundad[oa]|fuga|gotera|humedad)\b/i;

const cleanRole = (metadata = {}) => String(metadata.turnAuthorRole || metadata.authorRole || metadata.contactRole || "").trim();

export function classifyInteractionDirection({ envelope = {}, identityRoles = [] } = {}) {
  const metadata = envelope.providerMetadata || {};
  if (metadata.operationalEvent === true || envelope.direction === "internal") return "verified_status_update";
  if (envelope.direction !== "inbound") return "ambiguous_actor";

  const text = String(envelope.sanitizedText || "");
  const staffAuthor = STAFF_ROLE.test(cleanRole(metadata));
  if (INTERNAL_DIRECTIVE.test(text) || INTERNAL_TEMPLATE.test(text) || (staffAuthor && THIRD_PARTY_REPORT.test(text))) {
    return "internal_instruction_about_customer";
  }
  if (staffAuthor) return "ambiguous_actor";

  const externalRole = /^(?:tenant|owner|inquilino|propietario)$/i.test(cleanRole(metadata))
    || identityRoles.some((role) => /^(?:tenant|owner|inquilino|propietario)$/i.test(String(role)));
  if (CUSTOMER_SELF_ACTION.test(text) || IDENTITY_INDEPENDENT_CUSTOMER_SIGNAL.test(text) || CUSTOMER_MAINTENANCE_REPORT.test(text) || externalRole) return "inbound_customer_action";
  return "ambiguous_actor";
}
