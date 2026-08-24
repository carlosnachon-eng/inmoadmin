export function operationalWorkerGuard(env = process.env) {
  if (env.SHADOW_OUTBOUND_ENABLED === "true") {
    return { allowed: false, error: "Operational ingestion exige outbound apagado." };
  }
  return { allowed: true };
}
