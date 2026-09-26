# Historical Replay explicit attempts — Supabase DEV

Closure addendum (2026-09-26): the two pending checks below were subsequently completed without changing the candidate. See [HISTORICAL_REPLAY_EXPLICIT_ATTEMPTS_DEV_PASS](README.md). The original partial report is retained unchanged below as historical evidence.

Date: 2026-09-26. Result: **PARTIAL — NO-GO for declaring the full DEV certification complete.**

Candidate: `codex/historical-replay-explicit-attempts`, HEAD `6f966d5553a17408dc6eb0d8a00ba6c5ca66680b`.
The product worktree is unchanged and clean. Nothing was pushed or deployed.

## Scope and destination

Only `inmoadmin-dev`, project `hjfwjnejbcpmknvfpdcq`, verified ACTIVE_HEALTHY immediately before installation. Database PostgreSQL 17.6.1.155; catalog execution role postgres, not superuser. No Production access, gate changes, real conversations, banking case, provider calls, outbound, R1 or canary.

Previously approved local results remain separate and were not rerun: directed 626/626, suite 1363/1363, local PostgreSQL 35/35, build and diff check PASS.

## Installation and catalog checks — PASS on real DEV

Applied exactly `20260925160512_historical_replay_attempts.sql`, using the official Supabase migration connector. Response: `{"success":true}`. Do not reapply.

Preflight: base tables, original unique constraint, profiles/Auth FK, application roles admin and asesor, required privileges present. New table/functions/indexes absent before installation; no conflicting locks observed.

Post-installation:

- New table `public.shadow_historical_replay_attempts`: 21 columns, RLS enabled, owner postgres.
- 13 constraints, including root-case FK, authorization-profile FK, same-case parent FK, attempt-number and one-child uniqueness.
- Seven indexes, including partial first-child and parent-child unique indexes.
- Two enabled immutable-evidence/transition triggers on originals and attempts.
- Original `UNIQUE(historical_turn_key,evaluation_runtime_version)` unchanged.
- RPC `prepare_historical_replay_retry(uuid,uuid,uuid)` is SECURITY DEFINER, empty search_path, lock_timeout 3s, statement_timeout 10s; only service_role EXECUTE among application roles.
- anon/authenticated have no attempts SELECT/INSERT/UPDATE/DELETE/TRUNCATE or RPC EXECUTE.
- service_role has attempts SELECT and only the certified outcome-column UPDATE grants; no direct INSERT/DELETE, audit-metadata UPDATE or table-wide UPDATE.
- Installed function bodies matched the candidate's source MD5s: prepare `a98b662da799156b90135205f7d6a556`; attempt guard `681910772a7959f556271f322fd6a738`; original guard `aa373be2cbd283b1bd879708e08ed864`.
- Supabase advisor INFO `rls_enabled_no_policy`: expected for this service-only table. No direct application policies were added or protections relaxed.

## Real Auth, endpoint and database behavior — executed

Temporary local Next application from the exact candidate, listening only on 127.0.0.1. Official enabled publishable API key and hidden local capture of a DEV administrative API key. Administrative key only in process memory/server; no secret in repository, browser, logs or this report. Normal HTTPS verification retained.

Two exclusively synthetic Auth actors were created without invitations/email/SMS: active admin and active asesor. Existing Auth trigger created profiles; only the synthetic admin's application role was updated. Both signed in against real Supabase DEV. No Auth, authorization, endpoint, RPC or database response was mocked.

Five synthetic root cases and one synthetic cohort used the existing runtime identifier without a runtime workaround. Two child attempts were created. Old synthetic evidence remained on root rows.

