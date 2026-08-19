import { DEV_PROJECT_REF, assertSupabaseEnvironment, getAdminSupabase } from "../../../../lib/ejecutivo/workCenter.js";
import { processShadowEnvelope } from "../../../../lib/shadow/pipeline.js";
import { handle360DialogWebhook as handleWebhook } from "../../../../lib/shadow/providers/360dialogWebhook.js";

export const config = { api: { bodyParser: { sizeLimit: "256kb" } } };

export function handle360DialogWebhook(req, res, overrides = {}) {
  return handleWebhook(req, res, {
    env: overrides.env || process.env,
    environment: overrides.environment || (() => assertSupabaseEnvironment()),
    getAdmin: overrides.getAdmin || getAdminSupabase,
    processEnvelope: overrides.processEnvelope || processShadowEnvelope,
    devProjectRef: DEV_PROJECT_REF,
    now: overrides.now || new Date(),
  });
}

export default function handler(req, res) {
  return handle360DialogWebhook(req, res);
}
