import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth.js";
import { fetchRespondContact } from "../../../lib/ejecutivo/respondSync.js";
import { assertIdentityLinkReviewWrite, contactPhoneFromRespondPayload, generateIdentityCandidates, identityLinkCapabilities, reviewIdentityLink } from "../../../lib/shadow/identityBridge.js";
import { sameOriginAdminRequest } from "../../../lib/shadow/identityBootstrap.js";
import { buildRespondIdentityReviewModels } from "../../../lib/shadow/respondIdentityReview.js";

const adminClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const opaqueRef = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 12);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ ok: false, error: "method_not_allowed" });
  const actor = await authorizeShadowAdministrator(req);
  if (!actor) return res.status(403).json({ ok: false, error: "not_authorized" });
  const capabilities = identityLinkCapabilities(process.env);
  if (!capabilities.enabled) return res.status(409).json({ ok: false, error: "identity_bridge_disabled" });
  if (req.method === "POST" && !sameOriginAdminRequest(req)) return res.status(403).json({ ok: false, error: "invalid_origin" });
  const admin = adminClient();
  try {
    if (req.method === "POST") {
      const action = String(req.body?.action || "");
      if (action === "generate") {
        const { data: conversation, error: conversationError } = await admin.from("shadow_conversations")
          .select("respond_contact_id,provider,channel").eq("id", String(req.body?.conversationId || "")).maybeSingle();
        if (conversationError) throw conversationError;
        if (!conversation || conversation.provider !== "respond_admin" || String(conversation.channel) !== "544519" || !conversation.respond_contact_id) return res.status(400).json({ ok: false, error: "contact_not_eligible" });
        const respondContactId = conversation.respond_contact_id;
        const contact = await fetchRespondContact(respondContactId); // lectura server-side; token nunca llega al browser/Shadow.
        const normalizedPhone = contactPhoneFromRespondPayload({ contact });
        const result = await generateIdentityCandidates(admin, { respondContactId, normalizedPhone });
        return res.status(200).json({ ok: true, status: result.status, candidates: result.candidates });
      }
      try { assertIdentityLinkReviewWrite(capabilities); }
      catch (error) { return res.status(409).json({ ok: false, error: error.message }); }
      const result = await reviewIdentityLink(admin, { linkId: req.body?.linkId, action, actorProfileId: actor.id });
      return res.status(200).json({ ok: true, result });
    }
    const [{ data: links, error }, { data: conversations, error: conversationError }] = await Promise.all([
      admin.from("respond_identity_links")
      .select("id,respond_contact_id,client_identity_id,link_status,link_source,confidence,reason_code,confirmed_at,created_at")
      .order("created_at", { ascending: false }).limit(200),
      admin.from("shadow_conversations").select("id,respond_contact_id,last_message_at").eq("provider", "respond_admin").eq("channel", "544519").not("respond_contact_id", "is", null).order("last_message_at", { ascending: false }).limit(200),
    ]);
    if (error || conversationError) throw error || conversationError;
    const clientIds = [...new Set((links || []).map((row) => row.client_identity_id).filter(Boolean))];
    const [{ data: contracts, error: contractError }, { data: properties, error: propertyError }, { data: roles, error: roleError }] = await Promise.all([
      clientIds.length ? admin.from("contracts").select("id,tenant_client_id,property_id,status,start_date,end_date,tenant_name,tenant_phone,owner_name,property_name").in("tenant_client_id", clientIds) : { data: [], error: null },
      clientIds.length ? admin.from("properties").select("id,owner_client_id,status,name,owner_phone").in("owner_client_id", clientIds) : { data: [], error: null },
      clientIds.length ? admin.from("client_identity_roles").select("client_identity_id,role_kind,status").in("client_identity_id", clientIds) : { data: [], error: null },
    ]);
    if (contractError || propertyError || roleError) throw contractError || propertyError || roleError;
    const reviews = buildRespondIdentityReviewModels({ links: links || [], contracts: contracts || [], properties: properties || [], roles: roles || [] });
    const identities = (links || []).map((link, index) => ({
      ...(capabilities.reviewWriteEnabled ? { id: link.id } : {}), contactRef: opaqueRef(link.respond_contact_id), status: link.link_status,
      source: link.link_source, confidence: Number(link.confidence), reasonCode: link.reason_code,
      confirmedAt: link.confirmed_at, createdAt: link.created_at,
      review: reviews[index],
    }));
    const linkedContacts = new Set((links || []).map((row) => row.respond_contact_id));
    const unresolved = (conversations || []).filter((row) => !linkedContacts.has(row.respond_contact_id)).map((row) => ({ conversationId: row.id, contactRef: opaqueRef(row.respond_contact_id), status: "no_candidate", lastMessageAt: row.last_message_at }));
    const all = [...identities, ...unresolved];
    return res.status(200).json({ ok: true, capabilities, identities: all, counts: all.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), {}) });
  } catch (error) {
    console.error("[shadow-identities]", error?.message || "identity_bridge_error");
    return res.status(500).json({ ok: false, error: "identity_bridge_error" });
  }
}
