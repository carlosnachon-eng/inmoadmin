import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth.js";
import { sameOriginAdminRequest } from "../../../lib/shadow/identityBootstrap.js";

export const config = { maxDuration: 30 };
const MODEL = "claude-haiku-4-5-20251001";
const clean = (value, max = 120) => String(value || "").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, max) || null;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  const actor = await authorizeShadowAdministrator(req);
  if (!actor || !sameOriginAdminRequest(req)) return res.status(403).json({ ok: false, error: "not_authorized" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ ok: false, error: "anthropic_key_missing" });
  const started = Date.now();
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 8, messages: [{ role: "user", content: "responde OK" }] }),
    });
    let usage = null;
    if (response.ok) {
      const body = await response.json();
      usage = { input_tokens: Number(body?.usage?.input_tokens || 0), output_tokens: Number(body?.usage?.output_tokens || 0) };
    } else {
      await response.body?.cancel?.();
    }
    return res.status(200).json({ ok: response.ok, provider_status: response.status, request_id: clean(response.headers.get("request-id")), latency_ms: Date.now() - started, usage });
  } catch (error) {
    return res.status(200).json({ ok: false, provider_status: null, request_id: null, latency_ms: Date.now() - started, usage: null, transport_class: clean(error?.cause?.code || error?.code || error?.name, 60) });
  }
}
