import { validateShadowToolArguments } from "../context.js";

const patterns = Object.freeze({
  pago_renta: /\b(?:cu[aá]nto\s+debo|saldo|adeudo|estado\s+de(?:l)?\s+pago|comprobante|confirmaci[oó]n|ya\s+pagu[eé]|pago\s+de\s+renta)\b/i,
  mantenimiento: /\b(?:ticket|seguimiento|reparaci[oó]n|t[eé]cnico|fuga|desperfecto|humedad|bomba|da[ñn]o|no\s+(?:lleg[oó]|arregl[oó]))\b/i,
  servicio: /\b(?:agua|cfe|luz|gas|internet|cuotas?|recibo|consumo|periodo|corte|adeudo|comprobante)\b/i,
  contrato: /\b(?:contrato|renovaci[oó]n|renovar|vence|vigencia|cancelar|monto\s+de\s+la\s+renta)\b/i,
  llaves: /\b(?:llave|llaves|acceso|resguardo|prest(?:ar|ada)|devolv(?:er|í))\b/i,
  propietario_liquidacion: /\b(?:liquidaci[oó]n|depositan\s+al\s+propietario|detalle\s+de\s+mi\s+liquidaci[oó]n)\b/i,
  work_center: /\b(?:caso\s+operativo|centro\s+operativo|trabajo\s+administrativo)\b/i,
});

const idFromEvidence = (tools, entityType) => {
  const ids = [...new Set((tools || []).filter((tool) => tool.ok).flatMap((tool) => tool.result || [])
    .filter((row) => row.entityType === entityType).map((row) => row.internalId || row.id).filter(Boolean))];
  return ids.length === 1 ? String(ids[0]) : null;
};

function collectIdentifiers(metadata = {}, resolvedEntities = [], tools = []) {
  const resolved = (type) => {
    const ids = [...new Set(resolvedEntities.filter((entity) => entity.entityType === type).map((entity) => entity.internalId).filter(Boolean))];
    return ids.length === 1 ? String(ids[0]) : null;
  };
  return {
    propertyId: metadata.propertyId || resolved("property") || idFromEvidence(tools, "property"),
    contractId: metadata.contractId || resolved("contract") || idFromEvidence(tools, "contract"),
    paymentId: metadata.paymentId || resolved("payment") || idFromEvidence(tools, "payment"),
    serviceId: metadata.serviceId || resolved("service") || idFromEvidence(tools, "service"),
    ticketId: metadata.ticketId || resolved("maintenance_ticket") || idFromEvidence(tools, "maintenance_ticket"),
    keyId: metadata.keyId || resolved("key") || idFromEvidence(tools, "key"),
    ownerPaymentId: metadata.ownerPaymentId || resolved("owner_liquidation") || idFromEvidence(tools, "owner_liquidation"),
    workCenterContextKey: metadata.workCenterContextKey || resolved("work_center_case"),
  };
}

const validCall = (name, args, reason) => {
  try { return { name, args: validateShadowToolArguments(name, args), reason, source: "policy_required" }; }
  catch { return null; }
};
const alreadySucceeded = (tools, call) => (tools || []).some((tool) => tool.ok && tool.name === call.name);

export function deriveRequiredTools({ intent, secondaryIntents = [], message = "", resolvedContext = [], availableIdentifiers = {}, metadata = {}, toolResults = [] }) {
  const ids = { ...collectIdentifiers(metadata, resolvedContext, toolResults), ...availableIdentifiers };
  const intents = new Set([intent, ...secondaryIntents]); const requiredNowTools = []; const expectedAfterClarificationTools = []; const notApplicableTools = [];
  const rule = (active, name, args, reason) => {
    if (!active) { notApplicableTools.push(name); return; }
    const call = validCall(name, args, reason);
    if (!call) { expectedAfterClarificationTools.push(name); return; }
    if (!alreadySucceeded(toolResults, call)) requiredNowTools.push(call);
  };
  rule(intents.has("pago_renta") && patterns.pago_renta.test(message), "get_payment_summary", ids.paymentId ? { paymentId: ids.paymentId } : { contractId: ids.contractId }, "policy:pago_renta_contexto_suficiente");
  rule(intents.has("mantenimiento") && patterns.mantenimiento.test(message), "get_maintenance_ticket_summary", ids.ticketId ? { ticketId: ids.ticketId } : { propertyId: ids.propertyId }, "policy:mantenimiento_contexto_suficiente");
  rule(intents.has("servicio") && patterns.servicio.test(message), "get_service_period_status", { serviceId: ids.serviceId }, "policy:servicio_contexto_suficiente");
  rule(intents.has("contrato") && patterns.contrato.test(message), "find_active_contracts", ids.contractId ? { contractId: ids.contractId } : { propertyId: ids.propertyId }, "policy:contrato_contexto_suficiente");
  rule(intents.has("llaves") && patterns.llaves.test(message), "get_key_custody_status", { keyId: ids.keyId }, "policy:llaves_contexto_suficiente");
  rule(intents.has("propietario_liquidacion") && patterns.propietario_liquidacion.test(message), "get_owner_liquidation_summary", { ownerPaymentId: ids.ownerPaymentId }, "policy:liquidacion_contexto_suficiente");
  rule(Boolean(ids.workCenterContextKey) && patterns.work_center.test(message), "get_work_center_case", { contextKey: ids.workCenterContextKey }, "policy:work_center_contexto_explicito");
  return { requiredNowTools, expectedAfterClarificationTools: [...new Set(expectedAfterClarificationTools)], notApplicableTools: [...new Set(notApplicableTools)], availableIdentifiers: ids };
}

const callKey = (call) => `${call.name}:${JSON.stringify(call.args)}`;
export function combinePolicyAndModelTools(policyCalls = [], modelCalls = []) {
  const combined = new Map();
  for (const call of policyCalls) combined.set(callKey(call), { ...call, source: "policy_required" });
  for (const call of modelCalls) {
    const key = callKey(call); const existing = combined.get(key);
    combined.set(key, existing ? { ...existing, source: "both", modelReason: call.reason } : { ...call, source: "model_proposed" });
  }
  return [...combined.values()];
}
