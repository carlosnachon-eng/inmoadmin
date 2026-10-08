import { createHmac } from "node:crypto";

const ADDRESS = /^[1-9][0-9]{7,14}$/;
const NATIVE = /^wamid\.[A-Za-z0-9+/=_-]{1,500}$/;
const HEX = /^[a-f0-9]{64}$/;
const ADMIN = ["1297760461811288", "1198305790026665"];
const hmac = (key, text) => createHmac("sha256", Buffer.from(key, "hex")).update(text).digest("hex");

// After HMAC verification + observer scope validation only. No raw address is
// returned. Identical native-address semantics to capture.js sender_ref, NOT
// canonical phone normalization or an internal identity assertion.
export function captureEchoSubjects(body, observations, inputs, scope, config) {
  if (!config) return [];
  if (scope.wabaId !== ADMIN[0] || scope.phoneNumberId !== ADMIN[1]) return [];
  const keyTag = hmac(config.hmacKey, "meta-admin-native-subject-key:v1");
  const events = new Map(observations.map(e => [e.observationKey, e]));
  const rows = new Map();
  const add = row => {
    const old = rows.get(row.event_key);
    if (old && JSON.stringify(old) !== JSON.stringify(row)) throw new Error("meta_echo_subject_conflict");
    rows.set(row.event_key, row);
  };
  for (const i of inputs) add({ event_key: i.event_key, subject_ref: i.sender_ref,
    key_tag: keyTag, context_id: null, evidence_state: "exact", evidence_source: "signed_from" });
  for (const entry of body.entry) for (const change of entry.changes) {
    if (change.field !== "smb_message_echoes") continue;
    for (const item of change.value.message_echoes || []) {
      const type = ["edit", "revoke"].includes(item.type) ? `message.${item.type}` : "message.sent";
      const event_key = `${type}:${item.id}`, event = events.get(event_key);
      if (!event || Date.parse(event.occurredAt) < Date.parse(config.notBefore)) continue;
      const validTo = typeof item.to === "string" && ADDRESS.test(item.to);
      const validContext = item.context === undefined || (item.context !== null
        && typeof item.context === "object" && typeof item.context.id === "string" && NATIVE.test(item.context.id));
      add({ event_key, key_tag: keyTag,
        subject_ref: validTo ? hmac(config.hmacKey, `${scope.wabaId}:${scope.phoneNumberId}:${item.to}`) : null,
        context_id: validContext ? item.context?.id ?? null : null,
        evidence_state: validContext && (item.to === undefined || validTo)
          && (validTo || item.context?.id || event.providerMetadata.originalMessageId) ? "exact" : "unknown",
        evidence_source: validTo ? "signed_to" : "no_recipient" });
    }
  }
  return [...rows.values()];
}

// Per-candidate attribution, never a human identity / episode / pause state.
// A missing historical sidecar, unresolved reference or contradictory native
// evidence fails closed. Timestamps are deliberately absent from this matcher.
export function assessEchoSubjects(target, roots, nodes) {
  if (!target || !Array.isArray(roots) || !Array.isArray(nodes)) return null;
  const byId = new Map(nodes.map(n => [n.event_id, n]));
  const byNative = new Map();
  for (const n of nodes) byNative.set(n.native_message_id, [...(byNative.get(n.native_message_id) || []), n]);
  const compatible = n => n && n.waba_id === target.waba_id && n.phone_number_id === target.phone_number_id
    && HEX.test(target.key_tag || "") && n.key_tag === target.key_tag;
  function collect(n, seen = new Set()) {
    if (!compatible(n) || seen.has(n.event_id) || seen.size >= 16 || n.evidence_state !== "exact")
      return { refs: [], unknown: true };
    const visited = new Set(seen).add(n.event_id);
    const refs = HEX.test(n.subject_ref || "") ? [n.subject_ref] : [];
    let unknown = false;
    for (const ref of [n.context_id, n.original_message_id].filter(Boolean)) {
      const candidates = byNative.get(ref) || [];
      if (candidates.length !== 1) { unknown = true; continue; }
      const result = collect(candidates[0], visited);
      refs.push(...result.refs); unknown ||= result.unknown;
    }
    return { refs, unknown: unknown || refs.length === 0 };
  }
  return roots.map(id => {
    const result = collect(byId.get(id));
    const refs = new Set(result.refs);
    const state = refs.size > 1 ? "conflict" : result.unknown || !HEX.test(target.subject_ref || "")
      ? "unknown" : refs.has(target.subject_ref) ? "same_subject" : "other_subject";
    return { event_id: id, state };
  });
}
