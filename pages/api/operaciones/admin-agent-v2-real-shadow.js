import { createClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import {
  assertAdminAgentV2ShadowEnvironment,
  createAdminAgentV2Session,
  executeAdminAgentV2RequiredActions,
  retrieveAdminAgentV2Session,
} from "../../../lib/agentsV2/openaiAdminAgent";

export const config = { maxDuration: 120 };

const ADMIN_CHANNEL_ID = "544519";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const client = (key, token) => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
  global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  auth: { persistSession: false, autoRefreshToken: false },
});

async function authorize(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const auth = client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, token);
  const { data: { user } } = await auth.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await auth.from("profiles").select("id,role_id,active").eq("id", user.id).maybeSingle();
  if (!profile?.active || !["admin", "coord_operaciones"].includes(profile.role_id)) return null;
  return profile;
}

async function listItems(sessionId) {
  const response = await fetch(`https://api.openai.com/v1/agents/sessions/${encodeURIComponent(sessionId)}/items?order=asc&limit=100`, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "OpenAI-Beta": "agents=v1" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`admin_agent_v2_items_failed_${response.status}`);
  return Array.isArray(body?.data) ? body.data : [];
}

function assistantOutput(items) {
  const assistant = [...items].reverse().find((item) => item?.role === "assistant");
  return (assistant?.content || []).map((part) => part?.text || part?.output_text || "").filter(Boolean).join("\n").slice(0, 3000);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"method_not_allowed" });
  try {
    const profile = await authorize(req);
    if (!profile) return res.status(403).json({ ok:false, error:"not_authorized" });
    const environment = assertAdminAgentV2ShadowEnvironment(process.env);
    const messageId = String(req.body?.messageId || "");
    if (!/^[0-9a-f-]{36}$/i.test(messageId)) return res.status(400).json({ ok:false, error:"invalid_message_id" });

    const admin = getAdminSupabase();
    const { data: message, error: messageError } = await admin.from("shadow_messages")
      .select("id,conversation_id,provider,direction,sanitized_text,attachment_metadata,occurred_at")
      .eq("id", messageId).maybeSingle();
    if (messageError) throw messageError;
    if (!message) return res.status(404).json({ ok:false, error:"message_not_found" });
    if (message.provider !== "respond_admin" || message.direction !== "inbound") {
      return res.status(409).json({ ok:false, error:"message_not_eligible" });
    }
    if ((message.attachment_metadata || []).length) return res.status(409).json({ ok:false, error:"attachments_not_supported_in_v2_shadow_yet" });
    if (!String(message.sanitized_text || "").trim()) return res.status(409).json({ ok:false, error:"empty_message" });

    const { data: conversation, error: conversationError } = await admin.from("shadow_conversations")
      .select("id,channel,respond_contact_id").eq("id", message.conversation_id).maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation || conversation.channel !== ADMIN_CHANNEL_ID || !conversation.respond_contact_id) {
      return res.status(409).json({ ok:false, error:"conversation_not_eligible" });
    }

    const input = [
      `respondContactId opaco: ${String(conversation.respond_contact_id).slice(0,120)}`,
      "Mensaje real sanitizado del cliente:",
      String(message.sanitized_text).slice(0,4000),
      "Modo Shadow V2: usa sólo datos verificados de InmoAdmin. No envíes nada y no inventes identidad, pagos, contratos, inmuebles ni autorizaciones.",
    ].join("\n");

    const started = Date.now();
    let session = await createAdminAgentV2Session({ input, env: { ...process.env, VERCEL_ENV:"development", SUPABASE_ENVIRONMENT:"dev" } });
    const calledTools = [];
    for (let step = 0; step < 80; step += 1) {
      session = await retrieveAdminAgentV2Session({ sessionId:session.id, env:{ ...process.env, VERCEL_ENV:"development", SUPABASE_ENVIRONMENT:"dev" } });
      if (session.status === "requires_action") {
        for (const action of session.required_actions || []) calledTools.push(String(action?.name || action?.type || "unknown").slice(0,80));
        const handled = await executeAdminAgentV2RequiredActions({ db:admin, session, env:{ ...process.env, VERCEL_ENV:"development", SUPABASE_ENVIRONMENT:"dev" } });
        if (!handled.handled) throw new Error("admin_agent_v2_unhandled_required_action");
        await sleep(150);
        continue;
      }
      if (["idle","failed"].includes(session.status)) break;
      await sleep(350);
    }
    session = await retrieveAdminAgentV2Session({ sessionId:session.id, env:{ ...process.env, VERCEL_ENV:"development", SUPABASE_ENVIRONMENT:"dev" } });
    const items = await listItems(session.id);
    return res.status(200).json({
      ok: session.status === "idle",
      mode: environment.mode,
      messageId,
      sessionId: session.id,
      status: session.status,
      error: session.error || null,
      calledTools,
      output: assistantOutput(items),
      latencyMs: Date.now() - started,
      outbound: false,
      persisted: false,
    });
  } catch (error) {
    console.error("[admin-agent-v2-real-shadow]", error?.message || error);
    return res.status(500).json({ ok:false, error:String(error?.message || "admin_agent_v2_real_shadow_failed").slice(0,180) });
  }
}
