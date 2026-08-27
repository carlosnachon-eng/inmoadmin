import { createClient } from "@supabase/supabase-js";

export const OWNER_BUCKET = "condominium-owner-private";
export const OWNER_UPLOAD_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);

export function bearerToken(req) {
  return String(req?.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

export function publicPortalError(res, status, message) {
  return res.status(status).json({ error: message });
}

export async function authorizePortalRequest(req, env = process.env) {
  const token = bearerToken(req);
  if (!token) return { status: 401, error: "Sesión requerida" };
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { status: 503, error: "Servicio temporalmente no disponible" };
  }

  const authClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user?.id) return { status: 401, error: "Sesión inválida" };

  const scoped = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { token, userId: data.user.id, scoped };
}

export function createPortalAdmin(env = process.env) {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function safeExtension(value) {
  const extension = String(value || "").trim().toLowerCase();
  return OWNER_UPLOAD_EXTENSIONS.has(extension) ? extension : null;
}
