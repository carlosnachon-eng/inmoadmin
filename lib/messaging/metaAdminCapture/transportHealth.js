import { createHash } from "node:crypto";

const WABA = "1297760461811288", PHONE = "1198305790026665", APP = "1728488815945294";
const ROUTE = "/api/webhooks/meta";
const time = value => Date.parse(value);
const ref = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Isolated operator-side reader. GET only; no secrets discovery, receiver probe,
// model, sender or DB writes. Logs API shape follows Vercel CLI logs-v2.ts.
// "healthy" means observable operational evidence, NOT perfect delivery.
export function createMetaAdminTransportReader({ projectId, teamId, hostname,
  expectedDeploymentId, expectedSha, vercelToken, metaToken,
  fetchImpl = fetch, now = Date.now } = {}) {
  return async function readTransportHealth(candidate) {
    const started = now();
    const unknown = reason => ({ status: "unknown", reason, checked_at: new Date(now()).toISOString() });
    try {
      if (!projectId || !teamId || !hostname || !expectedDeploymentId || !/^[a-f0-9]{40}$/.test(expectedSha || "")
        || !vercelToken || !metaToken || candidate?.waba_id !== WABA || candidate.phone_number_id !== PHONE)
        return unknown("reader_configuration_unknown");
      const from = Math.min(time(candidate.occurred_at), time(candidate.captured_at));
      const until = time(candidate.checked_at);
      if (!Number.isFinite(from) || !Number.isFinite(until) || from > until
        || until > started + 1000 || started - until > 5000 || candidate.persisted !== true)
        return unknown("candidate_snapshot_unknown");
      // No implicit retries or redirects (including redirects carrying tokens).
      const get = async (url, token) => {
        const remaining = 4500 - (now() - started);
        if (remaining <= 0) throw Error("deadline");
        const r = await fetchImpl(url, { method: "GET", redirect: "error",
          signal: AbortSignal.timeout(remaining), headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw Error("read_failed");
        return r.json();
      };
      const deploymentUrl = new URL(`https://api.vercel.com/v13/deployments/${encodeURIComponent(hostname)}`);
      deploymentUrl.searchParams.set("teamId", teamId);
      async function deployment() {
        const d = await get(deploymentUrl, vercelToken);
        if (d.id !== expectedDeploymentId || d.projectId !== projectId || d.target !== "production"
          || d.readyState !== "READY" || d.meta?.githubCommitSha !== expectedSha
          || !Number.isFinite(d.ready) || d.ready > from) throw Error("deployment_unexpected");
        return d;
      }
      const [d, apps] = await Promise.all([
        deployment(), get(`https://graph.facebook.com/v26.0/${WABA}/subscribed_apps`, metaToken),
      ]);
      // A paginated subscription response cannot prove presence/absence safely
      // without exhausting it; fail closed instead of following tokenized URLs.
      if (!Array.isArray(apps.data) || apps.paging?.next
        || apps.data.filter(a => a.whatsapp_business_api_data?.id === APP).length !== 1)
        return unknown("subscription_unverified");
      let rows = [], exhausted = false;
      for (let page = 0; page < 20; page++) {
        const url = new URL("https://vercel.com/api/logs/request-logs");
        for (const [k,v] of Object.entries({ projectId, ownerId:teamId, environment:"production",
          startDate:String(from), endDate:String(until), page:String(page) })) url.searchParams.set(k,v);
        // Do not filter deployment or errors: that would hide mismatches and
        // known unfinished requests. Inspect only exact webhook POSTs locally.
        const result = await get(url, vercelToken);
        if (!Array.isArray(result.rows) || typeof result.hasMoreRows !== "boolean")
          return unknown("request_logs_shape_unknown");
        rows.push(...result.rows);
        if (rows.length > 10000) return unknown("request_logs_truncated");
        if (!result.hasMoreRows) { exhausted = true; break; }
        if (result.rows.length === 0) return unknown("request_logs_pagination_conflict");
      }
      if (!exhausted) return unknown("request_logs_truncated");
      const seen = new Map();
      let failed = false;
      for (const row of rows) {
        if (typeof row.requestPath !== "string" || typeof row.requestMethod !== "string")
          return unknown("request_metadata_missing");
        if (row.requestPath.split("?")[0] !== ROUTE || row.requestMethod !== "POST") continue;
        const ts = time(row.timestamp);
        if (!row.requestId || !Number.isFinite(ts) || ts < from || ts > until
          || row.environment !== "production" || row.deploymentId !== expectedDeploymentId
          || !Array.isArray(row.logs)) return unknown("request_metadata_conflict");
        const summary = { status:row.statusCode, logs:row.logs };
        if (seen.has(row.requestId) && seen.get(row.requestId) !== ref(summary))
          return unknown("request_results_conflict");
        seen.set(row.requestId, ref(summary));
        if (!Number.isInteger(row.statusCode) || row.statusCode < 100)
          return unknown("request_in_flight_or_uncertain");
        if (row.logs.some(l => l.messageTruncated || typeof l.message !== "string" || typeof l.level !== "string"))
          return unknown("request_logs_incomplete");
        if (row.statusCode >= 500 || row.logs.some(l => ["error","fatal"].includes(l.level)
          || /timeout|timed out|persistence.*fail|persist.*error/i.test(l.message))) failed = true;
        else if (row.statusCode !== 200) return unknown("request_not_acknowledged");
      }
      // Detect a deployment/alias change while reading. No production probe.
      await deployment();
      if (now() - started > 4500 || now() - until > 5000) return unknown("health_read_expired");
      if (!Number.isSafeInteger(candidate.unresolved_ingestion) || candidate.unresolved_ingestion < 0)
        return unknown("ingestion_state_unknown");
      if (failed || candidate.unresolved_ingestion > 0)
        return { status:"unhealthy", reason:"observable_ingestion_failure", checked_at:new Date(now()).toISOString() };
      return { status:"healthy", basis:"observable_operational_evidence_only",
        checked_at:new Date(now()).toISOString(), waba_id:WABA, phone_number_id:PHONE,
        covered_from:new Date(from).toISOString(), covered_through:new Date(until).toISOString(),
        receiver_ready:true, subscription_active:true, coverage_complete:true,
        known_pending:0, in_flight:0, unresolved_failures:0,
        evidence_refs:[ref({deployment:d.id,sha:expectedSha}),ref({app:APP,waba:WABA}),
          ref({from,until,requests:[...seen],snapshot:candidate.checked_at})] };
    } catch {
      // Do not expose API errors, URLs, log content or credential-bearing data.
      return unknown("transport_read_failed_or_contradictory");
    }
  };
}
