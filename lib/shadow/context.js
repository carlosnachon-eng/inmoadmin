const MAX_RESULTS = 5;
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

export const shadowContextTools = Object.freeze({
  find_properties: (db, value, { byReference = false } = {}) => bounded(
    byReference
      ? db.from("properties").select("id,name").ilike("name", `%${String(value).slice(0, 80)}%`)
      : db.from("properties").select("id,name").eq("id", value),
    (x) => ({ entityType: "property", internalId: x.id, label: x.name || `Inmueble ${x.id}`, method: byReference ? "property_reference" : "explicit_link", confidence: byReference ? 65 : 100, reasonCode: byReference ? "property_reference_match" : "explicit_link", href: `/propiedades?propertyId=${encodeURIComponent(x.id)}` }),
  ),
  find_active_contracts: (db, contractId) => bounded(
    db.from("contracts").select("id,property_id,status").eq("id", contractId).in("status", ["activo", "active"]),
    (x) => ({ entityType: "contract", internalId: x.id, label: `Contrato ${x.id}`, method: "explicit_link", confidence: 100, reasonCode: "active_contract_match", href: `/contratos?contractId=${encodeURIComponent(x.id)}` }),
  ),
  get_payment_summary: (db, paymentId) => bounded(
    db.from("payments").select("id,contract_id,status,due_date,amount").eq("id", paymentId),
    (x) => ({ entityType: "payment", internalId: x.id, label: `Renta ${x.due_date || x.id}`, method: "explicit_link", confidence: 100, reasonCode: "payment_match", href: `/cobranza?paymentId=${encodeURIComponent(x.id)}` }),
  ),
  get_service_period_status: (db, serviceId) => bounded(
    db.from("pagos_servicios").select("id,servicio_id,periodo,status,monto").eq("servicio_id", serviceId).order("periodo", { ascending: false }),
    (x) => ({ entityType: "service", internalId: x.servicio_id, label: `Servicio ${x.periodo || x.servicio_id}`, method: "explicit_link", confidence: 100, reasonCode: "service_period_match", href: `/propiedades?serviceId=${encodeURIComponent(x.servicio_id)}${x.periodo ? `&period=${encodeURIComponent(x.periodo)}&paymentId=${encodeURIComponent(x.id)}` : ""}` }),
  ),
  get_maintenance_ticket_summary: (db, ticketId) => bounded(
    db.from("maintenance_tickets").select("id,property_name,status,priority,created_at").eq("id", ticketId),
    (x) => ({ entityType: "maintenance_ticket", internalId: x.id, label: `Mantenimiento ${x.status || x.id}`, method: "explicit_link", confidence: 100, reasonCode: "maintenance_ticket_match", href: `/mantenimiento?ticketId=${encodeURIComponent(x.id)}` }),
  ),
  get_work_center_case: (db, contextKey) => bounded(
    db.from("administrative_case_controls").select("context_key,resolution_status,corrected_bucket,corrected_priority").eq("context_key", contextKey),
    (x) => ({ entityType: "work_center_case", internalId: x.context_key, label: `Caso operativo ${x.resolution_status}`, method: "explicit_link", confidence: 100, reasonCode: "work_center_case_match", href: `/mi-trabajo-administrativo?contextKey=${encodeURIComponent(x.context_key)}` }),
  ),
  get_key_custody_status: (db, keyId) => bounded(
    db.from("llaves").select("id,propiedad,en_resguardo,fecha_prestamo").eq("id", keyId),
    (x) => ({ entityType: "key", internalId: x.id, label: `Llave ${x.en_resguardo ? "en resguardo" : "prestada"}`, method: "explicit_link", confidence: 100, reasonCode: "key_custody_match", href: `/checador?keyId=${encodeURIComponent(x.id)}` }),
  ),
  get_owner_liquidation_summary: (db, ownerPaymentId) => bounded(
    db.from("owner_payments").select("id,period_description,status,total_liquid,amount_paid").eq("id", ownerPaymentId),
    (x) => ({ entityType: "owner_liquidation", internalId: x.id, label: `Liquidación ${x.period_description || x.id}`, method: "explicit_link", confidence: 100, reasonCode: "owner_liquidation_match", href: `/liquidaciones?receiptId=${encodeURIComponent(x.id)}` }),
  ),
  get_policy_or_signature_case: (db, recordId) => bounded(db.from("expedientes_poliza").select("id,status,property_id").eq("id", recordId), (x) => ({ id: x.id, status: x.status, propertyId: x.property_id })),
  get_condominium_fee_summary: (db, unitId) => bounded(db.from("condominium_fees").select("id,unit_id,period,status,amount").eq("unit_id", unitId).order("period", { ascending: false }), (x) => ({ id: x.id, unitId: x.unit_id, period: x.period, status: x.status, amount: x.amount })),
});

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
