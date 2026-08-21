import crypto from "node:crypto";
import { READ_ONLY_SHADOW_TOOLS, executeShadowReadOnlyTool, validateShadowToolArguments } from "../context.js";
import { SHADOW_AI_LIMITS, shadowAiGuard } from "./guards.js";
import { createAnthropicShadowResponse, DEFAULT_SHADOW_AI_MODEL } from "./anthropic.js";
import { SHADOW_AI_PROMPT_VERSION, SHADOW_AI_SYSTEM_PROMPT, SHADOW_AI_TOOL_GUIDE } from "./prompt.js";
import { SHADOW_AI_OUTPUT_SCHEMA_VERSION, validateShadowAiDecision } from "./schema.js";
import { buildEvidenceLedger, groundAndRenderDecision } from "./grounding.js";

const unsafePatterns = /(?:ya (?:descont[eé]|devolv[ií]|cancel[eé]|entregu[eé]|cort[eé])|queda autorizado|hemos pagado|se realizar[aá] el pago)/i;
export const shadowCommitmentPatterns = /\b(?:(?:voy|vamos) a (?:registrar|enviar|programar|solicitar|realizar|gestionar|tramitar|procesar|coordinar|comunicar)|proceder(?:é|emos)|para que podamos (?:registrar|enviar|programar|solicitar|realizar|revisar|gestionar|tramitar|procesar|coordinar|comunicar)|para (?:ayudarte a )?(?:procesar|gestionar|tramitar|asignar|coordinar|comunicar)(?:lo|la)?|(?:te ayudar[eé] a|puedo|podr[eé]) (?:revisar|canalizar|ubicar|gestionar|tramitar|procesar|coordinar|comunicar)|para proceder|vamos a gestionar|lo registrar[eé]|con (?:eso|esa informaci[oó]n) (?:ubico|podr[eé] ubicar|reviso|podr[eé] revisar))(?=\s|[.,;:!?]|$)/i;
const unsafeLegalActionPattern = /\b(?:suspender (?:toda )?comunicaci[oó]n|admitir responsabilidad|negar responsabilidad|ofrecer (?:un )?acuerdo|iniciar acciones legales|terminar (?:el )?contrato|retener (?:el )?dinero|devolver (?:el )?dinero)\b/i;
const privatePatterns = /(?:https?:\/\/|@|\+?52\s*\d|\b\d{10,18}\b)/i;
export const sanitizeShadowAiError = (error) => {
  if (!error?.providerError) return String(error?.message || "ai_error").replace(/[\r\n]/g, " ").slice(0, 180);
  const p = error.providerError;
  return [
    `s=${p.provider_status || ""}`, `t=${String(p.provider_error_type || "").slice(0, 32)}`,
    `c=${String(p.provider_error_code || "").slice(0, 24)}`, `f=${String(p.provider_error_field || "").slice(0, 36)}`,
    `r=${String(p.provider_request_id || "").slice(0, 48)}`, `m=${String(p.provider_error_message || "").slice(0, 40)}`,
  ].join(";").slice(0, 180);
};
export const shadowAiIdempotencyKey = (messageId, model) => crypto.createHash("sha256").update(`${messageId}:${SHADOW_AI_PROMPT_VERSION}:${model}`).digest("hex");
const MAX_ATTEMPTS = 3;
const retryableStatus = (status) => ["error", "timeout"].includes(status);

export class ShadowAiStageTimeoutError extends Error {
  constructor(stage) {
    super(stage);
    this.name = "ShadowAiStageTimeoutError";
    this.timeoutStage = stage;
  }
}

export const shadowAiRuntimeClock = (options) => options.clock || { now: () => Date.now(), setTimeout, clearTimeout };
export async function withShadowAiStageTimeout(operation, { stage, stageTimeoutMs, globalDeadlineMs, clock, controller }) {
  const remainingMs = globalDeadlineMs - clock.now();
  if (remainingMs <= 0) throw new ShadowAiStageTimeoutError("global_run_timeout");
  const timeoutMs = Math.min(stageTimeoutMs, remainingMs);
  const timeoutStage = remainingMs <= stageTimeoutMs ? "global_run_timeout" : stage;
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = clock.setTimeout(() => {
        controller?.abort();
        reject(new ShadowAiStageTimeoutError(timeoutStage));
      }, timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) clock.clearTimeout(timer);
  }
}

