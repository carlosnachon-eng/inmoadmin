import { createHash } from "node:crypto";
import { MATERIAL_BUCKET, MATERIAL_CODES, MATERIAL_MAX_BYTES } from "./policy.js";

export function verifyMaterialBytes(bytes, version) {
  const buffer = Buffer.from(bytes);
  if (!buffer.length || buffer.length > MATERIAL_MAX_BYTES || buffer.length !== version.byte_size ||
      buffer.subarray(0, 5).toString("ascii") !== "%PDF-" || !buffer.subarray(-2048).includes(Buffer.from("%%EOF")) ||
      createHash("sha256").update(buffer).digest("hex") !== version.sha256) throw new Error("material_integrity_failed");
  return buffer;
}

export async function loadMaterialBytes(admin, version) {
  if (!Object.values(MATERIAL_CODES).includes(version.material_code) ||
      version.object_path !== `${version.material_code}/${version.sha256}.pdf`) throw new Error("material_object_invalid");
  const { data, error } = await admin.storage.from(MATERIAL_BUCKET).download(version.object_path);
  if (error || !data) throw new Error("material_storage_unavailable");
  return verifyMaterialBytes(await data.arrayBuffer(), version);
}

// Operator-only library helper, no public route and no automatic activation.
// Uploaded bytes must already have human approval. No generation/transformation/upsert.
export async function registerApprovedMaterial(admin, { bytes, materialCode, version, filename, sha256, byteSize, approvedBy, validUntil }) {
  const { data: actor, error } = await admin.from("profiles").select("id,active,role_id").eq("id", approvedBy).maybeSingle();
  if (error || actor?.active !== true || actor.role_id !== "admin") throw new Error("material_admin_required");
  if (!Object.values(MATERIAL_CODES).includes(materialCode) || !/^[a-zA-Z0-9._-]{1,64}$/.test(version) ||
      !/^[a-f0-9]{64}$/.test(sha256) || !/^[^/\\\r\n]{1,180}\.pdf$/i.test(filename) ||
      !Number.isFinite(Date.parse(validUntil)) || Date.parse(validUntil) <= Date.now()) throw new Error("material_approval_invalid");
  const data = verifyMaterialBytes(bytes, { sha256, byte_size: byteSize });
  const objectPath = `${materialCode}/${sha256}.pdf`;
  const upload = await admin.storage.from(MATERIAL_BUCKET).upload(objectPath, data, {
    contentType: "application/pdf", cacheControl: "0", upsert: false,
  });
  if (upload.error) {
    // Reapproval may use unchanged bytes under a new validity/version. Never overwrite.
    // Even an upload conflict is accepted only after reading and checking the exact existing PDF.
    await loadMaterialBytes(admin, { material_code: materialCode, object_path: objectPath, sha256, byte_size: byteSize });
  }
  const saved = await admin.from("owner_approved_material_versions").insert({
    material_code: materialCode, version, filename, sha256, byte_size: byteSize,
    object_path: objectPath, approved_by: approvedBy, valid_until: validUntil, active: false,
  }).select("id,material_code,version,active").single();
  // No deletion here on uncertain persistence: retain immutable object for operator reconciliation.
  if (saved.error || !saved.data) throw new Error("material_registration_requires_review");
  return saved.data;
}
