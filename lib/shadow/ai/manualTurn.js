import { createHash } from "node:crypto";
import { buildRealShadowConversationTurns, realShadowTurnEnvelope, isTurnQaFree } from "./conversationTurns.js";
import { createShadowAiInputSnapshot, executeShadowAiStateStep } from "./stateMachine.js";
import { MANUAL_TURN_MODE, MANUAL_TURN_PROMPT, assertManualTurnDev, withManualTurnContext } from "./manualTurnContext.js";
import { safeManualTelemetry } from "./manualTurnTelemetry.js";
import { DEFAULT_SHADOW_AI_MODEL } from "./anthropic.js";
import { REAL_SHADOW_AI_SYSTEM_PROMPT } from "./realPrompt.js";
import { sanitizePreModelInput } from "./preModelSanitizer.js";
import { verifyFinalModelPayload } from "./finalModelPrivacy.js";
import { semanticConversationGuard, SHADOW_CONVERSATION_ACTIONS } from "./conversationAction.js";

export const manualMessageRef = (id) => createHash("sha256").update(`manual-message:${id}`).digest("hex").slice(0,32);
export const manualRef = (id) => String(id).replaceAll("-", "");
export function manualId(ref) {
  if (!/^[a-f0-9]{32}$/.test(ref || "")) throw new Error("manual_reference_invalid");
  return ref.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}
const data = (r) => { if (r.error) throw new Error("manual_storage_unavailable"); return r.data; };
const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

export async function loadManualTurn(db, messageRef, env, referenceView="shadow_manual_turn_message_refs") {
  if (!/^[a-f0-9]{32}$/.test(messageRef || "")) throw new Error("manual_reference_invalid");
  const ref = data(await db.from(referenceView).select("id").eq("message_ref",messageRef).single());
  const message = data(await db.from("shadow_messages").select("*").eq("id",ref.id).single());
  const conversation = data(await db.from("shadow_conversations").select("id,provider,channel,respond_contact_id").eq("id",message.conversation_id).single());
  const messages = data(await db.from("shadow_messages").select("id,conversation_id,provider,direction,occurred_at,sanitized_text,attachment_metadata,provider_metadata,external_message_id")
    .eq("conversation_id",conversation.id).order("occurred_at").order("id").limit(201));
  // Never truncate a conversation and silently assert context completeness.
  if (messages.length > 200) throw new Error("manual_context_limit");
  if (messages.some((m) => (m.attachment_metadata || []).length)) throw new Error("manual_attachment_review_required");
  const turns = buildRealShadowConversationTurns({ messages, conversations:[conversation], env });
  const turn = turns.find((t) => t.anchorMessageId === message.id);
  if (!turn || turn.closedReason !== "settled" || turn.humanResponseId || messages.at(-1)?.id !== message.id
    || !isTurnQaFree(turn,new Map(messages.map((m)=>[m.id,m])))) throw new Error("manual_turn_not_eligible");
  const envelope = realShadowTurnEnvelope(turn,conversation,env);
  // This is a read of an existing contact linkage, not identity preparation.
  envelope.providerMetadata.respondContactId = String(conversation.respond_contact_id || "");
  const snapshot = createShadowAiInputSnapshot(envelope);
  return { message, turn, snapshot, fingerprint:digest({ messages, conversation, snapshot }) };
}

export async function authorizeManualTurn(db, messageRef, actor, env) {
  assertManualTurnDev(env);
  const input = await loadManualTurn(db,messageRef,env);
  const result = data(await db.rpc("authorize_manual_shadow_turn", { p_message_id:input.message.id, p_actor_id:actor.id,
    p_turn_key:input.turn.turnKey, p_fingerprint:input.fingerprint, p_snapshot:input.snapshot, p_model:env.SHADOW_AI_MODEL || DEFAULT_SHADOW_AI_MODEL }));
  return { authorizationRef:manualRef(result.authorization_id), messageRef, status:"authorized", created:result.created };
}

export async function loadManualAuthorization(db, authorizationRef, actor) {
  const auth = data(await db.from("shadow_ai_manual_authorizations").select("*").eq("authorization_id",manualId(authorizationRef)).single());
  if (!auth.manual_turn_key || auth.authorized_by !== actor.id || auth.prompt_version !== MANUAL_TURN_PROMPT) throw new Error("manual_authorization_invalid");
  return auth;
}
export async function executeManualTurn(db, authorizationRef, actor, options = {}) {
  const env = options.env || process.env; assertManualTurnDev(env);
  const auth = await loadManualAuthorization(db,authorizationRef,actor);
  if (auth.consumed_at) return { ...await readManualTurn(db,authorizationRef,actor), duplicate:true };
  const input = await loadManualTurn(db,manualMessageRef(auth.message_id),env);
  const claim = data(await db.rpc("claim_manual_shadow_turn", { p_authorization_id:auth.authorization_id,p_actor_id:actor.id,p_fingerprint:input.fingerprint }));
  if (claim.claimed) {
    await withManualTurnContext(env,async (manualTurnContext) => {
      try {
        const runOptions = { ...options, manualTurnContext, systemPrompt:REAL_SHADOW_AI_SYSTEM_PROMPT, promptVersion:MANUAL_TURN_PROMPT };
        let state = await executeShadowAiStateStep(db,claim.run_id,"created",runOptions);
        if (state.status === "awaiting_model_round") state = await executeShadowAiStateStep(db,claim.run_id,"awaiting_model_round",runOptions);
        if (state.status === "awaiting_model_round") throw new Error("manual_round_limit");
      } catch {
        // E.g. storage unavailable before the state machine entered its try.
        // Consume is never undone; no implicit recovery or second provider call.
        const saved = await db.from("shadow_ai_runs").update({ status:"error",execution_state:"error",completed_at:new Date().toISOString(),error_sanitized:"manual_result_persistence_failed" })
          .eq("id",claim.run_id).eq("status","running");
        if (saved.error) throw new Error("manual_persistence_uncertain");
      }
    });
  }
  return { ...await readManualTurn(db,authorizationRef,actor), duplicate:!claim.claimed };
}