export function minimalShadowAiContext(envelope, deterministic, toolResults, round) {
  return {
    message: envelope.sanitizedText,
    metadata: Object.fromEntries(Object.entries(envelope.providerMetadata || {}).filter(([key]) => ["area","service","subject","contactRole","propertyReference","propertyId","contractId","paymentId","serviceId","ticketId","keyId","ownerPaymentId","workCenterContextKey","syntheticScenario"].includes(key))),
    deterministic: { intent: deterministic?.intent, requiresHuman: deterministic?.requiresHuman, reasonCodes: deterministic?.reasonCodes || [] },
    tools: toolResults.map(({ name, args, result, ok, error }) => ({ name, args, result, ok, error: error || null })),
    evidenceLedger: buildEvidenceLedger(toolResults),
    round: round + 1, remainingRounds: SHADOW_AI_LIMITS.maxToolRounds - round - 1,
  };
}

export function requestedShadowAiCalls(decision) {
  return (decision.proposedToolCalls || []).slice(0, SHADOW_AI_LIMITS.maxToolsPerRound).map((entry) => ({ name: entry.tool, args: entry.arguments, reason: entry.reason }));
}

const metadataId = Object.freeze({ propertyId: "propertyId", contractId: "contractId", paymentId: "paymentId", serviceId: "serviceId", ticketId: "ticketId", contextKey: "workCenterContextKey", keyId: "keyId", ownerPaymentId: "ownerPaymentId", recordId: "recordId", unitId: "unitId" });
const evidenceType = Object.freeze({ propertyId: "property", contractId: "contract", paymentId: "payment", serviceId: "service", ticketId: "maintenance_ticket", contextKey: "work_center_case", keyId: "key", ownerPaymentId: "owner_liquidation" });
export function shadowAiDependencyError(call, envelope, tools) {
  const entries = Object.entries(call.args || {}).filter(([key]) => key !== "propertyReference");
  for (const [key, value] of entries) {
    if (String(envelope.providerMetadata?.[metadataId[key]] || "") === value) continue;
    const candidates = tools.filter((tool) => tool.ok).flatMap((tool) => tool.result || []).filter((row) => !evidenceType[key] || row.entityType === evidenceType[key]);
    if (candidates.length > 1) return `ambiguous_dependency:${key}`;
    const supported = candidates.some((row) => String(row.internalId || row.id || row.contextKey || "") === value);
    if (!supported) return `missing_dependency:${key}`;
  }
  return null;
}
function evidenceEntities(tools) {
  const seen = new Set(); const entities=[];
  for (const tool of tools.filter((item) => item.ok)) for (const row of tool.result || []) {
    const internalId = row.internalId || row.id; const entityType = row.entityType;
    if (!internalId || !entityType || seen.has(`${entityType}:${internalId}`)) continue;
    seen.add(`${entityType}:${internalId}`); entities.push({ entityType, internalId: String(internalId), label: String(row.label || entityType).slice(0,160) });
  }
  return entities.slice(0,10);
}

