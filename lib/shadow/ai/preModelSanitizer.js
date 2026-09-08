const MAX_INPUT = 4000;
const MAX_OUTPUT = 2000;

const RULES = Object.freeze([
  ["url", /\b(?:https?:\/\/|www\.)\S+/giu, "[URL]"],
  ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[EMAIL]"],
  ["secret", /\b(?:bearer\s+)?(?:eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{8,}){1,2}|(?:sk|pk|key|token|secret)[-_=: ]+[A-Za-z0-9_./+-]{8,})\b/giu, "[SECRETO]"],
  ["uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, "[ID]"],
  ["opaque_id", /\b(?:contact|conversation|message|property|contract|payment|ticket|user|run|claim|external)[-_:#][A-Za-z0-9._:-]{4,}\b/giu, "[ID]"],
  ["account_labeled", /\b(?:cuenta|clabe|tarjeta)\s*(?:n[uú]m(?:ero)?\.?|no\.?|#|:)?\s*\d(?:[ -]?\d){5,}\b/giu, (match) => `${match.slice(0, match.search(/\d/u))}[CUENTA]`],
  ["bank", /\b\d(?:[ -]?\d){15,17}\b/gu, "[CUENTA]"],
  ["phone", /(?<!\d)(?:\+?52[\s().-]?)?\d(?:[\s().-]?\d){9}(?!\d)/gu, "[TELEFONO]"],
  ["folio", /\b(?:folio|referencia|operaci[oó]n|autorizaci[oó]n|rastreo|ticket)\s*(?:n[uú]m(?:ero)?\.?|no\.?|#|:)?\s*[A-Z0-9][A-Z0-9._/-]{3,}\b/giu, "$1 [FOLIO]"],
  ["amount", /(?:\$|MXN\s*)\s*\d[\d,.]*/giu, "[MONTO]"],
  ["direct_greeting", /^(\s*(?:[Hh]ola|[Bb]uen(?:os|as)\s+d[ií]as|[Bb]uenas\s+tardes|[Bb]uenas\s+noches)[, ]+)\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?(?=[,.:;!?])/u, "$1[PERSONA]"],
  ["named_person", /\b(?:[Ss]oy|[Mm]e llamo|[Mm]i nombre es|[Aa] nombre de|[Hh]abla|[Cc]ontacta(?:r)? a)\s+(?:el\s+[Ss]r\.?|la\s+[Ss]ra\.?)?\s*\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+){0,3}/gu, (match) => `${match.slice(0, match.search(/\p{Lu}/u))}[PERSONA]`],
  ["honorific", /\b(?:[Ss]r\.?|[Ss]ra\.?|[Ss]eñor|[Ss]eñora|[Ll]ic\.?|[Ll]icenciado|[Ll]icenciada|[Ii]ng\.?|[Ii]ngeniero|[Ii]ngeniera|[Aa]rq\.?|[Aa]rquitecto|[Aa]rquitecta)\s+\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+){0,3}/gu, "[PERSONA]"],
  ["address", /\b(?:calle|avenida|av\.?|boulevard|blvd\.?|privada|cerrada|carretera|camino|andador)\s+[\p{L}0-9 .'-]{1,70}?(?=\s*(?:,|\b(?:colonia|col\.?|cp\.?|c\.p\.|interior|int\.?|depto\.?|departamento)\b|$))/giu, "[DOMICILIO]"],
  ["address_reference", /\b[\p{Lu}][\p{L}'-]{2,}(?:\s+[\p{Lu}][\p{L}'-]{2,})?\s+#?\d{1,5}\b/gu, "[DOMICILIO]"],
  ["postal", /\b(?:c\.?p\.?|c[oó]digo postal)\s*:?[ ]*\d{5}\b/giu, "[CP]"],
  ["capitalized_pair", /\b\p{Lu}[\p{Ll}\p{M}'-]{2,}\s+\p{Lu}[\p{Ll}\p{M}'-]{2,}\b/gu, "[PERSONA]"],
]);

const RESIDUAL = Object.freeze([
  ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu],
  ["url", /\b(?:https?:\/\/|www\.)\S+/iu],
  ["secret", /\b(?:eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{8,}){1,2}|(?:sk|pk|key|token|secret)[-_=: ]+[A-Za-z0-9_./+-]{8,})\b/iu],
  ["uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu],
  ["long_number", /\b(?:\d[ -]?){10,18}\b/u],
  ["labeled_identifier", /\b(?:folio|referencia|operaci[oó]n|autorizaci[oó]n|rastreo|cuenta|clabe|tarjeta|token|api\s*key)\s*(?:no\.?|#|:)?\s*[A-Z0-9][A-Z0-9._/-]{3,}\b/iu],
  ["address", /\b(?:calle|avenida|av\.?|boulevard|blvd\.?|privada|cerrada|carretera|camino|andador)\s+[\p{L}0-9]/iu],
  ["address_reference", /\b\p{Lu}[\p{L}'-]{2,}(?:\s+\p{Lu}[\p{L}'-]{2,})?\s+#?\d{1,5}\b/u],
  ["explicit_person", /\b(?:[Ss]oy|[Mm]e llamo|[Mm]i nombre es|[Aa] nombre de|[Ee]s para|[Hh]abla con|[Cc]ontacta(?:r)? a|[Ss]r\.?|[Ss]ra\.?|[Ss]eñor|[Ss]eñora|[Ll]ic\.?)\s+\p{Lu}[\p{L}'-]+/u],
  ["capitalized_pair", /\b\p{Lu}[\p{Ll}\p{M}'-]{2,}\s+\p{Lu}[\p{Ll}\p{M}'-]{2,}\b/u],
]);

export function verifyPreModelPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { allowed: false, reasons: ["invalid_payload"] };
  if (Object.keys(payload).length !== 1 || typeof payload.message !== "string") return { allowed: false, reasons: ["non_minimal_payload"] };
  if (!payload.message.trim() || payload.message.length > MAX_OUTPUT) return { allowed: false, reasons: ["invalid_message_length"] };
  const reasons = RESIDUAL.filter(([, pattern]) => pattern.test(payload.message)).map(([reason]) => `residual_${reason}`);
  return { allowed: reasons.length === 0, reasons };
}

export function sanitizePreModelInput({ text, metadata } = {}) {
  if (typeof text !== "string" || text.length > MAX_INPUT) return { allowed: false, reasons: ["invalid_source_text"], payload: null, replacements: {} };
  let message = text.normalize("NFC"); const replacements = {};
  for (const [kind, pattern, replacement] of RULES) {
    let count = 0;
    message = message.replace(pattern, (...args) => { count += 1; return typeof replacement === "function" ? replacement(...args) : replacement; });
    if (count) replacements[kind] = count;
  }
  message = message.replace(/\s{2,}/g, " ").trim().slice(0, MAX_OUTPUT);
  const payload = { message };
  const verification = verifyPreModelPayload(payload);
  const metadataDiscarded = metadata && typeof metadata === "object" ? Object.keys(metadata).length : 0;
  return { ...verification, payload: verification.allowed ? payload : null, replacements, metadataDiscarded };
}

export async function invokeSanitizedPhase3A(source, invokePhase3A) {
  if (typeof invokePhase3A !== "function") throw new TypeError("invokePhase3A must be a function");
  const sanitization = sanitizePreModelInput(source);
  if (!sanitization.allowed) return { invoked: false, sanitization, result: null };
  const result = await invokePhase3A(sanitization.payload);
  return { invoked: true, sanitization, result };
}
