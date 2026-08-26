import { createClient } from "@supabase/supabase-js";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth.js";
import { fetchRespondContact } from "../../../lib/ejecutivo/respondSync.js";
import {
  bootstrapHistoricalIdentityCohort,
  buildHistoricalIdentityIndex,
  sameOriginAdminRequest,
  validateHistoricalIdentityRefs,
} from "../../../lib/shadow/identityBootstrap.js";

const adminClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export async function loadHistoricalAdminEvents(admin) {
  const select = "event_id,respond_contact_id,event_type,event_occurred_at,received_at,payload_meta";
  const variants = [{ channel_id: "544519" }, { channelId: "544519" }, { channel: { id: "544519" } }];
  const responses = await Promise.all(variants.map((shape) => admin.from("gv_respond_webhook_events")
    .select(select).eq("event_type", "message.received").contains("payload_meta", shape)
    .order("received_at", { ascending: false }).limit(500)));
  const failed = responses.find((result) => result.error);
  if (failed?.error) throw failed.error;
  const unique = new Map();
  for (const row of responses.flatMap((result) => result.data || [])) unique.set(row.event_id, row);
  return [...unique.values()];
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: "method_not_allowed" });
  const actor = await authorizeShadowAdministrator(req);
  if (!actor) return res.status(403).json({ ok: false, error: "not_authorized" });
  if (process.env.SHADOW_IDENTITY_BRIDGE_ENABLED !== "true") return res.status(409).json({ ok: false, error: "identity_bridge_disabled" });
  if (req.method === "POST" && !sameOriginAdminRequest(req)) return res.status(403).json({ ok: false, error: "invalid_origin" });
  const admin = adminClient();
  try {
    const events = await loadHistoricalAdminEvents(admin);
    const index = buildHistoricalIdentityIndex(events);
    if (req.method === "GET") {
      const contacts = [...index.values()].filter((item) => !item.ambiguous)
        .sort((a, b) => new Date(b.lastInboundAt || 0) - new Date(a.lastInboundAt || 0))
        .slice(0, 50)
        .map(({ contactRef, lastInboundAt }) => ({ contactRef, lastInboundAt }));
      return res.status(200).json({ ok: true, maxBatchSize: 10, contacts });
    }
    const contactRefs = validateHistoricalIdentityRefs(req.body?.contactRefs);
    const results = await bootstrapHistoricalIdentityCohort(admin, {
      contactRefs, actorProfileId: actor.id, eventRows: events, fetchContact: fetchRespondContact,
    });
    return res.status(200).json({ ok: true, evaluated: results.length, results });
  } catch (error) {
    const code = error?.message === "invalid_historical_identity_cohort" ? "invalid_historical_identity_cohort" : "historical_identity_bootstrap_error";
    console.error("[shadow-identity-bootstrap]", code);
    return res.status(code === "invalid_historical_identity_cohort" ? 400 : 500).json({ ok: false, error: code });
  }
}