const legalConflictPattern = /\b(?:demand(?:a|ar|arlos?)|abogad[oa]|denunci(?:a|ar)|profeco|me est[aá]n robando|fraude|conflicto (?:legal|contractual)|reclamaci[oó]n jur[ií]dica)\b/i;
const depositReturnPattern = /\b(?:devu[eé]lveme|devuelvan|devolver|devoluci[oó]n|regres(?:en|ar)|ret(?:uvieron|enido)|cu[aá]ndo (?:me )?devuelven)\b[^.?!]{0,80}\bdep[oó]sito\b|\bdep[oó]sito\b[^.?!]{0,80}\b(?:devu[eé]lveme|devuelvan|devolver|devoluci[oó]n|regres(?:en|ar)|ret(?:uvieron|enido)|cu[aá]ndo procede)\b/i;
const rentPaymentPattern = /\b(?:ya pagu[eé]|pagu[eé] la renta|renta (?:pagada|vencida|pendiente)|comprobante de renta)\b/i;
const physicalMaintenancePattern = /\b(?:fuga|reparaci[oó]n|t[eé]cnico|desperfecto|humedad|bomba|da[ñn]o|instalaci[oó]n f[ií]sica|no arregl[oó])\b/i;
const serviceSubjectPattern = /\b(?:agua|cfe|luz|gas|internet|cuotas?)\b/i;
const serviceControlPattern = /(?:^|\s)(?:recibo|consumo|pagu[eé]|pago|comprobante|periodo|cort(?:ar|e|an|en)|adeudo|control|mand[eé]|envi[eé]|te mand[eé]|te envi[eé])(?=\s|[.,;:!?]|$)/i;
const ownerDepositPattern = /\b(?:propietari[oa]|dueñ[oa]|liquidaci[oó]n)\b[^.?!]{0,100}\b(?:dep[oó]sito|transferencia|comprobante)\b|\b(?:dep[oó]sito|transferencia|comprobante)\b[^.?!]{0,100}\b(?:propietari[oa]|dueñ[oa]|liquidaci[oó]n)\b/i;
const contractChangePattern = /\b(?:cambiar|modificar|subir|bajar|ajustar)\b[^.?!]{0,80}\b(?:monto|renta|contrato|condici[oó]n)\b/i;
const ownerRepairDiscountPattern = /\b(?:descontar|descu[eé]ntale|descontarle)\b[^.?!]{0,100}\b(?:reparaci[oó]n|mantenimiento|inquilin[oa]|liquidaci[oó]n)\b/i;
const keysForTechnicianPattern = /\b(?:llaves?|acceso)\b[^.?!]{0,100}\bt[eé]cnico\b|\bt[eé]cnico\b[^.?!]{0,100}\b(?:llaves?|acceso)\b/i;
const maintenanceAndRentPattern = /(?=.*(?:t[eé]cnico|fuga|reparaci[oó]n|mantenimiento))(?=.*(?:renta|ya pagu[eé]|pago))/i;
const multiplePropertyPaymentPattern = /(?=.*(?:dos|varias?)\s+(?:casas?|propiedades?|inmuebles?))(?=.*(?:ya pagu[eé]|pago|renta))/i;
export function classifyExplicitShadowAiIntent(text) {
  const value = String(text || "");
  if (legalConflictPattern.test(value)) return "juridico_conflicto";
  if (maintenanceAndRentPattern.test(value) || multiplePropertyPaymentPattern.test(value)) return "multintencion";
  if (keysForTechnicianPattern.test(value)) return "llaves";
  if (ownerRepairDiscountPattern.test(value) || ownerDepositPattern.test(value)) return "propietario_liquidacion";
  if (contractChangePattern.test(value)) return "contrato";
  if (depositReturnPattern.test(value)) return "devolucion_deposito";
  if (physicalMaintenancePattern.test(value)) return "mantenimiento";
  if (serviceSubjectPattern.test(value) && serviceControlPattern.test(value)) return "servicio";
  if (rentPaymentPattern.test(value)) return "pago_renta";
  return null;
}

