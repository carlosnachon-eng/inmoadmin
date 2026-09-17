const OPERATIONAL_LANGUAGE = /\b(?:agua|gas|luz|cfe|internet|recibo|comprobante|pago|saldo|adeudo|renta|contrato|servicio|reparaci[oó]n|mantenimiento|necesito|quiero|puedes|podr[ií]as|revisa|confirma|sube|carga|registra|env[ií]a|duda|pregunta)\b/i;
const CLOSURE_ONLY = /^(?:(?:muchas?\s+)?gracias|perfecto|excelente|entendido|de\s+acuerdo|ok(?:ay)?|sale|listo|buen(?:os)?\s+d[ií]as?|buena\s+tarde|igualmente|hasta\s+luego)(?:\s+(?:muchas?\s+)?gracias|\s+igualmente|\s+buen(?:os)?\s+d[ií]as?)?[.!¡¿?\s]*$/i;

export function isConversationalClose(envelope = {}) {
  const text = String(envelope?.sanitizedText || "").trim();
  const attachment = envelope?.providerMetadata?.attachmentContext;
  const hasAttachment = attachment?.present === true || (attachment?.items || []).length > 0 || /\[(?:IMAGEN|DOCUMENTO|ARCHIVO)\]/i.test(text);
  if (!text || text.length > 120 || hasAttachment || text.includes("?") || OPERATIONAL_LANGUAGE.test(text)) return false;
  return CLOSURE_ONLY.test(text.replace(/[.!¡,;:]+/g, " ").replace(/\s+/g, " ").trim());
}
