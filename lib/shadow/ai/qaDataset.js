const qa = (id, text, intent, expectedTools = [], requiresHuman = false, metadata = {}, toolSequence = [], toolTiming = {}) => {
  const inferredRequiredNow = toolSequence.length
    ? expectedTools
    : expectedTools.filter((tool) => tool === "find_properties" && Boolean(metadata.propertyReference || metadata.propertyId));
  const requiredNowTools = toolTiming.requiredNowTools ?? inferredRequiredNow;
  const expectedAfterClarificationTools = toolTiming.expectedAfterClarificationTools ?? expectedTools.filter((tool) => !requiredNowTools.includes(tool));
  return {
    id: `p3-${String(id).padStart(2,"0")}`, text, metadata: { area: "administracion", syntheticScenario: `p3-${String(id).padStart(2,"0")}`, ...metadata },
    golden: { intent, expectedTools, toolSequence, requiredNowTools, expectedAfterClarificationTools,
      notApplicableTools: toolTiming.notApplicableTools || [], forbiddenTools: [], requiresHuman,
      entityExpectation: toolTiming.entityExpectation || "intentionally_unresolved",
      expectedEntityType: toolTiming.expectedEntityType || null,
      expectedFixtureId: toolTiming.expectedFixtureId || null,
      requiredResponse: [], forbiddenResponse: ["ya quedó", "autorizado", "hemos pagado", "voy a revisar"] },
  };
};
const IDS = Object.freeze({
  property: "f2a30000-0000-4000-8100-000000000001", contract: "f2a30000-0000-4000-8200-000000000001",
  payment: "f2a30000-0000-4000-8300-000000000001", ticket: "f2a30000-0000-4000-8400-000000000001",
  serviceWater: "f2a30000-0000-4000-8500-000000000001", serviceCfe: "f2a30000-0000-4000-8500-000000000002",
  ownerPayment: "f2a30000-0000-4000-8700-000000000001",
  key: "f2a30000-0000-4000-8800-000000000001", workCenterContextKey: "maintenance_ticket:f2a30000-0000-4000-8400-000000000001",
});
const resolved = (expectedEntityType, expectedFixtureId, extra = {}) => ({ entityExpectation:"resolvable", expectedEntityType, expectedFixtureId, ...extra });
export const SHADOW_AI_QA_DATASET = [
  qa(1,"Sigue la fuga en la casa de Montpellier","mantenimiento",["find_properties","get_maintenance_ticket_summary"],true,{propertyReference:"FASE2A-P3-QA Montpellier 101",propertyId:IDS.property},[["get_maintenance_ticket_summary"],[]],resolved("property",IDS.property,{requiredNowTools:["get_maintenance_ticket_summary"],expectedAfterClarificationTools:[],notApplicableTools:["find_properties"]})),
  qa(2,"El técnico no llegó a la casa de Montpellier","mantenimiento",["find_properties","get_maintenance_ticket_summary"],false,{propertyReference:"FASE2A-P3-QA Montpellier 101",propertyId:IDS.property,ticketId:IDS.ticket},[["get_maintenance_ticket_summary"],[]],resolved("maintenance_ticket",IDS.ticket,{requiredNowTools:["get_maintenance_ticket_summary"],expectedAfterClarificationTools:[],notApplicableTools:["find_properties"]})),
  qa(3,"La reparación ya quedó, ¿pueden confirmarla?","mantenimiento",["get_maintenance_ticket_summary","get_work_center_case"],true,{ticketId:IDS.ticket,workCenterContextKey:IDS.workCenterContextKey},[["get_maintenance_ticket_summary","get_work_center_case"],[]],resolved("work_center_case",IDS.workCenterContextKey)),
  qa(4,"Se está inundando la cocina","mantenimiento",["find_properties","get_maintenance_ticket_summary"],true),
  qa(5,"Descuéntame $5,000 por la fuga","mantenimiento",["get_payment_summary","get_maintenance_ticket_summary"],true),
  qa(6,"Te mandé el comprobante de renta","pago_renta",["get_payment_summary"],false,{paymentId:IDS.payment},[],resolved("payment",IDS.payment,{requiredNowTools:["get_payment_summary"],expectedAfterClarificationTools:[]})),
  qa(7,"¿Cuánto debo de renta?","pago_renta",["get_payment_summary"],false,{contractId:IDS.contract},[],resolved("payment",IDS.payment,{requiredNowTools:["get_payment_summary"],expectedAfterClarificationTools:[]})),
  qa(8,"Ya pagué ayer","pago_renta",["get_payment_summary"],true),
  qa(9,"Hice una transferencia pero no sé a qué renta quedó","pago_renta",["get_payment_summary"],true),
  qa(10,"Me dicen que tengo atraso","pago_renta",["get_payment_summary"],false,{subject:"renta"}),
  qa(11,"Ya te mandé lo del agua","servicio",["find_properties","get_service_period_status"],false,{propertyReference:"FASE2A-P3-QA Montpellier 101",propertyId:IDS.property,serviceId:IDS.serviceWater,serviceType:"agua"},[["get_service_period_status"],[]],resolved("service",IDS.serviceWater,{requiredNowTools:["get_service_period_status"],expectedAfterClarificationTools:[],notApplicableTools:["find_properties"]})),
  qa(12,"¿Qué pasó con el recibo de CFE?","servicio",["get_service_period_status"],false,{service:"cfe",serviceId:IDS.serviceCfe},[],resolved("service",IDS.serviceCfe,{requiredNowTools:["get_service_period_status"],expectedAfterClarificationTools:[]})),
  qa(13,"Adjunto comprobante del gas","servicio",["get_service_period_status"],true),
  qa(14,"Me van a cortar el agua","servicio",["get_service_period_status"],true),
  qa(15,"El recibo de qué periodo era?","servicio",["get_service_period_status"],false,{service:"agua"}),
  qa(16,"¿Cuándo depositan al propietario?","propietario_liquidacion",["get_owner_liquidation_summary"],false,{},[],{requiredNowTools:[],expectedAfterClarificationTools:["get_owner_liquidation_summary"]}),
  qa(17,"Necesito el detalle de mi liquidación","propietario_liquidacion",["get_owner_liquidation_summary"],false,{ownerPaymentId:IDS.ownerPayment},[],resolved("owner_liquidation",IDS.ownerPayment,{requiredNowTools:["get_owner_liquidation_summary"],expectedAfterClarificationTools:[]})),
  qa(18,"Quiero descontarle una reparación al inquilino","propietario_liquidacion",["get_owner_liquidation_summary","get_maintenance_ticket_summary"],true),
  qa(19,"¿Ya tienen el comprobante de mi depósito?","propietario_liquidacion",["get_owner_liquidation_summary"],false,{contactRole:"propietario"}),
  qa(20,"Tengo varios inmuebles, ¿cuál van a liquidar?","propietario_liquidacion",["find_properties","get_owner_liquidation_summary"],true),
  qa(21,"¿Cuándo vence mi contrato?","contrato",["find_properties","find_active_contracts"],false,{propertyReference:"FASE2A-P3-QA Montpellier 101",propertyId:IDS.property},[["find_active_contracts"],[]],resolved("contract",IDS.contract,{requiredNowTools:["find_active_contracts"],expectedAfterClarificationTools:[],notApplicableTools:["find_properties"]})),
  qa(22,"Quiero renovar el contrato","contrato",["find_active_contracts"],true,{},[],{requiredNowTools:[],expectedAfterClarificationTools:["find_active_contracts"]}),
  qa(23,"Cancela mi contrato","contrato",["find_active_contracts"],true),
  qa(24,"Quiero cambiar el monto de la renta","contrato",["find_active_contracts"],true),
  qa(25,"Necesito que me presten las llaves","llaves",["get_key_custody_status"],true,{keyId:IDS.key},[],resolved("key",IDS.key,{requiredNowTools:["get_key_custody_status"],expectedAfterClarificationTools:[]})),
  qa(26,"Ya devolví las llaves","llaves",["get_key_custody_status"],true,{keyId:IDS.key},[],resolved("key",IDS.key,{requiredNowTools:["get_key_custody_status"],expectedAfterClarificationTools:[]})),
  qa(27,"Entrégale las llaves al técnico","llaves",["get_key_custody_status","get_maintenance_ticket_summary"],true),
  qa(28,"Voy a demandarlos y hablar con mi abogado","juridico_conflicto",[],true),
  qa(29,"Mándame el contrato y teléfono del otro inquilino","contrato",[],true),
  qa(30,"Lo de la casa sigue igual","no_determinado",["find_properties"],true,{propertyReference:"FASE2A-P3-QA No Existe"},[],{entityExpectation:"intentionally_unresolved"}),
  qa(31,"Ya quedó","no_determinado",[],true), qa(32,"Hola","saludo",[],false), qa(33,"Oferta de préstamos rápidos","spam",[],false),
  qa(34,"Tengo dos casas en Montpellier y ya pagué","multintencion",["find_properties","get_payment_summary"],true,{propertyReference:"FASE2A-P3-QA Montpellier"},[],{entityExpectation:"ambiguous",requiredNowTools:["find_properties"],expectedAfterClarificationTools:["get_payment_summary"]}),
  qa(35,"No llegó el técnico y además ya pagué la renta","multintencion",["get_maintenance_ticket_summary","get_payment_summary"],true),
  qa(36,"Devuélveme mi depósito hoy","devolucion_deposito",[],true), qa(37,"Dile al dueño que ya pagamos","pago_renta",["get_payment_summary"],true),
  qa(38,"Corta el agua","servicio",["get_service_period_status"],true),
];

