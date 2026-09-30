import { createClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { runAdminAgentV2RealShadowMessage } from "../../../lib/agentsV2/runRealShadowMessage";

export const config = { maxDuration: 120 };

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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"method_not_allowed" });
  try {
    const profile = await authorize(req);
    if (!profile) return res.status(403).json({ ok:false, error:"not_authorized" });
    const messageId = String(req.body?.messageId || "");
    if (!/^[0-9a-f-]{36}$/i.test(messageId)) return res.status(400).json({ ok:false, error:"invalid_message_id" });
    const result = await runAdminAgentV2RealShadowMessage(getAdminSupabase(), messageId, { env:process.env });
    return res.status(200).json({ ...result, persisted:false });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    console.error("[admin-agent-v2-real-shadow]", error?.message || error);
    return res.status(status).json({ ok:false, error:String(error?.message || "admin_agent_v2_real_shadow_failed").slice(0,180) });
  }
}
