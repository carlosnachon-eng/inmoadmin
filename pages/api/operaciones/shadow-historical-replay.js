import { createClient } from "@supabase/supabase-js";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth.js";
import { sameOriginAdminRequest } from "../../../lib/shadow/identityBootstrap.js";
import { executeHistoricalReplayCase, historicalReplayMetrics, HISTORICAL_REPLAY_MAX_CASES, HISTORICAL_REPLAY_RATINGS, HISTORICAL_REPLAY_REASONS, HISTORICAL_REPLAY_RUNTIME, selectHistoricalReplayCohort } from "../../../lib/shadow/ai/historicalReplay.js";

const adminClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const loadSource = async (admin) => {
  const [messages, conversations, media] = await Promise.all([
    admin.from("shadow_messages").select("id,conversation_id,external_message_id,direction,occurred_at,sanitized_text,message_type,attachment_metadata,provider_metadata").order("occurred_at", { ascending: true }).limit(2000),
    admin.from("shadow_conversations").select("id,provider,channel,respond_contact_id,last_message_at").eq("provider", "respond_admin").eq("channel", "544519"),
    admin.from("shadow_media_interpretations").select("external_message_id,status,result_safe").eq("status", "completed").limit(500),
  ]);
  const failed = [messages, conversations, media].find((item) => item.error)?.error; if (failed) throw failed;
  return { messages: messages.data || [], conversations: conversations.data || [], mediaInterpretations: media.data || [] };
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ ok: false, error: "method_not_allowed" });
  const actor = await authorizeShadowAdministrator(req); if (!actor) return res.status(403).json({ ok: false, error: "not_authorized" });
  if (req.method === "POST" && !sameOriginAdminRequest(req)) return res.status(403).json({ ok: false, error: "invalid_origin" });
  const admin = adminClient();
  try {
    if (req.method === "GET") {
      const [{ data: cohorts, error: cohortError }, { data: cases, error: caseError }, { data: reviews, error: reviewError }] = await Promise.all([
        admin.from("shadow_historical_replay_cohorts").select("id,status,requested_count,domain_counts,runtime_version,created_at,completed_at").order("created_at", { ascending: false }).limit(20),
        admin.from("shadow_historical_replay_cases").select("id,cohort_id,case_ref,case_domain,status,occurred_at,turn_snapshot,human_response_snapshot,temporal_grounding,identity_grounding,operational_resolution,conversation_action,proposed_message,result_safe,message_safe,would_resolve_without_human,input_tokens,output_tokens,estimated_cost_usd,latency_ms,error_code,created_at,completed_at").order("created_at", { ascending: false }).limit(100),
        admin.from("shadow_historical_replay_reviews").select("id,replay_case_id,rating,reason,created_at").order("created_at", { ascending: false }).limit(200),
      ]);
      if (cohortError || caseError || reviewError) throw cohortError || caseError || reviewError;
      const latestReview = new Map((reviews || []).map((row) => [row.replay_case_id, row]));
      const enriched = (cases || []).map((row) => ({ ...row, review: latestReview.get(row.id) || null }));
      return res.status(200).json({ ok: true, runtime: HISTORICAL_REPLAY_RUNTIME, cohorts: cohorts || [], cases: enriched, metrics: historicalReplayMetrics(enriched.map((row) => ({ ...row, human_rating: row.review?.rating }))) });
    }
    const action = String(req.body?.action || "");
    if (action === "preview") {
      const source = await loadSource(admin); const preview = selectHistoricalReplayCohort({ ...source, env: process.env });
      return res.status(200).json({ ok: true, preview: { ...preview, cases: preview.cases.map(({ envelope, humanResponseSnapshot, ...row }) => ({ ...row, humanResponseAvailable: Boolean(humanResponseSnapshot), envelope: undefined })) } });
    }
    if (action === "prepare") {
      const turnKeys = Array.isArray(req.body?.turnKeys) ? [...new Set(req.body.turnKeys.map(String))] : [];
      if (!turnKeys.length || turnKeys.length > HISTORICAL_REPLAY_MAX_CASES) return res.status(400).json({ ok: false, error: "invalid_explicit_cohort" });
      const source = await loadSource(admin); const selected = selectHistoricalReplayCohort({ ...source, env: process.env, selectedTurnKeys: turnKeys });
      if (selected.cases.length !== turnKeys.length) return res.status(400).json({ ok: false, error: "cohort_contains_ineligible_turn" });
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
      try {
        const result = await executeHistoricalReplayCase(admin, replayCase, { env: process.env });
        const resolution = result.operationalResolution; const conversation = result.conversationAction;
        await admin.from("shadow_historical_replay_cases").update({ status: "completed", operational_resolution: resolution, conversation_action: conversation.conversation_action, proposed_message: conversation.proposed_message, result_safe: { tools: result.tools, evidence: result.evidence, providerRequestRefs: result.providerRequestRefs, providerModels: result.providerModels, outputDiagnostics: result.outputDiagnostics }, message_safe: result.messageSafe, would_resolve_without_human: resolution.would_resolve_without_human, input_tokens: result.inputTokens, output_tokens: result.outputTokens, estimated_cost_usd: result.estimatedCostUsd, latency_ms: result.latencyMs, completed_at: new Date().toISOString() }).eq("id", id).eq("status", "running");
        return res.status(200).json({ ok: true, caseId: id, status: "completed" });
      } catch (executionError) {
        const telemetry = executionError.historicalReplayTelemetry || {};
        await admin.from("shadow_historical_replay_cases").update({ status: "error", error_code: String(executionError.message || "replay_error").replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 80), result_safe: { providerRequestRefs: telemetry.providerRequestRefs || [], providerModels: telemetry.providerModels || [], outputDiagnostics: { outputStage: telemetry.outputStage || "unknown", diagnosticCode: telemetry.diagnosticCode || "historical_replay_error", truncatedFields: telemetry.truncatedFields || [] } }, input_tokens: Number(telemetry.inputTokens || 0), output_tokens: Number(telemetry.outputTokens || 0), estimated_cost_usd: Number(telemetry.estimatedCostUsd || 0), latency_ms: Number(telemetry.latencyMs || 0), completed_at: new Date().toISOString() }).eq("id", id).eq("status", "running");
        return res.status(422).json({ ok: false, error: "historical_replay_execution_error" });
      }
    }
    if (action === "review") {
      const rating = String(req.body?.rating || ""); const reason = req.body?.reason ? String(req.body.reason) : null;
      if (!HISTORICAL_REPLAY_RATINGS.includes(rating) || (reason && !HISTORICAL_REPLAY_REASONS.includes(reason))) return res.status(400).json({ ok: false, error: "invalid_review" });
      const { error } = await admin.from("shadow_historical_replay_reviews").insert({ replay_case_id: String(req.body?.caseId || ""), rating, reason, reviewed_by: actor.id }); if (error) throw error;
      return res.status(201).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: "invalid_action" });
  } catch (error) {
    console.error("[shadow-historical-replay]", String(error?.message || "historical_replay_error").slice(0, 100));
    return res.status(500).json({ ok: false, error: "historical_replay_error" });
  }
}