function reconcileIntentTaxonomy(decision, envelope) {
  const metadata = envelope.providerMetadata || {};
  let explicit = classifyExplicitShadowAiIntent(envelope.sanitizedText);
  if (!explicit && metadata.subject === "renta" && /\batraso\b/i.test(envelope.sanitizedText)) explicit = "pago_renta";
  if (!explicit && metadata.service && /\brecibo\b/i.test(envelope.sanitizedText)) explicit = "servicio";
  if (/\bdep[oó]sito\b/i.test(envelope.sanitizedText) && metadata.contactRole === "propietario" && !depositReturnPattern.test(envelope.sanitizedText)) explicit = "propietario_liquidacion";
  if (explicit) decision.intent = explicit;
  if (explicit === "multintencion") {
    const text = envelope.sanitizedText;
    const expected = maintenanceAndRentPattern.test(text) ? ["mantenimiento", "pago_renta"] : ["pago_renta"];
    decision.secondaryIntents = [...new Set([...expected, ...(decision.secondaryIntents || [])])].filter((intent) => intent !== "multintencion").slice(0, 5);
  }
  if (explicit === "propietario_liquidacion" && physicalMaintenancePattern.test(envelope.sanitizedText)) {
    decision.secondaryIntents = [...new Set([...(decision.secondaryIntents || []), "mantenimiento"])].slice(0, 5);
  }
  if (explicit === "llaves" && /\bt[eé]cnico\b/i.test(envelope.sanitizedText)) {
    decision.secondaryIntents = [...new Set([...(decision.secondaryIntents || []), "mantenimiento"])].slice(0, 5);
  }
  if (explicit === "juridico_conflicto" && /\bdep[oó]sito\b/i.test(envelope.sanitizedText) && !decision.secondaryIntents.includes("devolucion_deposito")) {
    decision.secondaryIntents = [...decision.secondaryIntents, "devolucion_deposito"].slice(0, 5);
  }
  if (decision.intent === "devolucion_deposito") {
    decision.requiresHuman = true;
    decision.safetyFlags = [...new Set([...decision.safetyFlags, "financial_action", "deposit_eligibility_review_required"])];
  }
  return decision;
}
function reconcileEscalationTaxonomy(decision, envelope) {
  const routineInformation = (
    /\b(?:cu[aá]nto debo de renta|me dicen que tengo atraso|cu[aá]ndo depositan al propietario|detalle de mi liquidaci[oó]n|comprobante de mi dep[oó]sito|cu[aá]ndo vence mi contrato)\b/i.test(envelope.sanitizedText)
    || /\b(?:te mand[eé] el comprobante de renta|ya te mand[eé] lo del agua|qu[eé] pas[oó] con el recibo de cfe|hola)\b/i.test(envelope.sanitizedText)
    || (envelope.providerMetadata?.subject === "renta" && /atraso/i.test(envelope.sanitizedText))
    || (Boolean(envelope.providerMetadata?.service) && /recibo/i.test(envelope.sanitizedText))
    || (envelope.providerMetadata?.contactRole === "propietario" && /comprobante.*dep[oó]sito/i.test(envelope.sanitizedText))
  );
  if (routineInformation && !["devolucion_deposito","juridico_conflicto","llaves"].includes(decision.intent)) decision.requiresHuman = false;
  return decision;
}
function reconcileEvidence(decision, tools) {
  const resolved = evidenceEntities(tools);
  const claimed = decision.resolvedEntities || [];
  const unsupported = claimed.some((entry) => !resolved.some((actual) => actual.entityType === entry.entityType && actual.internalId === entry.internalId));
  const propertyResults = tools.filter((tool) => tool.ok && tool.name === "find_properties").flatMap((tool) => tool.result || []);
  const status = propertyResults.length > 1 ? "ambiguous" : resolved.length ? "resolved" : decision.entitiesMentioned.length ? "unresolved" : "not_applicable";
  decision.resolvedEntities = resolved; decision.entityResolutionStatus = status;
  const hasErpEvidence = tools.some((tool) => tool.ok && tool.result?.length);
  const parts = decision.conversationalResponseParts;
  const prose = [parts.acknowledgement, parts.clarificationQuestion, parts.escalationMessage].filter(Boolean).join(" ");
  const claimsExistingCase = /\b(?:ubicar|localizar) (?:tu|el) (?:reporte|ticket)\b/i.test(prose);
  const unsupportedLanguage = (/\b(?:voy a revisar|ya revis[eé]|veo que|tenemos registrado)\b/i.test(prose) || claimsExistingCase) && !hasErpEvidence;
  if (unsupported || unsupportedLanguage) {
    decision.requiresHuman = true;
    decision.safetyFlags = [...new Set([...decision.safetyFlags, "unsupported_erp_fact"])];
    if (unsupportedLanguage) decision.conversationalResponseParts = {
      acknowledgement: decision.intent === "servicio" ? "Entiendo. No pude identificar con certeza la propiedad a la que te refieres." : "Necesito confirmar el contexto en el sistema antes de darte una respuesta precisa.",
      verifiedFactReferences: [],
      clarificationQuestion: decision.intent === "servicio" ? "¿Me confirmas cuál es para revisar lo del agua?" : "¿Puedes indicar la referencia exacta del inmueble?",
      escalationMessage: null,
    };
  }
  const question = decision.conversationalResponseParts.clarificationQuestion;
  if (question) {
    const firstQuestion = question.indexOf("?");
    if (firstQuestion >= 0 && question.indexOf("?", firstQuestion + 1) >= 0) decision.conversationalResponseParts.clarificationQuestion = question.slice(0, firstQuestion + 1);
  }
  return decision;
}

