import { loadMaterialBytes } from "./assets.js";
import { materialLink, materialOrigin } from "./links.js";
import { deliveryMode, materialsEnabled, materialWindowOpen, MATERIAL_CODES, rentalGuaranteeText, selectOwnerMaterial } from "./policy.js";

const VERSION_FIELDS = "id,material_code,version,filename,sha256,byte_size,object_path,active,valid_from,valid_until";
export { VERSION_FIELDS };
const one = value => Array.isArray(value) ? value[0] : value;

export function respondMaterialMessage(mode, url, code) {
  if (mode === "document") return { type: "attachment", attachment: { type: "file", url } };
  return { type: "text", text: `${code === MATERIAL_CODES.rent ? "Presentación de renta y administración" : "Presentación del servicio de venta"}: ${url}\nEnlace temporal válido por una hora.${code === MATERIAL_CODES.rent ? "\n" + rentalGuaranteeText() : ""}` };
}

async function sendMaterial({ fetchImpl, env, contactId, channelId, message }) {
  const response = await fetchImpl(`https://api.respond.io/v2/contact/id:${encodeURIComponent(contactId)}/message`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${env.RESPOND_IO_TOKEN || env.RESPOND_IO_API_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ channelId: Number(channelId), message }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !/^\d{1,30}$/.test(String(body?.messageId || ""))) throw new Error("material_provider_uncertain");
  return String(body.messageId);
}

// Called only after the existing Owner text reply has a persisted successful receipt.
// A reservation is never replayed, even after a crash/timeout/ambiguous provider result.
export async function deliverOwnerMaterial(admin, inbound, runId, { env = process.env, fetchImpl = fetch } = {}) {
  if (!materialsEnabled(env)) return { status: "disabled" };
  const selection = selectOwnerMaterial(inbound.sanitized_text);
  if (!selection.code) return { status: selection.kind === "clarify" ? "clarification_required" : "not_requested" };
  if (!materialWindowOpen(inbound.occurred_at)) return { status: "blocked", error_code: "material_messaging_window_closed" };
  const mode = deliveryMode(inbound.channel_id);
  if (!mode) return { status: "blocked", error_code: "material_channel_unsupported" };
  let reservation, dispatchStarted = false;
  try {
    materialOrigin(env);
    if (!env.RESPOND_IO_TOKEN && !env.RESPOND_IO_API_TOKEN) throw new Error("material_sender_configuration_missing");
    const reserved = await admin.rpc("reserve_owner_material_delivery", {
      p_inbound_id: inbound.id, p_run_id: runId, p_material_code: selection.code, p_delivery_mode: mode,
    });
    if (reserved.error) throw new Error("material_reservation_failed");
    reservation = one(reserved.data);
    if (!reservation?.id) return { status: "unavailable" };
    if (!reservation.created) return { status: "duplicate_suppressed", deliveryRef: reservation.id };
    const versionResult = await admin.from("owner_approved_material_versions").select(VERSION_FIELDS).eq("id", reservation.version_id).single();
    if (versionResult.error || !versionResult.data) throw new Error("material_version_unavailable");
    await loadMaterialBytes(admin, versionResult.data);
    // DB rechecks current approval/expiry, newer inbound and human reply immediately before claim.
    const claimed = await admin.rpc("claim_owner_material_delivery", { p_delivery_id: reservation.id });
    if (claimed.error || !one(claimed.data)?.id) throw new Error("material_claim_blocked");
    const claim = one(claimed.data);
    const url = materialLink(reservation.id, claim.link_expires_at, env);
    dispatchStarted = true;
    const providerId = await sendMaterial({ fetchImpl, env, contactId: inbound.respond_contact_id, channelId: inbound.channel_id,
      message: respondMaterialMessage(mode, url, selection.code) });
    const saved = await admin.from("owner_material_deliveries").update({ status: "sent", provider_message_id: providerId, sent_at: new Date().toISOString(), completed_at: new Date().toISOString() })
      .eq("id", reservation.id).eq("status", "dispatching").select("id").single();
    if (saved.error || !saved.data) throw new Error("material_result_persistence_uncertain");
    return { status: "sent", deliveryRef: reservation.id, materialCode: selection.code, version: versionResult.data.version, mode };
  } catch {
    const status = dispatchStarted ? "uncertain" : "blocked";
    const error_code = dispatchStarted ? "material_delivery_uncertain_requires_review" : "material_preflight_blocked";
    if (reservation?.created) {
      // Fixed enums only; no provider body, URL, secret or error.message in telemetry.
      const result = await Promise.resolve(admin.from("owner_material_deliveries").update({ status, error_code, completed_at: new Date().toISOString() })
        .eq("id", reservation.id).in("status", ["reserved", "dispatching"]).select("id").maybeSingle()).catch(() => null);
      if (!result || result.error || !result.data) return { status: "uncertain", error_code: "material_audit_persistence_uncertain", deliveryRef: reservation.id };
    }
    return { status, error_code, ...(reservation?.id ? { deliveryRef: reservation.id } : {}) };
  }
}
