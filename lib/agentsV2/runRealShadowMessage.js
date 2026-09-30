import {
  assertAdminAgentV2ShadowEnvironment,
  createAdminAgentV2Session,
  executeAdminAgentV2RequiredActions,
  retrieveAdminAgentV2Session,
} from "./openaiAdminAgent.js";

export const ADMIN_AGENT_V2_ADMIN_CHANNEL_ID = "544519";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listItems(sessionId, env = process.env) {
  const response = await fetch(`https://api.openai.com/v1/agents/sessions/${encodeURIComponent(sessionId)}/items?order=asc&limit=100`, {
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "OpenAI-Beta": "agents=v1" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`admin_agent_v2_items_failed_${response.status}`);
  return Array.isArray(body?.data) ? body.data : [];
}

function assistantOutput(items) {
  const assistant = [...items].reverse().find((item) => item?.role === "assistant");
  return (assistant?.content || []).map((part) => part?.text || part?.output_text || "").filter(Boolean).join("\n").slice(0, 3000);
}

export async function loadEligibleAdminAgentV2Message(admin, messageId) {
  const { data: message, error: messageError } = await admin.from("shadow_messages")
    .select("id,conversation_id,provider,direction,sanitized_text,attachment_metadata,occurred_at")
    .eq("id", messageId).maybeSingle();
  if (messageError) throw messageError;
  if (!message) throw Object.assign(new Error("message_not_found"), { statusCode: 404 });
  if (message.provider !== "respond_admin" || message.direction !== "inbound") {
    throw Object.assign(new Error("message_not_eligible"), { statusCode: 409 });
  }
  if ((message.attachment_metadata || []).length) {
    throw Object.assign(new Error("attachments_not_supported_in_v2_shadow_yet"), { statusCode: 409 });
  }
  if (!String(message.sanitized_text || "").trim()) {
    throw Object.assign(new Error("empty_message"), { statusCode: 409 });
  }

  const { data: conversation, error: conversationError } = await admin.from("shadow_conversations")
    .select("id,channel,respond_contact_id").eq("id", message.conversation_id).maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation || conversation.channel !== ADMIN_AGENT_V2_ADMIN_CHANNEL_ID || !conversation.respond_contact_id) {
    throw Object.assign(new Error("conversation_not_eligible"), { statusCode: 409 });
  }
  return { message, conversation };
}

export async function runAdminAgentV2RealShadowMessage(admin, messageId, { env = process.env } = {}) {
  const environment = assertAdminAgentV2ShadowEnvironment(env);
  const { message, conversation } = await loadEligibleAdminAgentV2Message(admin, messageId);
  const input = [
    `respondContactId opaco: ${String(conversation.respond_contact_id).slice(0,120)}`,
    "Mensaje real sanitizado del cliente:",
    String(message.sanitized_text).slice(0,4000),
    "Modo Shadow V2: usa sólo datos verificados de InmoAdmin. No envíes nada y no inventes identidad, pagos, contratos, inmuebles ni autorizaciones.",
  ].join("\n");

  const started = Date.now();
  const transportEnv = { ...env, VERCEL_ENV:"development", SUPABASE_ENVIRONMENT:"dev" };
  let session = await createAdminAgentV2Session({ input, env: transportEnv });
  const calledTools = [];
  for (let step = 0; step < 80; step += 1) {
    session = await retrieveAdminAgentV2Session({ sessionId:session.id, env:transportEnv });
    if (session.status === "requires_action") {
      for (const action of session.required_actions || []) calledTools.push(String(action?.name || action?.type || "unknown").slice(0,80));
      const handled = await executeAdminAgentV2RequiredActions({ db:admin, session, env:transportEnv });
      if (!handled.handled) throw new Error("admin_agent_v2_unhandled_required_action");
      await sleep(150);
      continue;
    }
    if (["idle","failed"].includes(session.status)) break;
    await sleep(350);
  }
  session = await retrieveAdminAgentV2Session({ sessionId:session.id, env:transportEnv });
  const items = await listItems(session.id, env);
  return {
    ok: session.status === "idle",
    mode: environment.mode,
    messageId,
    conversationId: conversation.id,
    sessionId: session.id,
    status: session.status,
    error: session.error || null,
    calledTools,
    output: assistantOutput(items),
    latencyMs: Date.now() - started,
    outbound: false,
  };
}
