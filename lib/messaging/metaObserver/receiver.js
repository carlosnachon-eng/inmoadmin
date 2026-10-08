import { createHash, timingSafeEqual } from "node:crypto";
import { metaObserverConfig, MAX_META_BODY_BYTES } from "./config.js";
import { createMetaObserverProvider } from "../providers/metaObserver.js";

const sameToken = (a, b) => typeof a === "string" && typeof b === "string"
  && a.length <= 256 && timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

async function rawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_META_BODY_BYTES) throw Object.assign(new Error("meta_observer_body_too_large"), { http: 413 });
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function journalRow(event) {
  const m = event.providerMetadata;
  return { event_key: event.observationKey, native_message_id: event.nativeMessageId,
    event_type: event.providerEventType, occurred_at: event.occurredAt,
    source_field: m.field, category: m.category, message_type: m.messageType,
    status: m.status, original_message_id: m.originalMessageId,
    error_codes: m.errorCodes, author_evidence: event.author.evidence };
}

// The only dependency is a durable observer RPC. No import/callback for any
// lane, media download, Respond, human pause, queue, workflow or assignment.
export function createMetaObserverHandler({ getDb, env = () => process.env,
  log = code => console.error("[meta-observer]", code) }) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "POST"].includes(req.method)) {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }
    let config;
    try { config = metaObserverConfig(env()); }
    catch { log("config_invalid"); return res.status(503).json({ ok: false, error: "observer_unavailable" }); }
    if (!config) return res.status(404).json({ ok: false, error: "not_found" });
    if (req.method === "GET") {
      const q = req.query || {};
      if (q["hub.mode"] !== "subscribe" || !sameToken(q["hub.verify_token"], config.verifyToken)
        || typeof q["hub.challenge"] !== "string" || !/^[0-9]{1,64}$/.test(q["hub.challenge"]))
        return res.status(403).json({ ok: false, error: "verification_denied" });
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(200).send(q["hub.challenge"]);
    }
    let raw, normalized;
    try {
      raw = await rawBody(req);
      const provider = createMetaObserverProvider(config);
      if (!provider.verifyWebhook(raw, req.headers?.["x-hub-signature-256"], config.appSecret))
        return res.status(401).json({ ok: false, error: "invalid_signature" });
      const contentType = req.headers?.["content-type"];
      if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/i.test(contentType))
        return res.status(415).json({ ok: false, error: "unsupported_media_type" });
      normalized = provider.normalizeWebhook(JSON.parse(raw.toString("utf8")));
    } catch (error) {
      if (error?.code === "meta_observer_scope_denied")
        return res.status(403).json({ ok: false, error: "scope_denied" });
      return res.status(error?.http === 413 ? 413 : 400).json({ ok: false, error: "invalid_payload" });
    }
    // Includes empty unsupported batches: RPC still checks the separately
    // reviewed database scope. A 200 never reports uncommitted observations.
    try {
      const db = await getDb();
      const { data, error } = await db.rpc("observe_meta_admin_events_v1", {
        p_waba_id: config.wabaId, p_phone_number_id: config.phoneNumberId,
        p_body_sha256: createHash("sha256").update(raw).digest("hex"),
        p_events: normalized.events.map(journalRow),
      });
      if (error || data?.durable !== true || data?.state !== "observed"
        || !Number.isInteger(data.inserted) || !Number.isInteger(data.duplicates)
        || data.inserted < 0 || data.duplicates < 0
        || data.inserted + data.duplicates !== normalized.events.length) throw new Error("not_durable");
      return res.status(200).json({ ok: true, observerOnly: true, observed: data.inserted,
        duplicates: data.duplicates, ignored: normalized.ignored });
    } catch {
      log("persistence_failed"); // Never log body, error text, headers, token or IDs.
      return res.status(503).json({ ok: false, error: "observation_not_persisted" });
    }
  };
}
