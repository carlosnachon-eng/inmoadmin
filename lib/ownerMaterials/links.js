import { createHmac, timingSafeEqual } from "node:crypto";
import { MATERIAL_LINK_SECONDS } from "./policy.js";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function secret(env) {
  if (typeof env.OWNER_APPROVED_MATERIALS_LINK_SECRET !== "string" || env.OWNER_APPROVED_MATERIALS_LINK_SECRET.length < 32) throw new Error("material_link_configuration_missing");
  return env.OWNER_APPROVED_MATERIALS_LINK_SECRET;
}
export function materialOrigin(env) {
  let url;
  try { url = new URL(env.OWNER_APPROVED_MATERIALS_ORIGIN); } catch { throw new Error("material_origin_invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      url.hostname === "localhost" || /^[\d.:]+$/.test(url.hostname)) throw new Error("material_origin_invalid");
  secret(env);
  return url.origin;
}
const mac = (value, env) => createHmac("sha256", secret(env)).update("owner-material-v1:" + value).digest("base64url");
export function materialLink(deliveryId, expiresAt, env) {
  if (!uuid.test(deliveryId)) throw new Error("material_link_invalid");
  const payload = `${deliveryId}.${Math.floor(Date.parse(expiresAt) / 1000)}`;
  return `${materialOrigin(env)}/api/owner-materials/download?t=${payload}.${mac(payload, env)}`;
}
export function verifyMaterialLink(token, env, now = Date.now()) {
  if (typeof token !== "string" || token.length > 150) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !uuid.test(parts[0]) || !/^\d{10}$/.test(parts[1]) || !/^[\w-]{43}$/.test(parts[2])) return null;
  const expiry = Number(parts[1]);
  if (expiry <= Math.floor(now / 1000) || expiry > Math.floor(now / 1000) + MATERIAL_LINK_SECONDS) return null;
  const expected = Buffer.from(mac(parts.slice(0, 2).join("."), env));
  if (!timingSafeEqual(expected, Buffer.from(parts[2]))) return null;
  return { deliveryId: parts[0], expiry };
}
