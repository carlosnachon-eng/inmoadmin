import { createClient } from "@supabase/supabase-js";
import { isAdministrativeWorkCenterRole } from "../../../lib/operaciones/administrativeWorkCenter";
import { shadowContextState } from "../../../lib/shadow/pipeline";
import { realShadowDevCloneEligibility, realShadowMessageEligibility } from "../../../lib/shadow/ai/realMessage";
import { REAL_SHADOW_AI_PROMPT_VERSION } from "../../../lib/shadow/ai/realPrompt";

const client = (key, token) => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
  global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  auth: { persistSession: false, autoRefreshToken: false },
});

async function authorize(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return { status: 401, error: "Sesión requerida." };
  const authenticated = client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, token);
  const { data: { user } } = await authenticated.auth.getUser(token);
  if (!user) return { status: 401, error: "Sesión inválida." };
  const { data: profile } = await authenticated.from("profiles").select("id,role_id,active").eq("id", user.id).maybeSingle();
  if (!profile?.active || !isAdministrativeWorkCenterRole(profile.role_id)) return { status: 403, error: "Shadow no autorizado." };
  return { authenticated, profile };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ ok: false, error: "Método no permitido." });
  try {
    const auth = await authorize(req);
    if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });
    if (req.method === "POST") {
      const messageId = String(req.body?.messageId || "");
      const classification = String(req.body?.classification || "");
      if (!messageId || !["correct","partially_correct","wrong_context","wrong_intent","wrong_action","wrong_response","unsafe"].includes(classification)) return res.status(400).json({ ok: false, error: "Evaluación inválida." });
      const { data, error } = await auth.authenticated.from("shadow_human_evaluations").insert({
        message_id: messageId, classification, labels: Array.isArray(req.body?.labels) ? req.body.labels.slice(0, 10) : [],
        expected_correction: String(req.body?.expectedCorrection || "").slice(0, 1000) || null,
        notes: String(req.body?.notes || "").slice(0, 1000) || null, actor_profile_id: auth.profile.id,
      }).select("id,classification,expected_correction,notes,created_at").single();
      if (error) throw error;
      return res.status(201).json({ ok: true, evaluation: data });
    }
    const admin = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const [messages, conversations, events, matches, evaluations, operationalEvents, aiRuns, aiDecisions, toolAudit] = await Promise.all([
      admin.from("shadow_messages").select("id,conversation_id,direction,occurred_at,sanitized_text,message_type,attachment_metadata,provider_metadata,processing_state,intent,administrative_likelihood,reason_codes,requires_human,created_at").order("occurred_at", { ascending: false }).limit(250),
      admin.from("shadow_conversations").select("id,provider,channel,contact_hash,first_message_at,last_message_at,administrative_likelihood,status"),
      admin.from("shadow_ingestion_events").select("status,sanitization_changed,duplicate_count"),
      admin.from("shadow_context_matches").select("message_id,internal_entity_type,internal_id,display_label,match_method,confidence_rank,ambiguous,reason_code,context_href"),
      admin.from("shadow_human_evaluations").select("id,message_id,classification,expected_correction,notes,actor_profile_id,created_at").order("created_at", { ascending: false }),
      admin.from("shadow_operational_events").select("id,source,kind,event_type,aggregate_type,aggregate_id,ticket_id,quote_id,property_id,maintenance_scope,occurred_at,payload_safe,requires_human,created_at").order("occurred_at", { ascending: false }).limit(250),
      admin.from("shadow_ai_runs").select("id,message_id,operational_event_id,input_kind,status,execution_state,current_round,max_rounds,evidence_ledger,model,prompt_version,schema_version,campaign_id,started_at,completed_at,state_updated_at,latency_ms,input_tokens,output_tokens,estimated_cost_usd,error_sanitized,attempt_number,retry_of_run_id").order("created_at", { ascending: false }),
      admin.from("shadow_ai_decisions").select("id,ai_run_id,status,intent,urgency,proposed_action,proposed_response,confidence,requires_human,escalation_reason,decision_json,tool_summary,created_at").order("created_at", { ascending: false }),
      admin.from("shadow_context_query_audit").select("message_id,tool_name,result_count,succeeded,duration_ms,created_at").order("created_at", { ascending: false }),
    ]);
    const failure = [messages, conversations, events, matches, evaluations, operationalEvents, aiRuns, aiDecisions, toolAudit].find((result) => result.error)?.error;
    if (failure) throw failure;
    const counts = (events.data || []).reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1, duplicate: acc.duplicate + Number(item.duplicate_count || 0), sanitized: acc.sanitized + (item.sanitization_changed ? 1 : 0) }), { accepted: 0, duplicate: 0, rejected: 0, error: 0, sanitized: 0 });
    const messageMatches = new Map();
    for (const match of matches.data || []) messageMatches.set(match.message_id, (messageMatches.get(match.message_id) || 0) + 1);
    const conversationsById = new Map((conversations.data || []).map((item) => [item.id, item]));
    const realRunsByMessage = new Map((aiRuns.data || []).filter((item) => item.prompt_version === REAL_SHADOW_AI_PROMPT_VERSION).map((item) => [item.message_id, item]));
    const realManualEnabled = process.env.VERCEL_ENV === "production" && process.env.SUPABASE_ENVIRONMENT === "production" && process.env.SHADOW_AI_ENABLED === "true" && process.env.SHADOW_AI_PRODUCTION_ENABLED === "true" && process.env.SHADOW_AI_ALLOW_REAL_MESSAGES === "true" && process.env.SHADOW_AI_ALLOW_OPERATIONAL_EVENTS !== "true" && process.env.SHADOW_OUTBOUND_ENABLED !== "true";
    const devProjectRef = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i)?.[1] || null;
    const realManualDevTestEnabled = process.env.VERCEL_ENV === "preview" && process.env.SUPABASE_ENVIRONMENT === "dev" && devProjectRef === "hjfwjnejbcpmknvfpdcq" && process.env.SHADOW_REAL_MANUAL_DEV_TEST_ENABLED === "true" && process.env.SHADOW_AI_ALLOW_REAL_MESSAGES !== "true" && process.env.SHADOW_AI_PRODUCTION_ENABLED !== "true" && process.env.SHADOW_OUTBOUND_ENABLED !== "true";
    const enrichedMessages = (messages.data || []).map((message) => {
      const matchCount = messageMatches.get(message.id) || 0;
      const state = shadowContextState(
        { direction: message.direction },
        { intent: message.intent },
        { matches: Array.from({ length: matchCount }), ambiguous: false },
      );
      const realEligibility = realManualDevTestEnabled
        ? realShadowDevCloneEligibility({ message, conversation: conversationsById.get(message.conversation_id), env: process.env })
        : realShadowMessageEligibility({ message, conversation: conversationsById.get(message.conversation_id), env: process.env });
      const realRun = realRunsByMessage.get(message.id) || null;
      return { ...message, semantic_context_needed: state.semanticContextNeeded, context_status: state.contextStatus, real_shadow: { eligible: (realManualEnabled || realManualDevTestEnabled) && realEligibility.allowed && !realRun, devTest: realManualDevTestEnabled && realEligibility.allowed, reason: realEligibility.reason, runId: realRun?.id || null, status: realRun?.status || null, executionState: realRun?.execution_state || null } };
    });
    return res.status(200).json({ ok: true, messages: enrichedMessages, operationalEvents: operationalEvents.data || [], conversations: conversations.data || [], matches: matches.data || [], evaluations: evaluations.data || [], aiRuns: aiRuns.data || [], aiDecisions: aiDecisions.data || [], toolAudit: toolAudit.data || [], metrics: counts, realManualEnabled, realManualDevTestEnabled, aiStatus: (aiRuns.data || []).some((x)=>x.status==="completed") ? "executed_qa" : "not_executed" });
  } catch (error) {
    console.error("[shadow-coordinator]", error?.message || error);
    return res.status(500).json({ ok: false, error: "No se pudo cargar Coordinador IA — Sombra." });
  }
}
