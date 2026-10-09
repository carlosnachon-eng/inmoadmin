# Meta Admin Shadow Once v1 — isolated local review

Base: `ec23c84c22fb0676b05fc4e2e8c2be67fbe10d6b`.
No merge, deploy, receiver caller, cron, Human Attention v1 or change to #168.
No changes to Respond, correlation, routing, business agents or identity links.
The local future-subject-evidence extension wraps secure capture atomically; it
is not merged, deployed or installed remotely.

## Execution boundary

`runMetaAdminShadowOnce` requires the one exact authorized input UUID. It accepts
`matched` only from the exact canonical bridge and `unmatched` only for zero exact
candidates. Ambiguous, inactive/unconfirmed identities and malformed results block.
Both contexts are restricted in v1: only `identity_state` and the captured sanitized
text reach the model, never client identity UUIDs, phones, properties, contracts,
Respond data or temporal correlation. All tools are removed, including read-only
private tools; no business DB handle reaches the model adapter.

The isolated adapter reuses `buildAdminAgentV2Config` instructions and configured
model. It uses **one direct OpenAI Responses POST** (not the existing Respond-only
Agents session loader/loop), `tools=[]`, `tool_choice=none`, `store=false`, a bounded
timeout, no continuation, no retry/fallback, no redirect. This certifies the
restricted Admin instruction/configuration path, not private Admin tool execution.
Anthropic/non-OpenAI model configuration blocks before a claim. Provider/model and
proposed response are recorded in the private audit; no sender exists.

## Observation gates and limitations

Read-only SQL checks exact Admin scope, enabled capture, future-cutoff input,
observer state, identity and edit/revoke observations. Proposed local revision:
freshness requires a query at most 5 seconds old and independent transport evidence
at most 5 seconds old. The age of the latest received message is not a gate.
Recent DB traffic alone is NOT proof of healthy ingestion or absent human activity.

The trusted `readTransportHealth` contract must return exact `waba_id` and
`phone_number_id`, `receiver_ready=true`, `subscription_active=true`,
`known_pending=0`, `in_flight=0`, `unresolved_failures=0`, `coverage_complete=true`,
`checked_at`, `covered_from`, `covered_through` and nonempty audit `evidence_refs`.
Coverage must begin no later than the candidate occurrence/capture and end within
5 seconds of the current snapshot. Missing/unknown coverage blocks. Evidence refs
are opaque audit references, never tokens, phones or raw payloads.

`transportHealth.js` implements GET-only operational reads, supplied explicitly
through `transportReaderConfig` on the PostgreSQL store (no secret discovery).
It checks the production alias deployment before/after the reads, expected SHA,
READY since before the candidate, exact App membership in WABA subscribed_apps,
and enumerates Vercel request logs for the interval. It reconciles known failures
with the durable candidate and journal snapshot. The SQL snapshot is refreshed
again after these external reads; its boundary is statement_timestamp().

`coverage_complete` means enumeration of these observable sources only, NOT
guaranteed delivery. Zero known pending/in-flight means none visible in these
sources. Silent intervals are allowed. Provider events not delivered yet, logs
not indexed yet, and an unlogged transient alias change cannot be excluded.
The result explicitly carries basis=observable_operational_evidence_only.
Known 5xx/timeouts/persistence errors yield unhealthy; malformed, inaccessible,
truncated, contradictory, unfinished or expired reads yield unknown. Both block.
No claim of absolute absence of an event not yet delivered is possible.

