# Approved Materials v1 — Owner Agent

Scope: independent branch `codex/owner-approved-materials-v1`, based on `main` `30beba05a1a53741915137c2e65066a547f5ed98`. No PR160 code, routing, handoffs, assignment, cron changes, model tools or prompt changes. No live provider requests, remote SQL, uploads, environment changes or deployments performed.

## Approved source files

`owner-approved-materials-assets.json` pins the exact bytes approved by the user. Both original PDFs were opened/rendered (4 pages each), visually inspected and hashed, without alteration. The user explicitly approved the iCloud rental PDF as the replacement for the previously supplied, different rental hash. No PDFs generated, copied into the repository or uploaded to any bucket. Registration/validity dates remain an operator step before activation.

## Audit and reuse

- Reuse existing Owner capture, `processOwnerInboundById`, inbound/run/text-outbound identity and Respond channel transport. No new router/CRM/scheduler/round robin.
- Existing private Supabase evidence download/upload patterns support controlled objects. Legacy `documentos`/property public URLs and private conversation attachments are NOT reused as promotional assets.
- Existing Owner has no authoritative durable conversation-stage entity. V1 explicitly uses the stable server-owned stage `owner_service_introduction_v1` per Respond contact, not a model label, inbound ID, time window or version. This is intentionally conservative: one copy of each material per contact during service introduction; it never resets automatically. A later-stage resend requires separately reviewed future support, not a retry/reset of this evidence.
- `es_exclusiva` alone is not proof of an active signed exclusive contract. Current Owner context cannot independently establish both residential + exclusive contract conditions. Runtime always uses the conditional guarantee. The pure renderer supports both verified conditions, but the automatic processor does not invent those verifications.

## Flow

```text
Existing Owner inbound/claim/model/text reply (unchanged with flag OFF)
  → ON: deterministic material selector + conditional guarantee/ambiguity guard
  → persisted successful existing text receipt
  → atomic reserve(contact, introduction stage, material code); pin active version
  → read private PDF; verify size/signature/hash
  → atomic one-shot claim; recheck approval, human reply, newer inbound and 24h window
  → one Respond message: PDF (WhatsApp/Messenger) or temporary link (Instagram/TikTok)
  → sent receipt OR blocked/uncertain audit, never automatically resent
```

No document/URL is supplied to the model. URLs are produced after its response; model-generated URLs are not used. Selection is deliberately conservative/current-message-only: rent/admin → rental PDF, sale → sale PDF, multiple/negated/uncertain intents or unspecified material request → one clarification and no file. Ordinary unclassified follow-ups do not invent intent or start another stage.

## Provider contract and capabilities

Official sources consulted:

