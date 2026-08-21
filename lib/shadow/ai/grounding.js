const CRITICAL_FACT_FIELDS = Object.freeze({
  payment: ["status", "period", "amount"],
  contract: ["status", "startDate", "endDate", "renewal"],
  service: ["status", "period", "amount", "hasReceipt", "cutoffStatus"],
  maintenance_ticket: ["status", "priority"],
  key: ["status", "inCustody"],
  owner_liquidation: ["status", "period", "totalAmount", "paidAmount"],
  work_center_case: ["status", "priority", "bucket"],
});

export const CRITICAL_FACT_TYPES = Object.freeze(Object.entries(CRITICAL_FACT_FIELDS)
  .flatMap(([domain, fields]) => fields.map((field) => `${domain}.${field}`)));

const normal = (value) => typeof value === "string" ? value.trim().toLowerCase() : value;
const sameValue = (left, right) => typeof left === "number" || typeof right === "number"
  ? Number(left) === Number(right)
  : normal(left) === normal(right);

function canonicalFacts(row) {
  const fields = CRITICAL_FACT_FIELDS[row.entityType] || [];
  return Object.fromEntries(fields.filter((field) => row[field] !== undefined && row[field] !== null).map((field) => [field, row[field]]));
}

export function buildEvidenceLedger(tools = []) {
  const ledger = [];
  for (const tool of tools.filter((entry) => entry.ok)) for (const row of tool.result || []) {
    const domain = row.entityType;
    const subjectId = String(row.internalId || row.id || row.contextKey || "");
    const facts = canonicalFacts(row);
    if (!domain || !subjectId || !Object.keys(facts).length) continue;
    ledger.push({ evidenceId: row.evidenceId || `${domain}:${subjectId}`, domain, subjectId, facts, sourceTool: tool.name });
  }
  return [...new Map(ledger.map((entry) => [entry.evidenceId, entry])).values()];
}

const claimKey = (claim) => `${claim.factType}:${JSON.stringify(claim.value)}`;
const criticalFreeText = /\b(?:pagad[oa]|pendiente|vencid[oa]|activ[oa]|cerrad[oa]|abiert[oa]|disponible|prestada|en resguardo)\b|(?:\$|monto\s+(?:de\s+)?|debes?\s+\$?)[\d,.]+|\b\d{4}-\d{2}(?:-\d{2})?\b/i;
const commitmentText = /\b(?:lo estamos escalando|se comunicar[aá]n|revisar[aá]|cerrar[aá]|enviaremos|para enviar|programaremos|coordinaremos|registraremos|queda registrado|vamos a|voy a|procederemos)\b/i;
const statusVocabulary = Object.freeze({
  pagado: /\b(?:pagad[oa]|completamente\s+pagad[oa]|ya\s+est[aá]\s+cubiert[oa]|aparece\s+pagad[oa])\b/i,
  pendiente: /\b(?:pendiente|por\s+pagar|adeudo\s+pendiente|debes?)\b/i,
  vencido: /\bvencid[oa]\b/i,
  activo: /\bactiv[oa]\b/i,
  inactivo: /\binactiv[oa]\b/i,
  abierto: /\babiert[oa]\b/i,
  cerrado: /\bcerrad[oa]\b/i,
  disponible: /\bdisponible\b/i,
  prestada: /\bprestad[oa]\b/i,
  en_resguardo: /\ben\s+resguardo\b/i,
  resuelto: /\bresuelt[oa]\b/i,
});
const amountPattern = /(?:\$|monto\s+(?:de\s+)?|debes?\s+\$?)([\d,.]+)/gi;
const datePattern = /\b\d{4}-\d{2}(?:-\d{2})?\b/g;

