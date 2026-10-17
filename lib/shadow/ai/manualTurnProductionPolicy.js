// Production capability policy; no request or client-side flag can override it.
export const MANUAL_PROD_MODE = "manual_prod_one_turn";
export const MANUAL_PROD_PROMPT = "manual-prod-one-turn-v1";
export const MANUAL_PROD_PROJECT = "bnzrnizrmonjxlktbhlp";
export const MANUAL_PROD_ORIGIN = "https://app.emporioinmobiliario.com.mx";
export const MANUAL_PROD_GATE = "SHADOW_MANUAL_TURN_PRODUCTION_ENABLED";

export function assertManualProductionReadEnvironment(env) {
  if (env.VERCEL_ENV !== "production" || env.SUPABASE_ENVIRONMENT !== "production"
    || env.NEXT_PUBLIC_SUPABASE_URL !== `https://${MANUAL_PROD_PROJECT}.supabase.co`
    || env.SHADOW_MANUAL_TURN_DEV_ENABLED !== "false") throw new Error("manual_prod_environment_required");
}
export function manualProductionRuntime(env) {
  assertManualProductionReadEnvironment(env);
  if (!/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA || "")
    || !/^dpl_[A-Za-z0-9]{10,80}$/.test(env.VERCEL_DEPLOYMENT_ID || "")) throw new Error("manual_prod_runtime_unaccredited");
  return { sha:env.VERCEL_GIT_COMMIT_SHA, deployment:env.VERCEL_DEPLOYMENT_ID };
}
export function manualProductionSameOrigin(req) {
  const headers=req.headers || {}, host=new URL(MANUAL_PROD_ORIGIN).host;
  if (headers.host !== host || (headers["x-forwarded-host"] && headers["x-forwarded-host"] !== host)
    || (headers["x-forwarded-proto"] && headers["x-forwarded-proto"] !== "https")) return false;
  if (headers.origin) return headers.origin === MANUAL_PROD_ORIGIN;
  try { return req.method === "GET" && headers["sec-fetch-site"] === "same-origin"
    && new URL(headers.referer).origin === MANUAL_PROD_ORIGIN; } catch { return false; }
}
