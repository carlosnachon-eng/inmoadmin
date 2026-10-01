// Social v1 policy only. No new assignment authority or classifier model.
const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export const socialSalesProtected = (inbound, env = process.env) => Boolean(inbound?.social_route_id)
  || (env.SOCIAL_ROUTING_V1_ENABLED === "true" && ["497382", "497385", "498219", "515318"].includes(String(inbound?.channel_id)));

export function isCommercialServiceOffer(text) {
  const t = normalize(text);
  return /\b(videos?|drones?|audiovisual(?:es)?|fotografia|fotografos?|marketing|recorridos virtuales)\b/.test(t)
    && /\b(ofrezco|ofrecemos|ofreciendo|ofrecer|ofertamos|brindo|brindamos|nuestros servicios|mis servicios|soy (?:videografo|fotografo)|hacemos videos|realizamos videos)\b/.test(t);
}

export function explicitPropertyAppointment(text, { verifiedProperty = false } = {}) {
  const t = normalize(text);
  if (isCommercialServiceOffer(t)) return false;
  const prospect = /\b(casa|departamento|depa|local|oficina|bodega|terreno|inmueble|propiedad)\b/.test(t) || verifiedProperty;
  const request = /\b(?:quiero|quisiera|me gustaria|podemos|puedo|podria|podrias|puedes|deseo|necesito)\b.{0,55}\b(?:ver(?:lo|la)?|conocer(?:lo|la)?|visitar|visita|cita|mostrar|mostrarme|ensenar|ensenarme)\b/.test(t)
    || /\b(?:agendar|agendamos|agendo|concertar|programar)\b.{0,35}\b(?:visita|cita)\b/.test(t)
    || /\b(?:cuando|que horario|a que hora)\b.{0,45}\b(?:visitar|ver(?:lo|la)?|visita)\b/.test(t);
  return prospect && request;
}

export function isShortSocialCta(text) {
  const t = normalize(text).trim();
  const words = t.match(/[a-z0-9]+/g) || [];
  return words.length > 0 && words.length <= 4 && !/[?¿]/.test(t)
    && !/\b(hola|buenos|buenas|gracias|perfecto|ok|si|no|quiero|busco|necesito|comprar|rentar|cita|visita|asesor|ayuda|queja|poliza|contrato|pago|ofrezco)\b/.test(t);
}

export const SOCIAL_CTA_CLARIFICATION = "¿A qué propiedad o publicación te refieres? Si tienes el enlace o la zona, compártelo.";
export const SOCIAL_INVENTORY_CLARIFICATION = "No puedo identificar con certeza la propiedad de esa publicación. ¿Me compartes el enlace o la ubicación para verificarla?";
export function isInventoryAbsenceClaim(text) {
  const t = normalize(text);
  return /\b(?:no (?:me )?(?:aparecen|aparece|hay|tenemos|tengo|existen|existe|encontre|encuentro|encontramos|contamos)|ningun[ao]?|sin (?:inventario|propiedades|casas|opciones))\b/.test(t)
    && /\b(casas?|propiedades|inmuebles|inventario|publicad[ao]s?|opciones|resultados|departamentos|terrenos|listados|viviendas)\b/.test(t);
}
