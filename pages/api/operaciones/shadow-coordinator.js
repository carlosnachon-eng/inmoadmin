import { createClient } from "@supabase/supabase-js";
import { isAdministrativeWorkCenterRole } from "../../../lib/operaciones/administrativeWorkCenter";
import { shadowContextState } from "../../../lib/shadow/pipeline";
import { realShadowDevCloneEligibility, realShadowMessageEligibility } from "../../../lib/shadow/ai/realMessage";
import { REAL_SHADOW_AI_PROMPT_VERSION } from "../../../lib/shadow/ai/realPrompt";
import { assertManualAuthorizationEnvironment, manualAuthorizationState } from "../../../lib/shadow/ai/manualAuthorization";

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
    const [messages, conversations, events, matches, evaluations, operationalEvents, aiRuns, aiDecisions, toolAudit, manualAuthorizations, conversationActions, adminOutboundMessages] = await Promise.all([
      admin.from("shadow_messages").select("id,conversation_id,external_message_id,direction,occurred_at,sanitized_text,message_type,attachment_metadata,provider_metadata,processing_state,intent,administrative_likelihood,reason_codes,requires_human,created_at").order("occurred_at", { ascending: false }).limit(250),
      admin.from("shadow_conversations").select("id,provider,channel,contact_hash,first_message_at,last_message_at,administrative_likelihood,status"),
      admin.from("shadow_ingestion_events").select("status,sanitization_changed,duplicate_count"),
      admin.from("shadow_context_matches").select("message_id,internal_entity_type,internal_id,display_label,match_method,confidence_rank,ambiguous,reason_code,context_href"),
      admin.from("shadow_human_evaluations").select("id,message_id,classification,expected_correction,notes,actor_profile_id,created_at").order("created_at", { ascending: false }),
      admin.from("shadow_operational_events").select("id,source,kind,event_type,aggregate_type,aggregate_id,ticket_id,quote_id,property_id,maintenance_scope,occurred_at,payload_safe,requires_human,created_at").order("occurred_at", { ascending: false }).limit(250),
      admin.from("shadow_ai_runs").select("id,message_id,operational_event_id,input_kind,status,execution_state,current_round,max_rounds,evidence_ledger,model,prompt_version,schema_version,campaign_id,started_at,completed_at,state_updated_at,latency_ms,input_tokens,output_tokens,estimated_cost_usd,error_sanitized,attempt_number,retry_of_run_id,telemetry_json").order("created_at", { ascending: false }),
      admin.from("shadow_ai_decisions").select("id,ai_run_id,status,intent,urgency,proposed_action,proposed_response,confidence,requires_human,escalation_reason,decision_json,tool_summary,created_at").order("created_at", { ascending: false }),
      admin.from("shadow_context_query_audit").select("message_id,tool_name,result_count,succeeded,duration_ms,created_at").order("created_at", { ascending: false }),
      admin.from("shadow_ai_manual_authorizations").select("authorization_id,message_id,authorized_at,expires_at,consumed_at,revoked_at,purpose,model,prompt_version,ai_run_id,created_at").order("created_at", { ascending: false }),
      process.env.SHADOW_CONVERSATION_ACTIONS_ENABLED === "true"
        ? admin.from("shadow_conversation_actions").select("id,ai_run_id,message_id,turn_key,case_domain,interaction_direction,conversation_action,status,proposed_message,operational_follow_up,evidence_refs,confidence,requires_human,auto_send_eligible,blocked_reason,expires_at,superseded_at,created_at").order("created_at", { ascending: false }).limit(250)
        : { data: [], error: null },
      admin.from("shadow_admin_outbound_messages").select("id,conversation_action_id,turn_key,channel_id,conversation_action,case_domain,status,provider_message_id,error_code,claimed_at,sent_at,completed_at,created_at").order("created_at", { ascending: false }).limit(50),
    ]);
    const outboundUnavailable = adminOutboundMessages.error?.code === "42P01";
    const failure = [messages, conversations, events, matches, evaluations, operationalEvents, aiRuns, aiDecisions, toolAudit, manualAuthorizations, conversationActions, outboundUnavailable ? { error: null } : adminOutboundMessages].find((result) => result.error)?.error;
    if (failure) throw failure;
    const counts = (events.data || []).reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1, duplicate: acc.duplicate + Number(item.duplicate_count || 0), sanitized: acc.sanitized + (item.sanitization_changed ? 1 : 0) }), { accepted: 0, duplicate: 0, rejected: 0, error: 0, sanitized: 0 });
    const messageMatches = new Map();
    for (const match of matches.data || []) messageMatches.set(match.message_id, (messageMatches.get(match.message_id) || 0) + 1);
    const conversationsById = new Map((conversations.data || []).map((item) => [item.id, item]));
    const realRunsByMessage = new Map((aiRuns.data || []).filter((item) => item.prompt_version === REAL_SHADOW_AI_PROMPT_VERSION).map((item) => [item.message_id, item]));
    const authorizationsByMessage = new Map();
    for (const authorization of manualAuthorizations.data || []) if (!authorizationsByMessage.has(authorization.message_id)) authorizationsByMessage.set(authorization.message_id, authorization);
    let manualEnvironment = null;
    try { manualEnvironment = assertManualAuthorizationEnvironment(process.env); } catch { manualEnvironment = null; }
    const realManualEnabled = manualEnvironment?.mode === "production";
    const realManualDevTestEnabled = manualEnvironment?.mode === "dev_test";
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
      const authorization = authorizationsByMessage.get(message.id) || null;
      const authorizationState = manualAuthorizationState(authorization);
      const enabled = realManualEnabled || realManualDevTestEnabled;
      return { ...message, semantic_context_needed: state.semanticContextNeeded, context_status: state.contextStatus, real_shadow: {
        eligible: enabled && realEligibility.allowed && !realRun && authorizationState === "active",
        authorizable: enabled && realEligibility.allowed && !realRun && authorizationState !== "active",
        devTest: realManualDevTestEnabled && realEligibility.allowed, reason: realEligibility.reason,
        authorization: authorization ? { id: authorization.authorization_id, state: authorizationState, authorizedAt: authorization.authorized_at, expiresAt: authorization.expires_at, consumedAt: authorization.consumed_at, revokedAt: authorization.revoked_at, runId: authorization.ai_run_id } : null,
        runId: realRun?.id || null, status: realRun?.status || null, executionState: realRun?.execution_state || null,
      } };
    });
    const actionsById = new Map((conversationActions.data || []).map((item) => [item.id, item]));
    const outboundMessages = (adminOutboundMessages.data || []).map((item) => ({ ...item, provider_message_ref: item.provider_message_id ? `${String(item.provider_message_id).slice(0,8)}…` : null, provider_message_id: undefined, action: actionsById.get(item.conversation_action_id) || null }));
    return res.status(200).json({ ok: true, messages: enrichedMessages, operationalEvents: operationalEvents.data || [], conversations: conversations.data || [], matches: matches.data || [], evaluations: evaluations.data || [], aiRuns: aiRuns.data || [], aiDecisions: aiDecisions.data || [], toolAudit: toolAudit.data || [], conversationActions: conversationActions.data || [], adminOutboundMessages: outboundMessages, metrics: counts, realManualEnabled, realManualDevTestEnabled, aiStatus: (aiRuns.data || []).some((x)=>x.status==="completed") ? "executed_qa" : "not_executed" });
  } catch (error) {
    console.error("[shadow-coordinator]", error?.message || error);
    return res.status(500).json({ ok: false, error: "No se pudo cargar Coordinador IA — Sombra." });
  }
}
