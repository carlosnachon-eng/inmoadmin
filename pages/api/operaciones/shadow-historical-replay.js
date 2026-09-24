import { createClient } from "@supabase/supabase-js";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth.js";
import { sameOriginAdminRequest } from "../../../lib/shadow/identityBootstrap.js";
import { executeHistoricalReplayCase, historicalReplayMetrics, HISTORICAL_REPLAY_MAX_CASES, HISTORICAL_REPLAY_RATINGS, HISTORICAL_REPLAY_REASONS, HISTORICAL_REPLAY_RUNTIME } from "../../../lib/shadow/ai/historicalReplay.js";
import { prepareHistoricalReplaySelection, previewHistoricalReplaySource } from "../../../lib/shadow/ai/historicalReplaySource.js";
import { historicalReplayConversationResult, storedHistoricalReplayConversationResult } from "../../../lib/shadow/ai/historicalReplayResult.js";
import { sanitizedModelPrivacyChecks } from "../../../lib/shadow/ai/modelPrivacyTelemetry.js";
import { projectProviderHttpError, sanitizedProviderHttpDiagnostics, replayProviderUsage, replayUsageColumns, storedReplayProviderAccounting } from "../../../lib/shadow/ai/providerHttpDiagnostics.js";

const adminClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
export function createHistoricalReplayHandler({ createAdmin = adminClient, authorize = authorizeShadowAdministrator, sameOrigin = sameOriginAdminRequest, executeCase = executeHistoricalReplayCase, env = process.env, now = Date.now } = {}) {
return async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ ok: false, error: "method_not_allowed" });
  const actor = await authorize(req); if (!actor) return res.status(403).json({ ok: false, error: "not_authorized" });
  if (req.method === "POST" && !sameOrigin(req)) return res.status(403).json({ ok: false, error: "invalid_origin" });
  const admin = createAdmin();
  try {
    if (req.method === "GET") {
      const [{ data: cohorts, error: cohortError }, { data: cases, error: caseError }, { data: reviews, error: reviewError }] = await Promise.all([
        admin.from("shadow_historical_replay_cohorts").select("id,status,requested_count,domain_counts,runtime_version,created_at,completed_at").order("created_at", { ascending: false }).limit(20),
        admin.from("shadow_historical_replay_cases").select("id,cohort_id,case_ref,case_domain,status,occurred_at,turn_snapshot,human_response_snapshot,temporal_grounding,identity_grounding,operational_resolution,conversation_action,proposed_message,result_safe,message_safe,would_resolve_without_human,input_tokens,output_tokens,estimated_cost_usd,latency_ms,error_code,created_at,completed_at").order("created_at", { ascending: false }).limit(100),
        admin.from("shadow_historical_replay_reviews").select("id,replay_case_id,rating,reason,human_auto_send_eligible,comment_safe,review_schema_version,created_at").order("created_at", { ascending: false }).limit(200),
      ]);
      if (cohortError || caseError || reviewError) throw cohortError || caseError || reviewError;
      const latestReview = new Map((reviews || []).map((row) => [row.replay_case_id, row]));
      const enriched = (cases || []).map((row) => {
        const privacyChecks = sanitizedModelPrivacyChecks(row.result_safe?.privacy_checks);
        const providerHttp = sanitizedProviderHttpDiagnostics(row.result_safe?.providerHttp);
        const accounting = storedReplayProviderAccounting(row);
        return { ...row, ...storedHistoricalReplayConversationResult(row), ...accounting,
          result_safe: { ...row.result_safe, providerHttp,
            ...(row.result_safe?.providerUsage ? { providerUsage: replayProviderUsage(accounting.input_tokens, accounting.output_tokens) } : {}),
            privacy_checks: privacyChecks }, provider_http: providerHttp, privacy_checks: privacyChecks,
          review: latestReview.get(row.id) || null };
      });
      return res.status(200).json({ ok: true, runtime: HISTORICAL_REPLAY_RUNTIME, cohorts: cohorts || [], cases: enriched, metrics: historicalReplayMetrics(enriched.map((row) => ({ ...row, human_rating: row.review?.rating }))) });
    }
    const action = String(req.body?.action || "");
    if (action === "preview") {
      const preview = await previewHistoricalReplaySource(admin, { env, now: now() });
      return res.status(200).json({ ok: true, preview: { ...preview, cases: preview.cases.map(({ envelope, humanResponseSnapshot, ...row }) => ({ ...row, humanResponseAvailable: Boolean(humanResponseSnapshot), envelope: undefined })) } });
    }
    if (action === "prepare") {
      const turnKeys = Array.isArray(req.body?.turnKeys) ? [...new Set(req.body.turnKeys.map(String))] : [];
      if (!turnKeys.length || turnKeys.length > HISTORICAL_REPLAY_MAX_CASES) return res.status(400).json({ ok: false, error: "invalid_explicit_cohort" });
      const selected = await prepareHistoricalReplaySelection(admin, { turnKeys, sourceSnapshot: req.body?.sourceSnapshot, env, now: now() });
      const { data: cohort, error } = await admin.from("shadow_historical_replay_cohorts").insert({ runtime_version: HISTORICAL_REPLAY_RUNTIME, requested_count: selected.cases.length, domain_counts: selected.counts, created_by: actor.id }).select("id").single(); if (error) throw error;
      const rows = selected.cases.map((item) => ({ cohort_id: cohort.id, historical_turn_key: item.historicalTurnKey, evaluation_runtime_version: item.evaluationRuntimeVersion, case_ref: item.caseRef, case_domain: item.domain, status: item.sufficientHistoricalContext ? "pending" : "not_evaluable", occurred_at: item.occurredAt, turn_snapshot: { ...item.turnSnapshot, envelope: item.envelope }, human_response_snapshot: item.humanResponseSnapshot, temporal_grounding: item.temporalGrounding, identity_grounding: item.identityGrounding, error_code: item.exclusionReason }));
      const { error: insertError } = await admin.from("shadow_historical_replay_cases").insert(rows); if (insertError) throw insertError;
      return res.status(201).json({ ok: true, cohortId: cohort.id, selected: rows.length });
    }
    if (action === "execute_one") {
      const id = String(req.body?.caseId || "");
      const { data: row, error } = await admin.from("shadow_historical_replay_cases").select("*").eq("id", id).eq("status", "pending").maybeSingle(); if (error) throw error;
      if (!row) return res.status(409).json({ ok: false, error: "replay_case_not_pending" });
      const { data: claimed, error: claimError } = await admin.from("shadow_historical_replay_cases").update({ status: "running" }).eq("id", id).eq("status", "pending").select("id").maybeSingle(); if (claimError) throw claimError;
      if (!claimed) return res.status(409).json({ ok: false, error: "replay_case_claim_conflict" });
      const snapshot = row.turn_snapshot || {};
      const replayCase = { evaluationMode: "historical_replay", sufficientHistoricalContext: true, temporalGrounding: row.temporal_grounding, identityGrounding: row.identity_grounding, humanResponseSnapshot: row.human_response_snapshot, envelope: snapshot.envelope };
      let privacyChecks = [];
      try {
        // Server-owned option. Never accept schema selection from the client.
        const result = await executeCase(admin, replayCase, { env, useReducedOutputSchema: true });
        const resolution = result.operationalResolution; const conversation = result.conversationAction;
        const conversationResult = historicalReplayConversationResult(conversation);
        privacyChecks = sanitizedModelPrivacyChecks(result.privacyChecks);
        const providerUsage = replayProviderUsage(result.inputTokens, result.outputTokens);
        const { data: saved, error: saveError } = await admin.from("shadow_historical_replay_cases").update({ status: "completed", operational_resolution: resolution, conversation_action: conversation.conversation_action, proposed_message: conversation.proposed_message, result_safe: { conversationAction: conversationResult, tools: result.tools, evidence: result.evidence, providerRequestRefs: result.providerRequestRefs, providerModels: result.providerModels, providerModelStatus: result.providerModelStatus, providerUsage, outputDiagnostics: result.outputDiagnostics, privacy_checks: privacyChecks }, message_safe: result.messageSafe, would_resolve_without_human: resolution.would_resolve_without_human, ...replayUsageColumns(providerUsage), latency_ms: result.latencyMs, completed_at: new Date().toISOString() }).eq("id", id).eq("status", "running").select("id").maybeSingle();
        if (saveError || !saved) throw new Error("historical_replay_result_not_saved");
        return res.status(200).json({ ok: true, caseId: id, status: "completed", ...conversationResult, privacy_checks: privacyChecks });
      } catch (executionError) {
        const telemetry = executionError.historicalReplayTelemetry || {};
        privacyChecks = sanitizedModelPrivacyChecks(telemetry.privacyChecks || privacyChecks);
        const privacyFailure = privacyChecks.at(-1)?.privacy_failure_code;
        const providerHttp = sanitizedProviderHttpDiagnostics(telemetry.providerHttp) || projectProviderHttpError(executionError.providerError);
        const providerUsage = replayProviderUsage(telemetry.inputTokens, telemetry.outputTokens);
        const providerRequestRefs = [...new Set([...(telemetry.providerRequestRefs || []), providerHttp?.provider_request_ref])].filter((ref) => typeof ref === "string" && /^[a-f0-9]{64}$/.test(ref));
        const outputDiagnostics = { outputStage: privacyFailure ? "final_model_privacy" : providerHttp ? "provider_http" : telemetry.outputStage || "unknown",
          diagnosticCode: privacyFailure || (providerHttp ? `model_http_${providerHttp.provider_http_status}` : telemetry.diagnosticCode || "historical_replay_error"), truncatedFields: telemetry.truncatedFields || [] };
        await admin.from("shadow_historical_replay_cases").update({ status: "error", error_code: privacyFailure || (providerHttp ? outputDiagnostics.diagnosticCode : String(executionError.message || "replay_error").replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 80)), result_safe: { providerRequestRefs, providerModels: telemetry.providerModels || [], providerModelStatus: telemetry.providerModelStatus || "unaccredited", providerUsage, providerHttp, outputDiagnostics, privacy_checks: privacyChecks }, ...replayUsageColumns(providerUsage), latency_ms: Number(telemetry.latencyMs || 0), completed_at: new Date().toISOString() }).eq("id", id).eq("status", "running");
        return res.status(422).json({ ok: false, error: "historical_replay_execution_error", outputDiagnostics, provider_http: providerHttp, providerUsage, providerRequestRefs, provider_model_status: telemetry.providerModelStatus || "unaccredited", privacy_checks: privacyChecks });
      }
    }
    if (action === "review") {
      const rating = String(req.body?.rating || ""); const reason = req.body?.reason ? String(req.body.reason) : null;
      const humanAutoSendEligible = req.body?.humanAutoSendEligible;
      const commentSafe = String(req.body?.comment || "").replace(/\s+/g, " ").trim().slice(0, 500) || null;
      if (!HISTORICAL_REPLAY_RATINGS.includes(rating) || (reason && !HISTORICAL_REPLAY_REASONS.includes(reason)) || typeof humanAutoSendEligible !== "boolean" || (rating !== "correct" && !reason)) return res.status(400).json({ ok: false, error: "invalid_review" });
      const { error } = await admin.from("shadow_historical_replay_reviews").insert({ replay_case_id: String(req.body?.caseId || ""), rating, reason, human_auto_send_eligible: humanAutoSendEligible, comment_safe: commentSafe, review_schema_version: "v2", reviewed_by: actor.id }); if (error) throw error;
      return res.status(201).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: "invalid_action" });
  } catch (error) {
    if (error.replaySourceStatus) return res.status(error.replaySourceStatus).json({ ok: false, error: error.message });
    console.error("[shadow-historical-replay]", String(error?.message || "historical_replay_error").slice(0, 100));
    return res.status(500).json({ ok: false, error: "historical_replay_error" });
  }
};
}

export default createHistoricalReplayHandler();
