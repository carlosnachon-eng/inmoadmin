import { createHmac } from "crypto";

import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { readRespondWebhookBody } from "../../../lib/ejecutivo/respondWebhook";
import {
  assertRespondAttributionPilotEnvironment,
  extractAttributionObservation,
  persistAttributionObservation,
  resolveRespondAttributionSigningKey,
  validPilotSignature,
} from "../../../lib/whatsappAttribution/respondAttribution";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    assertRespondAttributionPilotEnvironment();
    const signingKey = resolveRespondAttributionSigningKey();
    const body = await readRespondWebhookBody(req);
    const signature = req.headers["x-webhook-signature"];

    if (!validPilotSignature(body, signature, signingKey, createHmac)) {
      return res.status(401).json({ ok: false, error: "Firma invalida." });
    }

    const observation = extractAttributionObservation(body);
    if (!observation) {
      return res.status(200).json({ ok: true, ignored: "no_valid_reference" });
    }

    try {
      const result = await persistAttributionObservation(getAdminSupabase(), observation);
      return res.status(200).json({ ok: true, attribution: result.status || "observed" });
    } catch (error) {
      console.error("[respond-attribution-pilot]", error?.code || "storage_failed_open");
      return res.status(200).json({ ok: true, attribution: "storage_failed_open" });
    }
  } catch (error) {
    if (error?.statusCode === 404) return res.status(404).json({ ok: false, error: "Not Found" });
    if (error?.statusCode === 400 || error?.statusCode === 413) {
      return res.status(error.statusCode).json({ ok: false, error: error.message });
    }
    console.error("[respond-attribution-pilot]", error?.code || "receiver_unavailable");
    return res.status(503).json({ ok: false, error: "Receiver no disponible." });
  }
}
