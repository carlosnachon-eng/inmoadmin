import { createHash } from "node:crypto";
import {
  contactPhoneFromRespondPayload,
  generateIdentityCandidates,
  validateRespondContactId,
} from "./identityBridge.js";

export const MAX_HISTORICAL_IDENTITY_COHORT = 10;
const OPAQUE_REF = /^[a-f0-9]{12}$/;

export const opaqueIdentityContactRef = (value) => createHash("sha256")
  .update(String(value || ""))
  .digest("hex")
  .slice(0, 12);

export function sameOriginAdminRequest(req) {
  const origin = String(req?.headers?.origin || "");
  const host = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "");
  const protocol = String(req?.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
  if (!origin || !host) return false;
  try { return new URL(origin).origin === `${protocol}://${host}`; }
  catch { return false; }
}

export function validateHistoricalIdentityRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_HISTORICAL_IDENTITY_COHORT) {
    throw new Error("invalid_historical_identity_cohort");
  }
  const refs = value.map((item) => String(item || "").trim().toLowerCase());
  if (refs.some((item) => !OPAQUE_REF.test(item)) || new Set(refs).size !== refs.length) {
    throw new Error("invalid_historical_identity_cohort");
  }
  return refs;
}

export function buildHistoricalIdentityIndex(rows) {
  const contacts = new Map();
  for (const row of rows || []) {
    const channelId = row?.payload_meta?.channel_id ?? row?.payload_meta?.channelId ?? row?.payload_meta?.channel?.id;
    if (row?.event_type !== "message.received" || String(channelId || "") !== "544519") continue;
    let contactId;
    try { contactId = validateRespondContactId(row.respond_contact_id); }
    catch { continue; }
    const ref = opaqueIdentityContactRef(contactId);
    const previous = contacts.get(ref);
    const occurredAt = row.event_occurred_at || row.received_at || null;
    if (!previous) contacts.set(ref, { contactId, contactRef: ref, lastInboundAt: occurredAt, ambiguous: false });
    else if (previous.contactId !== contactId) previous.ambiguous = true;
    else if (occurredAt && (!previous.lastInboundAt || new Date(occurredAt) > new Date(previous.lastInboundAt))) previous.lastInboundAt = occurredAt;
  }
  return contacts;
}

const safeFailure = (error) => {
  const code = String(error?.code || "").toLowerCase();
  if (code === "respond_contact_phone_missing") return "phone_missing";
  if (code === "respond_contact_phone_invalid") return "phone_invalid";
  return "respond_read_error";
};

const hasPhoneLikeValue = (contact) => [contact?.phone, contact?.phoneNumber, contact?.identifier]
  .some((value) => value !== undefined && value !== null && String(value).trim());

const classification = (status) => ({
  candidate: "unique_candidate",
  conflict: "conflict",
  no_candidate: "no_candidate",
  confirmed: "confirmed_existing",
  rejected: "rejected_existing",
  revoked: "revoked_existing",
}[status] || "technical_error");

async function auditBootstrap(admin, { actorProfileId, contactId, outcome, existing = false }) {
  const { error } = await admin.from("respond_identity_audit").insert({
    respond_contact_id: contactId,
    event_type: "bootstrap_evaluated",
    actor_profile_id: actorProfileId,
    context_ids: { outcome, existing: Boolean(existing), source: "historical_admin_cohort" },
  });
  if (error) throw error;
}

export async function bootstrapHistoricalIdentityCohort(admin, {
  contactRefs,
  actorProfileId,
  eventRows,
  fetchContact,
}) {
  const refs = validateHistoricalIdentityRefs(contactRefs);
  const index = buildHistoricalIdentityIndex(eventRows);
  const results = [];

  for (const contactRef of refs) {
    const selected = index.get(contactRef);
    if (!selected || selected.ambiguous) {
      results.push({ contactRef, status: selected?.ambiguous ? "ambiguous_reference" : "not_eligible" });
      continue;
    }
    let contact = null;
    let normalizedPhone = null;
    try {
      contact = await fetchContact(selected.contactId);
      if (String(contact?.id || "") !== selected.contactId) throw Object.assign(new Error("contact_mismatch"), { code: "respond_contact_mismatch" });
      normalizedPhone = contactPhoneFromRespondPayload({ contact });
      if (!normalizedPhone) throw Object.assign(new Error("phone_unusable"), { code: hasPhoneLikeValue(contact) ? "respond_contact_phone_invalid" : "respond_contact_phone_missing" });
      const generated = await generateIdentityCandidates(admin, { respondContactId: selected.contactId, normalizedPhone });
      const status = classification(generated.status);
      await auditBootstrap(admin, { actorProfileId, contactId: selected.contactId, outcome: status, existing: generated.existing });
      results.push({ contactRef, status, existing: Boolean(generated.existing), candidates: Number(generated.candidates || 0) });
    } catch (error) {
      const status = safeFailure(error);
      await auditBootstrap(admin, { actorProfileId, contactId: selected.contactId, outcome: status });
      results.push({ contactRef, status });
    } finally {
      normalizedPhone = null;
      contact = null;
    }
  }
  return results;
}