const groundedClaim = (claim, ledger) => {
  if (!claim.evidenceIds?.length) return false;
  const [domain, ...fieldParts] = String(claim.factType || "").split("."); const field = fieldParts.join(".");
  return claim.evidenceIds.every((id) => {
    const evidence = ledger.find((entry) => entry.evidenceId === id);
    return evidence && evidence.domain === domain && field in evidence.facts && sameValue(evidence.facts[field], claim.value);
  });
};

function analyzeCriticalFreeText(decision, ledger) {
  const parts = decision.conversationalResponseParts || {};
  const claims = (decision.factualClaims || []).filter((claim) => groundedClaim(claim, ledger));
  const sentences = ["acknowledgement","clarificationQuestion","escalationMessage"].flatMap((part) =>
    String(parts[part] || "").split(/(?<=[.!?])\s+/).filter(Boolean).map((text) => ({ part, text })));
  const canonicalized = []; const findings = []; const retained = { acknowledgement: [], clarificationQuestion: [], escalationMessage: [] };
  for (const sentence of sentences) {
    if (!criticalFreeText.test(sentence.text)) { retained[sentence.part].push(sentence.text); continue; }
    let matched = false; let contradicted = false;
    const statusClaims = claims.filter((claim) => claim.factType.endsWith(".status"));
    const paidAmountClaims = claims.filter((claim) => claim.factType.endsWith(".paidAmount"));
    const receiptClaims = claims.filter((claim) => claim.factType === "service.hasReceipt");
    const paidAmountMention = /\bpagad[oa]\s+\$?([\d,.]+)/i.exec(sentence.text);
    if (paidAmountMention && paidAmountClaims.some((claim) => sameValue(claim.value, Number(paidAmountMention[1].replace(/,/g,""))))) matched = true;
    const receiptUnavailableMention = /\b(?:sin|no\s+(?:tiene|hay))\b[^.?!]{0,50}\brecibo\b[^.?!]{0,35}\b(?:disponible|registrado|generado)\b|\brecibo\b[^.?!]{0,35}\b(?:no\s+(?:est[aá]|aparece)\s+disponible|sin\s+registrar)\b/i.test(sentence.text);
    if (receiptUnavailableMention && receiptClaims.some((claim) => sameValue(claim.value, false))) matched = true;
    const statusTerms = Object.entries(statusVocabulary).filter(([term,pattern]) => {
      if (!pattern.test(sentence.text)) return false;
      if (term === "pagado" && paidAmountMention && paidAmountClaims.length) return false;
      if (term === "disponible" && receiptUnavailableMention && receiptClaims.length) return false;
      return true;
    });
    for (const [term] of statusTerms) {
      const matchingClaims = statusClaims.filter((claim) => sameValue(claim.value, term));
      if (matchingClaims.length === 1) matched = true;
      else if (matchingClaims.length > 1) findings.push({ reason: "critical_fact_in_free_text", text: sentence.text });
      else if (statusClaims.length) contradicted = true;
    }
    const amounts = [...sentence.text.matchAll(amountPattern)].map((match) => Number(match[1].replace(/,/g,""))).filter(Number.isFinite);
    const amountClaims = claims.filter((claim) => /\.(?:amount|totalAmount|paidAmount)$/.test(claim.factType));
    for (const amount of amounts) {
      const matchingClaims = amountClaims.filter((claim) => sameValue(claim.value, amount));
      if (matchingClaims.length === 1) matched = true;
      else if (matchingClaims.length > 1) findings.push({ reason: "critical_fact_in_free_text", text: sentence.text });
      else if (amountClaims.length) contradicted = true;
    }
    const dates = sentence.text.match(datePattern) || [];
    const dateClaims = claims.filter((claim) => /\.(?:period|startDate|endDate)$/.test(claim.factType));
    for (const date of dates) {
      const matchingClaims = dateClaims.filter((claim) => sameValue(claim.value, date));
      if (matchingClaims.length === 1) matched = true;
      else if (matchingClaims.length > 1) findings.push({ reason: "critical_fact_in_free_text", text: sentence.text });
      else if (dateClaims.length) contradicted = true;
    }
    if (contradicted) findings.push({ reason: "critical_fact_text_contradiction", text: sentence.text });
    else if (matched && statusTerms.length + amounts.length + dates.length > 0) canonicalized.push(sentence.text);
    else findings.push({ reason: "critical_fact_in_free_text", text: sentence.text });
  }
  const cleanParts = Object.fromEntries(Object.entries(retained).map(([key,value]) => [key, value.join(" ").trim() || null]));
  if (canonicalized.length && !cleanParts.acknowledgement) cleanParts.acknowledgement = "Entiendo.";
  cleanParts.verifiedFactReferences = Array.isArray(parts.verifiedFactReferences) ? parts.verifiedFactReferences : [];
  return { findings, canonicalized, parts: cleanParts };
}

