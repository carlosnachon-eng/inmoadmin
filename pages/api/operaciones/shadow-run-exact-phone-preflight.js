import { createClient } from "@supabase/supabase-js";
import { fetchRespondContact } from "../../../lib/ejecutivo/respondSync.js";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth.js";
import { sameOriginAdminRequest } from "../../../lib/shadow/identityBootstrap.js";
import { evaluateRunExactPhonePreflightReadOnly } from "../../../lib/shadow/runExactPhonePreflight.js";
import { createRunExactPhonePreflightHandler } from "../../../lib/shadow/runExactPhonePreflightApi.js";

const adminClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const preflight = createRunExactPhonePreflightHandler({
  authorize: authorizeShadowAdministrator,
  isSameOrigin: sameOriginAdminRequest,
  evaluate: evaluateRunExactPhonePreflightReadOnly,
  createAdminClient: adminClient,
  fetchContact: fetchRespondContact,
});

export default function handler(req, res) { return preflight(req, res); }
