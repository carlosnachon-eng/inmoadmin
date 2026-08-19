const MAX_RESULTS = 5;
const safeRows = (rows, mapper) => (rows || []).slice(0, MAX_RESULTS).map(mapper);

export async function resolveShadowContext(admin, envelope) {
  const meta = envelope.providerMetadata || {};
  const matches = [];
  const audit = [];
  const query = async (tool, builder, mapper) => {
    const started = Date.now();
    const { data, error } = await builder.limit(MAX_RESULTS);
    audit.push({ tool, resultCount: data?.length || 0, ok: !error, durationMs: Date.now() - started });
    if (error) return [];
    return safeRows(data, mapper);
  };
  if (meta.propertyId) {
    matches.push(...await query("find_properties", admin.from("properties").select("id").eq("id", meta.propertyId),
      (row) => ({ entityType: "property", internalId: row.id, label: `Inmueble ${row.id}`, method: "explicit_link", confidence: 100, href: `/propiedades?propertyId=${encodeURIComponent(row.id)}` })));
  } else if (meta.propertyReference && meta.propertyReference !== "MULTIPLE") {
    matches.push(...await query("find_properties", admin.from("properties").select("id,address").ilike("address", `%${String(meta.propertyReference).slice(0, 80)}%`),
      (row) => ({ entityType: "property", internalId: row.id, label: row.address || `Inmueble ${row.id}`, method: "property_reference", confidence: 65, href: `/propiedades?propertyId=${encodeURIComponent(row.id)}` })));
  }
  if (meta.contractId) {
    matches.push(...await query("find_active_contracts", admin.from("contracts").select("id,status,property_id").eq("id", meta.contractId),
      (row) => ({ entityType: "contract", internalId: row.id, label: `Contrato ${row.id}`, method: "explicit_link", confidence: 100, href: `/contratos?contractId=${encodeURIComponent(row.id)}` })));
  }
  const ambiguous = meta.propertyReference === "MULTIPLE" || matches.length > 1;
  return { matches, audit, ambiguous, requiresHuman: ambiguous || matches.length === 0, missingInformation: matches.length ? [] : ["Vínculo verificable con inmueble, contrato o caso"] };
}

export const READ_ONLY_SHADOW_TOOLS = Object.freeze([
  "find_properties", "find_active_contracts", "get_payment_summary", "get_service_period_status",
  "get_maintenance_ticket_summary", "get_work_center_case", "get_key_custody_status",
  "get_owner_liquidation_summary", "get_policy_or_signature_case", "get_condominium_fee_summary",
]);

const bounded = async (query, mapper) => {
  const { data, error } = await query.limit(MAX_RESULTS);
  if (error) throw error;
  return safeRows(data, mapper);
};

export const shadowContextTools = Object.freeze({
  find_properties: (db, propertyId) => bounded(db.from("properties").select("id").eq("id", propertyId), (x) => ({ id: x.id })),
  find_active_contracts: (db, propertyId) => bounded(db.from("contracts").select("id,property_id,status").eq("property_id", propertyId).in("status", ["activo","active"]), (x) => ({ id: x.id, propertyId: x.property_id, status: x.status })),
  get_payment_summary: (db, contractId) => bounded(db.from("payments").select("id,contract_id,status,due_date,amount").eq("contract_id", contractId).order("due_date", { ascending: false }), (x) => ({ id: x.id, contractId: x.contract_id, status: x.status, dueDate: x.due_date, amount: x.amount })),
  get_service_period_status: (db, serviceId) => bounded(db.from("pagos_servicios").select("id,servicio_id,periodo,estado,monto").eq("servicio_id", serviceId).order("periodo", { ascending: false }), (x) => ({ id: x.id, serviceId: x.servicio_id, period: x.periodo, status: x.estado, amount: x.monto })),
  get_maintenance_ticket_summary: (db, ticketId) => bounded(db.from("maintenance_tickets").select("id,property_id,status,priority,created_at").eq("id", ticketId), (x) => ({ id: x.id, propertyId: x.property_id, status: x.status, priority: x.priority, createdAt: x.created_at })),
  get_work_center_case: (db, contextKey) => bounded(db.from("administrative_case_controls").select("context_key,resolution_status,corrected_bucket,corrected_priority").eq("context_key", contextKey), (x) => ({ contextKey: x.context_key, status: x.resolution_status, bucket: x.corrected_bucket, priority: x.corrected_priority })),
  get_key_custody_status: (db, keyId) => bounded(db.from("llaves").select("id,property_id,estado,fecha_salida").eq("id", keyId), (x) => ({ id: x.id, propertyId: x.property_id, status: x.estado, checkedOutAt: x.fecha_salida })),
  get_owner_liquidation_summary: (db, ownerId) => bounded(db.from("owner_payments").select("id,owner_id,period,status,amount").eq("owner_id", ownerId).order("period", { ascending: false }), (x) => ({ id: x.id, ownerId: x.owner_id, period: x.period, status: x.status, amount: x.amount })),
  get_policy_or_signature_case: (db, recordId) => bounded(db.from("expedientes_poliza").select("id,status,property_id").eq("id", recordId), (x) => ({ id: x.id, status: x.status, propertyId: x.property_id })),
  get_condominium_fee_summary: (db, unitId) => bounded(db.from("condominium_fees").select("id,unit_id,period,status,amount").eq("unit_id", unitId).order("period", { ascending: false }), (x) => ({ id: x.id, unitId: x.unit_id, period: x.period, status: x.status, amount: x.amount })),
});
