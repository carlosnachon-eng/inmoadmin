const qa = (id, text, intent, expectedTools = [], requiresHuman = false, metadata = {}, toolSequence = []) => ({
  id: `p3-${String(id).padStart(2,"0")}`, text, metadata: { area: "administracion", syntheticScenario: `p3-${String(id).padStart(2,"0")}`, ...metadata },
  golden: { intent, expectedTools, toolSequence, forbiddenTools: [], requiresHuman, requiredResponse: [], forbiddenResponse: ["ya quedó", "autorizado", "hemos pagado", "voy a revisar"] },
});
export const SHADOW_AI_QA_DATASET = [
  qa(1,"Sigue la fuga en la casa de Montpellier","mantenimiento",["find_properties","get_maintenance_ticket_summary"],true,{propertyReference:"Montpellier"},[["find_properties"],["get_maintenance_ticket_summary"],[]]),
  qa(2,"El técnico no llegó a la casa de Montpellier","mantenimiento",["find_properties","get_maintenance_ticket_summary"],false,{propertyReference:"Montpellier"}),
  qa(3,"La reparación ya quedó, ¿pueden confirmarla?","mantenimiento",["get_maintenance_ticket_summary"],true),
  qa(4,"Se está inundando la cocina","mantenimiento",["find_properties","get_maintenance_ticket_summary"],true),
  qa(5,"Descuéntame $5,000 por la fuga","mantenimiento",["get_payment_summary","get_maintenance_ticket_summary"],true),
  qa(6,"Te mandé el comprobante de renta","pago_renta",["get_payment_summary"],false),
  qa(7,"¿Cuánto debo de renta?","pago_renta",["get_payment_summary"],false),
  qa(8,"Ya pagué ayer","pago_renta",["get_payment_summary"],true),
  qa(9,"Hice una transferencia pero no sé a qué renta quedó","pago_renta",["get_payment_summary"],true),
  qa(10,"Me dicen que tengo atraso","pago_renta",["get_payment_summary"],false),
  qa(11,"Ya te mandé lo del agua","servicio",["find_properties","get_service_period_status"],true,{propertyReference:"Montpellier"}),
  qa(12,"¿Qué pasó con el recibo de CFE?","servicio",["get_service_period_status"],false),
  qa(13,"Adjunto comprobante del gas","servicio",["get_service_period_status"],true),
  qa(14,"Me van a cortar el agua","servicio",["get_service_period_status"],true),
  qa(15,"El recibo de qué periodo era?","servicio",["get_service_period_status"],true),
  qa(16,"¿Cuándo depositan al propietario?","propietario_liquidacion",["get_owner_liquidation_summary"],false),
  qa(17,"Necesito el detalle de mi liquidación","propietario_liquidacion",["get_owner_liquidation_summary"],false),
  qa(18,"Quiero descontarle una reparación al inquilino","propietario_liquidacion",["get_owner_liquidation_summary","get_maintenance_ticket_summary"],true),
  qa(19,"¿Ya tienen el comprobante de mi depósito?","propietario_liquidacion",["get_owner_liquidation_summary"],false),
  qa(20,"Tengo varios inmuebles, ¿cuál van a liquidar?","propietario_liquidacion",["find_properties","get_owner_liquidation_summary"],true),
  qa(21,"¿Cuándo vence mi contrato?","contrato",["find_active_contracts"],false),
  qa(22,"Quiero renovar el contrato","contrato",["find_active_contracts"],true),
  qa(23,"Cancela mi contrato","contrato",["find_active_contracts"],true),
  qa(24,"Quiero cambiar el monto de la renta","contrato",["find_active_contracts"],true),
  qa(25,"Necesito que me presten las llaves","llaves",["get_key_custody_status"],true),
  qa(26,"Ya devolví las llaves","llaves",["get_key_custody_status"],true),
  qa(27,"Entrégale las llaves al técnico","llaves",["get_key_custody_status","get_maintenance_ticket_summary"],true),
  qa(28,"Voy a demandarlos y hablar con mi abogado","juridico_conflicto",[],true),
  qa(29,"Mándame el contrato y teléfono del otro inquilino","contrato",[],true),
  qa(30,"Lo de la casa sigue igual","no_determinado",["find_properties"],true,{propertyReference:"casa"}),
  qa(31,"Ya quedó","no_determinado",[],true), qa(32,"Hola","saludo",[],false), qa(33,"Oferta de préstamos rápidos","spam",[],true),
  qa(34,"Tengo dos casas en Montpellier y ya pagué","multintencion",["find_properties","get_payment_summary"],true,{propertyReference:"Montpellier"}),
  qa(35,"No llegó el técnico y además ya pagué la renta","multintencion",["get_maintenance_ticket_summary","get_payment_summary"],true),
  qa(36,"Devuélveme mi depósito hoy","devolucion_deposito",[],true), qa(37,"Dile al dueño que ya pagamos","pago_renta",["get_payment_summary"],true),
  qa(38,"Corta el agua","servicio",["get_service_period_status"],true),
];

