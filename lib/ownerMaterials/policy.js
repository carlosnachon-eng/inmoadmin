// Institutional materials only. This is not a router, a model tool or a new CRM.
export const MATERIAL_CODES = Object.freeze({
  rent: "OWNER_RENT_ADMIN_PRESENTATION",
  sale: "OWNER_SALE_PRESENTATION",
});
export const MATERIAL_STAGE = "owner_service_introduction_v1";
export const MATERIAL_BUCKET = "owner-approved-materials";
export const MATERIAL_MAX_BYTES = 10 * 1024 * 1024;
export const MATERIAL_LINK_SECONDS = 3600;
export const MATERIAL_CLARIFICATION = "¿Buscas apoyo para rentar, vender o administrar tu propiedad? Así puedo identificar la presentación adecuada.";
const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function materialsEnabled(env = process.env) {
  return env.OWNER_APPROVED_MATERIALS_V1_ENABLED === "true";
}

// Conservative selection from the current Owner inbound, never from model output,
// historical relative dates, contact names, untrusted URLs or conversational attachments.
export function selectOwnerMaterial(text) {
  const input = normalize(text);
  const rent = /\b(rentar|renta|arrendar|arrendamiento|alquilar|alquiler|administrar|administracion)\b/.test(input);
  const sale = /\b(vender|venta)\b/.test(input);
  const request = /\b(presentacion|folleto|pdf|material|servicios)\b/.test(input);
  const uncertain = /\b(no|ni|quizas|tal vez|todavia no|aun no)\b/.test(input);
  if ((rent && sale) || ((rent || sale) && uncertain)) return { kind: "clarify", code: null };
  if (rent) return { kind: "material", code: MATERIAL_CODES.rent };
  if (sale) return { kind: "material", code: MATERIAL_CODES.sale };
  return { kind: request ? "clarify" : "none", code: null };
}

export function deliveryMode(channelId) {
  // Respond's published Files matrix, not the generic unsupported-file URL fallback.
  if (["498219", "515318"].includes(String(channelId))) return "document";
  if (["497382", "497385"].includes(String(channelId))) return "temporary_link";
  return null; // Includes Admin 544519; never guess capabilities of an unknown channel.
}

export function materialWindowOpen(occurredAt, now = Date.now()) {
  const age = now - Date.parse(occurredAt);
  // A conservative 24h maximum for every channel; no templates or re-engagement here.
  return Number.isFinite(age) && age >= 0 && age < 24 * 60 * 60 * 1000;
}

export function rentalGuaranteeText({ residentialConfirmed, exclusiveContractConfirmed } = {}) {
  if (residentialConfirmed === true && exclusiveContractConfirmed === true) {
    return "La garantía de renta en 30 días o 20% de descuento aplica con las condiciones verificadas de inmueble habitacional y contrato de exclusiva con Emporio.";
  }
  return "La garantía de renta en 30 días o 20% de descuento sólo aplica a inmuebles habitacionales con contrato de exclusiva con Emporio; no confirmamos su aplicación a tu caso sin verificar ambas condiciones.";
}

export function guardOwnerMaterialResponse(text, selection) {
  if (selection.kind === "clarify") return MATERIAL_CLARIFICATION;
  const input = normalize(text);
  // Do not trust model assurances or a bare es_exclusiva checkbox as signed-contract evidence.
  // The current Owner context does not prove both conditions. Always qualify at runtime.
  if (/garanti[az]|30\s*dias|treinta\s*dias|20\s*%|veinte\s*por\s*ciento/.test(input)) return rentalGuaranteeText();
  // Material URLs are constructed only after the model, and are never persisted in its text.
  if (/(?:https?:\/\/|www\.)/i.test(String(text || ""))) return "¿Qué información del servicio te gustaría revisar?";
  return text;
}
