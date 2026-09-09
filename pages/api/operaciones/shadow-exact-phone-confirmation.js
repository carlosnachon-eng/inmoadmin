import { createClient } from "@supabase/supabase-js";
import { fetchRespondContact } from "../../../lib/ejecutivo/respondSync.js";
import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth.js";
import { createExactPhoneConfirmationHandler } from "../../../lib/shadow/exactPhoneConfirmationApi.js";
import { sameOriginAdminRequest } from "../../../lib/shadow/identityBootstrap.js";

const adminClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const confirmation = createExactPhoneConfirmationHandler({
  authorize: authorizeShadowAdministrator,
  isSameOrigin: sameOriginAdminRequest,
  createAdminClient: adminClient,
  fetchContact: fetchRespondContact,
});

export default function handler(req, res) {
  return confirmation(req, res);
}
