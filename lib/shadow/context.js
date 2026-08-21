const MAX_RESULTS = 5;
const numericOrUndefined = (value) => value === null || value === undefined || value === "" ? undefined : Number(value);
const safeRows = (rows, mapper) => (rows || []).slice(0, MAX_RESULTS).map(mapper);
const bounded = async (query, mapper) => {
  const { data, error } = await query.limit(MAX_RESULTS);
  if (error) throw error;
  return safeRows(data, mapper);
};

export const READ_ONLY_SHADOW_TOOLS = Object.freeze([
  "find_properties", "find_active_contracts", "get_payment_summary", "get_service_period_status",
  "get_maintenance_ticket_summary", "get_work_center_case", "get_key_custody_status",
  "get_owner_liquidation_summary", "get_policy_or_signature_case", "get_condominium_fee_summary",
]);

const uuid = { type: "string", format: "uuid" };
const reference = { type: "string", minLength: 1, maxLength: 120 };
const oneOfIds = (...names) => ({
  type: "object", additionalProperties: false,
  properties: Object.fromEntries(names.map((name) => [name, name.endsWith("Reference") ? reference : uuid])),
  oneOf: names.map((name) => ({ required: [name] })),
});

export const SHADOW_TOOL_ARGUMENT_SCHEMAS = Object.freeze({
  find_properties: oneOfIds("propertyReference", "propertyId"),
  find_active_contracts: oneOfIds("contractId", "propertyId"),
  get_payment_summary: oneOfIds("paymentId", "contractId"),
  get_service_period_status: oneOfIds("serviceId"),
  get_maintenance_ticket_summary: oneOfIds("ticketId", "propertyId"),
  get_work_center_case: { type: "object", additionalProperties: false, required: ["contextKey"], properties: { contextKey: reference } },
  get_key_custody_status: oneOfIds("keyId"),
  get_owner_liquidation_summary: oneOfIds("ownerPaymentId"),
  get_policy_or_signature_case: oneOfIds("recordId"),
  get_condominium_fee_summary: oneOfIds("unitId"),
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateShadowToolArguments(name, args) {
  const schema = SHADOW_TOOL_ARGUMENT_SCHEMAS[name];
  if (!schema || !args || typeof args !== "object" || Array.isArray(args)) throw new Error("invalid_tool_arguments");
  const keys = Object.keys(args);
  const allowed = Object.keys(schema.properties);
  if (!keys.length || keys.some((key) => !allowed.includes(key))) throw new Error("invalid_tool_arguments");
  const requiredSets = schema.oneOf ? schema.oneOf.map((entry) => entry.required) : [schema.required || []];
  if (requiredSets.filter((required) => required.every((key) => keys.includes(key))).length !== 1) throw new Error("invalid_tool_arguments");
  for (const key of keys) {
    const value = args[key]; const definition = schema.properties[key];
    if (typeof value !== "string" || !value.trim() || value.length > (definition.maxLength || 120)) throw new Error("invalid_tool_arguments");
    if (definition.format === "uuid" && !UUID_PATTERN.test(value)) throw new Error("invalid_tool_arguments");
  }
  return Object.fromEntries(keys.map((key) => [key, args[key].trim()]));
}

export const shadowContextTools = Object.freeze({
  find_properties: (db, value, { byReference = false } = {}) => bounded(
    byReference
      ? db.from("properties").select("id,name").ilike("name", `%${String(value).slice(0, 80)}%`)
      : db.from("properties").select("id,name").eq("id", value),
    (x) => ({ entityType: "property", internalId: x.id, label: x.name || `Inmueble ${x.id}`, method: byReference ? "property_reference" : "explicit_link", confidence: byReference ? 65 : 100, reasonCode: byReference ? "property_reference_match" : "explicit_link", href: `/propiedades?propertyId=${encodeURIComponent(x.id)}` }),
  ),
  find_active_contracts: (db, value) => { const args = typeof value === "string" ? { contractId: value } : value; return bounded(
    (args.contractId
      ? db.from("contracts").select("id,property_id,status,start_date,end_date").eq("id", args.contractId)
      : db.from("contracts").select("id,property_id,status,start_date,end_date").eq("property_id", args.propertyId)).in("status", ["activo", "active"]),
    (x) => ({ entityType: "contract", internalId: x.id, label: `Contrato ${x.id}`, status: x.status, startDate: x.start_date, endDate: x.end_date, method: "explicit_link", confidence: 100, reasonCode: "active_contract_match", href: `/contratos?contractId=${encodeURIComponent(x.id)}` }),
  ); },
  get_payment_summary: (db, value) => { const args = typeof value === "string" ? { paymentId: value } : value; return bounded(
    args.paymentId
      ? db.from("payments").select("id,contract_id,status,due_date,amount").eq("id", args.paymentId)
      : db.from("payments").select("id,contract_id,status,due_date,amount").eq("contract_id", args.contractId).order("due_date", { ascending: false }),
    (x) => ({ entityType: "payment", internalId: x.id, label: `Renta ${x.due_date || x.id}`, status: x.status, period: x.due_date, amount: numericOrUndefined(x.amount), method: "explicit_link", confidence: 100, reasonCode: "payment_match", href: `/cobranza?paymentId=${encodeURIComponent(x.id)}` }),
  ); },
  get_service_period_status: (db, serviceId) => bounded(
    db.from("pagos_servicios").select("id,servicio_id,periodo,status,monto,comprobante_url").eq("servicio_id", serviceId).order("periodo", { ascending: false }),
    (x) => ({ entityType: "service", internalId: x.servicio_id, evidenceId: `service:${x.servicio_id}:control:${x.id}`, label: `Servicio ${x.periodo || x.servicio_id}`, status: x.status, period: x.periodo, amount: numericOrUndefined(x.monto), hasReceipt: Boolean(x.comprobante_url), method: "explicit_link", confidence: 100, reasonCode: "service_period_match", href: `/propiedades?serviceId=${encodeURIComponent(x.servicio_id)}${x.periodo ? `&period=${encodeURIComponent(x.periodo)}&paymentId=${encodeURIComponent(x.id)}` : ""}` }),
  ),
  get_maintenance_ticket_summary: (db, value) => { const args = typeof value === "string" ? { ticketId: value } : value; return bounded(
    args.ticketId
      ? db.from("maintenance_tickets").select("id,property_id,property_name,status,priority,created_at").eq("id", args.ticketId)
      : db.from("maintenance_tickets").select("id,property_id,property_name,status,priority,created_at").eq("property_id", args.propertyId).order("created_at", { ascending: false }),
    (x) => ({ entityType: "maintenance_ticket", internalId: x.id, label: `Mantenimiento ${x.status || x.id}`, status: x.status, priority: x.priority, method: "explicit_link", confidence: 100, reasonCode: "maintenance_ticket_match", href: `/mantenimiento?ticketId=${encodeURIComponent(x.id)}` }),
  ); },
  get_work_center_case: (db, contextKey) => bounded(
    db.from("administrative_case_controls").select("context_key,resolution_status,corrected_bucket,corrected_priority").eq("context_key", contextKey),
    (x) => ({ entityType: "work_center_case", internalId: x.context_key, label: `Caso operativo ${x.resolution_status}`, status: x.resolution_status, priority: x.corrected_priority, bucket: x.corrected_bucket, method: "explicit_link", confidence: 100, reasonCode: "work_center_case_match", href: `/mi-trabajo-administrativo?contextKey=${encodeURIComponent(x.context_key)}` }),
  ),
  get_key_custody_status: (db, keyId) => bounded(
    db.from("llaves").select("id,propiedad,en_resguardo,fecha_prestamo").eq("id", keyId),
    (x) => ({ entityType: "key", internalId: x.id, label: `Llave ${x.en_resguardo ? "en resguardo" : "prestada"}`, status: x.en_resguardo ? "en_resguardo" : "prestada", inCustody: Boolean(x.en_resguardo), method: "explicit_link", confidence: 100, reasonCode: "key_custody_match", href: `/checador?keyId=${encodeURIComponent(x.id)}` }),
  ),
  get_owner_liquidation_summary: (db, ownerPaymentId) => bounded(
    db.from("owner_payments").select("id,period_description,status,total_liquid,amount_paid").eq("id", ownerPaymentId),
    (x) => ({ entityType: "owner_liquidation", internalId: x.id, label: `Liquidación ${x.period_description || x.id}`, status: x.status, period: x.period_description, totalAmount: numericOrUndefined(x.total_liquid), paidAmount: numericOrUndefined(x.amount_paid), method: "explicit_link", confidence: 100, reasonCode: "owner_liquidation_match", href: `/liquidaciones?receiptId=${encodeURIComponent(x.id)}` }),
  ),
  get_policy_or_signature_case: (db, recordId) => bounded(db.from("expedientes_poliza").select("id,status,property_id").eq("id", recordId), (x) => ({ id: x.id, status: x.status, propertyId: x.property_id })),
  get_condominium_fee_summary: (db, unitId) => bounded(db.from("condominium_fees").select("id,unit_id,period,status,amount").eq("unit_id", unitId).order("period", { ascending: false }), (x) => ({ id: x.id, unitId: x.unit_id, period: x.period, status: x.status, amount: x.amount })),
});

export async function executeShadowReadOnlyTool(admin, name, args) {
  if (!READ_ONLY_SHADOW_TOOLS.includes(name)) throw new Error("tool_not_allowlisted");
  const valid = validateShadowToolArguments(name, args);
  if (name === "find_properties") {
    const value = valid.propertyId || valid.propertyReference;
    return shadowContextTools[name](admin, value, { byReference: Boolean(valid.propertyReference) });
  }
  if (["find_active_contracts", "get_payment_summary", "get_maintenance_ticket_summary"].includes(name)) return shadowContextTools[name](admin, valid);
  const value = Object.values(valid)[0];
  return shadowContextTools[name](admin, value);
}

const intentTools = Object.freeze({
  enviar_comprobante_renta: ["find_properties", "find_active_contracts", "get_payment_summary"],
  reportar_mantenimiento: ["find_properties", "get_maintenance_ticket_summary"],
  seguimiento_mantenimiento: ["find_properties", "get_maintenance_ticket_summary"],
  propietario_liquidacion: ["find_properties", "find_active_contracts", "get_owner_liquidation_summary"],
  consulta_servicio: ["find_properties", "get_service_period_status"],
  enviar_comprobante_servicio: ["find_properties", "get_service_period_status"],
  solicitud_llaves: ["find_properties", "get_key_custody_status"],
  contrato: ["find_properties", "find_active_contracts"],
  emergencia: ["find_properties", "get_service_period_status"],
  proveedor_seguimiento: ["find_properties", "get_maintenance_ticket_summary"],
  queja_conflicto: ["find_properties", "get_work_center_case"],
  multintencion: ["find_properties", "get_payment_summary", "get_maintenance_ticket_summary"],
  no_determinado: ["find_properties"],
});

const toolArgument = (tool, meta) => ({
  find_properties: meta.propertyId || meta.propertyReference,
  find_active_contracts: meta.contractId,
  get_payment_summary: meta.paymentId,
  get_service_period_status: meta.serviceId,
  get_maintenance_ticket_summary: meta.ticketId,
  get_work_center_case: meta.workCenterContextKey,
  get_key_custody_status: meta.keyId,
  get_owner_liquidation_summary: meta.ownerPaymentId,
}[tool]);

export async function resolveShadowContext(admin, envelope, classification) {
  const meta = envelope.providerMetadata || {};
  const intent = classification?.intent || "no_determinado";
  const audit = [];
  const matches = [];
  if (["mensaje_social_spam"].includes(intent)) return { matches, audit, ambiguous: false, requiresHuman: classification?.requiresHuman ?? true, missingInformation: [] };
  for (const tool of intentTools[intent] || []) {
    const argument = toolArgument(tool, meta);
    if (!argument || argument === "MULTIPLE") continue;
    const started = Date.now();
    try {
      const rows = await shadowContextTools[tool](admin, argument, { byReference: tool === "find_properties" && !meta.propertyId });
      audit.push({ tool, resultCount: Math.min(MAX_RESULTS, rows.length), ok: true, durationMs: Date.now() - started });
      matches.push(...rows);
    } catch {
      audit.push({ tool, resultCount: 0, ok: false, durationMs: Date.now() - started });
    }
  }
  const propertyMatches = matches.filter((x) => x.entityType === "property");
  const ambiguous = propertyMatches.length > 1;
  return {
    matches,
    audit,
    ambiguous,
    requiresHuman: Boolean(classification?.requiresHuman || ambiguous || matches.length === 0),
    missingInformation: matches.length ? [] : ["Vínculo verificable con inmueble, contrato o caso"],
  };
}
