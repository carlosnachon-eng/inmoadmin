import { timingSafeEqual } from "node:crypto";
import { assertSupabaseEnvironment, getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { lookupPropertyPlaza, normalizeEmpPublicId } from "../../../lib/respond/propertyPlazaLookup";

export const config = {
  api: {
    bodyParser: { sizeLimit: "1kb" },
  },
};

const unavailable = (propertyPublicId = null) => ({
  status: "unavailable",
  propertyPublicId,
  plazaCode: null,
});

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function authorizePropertyPlazaLookup(req, env = process.env) {
  const expected = env.RESPOND_PROPERTY_LOOKUP_TOKEN;
  return Boolean(expected) && constantTimeEqual(req.headers.authorization, `Bearer ${expected}`);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json(unavailable());
  }

  const propertyPublicId = normalizeEmpPublicId(req.body?.publicId);
  if (!authorizePropertyPlazaLookup(req)) return res.status(401).json(unavailable(propertyPublicId));
  if (!propertyPublicId || Object.keys(req.body || {}).some((key) => key !== "publicId")) {
    return res.status(400).json(unavailable(propertyPublicId));
  }

  try {
    assertSupabaseEnvironment();
    const result = await lookupPropertyPlaza(getAdminSupabase(), propertyPublicId);
    return res.status(result.status === "unavailable" ? 503 : 200).json(result);
  } catch {
    return res.status(503).json(unavailable(propertyPublicId));
  }
}
