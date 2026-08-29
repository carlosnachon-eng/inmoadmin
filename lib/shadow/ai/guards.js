const DEV_PROJECT_REF = "hjfwjnejbcpmknvfpdcq";
const PRODUCTION_PROJECT_REF = "bnzrnizrmonjxlktbhlp";

export const SHADOW_AI_LIMITS = Object.freeze({
  maxBatch: 40,
  maxOutputTokens: 1400,
  maxToolRounds: 3,
  maxToolsPerRound: 5,
  // A successful production v10 first round took 7.3s. Forty seconds leaves
  // room for one bounded retry inside the 105s durable run deadline.
  anthropicRequestTimeoutMs: 90000,
  autoRealAnthropicAttemptTimeoutMs: 40000,
  toolTimeoutMs: 5000,
  globalRunTimeoutMs: 110000,
  autoRealDurableDeadlineMs: 105000,
  minimumAnthropicRoundBudgetMs: 55000,
  minimumAnthropicRetryBudgetMs: 42000,
  maxAnthropicRetriesPerRun: 1,
});

export function shadowAiGuard(envelope, env = process.env) {
  if (env.SHADOW_AI_ENABLED !== "true") return { allowed: false, status: "disabled" };
  if (env.SHADOW_OUTBOUND_ENABLED === "true") return { allowed: false, status: "blocked_outbound" };
  const ref = String(env.NEXT_PUBLIC_SUPABASE_URL || "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
  const isDev = env.SUPABASE_ENVIRONMENT === "dev" && ref === DEV_PROJECT_REF;
  const isProduction = env.SUPABASE_ENVIRONMENT === "production" && ref === PRODUCTION_PROJECT_REF && env.SHADOW_AI_PRODUCTION_ENABLED === "true";
  if (!isDev && !isProduction) return { allowed: false, status: "blocked_environment" };
  const operational = envelope?.provider === "inmoadmin_operational" && envelope?.providerMetadata?.operationalEvent === true;
  if (operational) {
    if (env.SHADOW_AI_ALLOW_OPERATIONAL_EVENTS !== "true") return { allowed: false, status: "blocked_operational_event" };
    if (env.SHADOW_AI_ALLOW_REAL_MESSAGES === "true") return { allowed: false, status: "blocked_mixed_real_inputs" };
    if (!env.ANTHROPIC_API_KEY) return { allowed: false, status: "missing_api_key" };
    return { allowed: true, status: "allowed" };
  }
  const synthetic = envelope?.provider === "synthetic" && Boolean(envelope?.providerMetadata?.syntheticScenario);
  if (synthetic && !isDev) return { allowed: false, status: "blocked_synthetic_outside_dev" };
  if (!synthetic) {
    if (!isProduction || env.SHADOW_AI_ALLOW_REAL_MESSAGES !== "true") return { allowed: false, status: "blocked_real_message" };
    const expectedChannel = String(env.SHADOW_RESPOND_ADMIN_CHANNEL_ID || "");
    const actualChannel = String(envelope?.providerMetadata?.channelId || envelope?.providerMetadata?.channel_id || "");
    if (envelope?.provider !== "respond_admin" || !expectedChannel || actualChannel !== expectedChannel) return { allowed: false, status: "blocked_real_message_channel" };
  }
  if (!env.ANTHROPIC_API_KEY) return { allowed: false, status: "missing_api_key" };
  return { allowed: true, status: "allowed" };
}
