const CONTACT_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE = new Set(["activo", "active"]);

export function identityLinkCapabilities(env = {}) {
  return {
    enabled: env.SHADOW_IDENTITY_BRIDGE_ENABLED === "true",
    reviewWriteEnabled: env.SHADOW_IDENTITY_LINK_REVIEW_WRITE_ENABLED === "true",
  };
}

export function assertIdentityLinkReviewWrite(capabilities) {
  if (!capabilities?.reviewWriteEnabled) throw new Error("identity_link_review_write_disabled");
}

export function validateRespondContactId(value) {
  const id = String(value || "").trim();
  if (!CONTACT_ID.test(id)) throw new Error("invalid_respond_contact_id");
  return id;
}

export function normalizeIdentityPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `52${digits}`;
  if (digits.length === 12 && digits.startsWith("52")) return digits;
  if (digits.length === 13 && digits.startsWith("521")) return `52${digits.slice(3)}`;
  return null;
}

export function contactPhoneFromRespondPayload(payload) {
  const contact = payload?.contact || {};
  const candidates = [contact.phone, contact.phoneNumber, contact.identifier, payload?.phone];
  return candidates.map(normalizeIdentityPhone).find(Boolean) || null;
}

export function effectiveContractState(row, now = Date.now()) {
  const stored = String(row?.status || "").toLowerCase();
  if (["vencido", "expired", "cancelado", "cancelled", "terminado"].includes(stored)) return { status: stored, active: false };
  const today = new Date(now).toISOString().slice(0, 10);
  const starts = row?.start_date ? String(row.start_date).slice(0, 10) : null;
  const ends = row?.end_date ? String(row.end_date).slice(0, 10) : null;
  if (starts && starts > today) return { status: "pendiente", active: false };
  if (ends && ends < today) return { status: "vencido", active: false };
  if (ends && ends === today) return { status: "finalizando", active: false };
  return { status: stored || "activo", active: ACTIVE.has(stored) };
}
const sha256Hex = async (value) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export async function generateIdentityCandidates(admin, { respondContactId, normalizedPhone }) {
  const contactId = validateRespondContactId(respondContactId);
  const phone = normalizeIdentityPhone(normalizedPhone);
  if (!phone) return { status: "no_candidate", candidates: 0 };
  const { data: prior, error: priorError } = await admin.from("respond_identity_links").select("link_status").eq("respond_contact_id", contactId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (priorError) throw priorError;
  if (prior?.link_status) return { status: prior.link_status, candidates: 0, existing: true };
  const phoneDigest = await sha256Hex(phone);
  const { data: candidateRows, error: candidateError } = await admin.rpc("find_respond_identity_candidates", { p_phone_digest: phoneDigest });
  if (candidateError) throw candidateError;
  const matches = new Map();
  for (const row of candidateRows || []) {
    if (!row.client_identity_id) continue;
    const item = matches.get(row.client_identity_id) || { clientIdentityId: row.client_identity_id, contracts: [], properties: [] };
    if (row.contract_id) item.contracts.push(row.contract_id);
    if (row.property_id) item.properties.push(row.property_id);
    matches.set(row.client_identity_id, item);
  }
  const candidates = [...matches.values()];
  if (!candidates.length) return { status: "no_candidate", candidates: 0 };
  const status = candidates.length === 1 ? "candidate" : "conflict";
  const source = candidates.length === 1 ? "exact_phone_unique" : "exact_phone_conflict";
  for (const item of candidates) {
    const { data: existing, error: existingError } = await admin.from("respond_identity_links").select("id").eq("respond_contact_id", contactId).eq("client_identity_id", item.clientIdentityId).in("link_status", ["candidate", "confirmed", "conflict"]).maybeSingle();
    if (existingError) throw existingError;
    let link = existing;
    if (!link) {
      const { data: inserted, error } = await admin.from("respond_identity_links").insert({
        respond_contact_id: contactId, client_identity_id: item.clientIdentityId, inmoadmin_client_id: null, link_status: status,
        link_source: source, confidence: candidates.length === 1 ? 0.95 : 0.5,
        reason_code: candidates.length === 1 ? "exact_full_phone_unique_candidate" : "multiple_exact_full_phone_candidates",
      }).select("id").single();
      if (error) throw error; link = inserted;
    }
    await admin.from("respond_identity_audit").insert({
      link_id: link?.id || null, respond_contact_id: contactId,
      event_type: status === "candidate" ? "candidate_created" : "conflict_detected",
      context_ids: { contractIds: item.contracts.slice(0, 10), propertyIds: [...new Set(item.properties)].slice(0, 10) },
      conflict_count: Math.max(0, candidates.length - 1),
    });
  }
  return { status, candidates: candidates.length };
}

export async function resolveConfirmedContactIdentity(admin, respondContactId, { audit = true } = {}) {
  const contactId = validateRespondContactId(respondContactId);
  const { data: links, error } = await admin.from("respond_identity_links")
    .select("id,client_identity_id,link_status,link_source,confidence,confirmed_at")
    .eq("respond_contact_id", contactId).eq("link_status", "confirmed").limit(2);
  if (error) throw error;
  if ((links || []).length !== 1) {
    if (audit) await admin.from("respond_identity_audit").insert({ respond_contact_id: contactId, event_type: "unresolved", conflict_count: Math.max(0, (links || []).length - 1) });
    return { resolved: false, reason: (links || []).length > 1 ? "identity_conflict" : "insufficient_identity_context", roles: [], contracts: [], properties: [] };
  }
  const link = links[0];
  const [contractsResult, propertiesResult] = await Promise.all([
    admin.from("contracts").select("id,property_id,status,start_date,end_date").eq("tenant_client_id", link.client_identity_id),
    admin.from("properties").select("id,status").eq("owner_client_id", link.client_identity_id),
  ]);
  if (contractsResult.error) throw contractsResult.error;
  if (propertiesResult.error) throw propertiesResult.error;
  const contracts = (contractsResult.data || []).map((row) => {
    const effective = effectiveContractState(row);
    return { id: row.id, propertyId: row.property_id, status: effective.status, active: effective.active, startDate: row.start_date, endDate: row.end_date };
  });
  const owned = (propertiesResult.data || []).map((row) => ({ id: row.id, status: row.status }));
  const propertyIds = [...new Set([...contracts.map((row) => row.propertyId).filter(Boolean), ...owned.map((row) => row.id)])];
  const roles = [...new Set([contracts.length ? "tenant" : null, owned.length ? "owner" : null].filter(Boolean))];
  if (audit) await admin.from("respond_identity_audit").insert({ link_id: link.id, respond_contact_id: contactId, event_type: "resolved", context_ids: { clientIdentityId: link.client_identity_id, contractIds: contracts.map((x) => x.id).slice(0, 10), propertyIds: propertyIds.slice(0, 10) } });
  return {
    resolved: true, linkId: link.id, linkSource: link.link_source, linkStatus: link.link_status,
    confidence: Number(link.confidence), clientContextKey: link.client_identity_id, roles,
    contracts, properties: propertyIds.map((id) => ({ id })),
    ambiguousPropertyContext: propertyIds.length > 1,
    missingInformation: propertyIds.length > 1 ? ["insufficient_property_context"] : [],
  };
}

export async function reviewIdentityLink(admin, { linkId, action, actorProfileId }) {
  if (!UUID.test(String(linkId || "")) || !UUID.test(String(actorProfileId || ""))) throw new Error("invalid_identity_review");
  if (!["confirm", "reject", "conflict", "revoke"].includes(action)) throw new Error("invalid_identity_review");
  const { data: current, error } = await admin.from("respond_identity_links").select("*").eq("id", linkId).maybeSingle();
  if (error) throw error; if (!current) throw new Error("identity_link_not_found");
  if (action === "confirm" && !current.client_identity_id) throw new Error("canonical_identity_required");
  const now = new Date().toISOString();
  const target = { confirm: "confirmed", reject: "rejected", conflict: "conflict", revoke: "revoked" }[action];
  const patch = { link_status: target, reviewed_by: actorProfileId, reviewed_at: now, updated_at: now,
    ...(target === "confirmed" ? { confirmed_by: actorProfileId, confirmed_at: now, link_source: "human_confirmation", confidence: 1 } : {}),
    ...(target !== "confirmed" ? { confirmed_by: null, confirmed_at: null } : {}),
    ...(target === "revoked" ? { revoked_at: now } : {}),
  };
  const { data, error: updateError } = await admin.from("respond_identity_links").update(patch).eq("id", linkId).select("id,link_status").single();
  if (updateError) throw updateError;
  await admin.from("respond_identity_audit").insert({ link_id: linkId, respond_contact_id: current.respond_contact_id, event_type: target === "confirmed" ? "confirmed" : target === "rejected" ? "rejected" : target === "revoked" ? "revoked" : "conflict_detected", actor_profile_id: actorProfileId });
  return data;
}
