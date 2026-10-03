# Approved Materials v1 — DEV / Storage certification

**APPROVED_MATERIALS_DEV_STORAGE_PASS** for the scope below, 2026-10-02.

Target: `inmoadmin-dev / hjfwjnejbcpmknvfpdcq`, healthy PostgreSQL 17.6.1.155. Source HEAD `b065db3e0e525ac6b1c12bca99798a74ffce262e`, PR #161. This supersedes only the earlier DEV/schema/Storage-pending evidence; it does not certify real PDFs or Respond delivery. Feature flag remained OFF; no hosted environment variable changed. No production, model or Respond request, merge or deployment.

## Migration and catalogue

Preflight proved dependencies present and this migration's tables, functions, policy and bucket absent. Applied only repository file `20261002044903_owner_approved_materials_v1.sql`, unchanged.

The Supabase MCP migration service recorded **DEV version `20261002144840`**, name `20261002044903_owner_approved_materials_v1`. Stored SQL SHA-256 and repository bytes both equal `18651948ed9cafd703d42fff6034dfb8dcc3d06bb39bbbfb646c52a9eb309b14`. This ledger-version mapping is explicit; do not replay the migration because the filename timestamp differs. No ledger repair, additional migration or schema/grant change was performed.

- Both tables have RLS; 26 constraints validated, 4 FK, 9 valid/ready indexes, 2 enabled guards.
- All 3 RPCs are SECURITY INVOKER, empty search path, callable only by service_role/owner.
- Service role has SELECT/INSERT, only `active` UPDATE on versions and the seven documented result/timestamp UPDATE columns on deliveries. No table-wide UPDATE, DELETE or TRUNCATE.
- No anon/authenticated table or column privileges. Their real query/RPC attempts were denied.
- Bucket `owner-approved-materials`: private, PDF-only, 10 MiB; restrictive Storage policy for anon/authenticated is intact.
- Security advisor reports INFO `rls_enabled_no_policy` for the two new tables: intentional server-only design, with client grants revoked and service_role BYPASSRLS verified. No client policies were added to silence the notice.

## Functional certification

19 DEV SQL groups PASS under the actual service_role/anon/authenticated roles, using synthetic users, versions and Owner context. Tested admin-only approval, version activation/replacement, one-shot reservation/claim, uncertainty preservation/no retry, no re-claim after interrupted dispatch, immutable capability, version-independent deduplication, human/newer-message blockers, missing text receipt, Admin-channel exclusion, document/link mode constraint, one-hour DB expiry, and minimum ACL. The entire first fixture transaction was rolled back and read-back confirmed no residue.

A separate committed fixture proved one reservation across repeated requests, exactly one claim, persisted `uncertain` with `material_delivery_uncertain_requires_review`, no provider receipt, and byte-for-byte unchanged evidence after another reserve/claim. Cleanup removed only its recorded synthetic dependencies.

**Concurrency limitation:** the two submitted DEV reservations did not overlap at PostgreSQL (timestamps in JSON). They prove duplicate suppression, not a new contention test. Do not relabel this as a DEV concurrency PASS. Real concurrent lock/claim contention remains covered by the previously certified isolated PostgreSQL 27/27 harness; no product failure was observed.

## Storage / HTTP certification

23 checks PASS using the real DEV Storage and Auth endpoints, with a hidden-input DEV secret kept only in process memory. Requests were pinned to the exact DEV origin, with redirects rejected. One unmistakably synthetic PDF-header fixture was uploaded (not an approved institutional PDF), downloaded byte-exactly, and removed.

- Duplicate upload without upsert rejected.
- Public retrieval denied.
- Anonymous and real authenticated synthetic user: download/upload/signing denied; no listing exposure; both material tables denied through PostgREST.
- Service-generated 3-second Storage capability retrieved the fixture, then failed after expiry. No URL or token persisted in evidence.
- This is a Storage capability test, **not** certification of the application HMAC download route with the feature ON. That route and real per-channel delivery remain for the next authorized phase.
- 28 DEV HTTP requests, zero non-DEV attempts, zero Respond/model calls; no automatic retries configured.

## Cleanup / scope boundaries

Final independent SQL read-back: **0** material versions, deliveries, Storage objects, synthetic Auth users/profiles/sessions, fixture Owner inbounds/runs/text-receipts/snapshots. Synthetic SQL actors were transactionally rolled back or deleted by exact fixture identity. The authenticated Storage actor was globally signed out and deleted through Auth Admin. Normal platform audit logs are not deleted.

The intentionally retained resources are exactly the migration history and new empty schema/RPC/index/trigger/policy/bucket. No real PDFs were read/uploaded, no material active version remains, no customer message was generated, no Production access occurred, and no code or gate was changed. The SQL artefact itself is unchanged from local certification.

Remaining: controlled loading/verification/approval of the two exact PDFs and QA of the real document/link transport per channel, under separate authorization. No merge or activation approval follows from this result.

Machine-readable evidence: `owner-approved-materials-dev-storage.json`.