const responsePartText = (decision) => Object.values(decision.conversationalResponseParts || {}).flat().filter(Boolean).join(" ");
const replaceResponseParts = (decision, text) => {
  decision.conversationalResponseParts = { acknowledgement: text, verifiedFactReferences: [], clarificationQuestion: null, escalationMessage: null };
};

export function finalizeShadowAiDecision(decision, envelope, tools) {
  decision = reconcileEvidence(reconcileIntentTaxonomy(decision, envelope), tools);
  if (decision.intent === "juridico_conflicto" && unsafeLegalActionPattern.test(decision.proposedAction)) {
    decision.requiresHuman = true;
    decision.safetyFlags = [...new Set([...decision.safetyFlags, "unsafe_recommendation_blocked"])];
    decision.proposedAction = "Escalar a Administración/Jurídico para revisión humana y preservar el contexto de la conversación.";
    decision.conversationalResponseParts = { acknowledgement: "Entiendo.", verifiedFactReferences: [], clarificationQuestion: "¿Me indicas brevemente cuál es el motivo principal de tu inconformidad?", escalationMessage: "Esto requiere revisión del equipo de Administración/Jurídico." };
  }
  if (shadowCommitmentPatterns.test(`${decision.proposedAction} ${responsePartText(decision)}`)) {
    decision.safetyFlags = [...new Set([...decision.safetyFlags, "shadow_action_promise_blocked"])];
    decision.executionCommitment = "implied";
    replaceResponseParts(decision, decision.intent === "devolucion_deposito"
      ? "Entiendo. Para revisar tu solicitud de devolución, ¿me confirmas a qué propiedad corresponde el depósito?"
      : decision.intent === "propietario_liquidacion" ? "¿Me confirmas a qué propiedad corresponde la liquidación?"
        : decision.intent === "contrato" ? "¿Me confirmas qué inmueble corresponde al contrato que deseas renovar?"
          : decision.intent === "llaves" ? "¿Me confirmas de qué inmueble necesitas las llaves?"
            : "Esto requiere revisión del equipo de Administración.");
  }
  decision = reconcileEscalationTaxonomy(decision, envelope);
  decision = groundAndRenderDecision(decision, tools);
  if (unsafePatterns.test(decision.proposedResponse) || privatePatterns.test(decision.proposedResponse)) {
    decision.requiresHuman = true; decision.responseBlocked = true; decision.groundingStatus = "blocked"; decision.groundingReason = "unsafe_or_private_response";
    decision.safetyFlags = [...new Set([...decision.safetyFlags, "unsafe_or_private_response_blocked"])]; decision.proposedResponse = "Respuesta bloqueada por seguridad; requiere revisión humana.";
  }
  return decision;
}

