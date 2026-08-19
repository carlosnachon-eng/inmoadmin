import { createClient } from "@supabase/supabase-js";
import { DEV_PROJECT_REF, assertSupabaseEnvironment, getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { ingestShadowEnvelope, syntheticEnvelope } from "../../../lib/shadow/coordinator";
import { SHADOW_SYNTHETIC_FIXTURES } from "../../../lib/shadow/fixtures";
import { resolveShadowContext } from "../../../lib/shadow/context";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido." });
  try {
    const environment = assertSupabaseEnvironment();
    if (environment.projectRef !== DEV_PROJECT_REF || environment.env === "production") return res.status(403).json({ ok: false, error: "Ingesta sintética bloqueada fuera de DEV." });
    if (process.env.SHADOW_SYNTHETIC_INGEST_ENABLED !== "true") return res.status(404).json({ ok: false, error: "Ingesta sintética deshabilitada." });
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data: { user } } = await auth.auth.getUser(token);
    const { data: profile } = user ? await auth.from("profiles").select("role_id,active").eq("id", user.id).maybeSingle() : { data: null };
    if (!profile?.active || !["admin","coord_operaciones"].includes(profile.role_id)) return res.status(403).json({ ok: false, error: "No autorizado." });
    const admin = getAdminSupabase();
    const results = [];
    for (const [id, text, metadata] of SHADOW_SYNTHETIC_FIXTURES) {
      const envelope = syntheticEnvelope({ id, text, metadata });
      const result = await ingestShadowEnvelope(admin, envelope);
      if (result?.status === "accepted") {
        const context = await resolveShadowContext(admin, envelope);
        if (context.matches.length) {
          const { error } = await admin.from("shadow_context_matches").upsert(context.matches.map((match) => ({
            message_id: result.messageId, internal_entity_type: match.entityType, internal_id: match.internalId,
            display_label: match.label, match_method: match.method, confidence_rank: match.confidence,
            ambiguous: context.ambiguous, reason_code: match.method === "explicit_link" ? "explicit_link" : "property_reference_match", context_href: match.href,
          })), { onConflict: "message_id,internal_entity_type,internal_id" });
          if (error) throw error;
        }
        if (context.audit.length) {
          const { error } = await admin.from("shadow_context_query_audit").insert(context.audit.map((item) => ({ message_id: result.messageId, tool_name: item.tool, result_count: Math.min(5, item.resultCount), succeeded: item.ok, duration_ms: item.durationMs })));
          if (error) throw error;
        }
      }
      results.push({ ...result, contextResolved: result?.status === "accepted" });
    }
    return res.status(200).json({ ok: true, fixtureCount: results.length, results });
  } catch (error) {
    console.error("[shadow-synthetic-ingest]", error?.message || error);
    return res.status(500).json({ ok: false, error: "Falló ingesta sintética." });
  }
}
