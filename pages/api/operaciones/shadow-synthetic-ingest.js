import { createClient } from "@supabase/supabase-js";
import { DEV_PROJECT_REF, assertSupabaseEnvironment, getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { SHADOW_SYNTHETIC_FIXTURES } from "../../../lib/shadow/fixtures";
import { processSyntheticShadowFixture } from "../../../lib/shadow/pipeline";

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
    for (const fixture of SHADOW_SYNTHETIC_FIXTURES) results.push(await processSyntheticShadowFixture(admin, fixture));
    return res.status(200).json({ ok: true, fixtureCount: results.length, results });
  } catch (error) {
    console.error("[shadow-synthetic-ingest]", error?.message || error);
    return res.status(500).json({ ok: false, error: "Falló ingesta sintética." });
  }
}
