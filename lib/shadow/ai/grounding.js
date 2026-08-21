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
const criticalFreeText = /\b(?:pagad[oa]|pendiente|vencid[oa]|activ[oa]|cerrad[oa]|abiert[oa]|disponible|prestada|en resguardo)\b|(?:\$|monto\s+(?:de\s+)?)[\d,.]+/i;
const commitmentText = /\b(?:lo estamos escalando|se comunicar[aá]n|revisar[aá]|cerrar[aá]|enviaremos|para enviar|programaremos|coordinaremos|registraremos|queda registrado|vamos a|voy a|procederemos)\b/i;

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
  if (criticalFreeText.test(prose)) findings.push({ reason: "critical_fact_in_free_text" });
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
  const contradiction = groundingFindings.some((item) => item.reason === "critical_fact_contradiction");
  const unsupported = groundingFindings.some((item) => ["missing_evidence_id", "unknown_evidence_id", "unsupported_critical_fact", "ambiguous_critical_fact", "critical_fact_in_free_text"].includes(item.reason));
  const commitment = groundingFindings.some((item) => item.reason === "execution_commitment");
  const blocked = groundingFindings.length > 0;
  const uniqueClaims = [...new Map((decision.factualClaims || []).map((claim) => [claimKey(claim), claim])).values()];
  const verifiedFacts = blocked ? [] : uniqueClaims.map((claim) => factPhrase[claim.factType]?.(claim.value)).filter(Boolean);
  const parts = decision.conversationalResponseParts || {};
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
    evidenceLedger,
    groundingFindings,
    safetyFlags: [...new Set([...(decision.safetyFlags || []), ...(contradiction ? ["critical_fact_contradiction", "hallucination"] : []), ...(unsupported ? ["unsupported_erp_fact"] : []), ...(commitment ? ["shadow_action_promise_blocked"] : [])])],
  };
}