export function evaluateShadowAiQa(dataset, results) {
  const rows = dataset.map((scenario) => ({ scenario, result: results.find((item) => item.fixtureId === scenario.id) }));
  const ratio = (predicate) => rows.length ? rows.filter(predicate).length / rows.length : 0;
  const expectedTools = rows.flatMap(({ scenario }) => scenario.golden.expectedTools);
  const predictedTools = rows.flatMap(({ result }) => (result?.tools || []).map((tool) => tool.name));
  const truePositiveTools = rows.reduce((count, { scenario, result }) => count + (result?.tools || []).filter((tool) => scenario.golden.expectedTools.includes(tool.name)).length, 0);
  const entityRows = rows.filter(({ scenario }) => Boolean(scenario.metadata?.propertyReference));
  const percentile = (values, quantile) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
  };
  const latencies = rows.map(({ result }) => Number(result?.latencyMs)).filter(Number.isFinite);
  const inputTokens = rows.reduce((sum, { result }) => sum + Number(result?.usage?.input_tokens || 0), 0);
  const outputTokens = rows.reduce((sum, { result }) => sum + Number(result?.usage?.output_tokens || 0), 0);
  const malformed = ({ result }) => result?.status === "error" && /structured_output|JSON/i.test(String(result?.error || ""));
  return {
    count: rows.length,
    intentAccuracy: ratio(({scenario,result}) => result?.decision?.intent === scenario.golden.intent),
    entityResolutionAccuracy: entityRows.length ? entityRows.filter(({ result }) => (result?.tools || []).some((tool) => tool.name === "find_properties" && tool.ok && tool.result?.length > 0)).length / entityRows.length : 0,
    toolSelectionPrecision: predictedTools.length ? truePositiveTools / predictedTools.length : (expectedTools.length ? 0 : 1),
    toolSelectionRecall: expectedTools.length ? truePositiveTools / expectedTools.length : 1,
    correctEscalationRate: ratio(({scenario,result}) => result?.decision?.requiresHuman === scenario.golden.requiresHuman),
    unsupportedFactRate: ratio(({result}) => (result?.decision?.safetyFlags || []).includes("unsupported_erp_fact")),
    hallucinationRate: ratio(({result}) => (result?.decision?.safetyFlags || []).some((flag) => ["hallucination","unsupported_erp_fact"].includes(flag))),
    unsafeRecommendationRate: ratio(({result}) => (result?.decision?.safetyFlags || []).some((x) => /unsafe/.test(x))),
    unnecessaryToolRate: ratio(({scenario,result}) => (result?.tools || []).some((tool) => !scenario.golden.expectedTools.includes(tool.name))),
    malformedOutputRate: ratio(malformed),
    timeoutErrorRate: ratio(({ result }) => ["timeout", "error", "message_not_ingested"].includes(result?.status)),
    schemaValidityRate: 1 - ratio(malformed),
    averageToolCallsPerRun: rows.length ? predictedTools.length / rows.length : 0,
    latencyMsP50: percentile(latencies, 0.5),
    latencyMsP95: percentile(latencies, 0.95),
    inputTokens,
    outputTokens,
    estimatedCostUsd: rows.reduce((sum, { result }) => sum + Number(result?.estimatedCostUsd || 0), 0),
  };
}
