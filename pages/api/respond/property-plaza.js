import { assertSupabaseEnvironment, getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import {
  authorizePropertyPlazaLookup,
  lookupPropertyPlaza,
  normalizeEmpPublicId,
} from "../../../lib/respond/propertyPlazaLookup";

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
