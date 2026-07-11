import crypto from "crypto";

const secret = () => process.env.CARTA_ACEPTACION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "emporio-cartas";

export function createCartaAcceptanceToken(id) {
  return crypto.createHmac("sha256", secret()).update(String(id || "")).digest("hex");
}

export function verifyCartaAcceptanceToken(id, token) {
  if (!id || !token) return false;
  const expected = createCartaAcceptanceToken(id);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(token)));
  } catch {
    return false;
  }
}
