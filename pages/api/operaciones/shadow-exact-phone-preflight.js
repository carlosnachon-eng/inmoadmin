import { createClient } from "@supabase/supabase-js";
import { fetchRespondContact } from "../../../lib/ejecutivo/respondSync.js";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth.js";
import { evaluateExactPhoneCohortReadOnly } from "../../../lib/shadow/exactPhoneReadOnlyEvaluator.js";
import { createExactPhonePreflightHandler } from "../../../lib/shadow/exactPhonePreflightApi.js";
import { sameOriginAdminRequest } from "../../../lib/shadow/identityBootstrap.js";

const adminClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const exactPhonePreflight = createExactPhonePreflightHandler({
  authorize: authorizeShadowAdministrator,
  isSameOrigin: sameOriginAdminRequest,
  evaluate: evaluateExactPhoneCohortReadOnly,
  createAdminClient: adminClient,
  fetchContact: fetchRespondContact,
});

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  return exactPhonePreflight(req, res);
}
