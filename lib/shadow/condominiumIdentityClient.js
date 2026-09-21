// Fresh session per explicit action. No token caching, logging or automatic retries.
export async function requestCondominiumIdentityReview({ supabase, profile, body, fetchImpl = fetch, now = Date.now }) {
  if (profile?.active !== true || profile.role_id !== "admin") throw new Error("admin_required");
  const { data, error } = await supabase.auth.getSession();
  const session = data?.session;
  if (error || !session?.access_token || !session?.user?.id || session.user.id !== profile.id
    || !Number.isFinite(Number(session.expires_at)) || Number(session.expires_at) <= Math.floor(now() / 1000)) throw new Error("fresh_session_required");
  const response = await fetchImpl("/api/operaciones/client-reconciliation", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(result.error || "condominium_review_failed");
  return result;
}
