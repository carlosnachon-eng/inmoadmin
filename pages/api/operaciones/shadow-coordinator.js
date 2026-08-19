import { createClient } from "@supabase/supabase-js";
import { isAdministrativeWorkCenterRole } from "../../../lib/operaciones/administrativeWorkCenter";
import { shadowContextState } from "../../../lib/shadow/pipeline";

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
      if (!messageId || !["correct","partially_correct","incorrect","wrong_context","wrong_intent","not_administration"].includes(classification)) return res.status(400).json({ ok: false, error: "Evaluación inválida." });
      const { data, error } = await auth.authenticated.from("shadow_human_evaluations").insert({
        message_id: messageId, classification, labels: Array.isArray(req.body?.labels) ? req.body.labels.slice(0, 10) : [],
        expected_correction: String(req.body?.expectedCorrection || "").slice(0, 1000) || null,
        notes: String(req.body?.notes || "").slice(0, 1000) || null, actor_profile_id: auth.profile.id,
      }).select("id,classification,expected_correction,notes,created_at").single();
      if (error) throw error;
      return res.status(201).json({ ok: true, evaluation: data });
    }
    const admin = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const [messages, conversations, events, matches, evaluations] = await Promise.all([
      admin.from("shadow_messages").select("id,conversation_id,direction,occurred_at,sanitized_text,message_type,attachment_metadata,provider_metadata,processing_state,intent,administrative_likelihood,reason_codes,requires_human,created_at").order("occurred_at", { ascending: false }).limit(250),
      admin.from("shadow_conversations").select("id,provider,channel,contact_hash,first_message_at,last_message_at,administrative_likelihood,status"),
      admin.from("shadow_ingestion_events").select("status,sanitization_changed,duplicate_count"),
      admin.from("shadow_context_matches").select("message_id,internal_entity_type,internal_id,display_label,match_method,confidence_rank,ambiguous,reason_code,context_href"),
      admin.from("shadow_human_evaluations").select("id,message_id,classification,expected_correction,notes,actor_profile_id,created_at").order("created_at", { ascending: false }),
    ]);
    const failure = [messages, conversations, events, matches, evaluations].find((result) => result.error)?.error;
    if (failure) throw failure;
    const counts = (events.data || []).reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1, duplicate: acc.duplicate + Number(item.duplicate_count || 0), sanitized: acc.sanitized + (item.sanitization_changed ? 1 : 0) }), { accepted: 0, duplicate: 0, rejected: 0, error: 0, sanitized: 0 });
    const messageMatches = new Map();
    for (const match of matches.data || []) messageMatches.set(match.message_id, (messageMatches.get(match.message_id) || 0) + 1);
    const enrichedMessages = (messages.data || []).map((message) => {
      const matchCount = messageMatches.get(message.id) || 0;
      const state = shadowContextState(
        { direction: message.direction },
        { intent: message.intent },
        { matches: Array.from({ length: matchCount }), ambiguous: false },
      );
      return { ...message, semantic_context_needed: state.semanticContextNeeded, context_status: state.contextStatus };
    });
    return res.status(200).json({ ok: true, messages: enrichedMessages, conversations: conversations.data || [], matches: matches.data || [], evaluations: evaluations.data || [], metrics: counts, aiStatus: "not_executed" });
  } catch (error) {
    console.error("[shadow-coordinator]", error?.message || error);
    return res.status(500).json({ ok: false, error: "No se pudo cargar Coordinador IA — Sombra." });
  }
}
