import {
  MAX_360DIALOG_WEBHOOK_BYTES,
  payloadSizeBytes,
  safeSecretEqual,
  transform360DialogWebhook,
} from "./360dialog.js";

async function withTimeout(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("shadow_timeout")), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function capture360DialogEnabled(env = process.env) {
  return env.SHADOW_360DIALOG_CAPTURE_ENABLED === "true" && env.SHADOW_OUTBOUND_ENABLED !== "true";
}

export async function handle360DialogWebhook(req, res, dependencies) {
  const { env, environment, getAdmin, processEnvelope, devProjectRef, now = new Date() } = dependencies;
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido." });

  let current;
  try { current = environment(); } catch { return res.status(404).json({ ok: false, error: "Captura no disponible." }); }
  if (current.env === "production" || current.projectRef !== devProjectRef) return res.status(404).json({ ok: false, error: "Captura no disponible." });
  if (!capture360DialogEnabled(env)) return res.status(404).json({ ok: false, error: "Captura deshabilitada." });
  if (!safeSecretEqual(req.headers["x-shadow-webhook-secret"], env.SHADOW_360DIALOG_WEBHOOK_SECRET)) return res.status(401).json({ ok: false, error: "Webhook no autenticado." });
  if (payloadSizeBytes(req.body) > MAX_360DIALOG_WEBHOOK_BYTES) return res.status(413).json({ ok: false, error: "Payload demasiado grande." });

  try {
    const transformed = transform360DialogWebhook(req.body, { now, maxEventAgeSeconds: Number(env.SHADOW_360DIALOG_MAX_EVENT_AGE_SECONDS) || undefined });
    if (!transformed.envelopes.length) return res.status(200).json({ ok: true, status: transformed.kind });
    const admin = getAdmin();
    const timeoutMs = Math.min(2000, Math.max(250, Number(env.SHADOW_360DIALOG_PROCESSING_TIMEOUT_MS) || 1200));
    const results = await Promise.all(transformed.envelopes.map(async (envelope) => {
      try {
        const result = await withTimeout(processEnvelope(admin, envelope), timeoutMs);
        return { status: result?.status || "accepted" };
      } catch (error) {
        console.error("[360dialog-shadow-isolated]", error?.message === "shadow_timeout" ? "timeout" : "isolated_error");
        return { status: "isolated_error" };
      }
    }));
    const failed = results.filter((item) => item.status === "isolated_error").length;
    console.info("[360dialog-shadow]", JSON.stringify({ received: results.length, failed }));
    if (failed === results.length) return res.status(503).json({ ok: false, accepted: 0, failed });
    return res.status(200).json({ ok: true, accepted: results.length - failed, failed });
  } catch (error) {
    const status = /fuera de ventana temporal/.test(String(error?.message || "")) ? 409 : 400;
    return res.status(status).json({ ok: false, error: status === 409 ? "Evento fuera de ventana temporal." : "Payload inválido." });
  }
}
