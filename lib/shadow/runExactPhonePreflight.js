import { createHash } from "node:crypto";
import { contactPhoneFromRespondPayload, validateRespondContactId } from "./identityBridge.js";
import { RUN_EXACT_PHONE_PREFLIGHT_CUTOFF, RUN_EXACT_PHONE_PREFLIGHT_REFS } from "./runExactPhonePreflightRefs.js";

const ACTIVE_ROLES = new Set(["tenant", "owner"]);
const TERMINAL_CONTRACT = new Set(["vencido", "expired", "cancelado", "cancelled", "terminado", "ended"]);
const INACTIVE_PROPERTY = new Set(["inactive", "inactiva", "inactivo", "archived", "archivada", "disabled", "deshabilitada"]);
const opaque = (namespace, value) => value ? createHash("sha256").update(`${namespace}:${String(value)}`).digest("hex").slice(0, 12) : null;
export const shadowRunRef = (id) => opaque("shadow_run", id);
export const respondContactRef = (id) => opaque("respond_contact", id);

const digestPhone = async (phone) => {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(phone));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const isoDay = (value) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null; };
const contractCurrent = (row, effectiveAt) => {
  const effective = isoDay(effectiveAt), start = isoDay(row?.start_date), end = isoDay(row?.end_date);
  return Boolean(effective && (!start || start <= effective) && (!end || end >= effective) && !TERMINAL_CONTRACT.has(String(row?.status || "").toLowerCase()));
};
const propertyCurrent = (row) => !INACTIVE_PROPERTY.has(String(row?.status || "").toLowerCase());
const outcome = (runRef, contactRef, blocker, extra = {}) => ({
  runRef, contactRef: contactRef || null, exactPhoneUnique: extra.exactPhoneUnique ?? false,
  oneToOne: extra.oneToOne ?? false, conflict: extra.conflict ?? false, role: extra.role || null,
  propertyRelationshipResolved: extra.propertyRelationshipResolved ?? false,
  contractCurrent: extra.contractCurrent ?? false, confirmable: !blocker, blocker: blocker || null,
});

export async function loadVerifiedRunContacts(admin, references = RUN_EXACT_PHONE_PREFLIGHT_REFS, toRunRef = shadowRunRef) {
  const wanted = new Set(references);
  if (wanted.size !== RUN_EXACT_PHONE_PREFLIGHT_REFS.length || RUN_EXACT_PHONE_PREFLIGHT_REFS.some((ref) => !wanted.has(ref))) throw new Error("invalid_run_preflight_cohort");
  const { data: runs, error } = await admin.from("shadow_ai_runs").select("id,message_id,created_at").gte("created_at", RUN_EXACT_PHONE_PREFLIGHT_CUTOFF).order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  const byRef = new Map();
  for (const run of runs || []) if (wanted.has(toRunRef(run.id))) byRef.set(toRunRef(run.id), run);
  const results = [];
  for (const runRef of references) {
    const run = byRef.get(runRef);
    if (!run?.message_id) { results.push({ runRef, contactId: null, blocker: "unattributed" }); continue; }
    const { data: message, error: messageError } = await admin.from("shadow_messages").select("id,conversation_id").eq("id", run.message_id).maybeSingle();
    if (messageError) throw messageError;
    if (!message?.conversation_id) { results.push({ runRef, contactId: null, blocker: "unattributed" }); continue; }
    const { data: conversation, error: conversationError } = await admin.from("shadow_conversations").select("id,provider,channel,respond_contact_id").eq("id", message.conversation_id).maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation?.respond_contact_id || conversation.provider !== "respond_admin" || String(conversation.channel) !== "544519") {
      results.push({ runRef, contactId: null, blocker: "unattributed" }); continue;
    }
    results.push({ runRef, contactId: validateRespondContactId(conversation.respond_contact_id), blocker: null });
  }
  return results;
}