Sources: Vercel deployment GET and the request-logs endpoint used by its official
[CLI](https://github.com/vercel/vercel/blob/main/packages/cli/src/util/logs-v2.ts),
plus Meta v26.0 WABA subscribed_apps. Tokens are explicit operator inputs,
Bearer headers only, never URLs/output. No retries/redirects. Pagination is capped
at 20 pages/10,000 rows and total reads at 4.5 seconds; reaching a cap blocks.
The request-log interface is not a stable public API: access/shape changes block.
Live access and indexing latency have NOT been certified by these local tests.

Manual window: use the observably healthy interval, not a fixed inbound TTL.
A 15-minute-old candidate is covered in the focused tests, but 15 minutes is not
a measured production guarantee or a new timeout. Any gap, expired health proof,
known pending delivery or applicable echo blocks at any age. No Production
activation is included.

Focused local reader/freshness/echo verification: 69/69 PASS, all HTTP/DB/model
dependencies intercepted; zero real model calls/sends or Production reads/writes.
No migration is introduced by this reader.

Gates also repeat after the durable model-start reservation, immediately before
the request, so time spent committing cannot silently expire the prior snapshot.
If this check blocks, no request is made; the reserved journal stays `uncertain`
(model_calls=1 reservation, not a billed-call assertion), without reset/retry.
Post-model health loss invalidates the retained proposal. Sender/tools unchanged.

Historical observer receipts have no recipient/subject for `app_echo` and remain
unknown; no backfill is permitted. The local future extension records a private
sidecar for each new captured inbound / echo in the observer transaction. It uses
the exact scope + raw native address HMAC semantics of `sender_ref`, never the
canonical phone digest. A domain-separated HMAC key tag prevents comparisons
across key rotations. No phone or echo text is stored in the sidecar.

For each later echo (occurred after inbound OR received after capture), the runner
evaluates native recipient / context / edit-revoke original links individually:
`same_subject`, `unknown`, `conflict` block; only proven `other_subject` is excluded.
Time selects the observation window but is never evidence of subject equality.
Unresolved references, multiple native-ID candidates, cycles, key mismatch,
graphs over 1000 nodes or reference depth 16 fail closed. Native reference fields
are optional: their presence in future real deliveries is not claimed by synthetic
fixtures. There is no operator attribution, episode state, resume, or identity link.
Gates repeat after claim immediately before generation and after the model. Any
new uncertainty/mutation or changed input/identity invalidates the proposal.
Absence in received observations never proves absence of a not-yet-delivered event;
this temporary shadow gate must NOT authorize future real sending.

## Exclusive execution audit

`scripts/sql/meta-admin-shadow-once-journal.sql` is a **local review draft**, not an
applied migration. It adds only one private audit table keyed UNIQUE by input UUID.
INSERT/ON CONFLICT claims exactly once; token/status CAS marks `model_started`
durably before the external request. No lease expiry/reset/reclaim/retry exists:
a crash consumes the attempt, even if no model request actually reached OpenAI.
The counter is a conservative reserved generation attempt, not billing proof.
Terminal records retain outcomes/proposals, including invalidated proposals.
Anon/authenticated have no privileges; service_role has restricted column writes,
no DELETE/TRUNCATE or ability to alter input identity/claim token. Global defaults
and all source journals remain untouched. The shadow audit adds no public API.
The separate future-evidence migration adds one service-role-only receiver RPC,
wrapping the existing capture RPC without replacing it or modifying source tables.

The draft was installed only in disposable loopback PostgreSQL for focused tests.
It is NOT installed in hosted DEV or Production. A reviewed journal installation
and a fresh trusted transport-health adapter are prerequisites to any positive run.
There is deliberately no automatic production executable or credential discovery.

## Selected real case: BLOCKED, no model

Input reference `0e58f21db9602fa9` (first capture, 2026-10-08 22:17:40.798651 UTC).
Bridge remains `unmatched/no_exact_identity`. At 22:25:52 UTC there were four later
Admin app echoes, first occurring 22:17:47 UTC (16:17:47 México). At 22:35:15.900522
UTC there were ten. Their author/recipient cannot be attributed from this journal.
The same runner gate evaluated those real metadata and returned
`blocked/later_app_echo_attention_uncertain` before claim or content/model access.
No claim, proposed response, model, sender or production audit row was created.
The input text was not retrieved because the earlier gate already blocks.

Effective model metadata was read without an API key: `OPENAI_ADMIN_AGENT_MODEL`
is `gpt-6-luna`; the selected Admin Agent V2 uses OpenAI, no Anthropic fallback.

## Focused verification (initial shadow diff)

- `node --test tests/metaAdminShadowOnce.test.mjs`: 24/24 PASS.
- `META_CAPTURE_TEST_DEPS=<existing local packages> node tests/metaAdminShadowOncePostgres.mjs`:
  6/6 PASS, including actual SQL snapshot, two concurrent clients/UNIQUE claim,
  crash/no reclaim, uncertain/no retry, echo between claim/model, ACL and cleanup=0.
- All model/transport calls intercepted; zero real model or message calls.
- The first local PG attempt hit sandbox loopback EPERM; permitted local execution
  then exposed a fixture UUID/text cast, corrected only in the synthetic fixture.

Remaining: no natural model PASS is claimed. This selected inbound must not be
forced through its uncertainty gate. No new input is selected automatically.

## Future subject evidence diff and rollout prerequisites (not executed)

- `lib/messaging/metaAdminCapture/echoSubject.js`: private evidence extraction and
  pure per-candidate matcher. No native-address canonicalization/identity lookup.
- `lib/messaging/metaObserver/receiver.js`: one atomic wrapper RPC when capture is
  enabled; failed evidence persistence returns 503, never a partial 200. OFF path unchanged.
- `supabase/migrations/20261008224646_meta_admin_echo_subject_evidence.sql`: private
  installation watermark, append-only sidecars, future-only insert trigger,
  wrapper RPC, explicit ACL/RLS. No global defaults/source journal changes.
- `shadowOncePostgres.js` / `shadowOnce.js`: exact-reference graph, individual
  echo assessments and gates repeated before/after intercepted generation.
- Focused unit and disposable PostgreSQL tests cover signed receiver persistence,
  atomic rollback, ACL/defaults, exact subject/context, conflict/unknown, duplicate
  concurrency, no backfill, no plaintext and proposal invalidation.

Any later rollout must install/review the additive migration BEFORE deploying the
receiver that requires its RPC. No such rollout is authorized by this local diff.
If an older receiver won a receipt, a retry cannot hydrate it; it remains unknown.
Contradictory retries against stored sidecars return 503, retain the original
evidence and require diagnosis; no automatic correction/overwrite is attempted.
No future real delivery, transport completeness or natural shadow PASS is claimed.

### Local verification of the future-evidence extension

- Unit tests: `metaAdminEchoSubject.test.mjs`, `metaAdminShadowOnce.test.mjs`,
  `metaAdminCapture.test.mjs`: **94/94 PASS**.
- `metaAdminEchoSubjectPostgres.mjs`: **11/11 PASS**, using actual local PostgreSQL
  receiver RPCs, same transaction rollback and two concurrent connections.
- `metaAdminShadowOncePostgres.mjs`: **6/6 PASS** for the affected runner adapter.
- `metaAdminCapturePostgres.mjs --phone-digest-only`: **7/7 PASS** for compatibility
  with the existing canonical identity index through the new wrapper.
- Cleanup: **0 synthetic records remaining** in every disposable database.
  Hosted DEV/Production connections: 0. Real model calls/sends: 0.
- Initial local failure: ambiguous SQL alias `m` in the new wrapper's completeness
  check; corrected to `receipt`. Final tests above passed with the correction.
- No commit, merge, deployment, remote migration, backfill or natural runner attempt.
