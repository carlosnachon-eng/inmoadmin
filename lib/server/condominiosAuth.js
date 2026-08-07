import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

let adminClient;

export function getAdminClient() {
  if (adminClient) return adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configuración segura de Supabase incompleta");
  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

export class HttpError extends Error {
  constructor(status, message, code = "REQUEST_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new HttpError(401, "Sesión requerida", "UNAUTHENTICATED");
  }
  return token;
}

export async function requireUser(req) {
  const supabase = getAdminClient();
  const token = getBearerToken(req);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    throw new HttpError(401, "Sesión inválida", "UNAUTHENTICATED");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) throw new HttpError(500, "No fue posible validar el perfil");
  if (profile && profile.active === false) {
    throw new HttpError(403, "Perfil inactivo", "PROFILE_INACTIVE");
  }

  return { user: data.user, token, supabase };
}

export async function requireCondominioPermission(req, condominioId, accion, unidadId = null) {
  const context = await requireUser(req);
  const { data, error } = await context.supabase.rpc("condominio_usuario_puede", {
    p_user_id: context.user.id,
    p_condominio_id: condominioId,
    p_accion: accion,
    p_unidad_id: unidadId,
  });
  if (error) throw new HttpError(500, "No fue posible comprobar el permiso");
  if (!data) throw new HttpError(403, "Acceso denegado", "FORBIDDEN");
  return context;
}

export function requestId(req) {
  return String(req.headers["x-request-id"] || crypto.randomUUID()).slice(0, 128);
}

export function clientFingerprint(req, userId = "") {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
  return crypto
    .createHash("sha256")
    .update(`${process.env.CONDOMINIOS_AUDIT_SALT || "local"}:${userId}:${ip}`)
    .digest("hex");
}

export async function enforceRateLimit(supabase, key, maxHits = 30, windowSeconds = 60) {
  const { data, error } = await supabase.rpc("condominio_consume_rate_limit", {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max_hits: maxHits,
  });
  if (error) throw new HttpError(500, "No fue posible validar el límite de solicitudes");
  if (!data) throw new HttpError(429, "Demasiadas solicitudes", "RATE_LIMITED");
}

export function sendApiError(res, error) {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[condominios]", error);
  return res.status(status).json({
    error: status >= 500 ? "No fue posible completar la operación" : error.message,
    code: error?.code || "INTERNAL_ERROR",
  });
}
