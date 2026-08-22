import { createClient } from "@supabase/supabase-js";

const ROLES = new Set(["admin", "coord_operaciones"]);
const client = (key, token) => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined, auth: { persistSession: false, autoRefreshToken: false } });

export async function authorizeShadowAdministrator(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const authenticated = client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, token);
  const { data: { user } } = await authenticated.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await authenticated.from("profiles").select("id,role_id,active").eq("id", user.id).maybeSingle();
  return profile?.active && ROLES.has(profile.role_id) ? profile : null;
}