export async function evaluateRunContactExactPhoneReadOnly(admin, { runRef, contactId, currentContact, effectiveAt = new Date().toISOString() }) {
  const contactRef = respondContactRef(contactId);
  if (!contactId || !currentContact || String(currentContact.id || "") !== contactId) return outcome(runRef, contactRef, "respond_contact_not_found");
  const phone = contactPhoneFromRespondPayload({ contact: currentContact });
  if (!phone) return outcome(runRef, contactRef, "respond_phone_unusable");
  const phoneDigest = await digestPhone(phone);
  const { data: identities, error: identityError } = await admin.from("client_identities").select("id,status").eq("status", "active").eq("phone_digest", phoneDigest).limit(2);
  if (identityError) throw identityError;
  if ((identities || []).length !== 1) return outcome(runRef, contactRef, (identities || []).length ? "multiple_exact_phone_candidates" : "no_exact_phone_candidate", { conflict: (identities || []).length > 1 });
  const identityId = identities[0].id;
  const [contactLinks, identityLinks, roles, sources, tenantContracts, ownedProperties] = await Promise.all([
    admin.from("respond_identity_links").select("client_identity_id,link_status").eq("respond_contact_id", contactId).in("link_status", ["candidate", "confirmed", "conflict"]),
    admin.from("respond_identity_links").select("respond_contact_id,link_status").eq("client_identity_id", identityId).in("link_status", ["candidate", "confirmed", "conflict"]),
    admin.from("client_identity_roles").select("role_kind,status").eq("client_identity_id", identityId),
    admin.from("client_source_links").select("source_type,source_id,link_status,revoked_at").eq("client_identity_id", identityId),
    admin.from("contracts").select("id,property_id,status,start_date,end_date").eq("tenant_client_id", identityId),
    admin.from("properties").select("id,status").eq("owner_client_id", identityId),
  ]);
  for (const result of [contactLinks, identityLinks, roles, sources, tenantContracts, ownedProperties]) if (result.error) throw result.error;
  const conflict = (contactLinks.data || []).some((row) => row.client_identity_id !== identityId)
    || (identityLinks.data || []).some((row) => row.respond_contact_id !== contactId)
    || (sources.data || []).some((row) => row.link_status === "revoked" || row.revoked_at);
  if (conflict) return outcome(runRef, contactRef, "identity_link_conflict", { exactPhoneUnique: true, conflict: true });
  const activeRoles = [...new Set((roles.data || []).filter((row) => row.status === "active" && ACTIVE_ROLES.has(row.role_kind)).map((row) => row.role_kind))];
  if (activeRoles.length !== 1) return outcome(runRef, contactRef, "ambiguous_role_context", { exactPhoneUnique: true, oneToOne: true, conflict: false });
  const role = activeRoles[0];
  const confirmedSources = new Set((sources.data || []).filter((row) => row.link_status === "confirmed").map((row) => `${row.source_type}:${row.source_id}`));
  if (role === "tenant") {
    const contracts = (tenantContracts.data || []).filter((row) => confirmedSources.has(`active_contract_tenant:${row.id}`) && contractCurrent(row, effectiveAt));
    const propertyIds = [...new Set(contracts.map((row) => row.property_id).filter(Boolean))];
    if (contracts.length !== 1 || propertyIds.length !== 1) return outcome(runRef, contactRef, contracts.length ? "ambiguous_property_or_contract" : "contract_not_current", { exactPhoneUnique: true, oneToOne: true, role });
    const { data: property, error } = await admin.from("properties").select("id,status").eq("id", propertyIds[0]).maybeSingle();
    if (error) throw error;
    if (!property || !propertyCurrent(property)) return outcome(runRef, contactRef, "property_not_current", { exactPhoneUnique: true, oneToOne: true, role });
    return outcome(runRef, contactRef, null, { exactPhoneUnique: true, oneToOne: true, role, propertyRelationshipResolved: true, contractCurrent: true });
  }
  const properties = (ownedProperties.data || []).filter((row) => propertyCurrent(row) && confirmedSources.has(`managed_property_owner:${row.id}`));
  if (properties.length !== 1) return outcome(runRef, contactRef, properties.length ? "ambiguous_property_context" : "insufficient_property_context", { exactPhoneUnique: true, oneToOne: true, role });
  const { data: contracts, error } = await admin.from("contracts").select("id,status,start_date,end_date").eq("property_id", properties[0].id);
  if (error) throw error;
  const currentContracts = (contracts || []).filter((row) => contractCurrent(row, effectiveAt));
  if (currentContracts.length > 1) return outcome(runRef, contactRef, "ambiguous_contract_context", { exactPhoneUnique: true, oneToOne: true, role, propertyRelationshipResolved: true });
  return outcome(runRef, contactRef, null, { exactPhoneUnique: true, oneToOne: true, role, propertyRelationshipResolved: true, contractCurrent: currentContracts.length === 1 });
}

export async function evaluateRunExactPhonePreflightReadOnly(admin, { fetchContact, references = RUN_EXACT_PHONE_PREFLIGHT_REFS, effectiveAt } = {}) {
  const associations = await loadVerifiedRunContacts(admin, references);
  const results = [];
  for (const association of associations) {
    if (!association.contactId) { results.push(outcome(association.runRef, null, "unattributed")); continue; }
    let currentContact;
    try { currentContact = await fetchContact(association.contactId); }
    catch { results.push(outcome(association.runRef, respondContactRef(association.contactId), "respond_read_error")); continue; }
    results.push(await evaluateRunContactExactPhoneReadOnly(admin, { ...association, currentContact, effectiveAt }));
  }
  return results;
}