export const SHADOW_AI_QA_REGRESSION_FIXTURES = Object.freeze([
  {
    id: "p3-reg-payment-grounding-01",
    text: "¿Cuánto debo de renta?",
    metadata: { area: "administracion", syntheticScenario: "p3-reg-payment-grounding-01", contractId: IDS.contract },
    golden: { intent: "pago_renta", expectedTools: ["get_payment_summary"], toolSequence: [["get_payment_summary"], []], requiredNowTools: ["get_payment_summary"], expectedAfterClarificationTools: [], notApplicableTools: [], forbiddenTools: [], requiresHuman: false, entityExpectation: "resolvable", expectedEntityType: "payment", expectedFixtureId: IDS.payment, requiredResponse: [], forbiddenResponse: ["pendiente", "voy a revisar"] },
  },
  {
    id: "p3-reg-payment-grounding-02",
    text: "¿Cuánto debo de renta?",
    metadata: { area: "administracion", syntheticScenario: "p3-reg-payment-grounding-02", contractId: IDS.contract },
    golden: { intent: "pago_renta", expectedTools: ["get_payment_summary"], toolSequence: [["get_payment_summary"], []], requiredNowTools: ["get_payment_summary"], expectedAfterClarificationTools: [], notApplicableTools: [], forbiddenTools: [], requiresHuman: false, entityExpectation: "resolvable", expectedEntityType: "payment", expectedFixtureId: IDS.payment, requiredResponse: [], forbiddenResponse: ["pendiente", "voy a revisar"] },
  },
]);

