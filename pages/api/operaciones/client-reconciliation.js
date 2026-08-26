import { createClient } from "@supabase/supabase-js";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth.js";
import { buildActiveClientReconciliationCohort, persistClientReconciliationCohort } from "../../../lib/shadow/clientIdentity.js";
import { sameOriginAdminRequest } from "../../../lib/shadow/identityBootstrap.js";

const adminClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ ok: false, error: "method_not_allowed" });
  const actor = await authorizeShadowAdministrator(req);
  if (!actor) return res.status(403).json({ ok: false, error: "not_authorized" });
  if (process.env.SHADOW_CLIENT_RECONCILIATION_ENABLED !== "true") return res.status(409).json({ ok: false, error: "client_reconciliation_disabled" });
  if (req.method === "POST" && !sameOriginAdminRequest(req)) return res.status(403).json({ ok: false, error: "origin_not_allowed" });
  const admin = adminClient();
  try {
    if (req.method === "GET") {
      const { data, error } = await admin.from("client_reconciliation_candidates")
        .select("id,role_kind,candidate_status,reason_code,source_count,client_identity_id,created_at")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return res.status(200).json({ ok: true, candidates: data || [] });
    }
    const action = String(req.body?.action || "");
    if (action === "prepare") {
      const [{ data: contracts, error: contractError }, { data: properties, error: propertyError }] = await Promise.all([
        admin.from("contracts").select("id,status,tenant_phone,tenant_name,tenant_email,property_name,owner_name"),
        admin.from("properties").select("id,name,owner_phone,owner_email"),
      ]);
      if (contractError || propertyError) throw contractError || propertyError;
      const cohort = buildActiveClientReconciliationCohort({ contracts, properties });
      const metrics = await persistClientReconciliationCohort(admin, cohort, actor.id);
      return res.status(200).json({ ok: true, metrics });
    }
    const candidateId = String(req.body?.candidateId || "");
    if (!UUID.test(candidateId)) return res.status(400).json({ ok: false, error: "invalid_candidate" });
    if (action === "confirm") {
      const existingIdentityId = req.body?.existingIdentityId ? String(req.body.existingIdentityId) : null;
      if (existingIdentityId && !UUID.test(existingIdentityId)) return res.status(400).json({ ok: false, error: "invalid_identity" });
      const { data, error } = await admin.rpc("confirm_client_reconciliation_candidate", { p_candidate_id: candidateId, p_actor_profile_id: actor.id, p_existing_identity_id: existingIdentityId });
      if (error) throw error;
      return res.status(200).json({ ok: true, clientIdentityId: data });
    }
    if (!["reject", "conflict", "skip", "revoke"].includes(action)) return res.status(400).json({ ok: false, error: "invalid_action" });
    const { data, error } = await admin.rpc("review_client_reconciliation_candidate", { p_candidate_id: candidateId, p_actor_profile_id: actor.id, p_action: action });
    if (error) throw error;
    return res.status(200).json({ ok: true, status: data });
  } catch (error) {
    console.error("[client-reconciliation]", error?.code || error?.message || "client_reconciliation_error");
    return res.status(500).json({ ok: false, error: "client_reconciliation_error" });
  }
}
