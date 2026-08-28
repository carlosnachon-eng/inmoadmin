import { createClient } from "@supabase/supabase-js";
import { isAdministrativeWorkCenterRole } from "../../../lib/operaciones/administrativeWorkCenter";
import { executeAdministrativeWorkR0, executeAdministrativeWorkR1 } from "../../../lib/operaciones/durableAdministrativeWork";
import { sameOriginAdminRequest } from "../../../lib/shadow/identityBootstrap";

const client = (key, token) => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
  global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  auth: { persistSession: false, autoRefreshToken: false },
});
const bearer = (req) => String(req.headers.authorization || "").startsWith("Bearer ") ? String(req.headers.authorization).slice(7).trim() : null;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ ok: false, error: "method_not_allowed" });
  const token = bearer(req);
  if (!token) return res.status(401).json({ ok: false, error: "session_required" });
  try {
    const authenticated = client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, token);
    const { data: { user }, error: userError } = await authenticated.auth.getUser(token);
    if (userError || !user) return res.status(401).json({ ok: false, error: "invalid_session" });
    const { data: profile, error: profileError } = await authenticated.from("profiles").select("id,role_id,active").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.active || !isAdministrativeWorkCenterRole(profile.role_id)) return res.status(403).json({ ok: false, error: "forbidden" });
    const admin = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (req.method === "GET") {
      const operation = String(req.query.operation || "list_administrative_work");
      const rows = await executeAdministrativeWorkR0(admin, operation, req.query);
      return res.status(200).json({ ok: true, operation, rows });
    }
    if (!sameOriginAdminRequest(req)) return res.status(403).json({ ok: false, error: "invalid_origin" });
    const result = await executeAdministrativeWorkR1(admin, {
      action: req.body?.action, input: req.body?.input, idempotencyKey: req.body?.idempotencyKey,
      actorType: "admin", actorProfileId: profile.id,
    });
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    const code = String(error?.message || "administrative_work_error");
    return res.status(error?.statusCode || (code.startsWith("invalid_") ? 400 : 500)).json({ ok: false, error: code });
  }
}
