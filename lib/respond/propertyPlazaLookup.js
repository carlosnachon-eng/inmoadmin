import { timingSafeEqual } from "node:crypto";

const EMP_PUBLIC_ID = /^EMP-[A-Z0-9]{8}$/;
const SUPPORTED_PLAZAS = new Set(["PUEBLA", "VERACRUZ"]);

export function normalizeEmpPublicId(value) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return EMP_PUBLIC_ID.test(normalized) ? normalized : null;
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function authorizePropertyPlazaLookup(req, env = process.env) {
  const expected = env.RESPOND_PROPERTY_LOOKUP_TOKEN;
  if (!expected) return false;
  return constantTimeEqual(req.headers.authorization, `Bearer ${expected}`)
    || constantTimeEqual(req.headers["x-respond-property-token"], expected);
}

function result(status, propertyPublicId = null, plazaCode = null) {
  return { status, propertyPublicId, plazaCode };
}

export async function lookupPropertyPlaza(admin, value) {
  const propertyPublicId = normalizeEmpPublicId(value);
  if (!propertyPublicId || !admin) return result("unavailable", propertyPublicId);

  try {
    const { data: properties, error: propertyError } = await admin
      .from("propiedades")
      .select("public_id,plaza_id")
      .eq("public_id", propertyPublicId)
      .limit(2);

    if (propertyError) return result("unavailable", propertyPublicId);
    if (!properties?.length) return result("not_found", propertyPublicId);
    if (properties.length !== 1) return result("ambiguous", propertyPublicId);

    const plazaId = properties[0]?.plaza_id;
    if (!plazaId) return result("unavailable", propertyPublicId);

    const { data: plaza, error: plazaError } = await admin
      .from("commercial_plazas")
      .select("code")
      .eq("id", plazaId)
      .maybeSingle();

    const plazaCode = String(plaza?.code || "").trim().toUpperCase();
    if (plazaError || !SUPPORTED_PLAZAS.has(plazaCode)) {
      return result("unavailable", propertyPublicId);
    }
    return result("resolved", propertyPublicId, plazaCode);
  } catch {
    return result("unavailable", propertyPublicId);
  }
}