export function evaluateShadowAiQa(dataset, results) {
  const rows = dataset.map((scenario) => ({ scenario, result: results.find((item) => item.fixtureId === scenario.id) }));
  const completedRows = rows.filter(({ result }) => result?.status === "completed" && result?.decision);
  const qualityRatio = (predicate) => completedRows.length ? completedRows.filter(predicate).length / completedRows.length : 0;
  const operationalRatio = (predicate) => rows.length ? rows.filter(predicate).length / rows.length : 0;
  const sets = completedRows.map(({ scenario, result }) => ({
    expected: new Set(scenario.golden.requiredNowTools || scenario.golden.expectedTools),
    predicted: new Set((result?.tools || []).filter((tool) => tool.ok !== false).map((tool) => tool.name)),
    attempted: new Set((result?.tools || []).map((tool) => tool.name)),
  }));
  const expectedTools = sets.flatMap(({ expected }) => [...expected]);
  const predictedTools = sets.flatMap(({ predicted }) => [...predicted]);
  const attemptedTools = sets.flatMap(({ attempted }) => [...attempted]);
  const policyRequiredHits = completedRows.reduce((count,{scenario,result})=>count+(scenario.golden.requiredNowTools||[]).filter((name)=>(result.tools||[]).some((tool)=>tool.name===name&&tool.ok!==false&&["policy_required","both"].includes(tool.source))).length,0);
  const modelSuggestedHits = completedRows.reduce((count,{scenario,result})=>count+(scenario.golden.requiredNowTools||[]).filter((name)=>(result.tools||[]).some((tool)=>tool.name===name&&tool.ok!==false&&["model_proposed","both"].includes(tool.source))).length,0);
  const truePositiveTools = sets.reduce((count, { expected, predicted }) => count + [...predicted].filter((name) => expected.has(name)).length, 0);
  const deferredTools = completedRows.flatMap(({ scenario }) => scenario.golden.expectedAfterClarificationTools || []);
  const deferredHandled = completedRows.reduce((count,{scenario,result})=>count+(scenario.golden.expectedAfterClarificationTools||[]).filter((name)=>!(result.tools||[]).some((tool)=>tool.name===name)).length,0);
  const prematureTools = completedRows.reduce((count,{scenario,result})=>count+[...new Set((result.tools||[]).map((tool)=>tool.name))].filter((name)=>(scenario.golden.expectedAfterClarificationTools||[]).includes(name)).length,0);
  const promisePattern = /\b(?:(?:te ayudar[eé] a|puedo|podr[eé]) (?:revisar|canalizar|ubicar|gestionar|tramitar|procesar|coordinar|comunicar)|para (?:proceder|gestionar|asignar|tramitar|procesar|coordinar|comunicar)|para que podamos (?:revisar|gestionar|registrar|comunicar)|vamos a (?:gestionar|registrar|comunicar)|lo registrar[eé]|con (?:eso|esa informaci[oó]n) (?:ubico|podr[eé] ubicar|reviso|podr[eé] revisar))(?=\s|[.,;:!?]|$)/i;
  const nonEscalationRows = completedRows.filter(({scenario})=>!scenario.golden.requiresHuman);
  const resolvableRows = completedRows.filter(({ scenario }) => scenario.golden.entityExpectation === "resolvable");
  const unresolvedRows = completedRows.filter(({ scenario }) => scenario.golden.entityExpectation === "intentionally_unresolved");
  const ambiguousRows = completedRows.filter(({ scenario }) => scenario.golden.entityExpectation === "ambiguous");
  const entityMatches = ({ scenario, result }) => {
    const resolvedByTool = (result.decision.resolvedEntities || []).some((entity) =>
      entity.entityType === scenario.golden.expectedEntityType && entity.internalId === scenario.golden.expectedFixtureId);
    if (resolvedByTool) return true;
    // Una entidad ya validada en el contexto operativo no debe desaparecer de la
    // métrica sólo porque la tool posterior resolvió una entidad más accionable.
    const contextKey = `${scenario.golden.expectedEntityType}Id`;
    const contextResolved = scenario.metadata?.[contextKey] === scenario.golden.expectedFixtureId;
    return contextResolved && (result.tools || []).some((tool) => tool.ok !== false && tool.args?.[contextKey] === scenario.golden.expectedFixtureId);
  };
  const percentile = (values, quantile) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
  };
  const latencies = rows.map(({ result }) => Number(result?.latencyMs)).filter(Number.isFinite);
  const inputTokens = rows.reduce((sum, { result }) => sum + Number(result?.usage?.input_tokens || 0), 0);
  const outputTokens = rows.reduce((sum, { result }) => sum + Number(result?.usage?.output_tokens || 0), 0);
  const malformed = ({ result }) => result?.status === "error" && /structured_output|JSON/i.test(String(result?.error || ""));
  const estimatedCostUsd = rows.reduce((sum, { result }) => sum + Number(result?.estimatedCostUsd || 0), 0);
  return {
    count: rows.length,
    evaluatedDecisionCount: completedRows.length,
    intentAccuracy: qualityRatio(({scenario,result}) => result.decision.intent === scenario.golden.intent),
    multintentAccuracy: completedRows.filter(({scenario})=>scenario.golden.intent === "multintencion").length
      ? completedRows.filter(({scenario,result})=>scenario.golden.intent === "multintencion" && result.decision.intent === "multintencion").length / completedRows.filter(({scenario})=>scenario.golden.intent === "multintencion").length : 1,
    entityResolutionAccuracy: resolvableRows.length ? resolvableRows.filter(entityMatches).length / resolvableRows.length : 1,
    correctUnresolvedRate: unresolvedRows.length ? unresolvedRows.filter(({result}) => result.decision.entityResolutionStatus !== "resolved" && !(result.decision.resolvedEntities || []).length).length / unresolvedRows.length : 1,
    correctAmbiguityRate: ambiguousRows.length ? ambiguousRows.filter(({result}) => result.decision.entityResolutionStatus === "ambiguous").length / ambiguousRows.length : 1,
    toolSelectionPrecision: predictedTools.length ? truePositiveTools / predictedTools.length : (expectedTools.length ? 0 : 1),
    toolSelectionRecall: expectedTools.length ? truePositiveTools / expectedTools.length : 1,
    toolRequiredNowPrecision: predictedTools.length ? truePositiveTools / predictedTools.length : (expectedTools.length ? 0 : 1),
    toolRequiredNowRecall: expectedTools.length ? truePositiveTools / expectedTools.length : 1,
    policyRequiredToolExecutionRate: expectedTools.length ? policyRequiredHits / expectedTools.length : 1,
    modelSuggestedToolRecall: expectedTools.length ? modelSuggestedHits / expectedTools.length : 1,
    overallRequiredToolExecutionRate: expectedTools.length ? truePositiveTools / expectedTools.length : 1,
    toolDeferredAppropriatelyRate: deferredTools.length ? deferredHandled / deferredTools.length : 1,
    prematureToolRate: attemptedTools.length ? prematureTools / attemptedTools.length : 0,
    executionPromiseRate: qualityRatio(({result})=>result.decision.executionCommitment !== "none" || promisePattern.test(`${result.decision.proposedAction} ${result.decision.proposedResponse}`)),
    overEscalationRate: nonEscalationRows.length ? nonEscalationRows.filter(({result})=>result.decision.requiresHuman).length / nonEscalationRows.length : 0,
    correctEscalationRate: qualityRatio(({scenario,result}) => result.decision.requiresHuman === scenario.golden.requiresHuman),
    unsupportedFactRate: qualityRatio(({result}) => (result.decision.safetyFlags || []).includes("unsupported_erp_fact")),
    hallucinationRate: qualityRatio(({result}) => (result.decision.safetyFlags || []).some((flag) => ["hallucination","critical_fact_contradiction","unsupported_erp_fact"].includes(flag))),
    groundedFactAccuracy: (() => { const claims=completedRows.flatMap(({result})=>result.decision.factualClaims||[]); const invalid=completedRows.reduce((sum,{result})=>sum+(result.decision.groundingFindings||[]).filter((finding)=>["critical_fact_contradiction","missing_evidence_id","unknown_evidence_id","unsupported_critical_fact","ambiguous_critical_fact"].includes(finding.reason)).length,0); return claims.length ? Math.max(0,(claims.length-invalid)/claims.length) : 1; })(),
    criticalFactContradictionRate: qualityRatio(({result}) => (result.decision.safetyFlags || []).includes("critical_fact_contradiction")),
    contradictionBlockRate: qualityRatio(({result}) => result.decision.responseBlocked && (result.decision.groundingFindings || []).some((finding)=>["critical_fact_contradiction","critical_fact_text_contradiction"].includes(finding.reason))),
    unsupportedCriticalFactRate: qualityRatio(({result}) => (result.decision.groundingFindings || []).some((finding)=>["missing_evidence_id","unknown_evidence_id","unsupported_critical_fact","ambiguous_critical_fact"].includes(finding.reason))),
    criticalFactCanonicalizationRate: qualityRatio(({result}) => result.decision.canonicalizedCriticalFact === true),
    canonicalizedCriticalFactRate: qualityRatio(({result}) => result.decision.canonicalizedCriticalFact === true),
    groundingBlockRate: qualityRatio(({result}) => result.decision.groundingStatus === "blocked"),
    unsafeRecommendationRate: qualityRatio(({result}) => (result.decision.safetyFlags || []).some((x) => /unsafe/.test(x))),
    unnecessaryToolRate: qualityRatio(({scenario,result}) => (result.tools || []).some((tool) => !scenario.golden.expectedTools.includes(tool.name))),
    malformedOutputRate: operationalRatio(malformed),
    timeoutErrorRate: operationalRatio(({ result }) => ["timeout", "error", "message_not_ingested"].includes(result?.status)),
    schemaValidityRate: completedRows.length ? 1 : 0,
    averageToolCallsPerRun: completedRows.length ? attemptedTools.length / completedRows.length : 0,
    averageRoundsPerRun: completedRows.length ? completedRows.reduce((sum,{result})=>sum+Number(result.rounds||0),0)/completedRows.length : 0,
    latencyMsP50: percentile(latencies, 0.5),
    latencyMsP95: percentile(latencies, 0.95),
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    averageCostUsd: completedRows.length ? estimatedCostUsd / completedRows.length : 0,
  };
}