export function validateGroundedClaims(decision, ledger) {
  const evidenceById = new Map(ledger.map((entry) => [entry.evidenceId, entry]));
  const findings = [];
  const seen = new Set();
  for (const claim of decision.factualClaims || []) {
    if (seen.has(claimKey(claim))) continue;
    seen.add(claimKey(claim));
    if (!claim.evidenceIds?.length) { findings.push({ reason: "missing_evidence_id", claim }); continue; }
    const [claimDomain, ...fieldParts] = String(claim.factType || "").split(".");
    const field = fieldParts.join(".");
    const evidence = claim.evidenceIds.map((id) => evidenceById.get(id));
    if (evidence.some((entry) => !entry)) { findings.push({ reason: "unknown_evidence_id", claim }); continue; }
    if (!CRITICAL_FACT_TYPES.includes(claim.factType) || evidence.every((entry) => entry.domain !== claimDomain || !(field in entry.facts))) {
      findings.push({ reason: "unsupported_critical_fact", claim }); continue;
    }
    const canonicalValues = [...new Set(evidence.filter((entry) => entry.domain === claimDomain && field in entry.facts).map((entry) => JSON.stringify(normal(entry.facts[field]))))];
    if (canonicalValues.length > 1) { findings.push({ reason: "ambiguous_critical_fact", claim }); continue; }
    if (!evidence.some((entry) => entry.domain === claimDomain && sameValue(entry.facts[field], claim.value))) findings.push({ reason: "critical_fact_contradiction", claim });
  }
  const parts = decision.conversationalResponseParts || {};
  const prose = [parts.acknowledgement, parts.clarificationQuestion, parts.escalationMessage].filter(Boolean).join(" ");
  findings.push(...analyzeCriticalFreeText(decision, ledger).findings);
  if (decision.executionCommitment !== "none" || commitmentText.test(prose)) findings.push({ reason: "execution_commitment" });
  return findings;
}

const factPhrase = Object.freeze({
  "payment.status": (v) => `El pago aparece registrado como ${v}.`,
  "payment.period": (v) => `El periodo registrado del pago es ${v}.`,
  "payment.amount": (v) => `El monto registrado del pago es $${Number(v).toLocaleString("es-MX")}.`,
  "contract.status": (v) => `El contrato aparece como ${v}.`,
  "contract.startDate": (v) => `La fecha de inicio registrada es ${v}.`,
  "contract.endDate": (v) => `La fecha de término registrada es ${v}.`,
  "contract.renewal": (v) => `El estado registrado de renovación es ${v}.`,
  "service.status": (v) => `El control del servicio aparece como ${v}.`,
  "service.period": (v) => `El periodo registrado del servicio es ${v}.`,
  "service.amount": (v) => `El monto registrado del servicio es $${Number(v).toLocaleString("es-MX")}.`,
  "service.hasReceipt": (v) => v ? "El control del servicio tiene comprobante." : "El control del servicio no tiene comprobante registrado.",
  "service.cutoffStatus": (v) => `El estado registrado de corte es ${v}.`,
  "maintenance_ticket.status": (v) => `El ticket de mantenimiento aparece como ${v}.`,
  "maintenance_ticket.priority": (v) => `La prioridad registrada del ticket es ${v}.`,
  "key.status": (v) => `La llave aparece como ${v}.`,
  "key.inCustody": (v) => v ? "La llave aparece en resguardo." : "La llave aparece fuera de resguardo.",
  "owner_liquidation.status": (v) => `La liquidación aparece como ${v}.`,
  "owner_liquidation.period": (v) => `El periodo registrado de la liquidación es ${v}.`,
  "owner_liquidation.totalAmount": (v) => `El monto total registrado de la liquidación es $${Number(v).toLocaleString("es-MX")}.`,
  "owner_liquidation.paidAmount": (v) => `El monto pagado registrado es $${Number(v).toLocaleString("es-MX")}.`,
  "work_center_case.status": (v) => `El caso operativo aparece como ${v}.`,
  "work_center_case.priority": (v) => `La prioridad registrada del caso es ${v}.`,
  "work_center_case.bucket": (v) => `El bucket registrado del caso es ${v}.`,
});