- [Respond Files channel matrix](https://respond.io/help/workspace-settings/files): WhatsApp documents and Messenger PDF; Instagram/TikTok do not accept PDF as native document. Respond's generic unsupported-file URL fallback is not used.
- [Respond official Developer API SDK types](https://github.com/respond-io/typescript-sdk/blob/master/src/types/message.ts): `message.type=attachment`, `attachment.type=file`, `attachment.url`; send response has `messageId`. No SDK automatic retries used: a single explicit fetch with 15s timeout and redirects rejected.
- [TikTok channel limits](https://respond.io/help/tiktok/tiktok-overview): channel messaging quotas/window still apply; no new channel connected. V1 uses a conservative 24h inbound age ceiling for all channels and no templates/re-engagement. Provider-side quotas/permissions still require channel QA before enabling.
- [Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals) and [Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn): storage remains private; a dedicated signed HMAC capability is served by the app instead of redirecting to a cacheable Storage URL. The endpoint reads only the delivery's version and verifies bytes, active approval, validity and one-hour expiry. `Cache-Control`, CDN and Vercel CDN are `no-store`; `Referrer-Policy=no-referrer`; inline PDF, no bucket listing. The feature gate OFF also closes these links.
- [Supabase changelog](https://supabase.com/changelog) reviewed; explicit grants and RLS used, no library/dependency upgrades committed.

These are documented capabilities and synthetic transport tests, not a claim of delivered PDFs in a real Respond account. Clients/providers can retain a PDF already downloaded; expiry is not DRM and cannot recall downloaded bytes. Forwarding a still-valid institutional link permits access until expiry. Access-log/query-token handling must be reviewed before rollout; the application never logs/persists generated URLs or free provider errors.

## Storage/schema/permissions

Proposed migration: `supabase/migrations/20261002044903_owner_approved_materials_v1.sql`, generated by Supabase CLI. **Not applied to Supabase DEV or Production.**

- Private bucket `owner-approved-materials`, PDF only, 10 MiB cap. Restrictive policy excludes anon/authenticated even under an older broad permissive object policy; no public URLs or direct-client policies granted.
- `owner_approved_material_versions`: code/version unique, one active version per code (partial unique index), immutable hash/object/approval/validity. New version approved by an active DB admin. Upload uses content-addressed path and `upsert:false`; unchanged bytes may be reapproved as a new version without modification. Versions start inactive; explicit atomic activation switches only active booleans. Version expiry required. No CMS/public registration route.
- `owner_material_deliveries`: FK to immutable version, existing inbound and run; contact/channel/stage, mode, reservation/dispatch/sent/completion timestamps, safe fixed error, provider message receipt. Unique contact/stage/material independent of version. No deletion grant; terminal status cannot be reset. No URL, provider body or credentials stored.
- Three `SECURITY INVOKER` RPCs (service-role only): activate version, reserve, claim. Short advisory-lock transactions plus unique constraint; no external I/O inside a DB transaction. RLS on both new tables, no anon/authenticated grants. Service role has SELECT/INSERT and limited-column UPDATE, no DELETE. Triggers preserve immutable evidence and require correct run/contact/channel plus a persisted successful Owner text receipt before reservation.
- Existing tables/data are not backfilled, rewritten or deleted. New references deliberately restrict deleting referenced history after a material is sent.

Read-only catalog postcheck: `supabase/postchecks/owner_approved_materials_v1.sql`.
Rollback: flag OFF immediately blocks new material sends/downloads; existing Owner behavior remains unchanged. Retain audit/versions. Separate `supabase/rollback/owner_approved_materials_v1_empty_only.sql` refuses removal if any approved version, delivery or object exists; never auto-run. No historical destructive rollback.

## Delivery semantics

Atomic reservation + one-shot claim means at most one application dispatch per contact/stage/material. It is NOT an assertion of provider exactly-once delivery. If fetch fails, times out, is rejected or its response/DB write is uncertain, the reservation remains consumed (`uncertain` or `dispatching` if audit persistence itself failed). No second message or automatic takeover, even on inbound retry, a new version or process restart. Operator reconciliation is required, not clearing the uniqueness key.

The existing normal Owner text is separate from the material message. A material is sent only after its text receipt persists. Failures/supersession/human response paths do not send a PDF. No claim is made to redesign the existing general Owner model/session recovery logic.

`sent` records the successful Respond API acceptance (`messageId`), not independent recipient delivery/read confirmation. No receipt polling or automatic replay is introduced.

## New configuration (not set anywhere)

- `OWNER_APPROVED_MATERIALS_V1_ENABLED=false` (default; exact `true` required).
- `OWNER_APPROVED_MATERIALS_ORIGIN`: approved HTTPS canonical app origin; no credentials/path/query/IP/localhost.
- `OWNER_APPROVED_MATERIALS_LINK_SECRET`: separate server-only random secret, minimum 32 characters. Never `NEXT_PUBLIC`, never checked in.
- Existing Respond server token reused; no new Respond workflow or credentials.

Branch-specific Vercel Preview exclusion only. Crons and all other rules unchanged.

## Certification and limits

All tests are synthetic. See final result artifact for exact counts. Source PDF local hash checks PASS. Focalized tests cover rent/admin/sale, ambiguity, real Owner processor OFF/ON with injected provider boundaries, byte checks, duplicates/concurrency, active version, expiry/tampering, channels, guarantee qualifiers, traceability, fixed safe failures, permissions and denied conversational-attachment paths.

Local PostgreSQL harness uses a temporary loopback cluster (not Supabase). Real independent connections prove reservation contention and one claim; catalog/ACL/RLS, immutable evidence, current version, expired/superseded/human contexts, unauthorized roles and broad legacy Storage policy denial are checked. The temporary cluster is stopped and removed. No remote fixtures exist.

Full suite has **three independently reproduced pre-existing failures on pristine base `30beba0`**; do not label the entire suite PASS:

1. `tests/respondWebhookMultiHmac.test.mjs`: data-URL test harness leaves newer `agentsV2/*` imports unmocked; `ERR_UNSUPPORTED_RESOLVE_REQUEST`.
2. `tests/shadowAiP3.test.mjs:591`: expected 18 tools, current base exposes 19.
3. `tests/shadowReducedOutputSchema.test.mjs:59`: expected 4355 schema bytes, current base is 4383.

None of those source/test files changed. Fixing them is outside this material delivery scope; no weakening/skipping of those assertions. Build succeeds with synthetic loopback Supabase configuration. Installation warns of the existing deprecated/vulnerable Next 14.1.0 dependency and deprecated auth helpers; no dependency upgrade included.

## Pre-rollout / remaining review

1. Review this separate PR; do not merge/activate automatically. Reconcile the three baseline test failures separately before claiming global green.
2. Authorize DEV migration/catalog/grant postcheck and Storage certification independently. Local PG does not certify real Storage gateway ACL or real DEV Auth.
3. Register the two exact approved PDFs with a real active admin, explicit approved validity dates, and immutable versions; verify bytes again. Activate versions transactionally. No upload done during this change.
4. Configure a DEV-only origin/signing secret and synthetic Respond QA transport. Certify document rendering and link expiry/no-cache on each connected channel, MIME headers, provider quotas and bot fetches. No real customer message without separate authorization.
5. Confirm production gates remain unchanged/OFF for this feature. Any future flag ON/SQL/upload/deployment is a separate authorization.
6. Merge compatibility with PR160: both touch the Owner processor. Preserve its continuity and appointment protection; this PR has not imported or modified PR160.

Decision: suitable for code review only, **NO-GO for production activation** until those checks/approvals close.
