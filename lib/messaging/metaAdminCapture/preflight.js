const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

// No agent/model/sender imports or injectable bypass. This phase cannot prove
// a native Meta attention episode or a cross-provider exclusive consumer.
export function metaNativeAttentionGate() {
  return { blocked: true, state: "unknown", reason: "meta_human_attention_unverified",
    humanAuthorshipProven: false, resumeSupported: false };
}

export async function resolveMetaAdminIdentity({ db, inputId }) {
  if (!UUID.test(inputId || "")) throw new Error("meta_admin_input_invalid");
  try {
    const { data, error } = await db.rpc("resolve_meta_admin_identity_v1", { p_input_id: inputId });
    if (error || !["matched", "ambiguous", "unmatched"].includes(data?.state)
      || data?.authorizes_business !== false) throw new Error("unverified");
    return data;
  } catch { throw new Error("meta_admin_identity_unverified"); }
}

// Explicit one-input manual preflight, not an automatic caller or an agent run.
// Database stores the terminal blocked attempt; duplicate requests reuse it.
export async function prepareMetaAdminShadow({ db, inputId }) {
  if (!UUID.test(inputId || "")) throw new Error("meta_admin_input_invalid");
  try {
    const { data, error } = await db.rpc("prepare_meta_admin_shadow_v1", { p_input_id: inputId });
    if (error || data?.status !== "blocked" || data?.model_calls !== 0 || data?.send_calls !== 0
      || data?.run_id !== null || data?.proposed_response !== null) throw new Error("unverified");
    return data;
  } catch { throw new Error("meta_admin_shadow_preflight_failed"); }
}