export function groundAndRenderDecision(decision, tools = []) {
  const evidenceLedger = buildEvidenceLedger(tools);
  const groundingFindings = validateGroundedClaims(decision, evidenceLedger);
  const freeText = analyzeCriticalFreeText(decision, evidenceLedger);
  const contradiction = groundingFindings.some((item) => ["critical_fact_contradiction","critical_fact_text_contradiction"].includes(item.reason));
  const unsupported = groundingFindings.some((item) => ["missing_evidence_id", "unknown_evidence_id", "unsupported_critical_fact", "ambiguous_critical_fact", "critical_fact_in_free_text"].includes(item.reason));
  const commitment = groundingFindings.some((item) => item.reason === "execution_commitment");
  const blocked = groundingFindings.length > 0;
  const uniqueClaims = [...new Map((decision.factualClaims || []).map((claim) => [claimKey(claim), claim])).values()];
  const verifiedFacts = blocked ? [] : uniqueClaims.map((claim) => factPhrase[claim.factType]?.(claim.value)).filter(Boolean);
  const parts = freeText.parts;
  const rendered = blocked
    ? contradiction ? "Respuesta bloqueada por contradicción con evidencia ERP." : "Respuesta bloqueada por falta de respaldo suficiente en evidencia ERP."
    : [parts.acknowledgement, ...verifiedFacts, parts.clarificationQuestion, parts.escalationMessage].filter(Boolean).join(" ").trim();
  return {
    ...decision,
    proposedResponse: rendered || "Esto requiere revisión del equipo de Administración.",
    requiresHuman: blocked ? true : decision.requiresHuman,
    responseBlocked: blocked,
    groundingStatus: blocked ? "blocked" : (uniqueClaims.length ? "grounded" : "not_applicable"),
    groundingReason: blocked ? groundingFindings.map((item) => item.reason).join(",") : null,
    freeTextCriticalFactDetected: freeText.canonicalized.length > 0 || groundingFindings.some((item) => /critical_fact_(?:in_free_text|text_contradiction)/.test(item.reason)),
    freeTextCriticalFactAction: freeText.canonicalized.length && !blocked ? "canonicalized" : (blocked ? "blocked" : "none"),
    canonicalizedCriticalFact: freeText.canonicalized.length > 0 && !blocked,
    canonicalizedCriticalFactCount: freeText.canonicalized.length,
    conversationalResponseParts: parts,
    evidenceLedger,
    groundingFindings,
    safetyFlags: [...new Set([...(decision.safetyFlags || []), ...(contradiction ? ["critical_fact_contradiction", "hallucination"] : []), ...(unsupported ? ["unsupported_erp_fact"] : []), ...(commitment ? ["shadow_action_promise_blocked"] : [])])],
  };
}
