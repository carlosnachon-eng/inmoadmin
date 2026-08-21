const DEV_PROJECT_REF = "hjfwjnejbcpmknvfpdcq";

export const SHADOW_AI_LIMITS = Object.freeze({
  maxBatch: 40,
  maxOutputTokens: 1400,
  maxToolRounds: 3,
  maxToolsPerRound: 5,
  anthropicRequestTimeoutMs: 50000,
  toolTimeoutMs: 5000,
  globalRunTimeoutMs: 105000,
});

export function shadowAiGuard(envelope, env = process.env) {
  if (env.SHADOW_AI_ENABLED !== "true") return { allowed: false, status: "disabled" };
  if (env.SHADOW_OUTBOUND_ENABLED === "true") return { allowed: false, status: "blocked_outbound" };
  const ref = String(env.NEXT_PUBLIC_SUPABASE_URL || "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
  if (env.SUPABASE_ENVIRONMENT !== "dev" || ref !== DEV_PROJECT_REF) return { allowed: false, status: "blocked_environment" };
  const synthetic = envelope?.provider === "synthetic" && Boolean(envelope?.providerMetadata?.syntheticScenario);
  if (!synthetic && env.SHADOW_AI_ALLOW_REAL_MESSAGES !== "true") return { allowed: false, status: "blocked_real_message" };
  if (!synthetic) return { allowed: false, status: "blocked_p3_synthetic_only" };
  if (!env.ANTHROPIC_API_KEY) return { allowed: false, status: "missing_api_key" };
  return { allowed: true, status: "allowed" };
}