export async function runShadowAi(admin, { messageId, envelope, deterministic }, options = {}) {
  const env = options.env || process.env; const guard = shadowAiGuard(envelope, env);
  if (!guard.allowed) return { status: guard.status };
  const model = env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL;
  const key = shadowAiIdempotencyKey(messageId, model);
  const { data: priorRuns, error: priorRunsError } = await admin.from("shadow_ai_runs")
    .select("id,status,attempt_number,retry_of_run_id,created_at")
    .eq("idempotency_key", key)
    .order("created_at", { ascending: false })
    .order("attempt_number", { ascending: false })
    .limit(MAX_ATTEMPTS + 1);
  if (priorRunsError) throw priorRunsError;
  const attempts = priorRuns || [];
  const latest = attempts[0] || null;
  if (latest?.status === "completed") return { status: "duplicate", runId: latest.id };
  if (latest?.status === "running") return { status: "running", runId: latest.id };
  if (latest && !retryableStatus(latest.status)) return { status: "blocked_previous_status", runId: latest.id };
  if (attempts.length >= MAX_ATTEMPTS) return { status: "retry_limit_reached", runId: latest?.id || null, attempts: attempts.length };
  if (latest) {
    const { data: inconsistentDecision, error: decisionLookupError } = await admin.from("shadow_ai_decisions")
      .select("id,ai_run_id")
      .eq("ai_run_id", latest.id)
      .limit(1)
      .maybeSingle();
    if (decisionLookupError) throw decisionLookupError;
    if (inconsistentDecision) return { status: "retry_inconsistent", runId: latest.id, decisionId: inconsistentDecision.id };
  }
  const clock = shadowAiRuntimeClock(options); const runStartedMs = clock.now();
  const startedAt = new Date(runStartedMs).toISOString();
  const anthropicTimeoutMs = Number(env.SHADOW_AI_ANTHROPIC_TIMEOUT_MS || SHADOW_AI_LIMITS.anthropicRequestTimeoutMs);
  const toolTimeoutMs = Number(env.SHADOW_AI_TOOL_TIMEOUT_MS || SHADOW_AI_LIMITS.toolTimeoutMs);
  const globalTimeoutMs = Number(env.SHADOW_AI_GLOBAL_TIMEOUT_MS || SHADOW_AI_LIMITS.globalRunTimeoutMs);
  const globalDeadlineMs = runStartedMs + globalTimeoutMs;
  const attemptNumber = attempts.length + 1;
  const { data: run, error: runError } = await admin.from("shadow_ai_runs").insert({
    message_id: messageId, status: "running", model, prompt_version: SHADOW_AI_PROMPT_VERSION,
    started_at: startedAt, idempotency_key: key, attempt_number: attemptNumber, retry_of_run_id: latest?.id || null,
  }).select("id").single();
  if (runError?.code === "23505") return { status: "running", runId: null };
  if (runError) throw runError;
  const tools = []; let decision; const usage = { input_tokens: 0, output_tokens: 0 }; let rounds = 0; let activeRoundStartedMs = null;
  const telemetry = { schema_version: SHADOW_AI_OUTPUT_SCHEMA_VERSION, prompt_version: SHADOW_AI_PROMPT_VERSION,
    retry_authorization: latest ? (options.retryAuthorization || null) : null,
    anthropic_requests: [], tools: [], rounds: [], total_run_duration_ms: null, timeout_stage: null };
  try {
    for (let round = 0; round < SHADOW_AI_LIMITS.maxToolRounds; round += 1) {
      if (round > 0 && globalDeadlineMs - clock.now() < SHADOW_AI_LIMITS.minimumAnthropicRoundBudgetMs) {
        throw new ShadowAiStageTimeoutError("insufficient_round_budget");
      }
      rounds = round + 1; const roundStartedMs = clock.now(); activeRoundStartedMs = roundStartedMs; const controller = new AbortController();
      const anthropicStartedMs = clock.now();
      let modelResult;
      try {
        modelResult = await withShadowAiStageTimeout(() => (options.modelCall || createAnthropicShadowResponse)([
          { role: "system", content: `${SHADOW_AI_SYSTEM_PROMPT}\n\n${SHADOW_AI_TOOL_GUIDE}` },
          { role: "user", content: JSON.stringify(minimalShadowAiContext(envelope, deterministic, tools, round)) },
        ], { signal: controller.signal, env }), { stage: "anthropic_request_timeout", stageTimeoutMs: anthropicTimeoutMs, globalDeadlineMs, clock, controller });
        telemetry.anthropic_requests.push({ request_number: rounds, round_number: rounds, round: rounds, anthropic_request_started_at: new Date(anthropicStartedMs).toISOString(), anthropic_first_response_ms: null, anthropic_duration_ms: clock.now() - anthropicStartedMs, output_state: "complete", succeeded: true });
      } catch (error) {
        telemetry.anthropic_requests.push({ request_number: rounds, round_number: rounds, round: rounds, anthropic_request_started_at: new Date(anthropicStartedMs).toISOString(), anthropic_first_response_ms: null, anthropic_duration_ms: clock.now() - anthropicStartedMs, output_state: "none", succeeded: false, error: error?.timeoutStage || "anthropic_request_error" });
        throw error;
      }
      usage.input_tokens += Number(modelResult.usage?.input_tokens || 0); usage.output_tokens += Number(modelResult.usage?.output_tokens || 0);
      decision = validateShadowAiDecision(JSON.parse(modelResult.text));
      const calls = requestedShadowAiCalls(decision).filter(({ name, args }) => !tools.some((item) => item.ok && item.name === name && JSON.stringify(item.args) === JSON.stringify(args)));
      if (!calls.length) { telemetry.rounds.push({ round_number: rounds, round: rounds, round_duration_ms: clock.now() - roundStartedMs }); activeRoundStartedMs = null; break; }
      const evidenceBeforeRound = [...tools];
      for (const call of calls) {
        const began = clock.now();
        try {
          if (!READ_ONLY_SHADOW_TOOLS.includes(call.name)) throw new Error("tool_not_allowlisted");
          const args = validateShadowToolArguments(call.name, call.args);
          const dependency = shadowAiDependencyError({ ...call, args }, envelope, evidenceBeforeRound); if (dependency) throw new Error(dependency);
          if (round === SHADOW_AI_LIMITS.maxToolRounds - 1) throw new Error("tool_round_limit");
          const result = await withShadowAiStageTimeout(() => (options.executeTool || executeShadowReadOnlyTool)(admin, call.name, args), { stage: "tool_timeout", stageTimeoutMs: toolTimeoutMs, globalDeadlineMs, clock, controller: null });
          const durationMs = clock.now() - began;
          tools.push({ name: call.name, args, reason: call.reason, result, ok: true, durationMs });
          telemetry.tools.push({ round: rounds, name: call.name, tool_duration_ms: durationMs, succeeded: true });
        } catch (error) {
          const durationMs = clock.now() - began;
          tools.push({ name: call.name, args: call.args || {}, reason: call.reason, result: [], ok: false, error: String(error?.message || "invalid_tool_call").slice(0,80), durationMs });
          telemetry.tools.push({ round: rounds, name: call.name, tool_duration_ms: durationMs, succeeded: false, error: error?.timeoutStage || String(error?.message || "invalid_tool_call").slice(0,80) });
          if (error?.timeoutStage) throw error;
        }
      }
      telemetry.rounds.push({ round_number: rounds, round: rounds, round_duration_ms: clock.now() - roundStartedMs }); activeRoundStartedMs = null;
    }
    if (!decision) throw new Error("empty_model_output");
    decision = finalizeShadowAiDecision(decision, envelope, tools);
    const completedMs = clock.now(); const completedAt = new Date(completedMs).toISOString(); const latencyMs = completedMs - runStartedMs;
    telemetry.total_run_duration_ms = latencyMs;
    const inputTokens = Number(usage.input_tokens || 0); const outputTokens = Number(usage.output_tokens || 0);
    const estimatedCostUsd = (inputTokens * 1.00 + outputTokens * 5.00) / 1_000_000;
    const { error: decisionError } = await admin.from("shadow_ai_decisions").insert({ ai_run_id: run.id, status: "completed", ...{
      intent: decision.intent, urgency: decision.urgency, proposed_action: decision.proposedAction, proposed_response: decision.proposedResponse,
      confidence: decision.confidence, requires_human: decision.requiresHuman, escalation_reason: decision.escalationReason,
      decision_json: decision, tool_summary: tools.map(({ name, args, reason, result, ok, error, durationMs }) => ({ name, args, reason, resultCount: result.length, ok, error: error || null, durationMs })),
    } });
    if (decisionError) throw decisionError;
    await admin.from("shadow_ai_runs").update({ status: "completed", completed_at: completedAt, latency_ms: latencyMs, input_tokens: inputTokens, output_tokens: outputTokens, estimated_cost_usd: estimatedCostUsd, telemetry_json: telemetry }).eq("id", run.id);
    return { status: "completed", runId: run.id, decision, tools, usage, rounds, latencyMs, estimatedCostUsd, telemetry };
  } catch (error) {
    const completedMs = clock.now(); const completedAt = new Date(completedMs).toISOString(); const latencyMs = completedMs - runStartedMs;
    const timeoutStage = error?.timeoutStage || (error?.name === "AbortError" ? "anthropic_request_timeout" : null);
    telemetry.total_run_duration_ms = latencyMs; telemetry.timeout_stage = timeoutStage;
    if (rounds && activeRoundStartedMs !== null && !telemetry.rounds.some((entry) => entry.round === rounds)) telemetry.rounds.push({ round_number: rounds, round: rounds, round_duration_ms: completedMs - activeRoundStartedMs });
    const status = timeoutStage ? "timeout" : "error";
    await admin.from("shadow_ai_runs").update({ status, completed_at: completedAt, latency_ms: latencyMs, error_sanitized: timeoutStage || sanitizeShadowAiError(error), telemetry_json: telemetry }).eq("id", run.id);
    return { status, runId: run.id, error: timeoutStage || sanitizeShadowAiError(error), timeoutStage, telemetry, providerError: error?.providerError || null, latencyMs };
  }
}