| Check | Observed result |
|---|---|
| UI login and active-admin section | PASS; real login HTTP 200, section rendered, no framework error overlay at that stage |
| Two overlapping prepare_retry HTTP requests | PASS; 201 and 200, identical attempt ID, exactly one child |
| New child evidence | PASS; attempt 2 pending, own result_safe and usage NULL, authorized actor matches |
| Original evidence | PASS; complete PostgREST JSON serialization byte-equivalent before/after child creation |
| Retry from original pending/running/completed | PASS; each HTTP 409 replay_retry_requires_error |
| Retry from pending child | PASS; HTTP 409 |
| Asesor or absent session | PASS; HTTP 403 not_authorized |
| Invalid origin | PASS; HTTP 403 invalid_origin |
| anon/authenticated direct SELECT and RPC | PASS; PostgreSQL 42501 |
| RPC active-admin recheck with asesor actor | PASS; admin_required |
| service direct INSERT/DELETE/audit-metadata UPDATE | PASS; 42501 |
| Attempt to reset root after retry | PASS; replay_original_evidence_immutable |
| Creation via actual UI confirmation button | PASS; HTTP 201 created=true; second child independently confirmed in DEV catalog |

Concurrency evidence is **two overlapping real HTTP requests**, not a claim that pg_blocking_pids or a held lock was measured in this DEV execution. The earlier held-lock test remains local evidence only.

## Uncompleted UI/endpoint verification

The driver failed in stage `ui_retry`, immediately after the actual UI creation returned 201, while waiting to locate the article containing `Intento 2: pending`. It recorded only `unexpected_local_test_error`; the specific browser exception and the subsequent GET response were not retained. Therefore:

- Do not claim a proven application defect or a proven Supabase defect.
- The child's database existence, status pending, empty separate telemetry and parent linkage were verified independently by read-only SQL.
- Display of the new child and parent link in the real UI remains unaccredited.
- The planned blocked/synthetic execution of that child, separate outcome telemetry and final GET/UI outcome comparison were **not executed**.
- No execute_one was made; no model was invoked or simulated. No tools, natural runs or human ratings were created.

These are the concrete remaining certification steps. No product code was changed to manufacture PASS, and the failed UI check was not retried.

## Cleanup — completed and verified

The driver's stdin was closed by the non-PTY process launcher, so its cleanup acknowledgement could not be delivered. Cleanup was completed through the already authorized DEV SQL connector, using explicit synthetic IDs and ownership filters, without disabling triggers, RLS or audit protections.

Deleted only this execution's two child attempts, five root cases, one cohort, and two synthetic Auth users plus their dependent profiles/sessions/identities/refresh tokens. The legitimate migration remains installed.

Final read-only counts: attempts 0, cases 0, cohorts 0, Auth users 0, profiles 0, sessions 0, refresh tokens 0, Auth identities 0. No matching Auth audit events were found by the synthetic actor IDs/usernames. No unrelated data was changed.

Browser and loopback server were closed. The specific remaining temporary driver process was terminated, discarding its in-memory credential. Its temporary node_modules link was removed. Candidate HEAD and clean product worktree reconfirmed.

## Integrity manifest (SHA-256)

| Artifact | SHA-256 |
|---|---|
| Candidate migration | `3a34fb16b1f2aa9bfec12214f78aa3669b578e7d1dfd613723457fe495592ecc` |
| Temporary DEV driver run.mjs | `9b1eecd637ba0e5810a7b09049bd3e6e53ec086bb05dadd956f3698fe9edf67b` |
| Temporary loopback server.cjs | `8fcf0cf43a0132c5458952d1ea75da46652e2a8c3fa97c431519c05c6bb0493d` |
| Hidden local capture.jxa | `7fad946ef331e460aac2e8f9443101a49b34f7d98f16a75c07bdc4f515a0358d` |

Temporary package retained at `/private/tmp/replay-attempts-dev.UrjcLM`. No administrative credential, password, session or token is stored there. Do not rerun its complete driver as if these completed checks were pending.

## Decision

Installation/catalog/security and real retry creation/concurrent idempotency: PASS within the observations above.
Full DEV endpoint/UI certification: **PENDING / NO-GO for declaring complete** until child display and its independent blocked/simulated result are accredited. No publication or deployment occurred.