const safeText = (value) => {
  if (typeof value !== "string") return null;
  const sanitized = sanitizePreModelInput({text:value});
  return sanitized.allowed && verifyFinalModelPayload({message:sanitized.payload.message}).allowed ? sanitized.payload.message : null;
};
export async function readManualTurnForMessage(db, messageRef, actor) {
  if (!/^[a-f0-9]{32}$/.test(messageRef || "")) throw new Error("manual_reference_invalid");
  const ref=data(await db.from("shadow_manual_turn_message_refs").select("id").eq("message_ref",messageRef).single());
  const auth=data(await db.from("shadow_ai_manual_authorizations").select("authorization_id").eq("message_id",ref.id)
    .eq("prompt_version",MANUAL_TURN_PROMPT).eq("authorized_by",actor.id).maybeSingle());
  return auth ? readManualTurn(db,manualRef(auth.authorization_id),actor) : {messageRef,status:"not_authorized",certified:false,human_review_required:true,outbound_authorized:false};
}
export async function readManualTurn(db, authorizationRef, actor) {
  const auth = await loadManualAuthorization(db,authorizationRef,actor);
  return readManualTurnRun(db,auth,authorizationRef);
}
export async function readManualTurnRun(db,auth,authorizationRef,mode=MANUAL_TURN_MODE) {
  const base = { authorizationRef,messageRef:manualMessageRef(auth.message_id),human_review_required:true,outbound_authorized:false };
  if (!auth.ai_run_id) return { ...base,status:auth.expires_at <= new Date().toISOString() ? "expired" : "authorized",certified:false };
  const run = data(await db.from("shadow_ai_runs").select("id,status,execution_state,telemetry_json,completed_at,error_sanitized").eq("id",auth.ai_run_id).single());
  if (run.telemetry_json?.input_mode !== mode) throw new Error("manual_run_invalid");
  const decision = data(await db.from("shadow_ai_decisions").select("decision_json").eq("ai_run_id",run.id).maybeSingle());
  const action = data(await db.from("shadow_conversation_actions").select("ai_run_id,turn_key,conversation_action,proposed_message,requires_human,auto_send_eligible,blocked_reason").eq("ai_run_id",run.id).maybeSingle());
  const resolution = decision?.decision_json?.operational_resolution;
  const telemetry = safeManualTelemetry(run.telemetry_json.manual_turn);
  const verified = Boolean(run.status === "completed" && ["completed","blocked"].includes(run.execution_state)
    && telemetry.persistence.verified && telemetry.persistence.decision && telemetry.persistence.operational_resolution && telemetry.persistence.conversation_action
    && resolution && action?.ai_run_id===run.id && action.turn_key===auth.manual_turn_key);
  return { ...base,runRef:manualRef(run.id),status:run.status,execution_state:run.execution_state,certified:verified,telemetry,
    decision_persisted:Boolean(decision),operational_resolution_persisted:Boolean(resolution),conversation_action_persisted:Boolean(action),
    operational_resolution: resolution ? { case_domain:["maintenance","payment","administrative_pending"].includes(resolution.case_domain)?resolution.case_domain:null,
      case_status:safeText(resolution.case_status),requires_human:resolution.requires_human===true,
      would_resolve_without_human:typeof resolution.would_resolve_without_human === "boolean" ? resolution.would_resolve_without_human : null,
      evidence_count:Array.isArray(resolution.evidence)?resolution.evidence.length:0 } : null,
    conversation_action:action ? { conversation_action:SHADOW_CONVERSATION_ACTIONS.includes(action.conversation_action)?action.conversation_action:null,
      proposed_message:safeText(action.proposed_message),requires_human:action.requires_human,auto_send_eligible:action.auto_send_eligible,
      blocked_reason:safeText(action.blocked_reason),message_safe:mode===MANUAL_TURN_MODE ? semanticConversationGuard(action.proposed_message).allowed : telemetry.message_safety?.message_safe ?? null,
      ...(mode!==MANUAL_TURN_MODE ? {message_safe_provenance:telemetry.message_safety?.provenance || null}: {}) } : null,
  };
}
