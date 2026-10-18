# Instagram DM manual sender — DEV certification

Date: 2026-10-12 UTC / 2026-10-11 Mexico. Base: `7f4f053`.

## Result and limits

- 84/84 focused JavaScript tests PASS (sender, receiver, thread boundary).
- Local PostgreSQL PASS: ACL/RLS, append-only, idempotency, terminal states, pause before dispatch, exact echo status. Independent sessions: one reservation winner and one dispatch winner.
- Real runner + real local RPCs + mocked Graph: PASS, HTTP failure persisted terminally, no replay.
- Hosted Supabase DEV functional/ACL/RLS PASS with rolled-back synthetic fixtures. Targets/actions/attention/events remaining: **0/0/0/0**.
- Hosted simultaneous concurrency **not certified**; local independent-session concurrency certified.
- Real Graph sends: **0**. Models: **0**. Business writes: **0**. Respond/Production untouched.
- No sender deployment or activation performed. No new permission, App Review, routing or subscription change.

## DEV database

Project: `hjfwjnejbcpmknvfpdcq` only.

Applied ledger: `20261012055251_instagram_manual_sender_dev_v1`.

Source: `scripts/sql/instagram-manual-sender-dev.sql`.

SHA-256 source **and actual ledger statement**, byte-for-byte:

`d3c1e6e42240f05f1e9404c70efe58051ae3373be193024e3188ab64d4a74e7f`

Private tables: encrypted targets, manual actions, attention, append-only events. No direct service-role table access; no public/anon/authenticated execute. Seven fixed service-role-only RPCs:

1. `observe_instagram_manual_dev_v1` — durable metadata + encrypted future target atomically.
2. `instagram_manual_load_dev_v1` — authorized server evidence for one input.
3. `instagram_manual_reserve_dev_v1` — unique action AND input; pause in same transaction.
4. `instagram_manual_start_dev_v1` — recheck role, exact source, 24h window; one dispatch winner.
5. `instagram_manual_finish_dev_v1` — append terminal accepted/failed/uncertain, no overwrite/reclaim/retry.
6. `instagram_manual_status_dev_v1` — sanitized journal status, no recipient/token/text/native IDs.
7. `instagram_manual_attention_dev_v1` — durable subject pause, no resume operation.

This reuses the Inbox reservation/attention pattern rather than putting Instagram in the WhatsApp-specific journal. Shared actor authorization, text validation, same-origin check and error sanitization are reused unchanged. The Instagram transport/payload is separate.

## Safety boundaries

- `/api/operaciones/instagram-inbox-manual-dev`: authenticated existing Admin/Operations authorization; DEV database only, rejects Production before auth/DB. Manual POST accepts exactly `input`, `action`, `text`. No recipient/thread/actor supplied by UI.
- Exact expected IG and Page; target authenticated with AES-256-GCM AAD binding account, DM type, observation key, native message and HMAC subject.
- Future capture only after Social HMAC validation. Old app secret not accepted. Capture disabled by default. Metadata-only historical events cannot be retrofitted by replay.
- No comments/mentions/echoes may acquire a recipient. No identity or private context supplied to this manual sender.
- One authorized input in environment, one action attempt/input, no retries. A failed/uncertain action cannot be reused; no unlock endpoint.
- A reserved action always pauses the subject before Graph. Crashes/uncertain results keep the pause; there is no automatic resume. Any future Instagram AI dispatch must consult the attention RPC; none is enabled here.
- `accepted` is Graph acceptance, not delivery. `sent` requires a signed exact matching echo on native message ID + subject + account. No delivered/read claim or new subscriptions; both marked unsupported in this version.
- Historical native message IDs are not used for approximate matching or Respond lookup.

## Official transport requirements checked

Source: [Meta — Send messages (Instagram Messaging)](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/send-message), inspected in authenticated browser; page updated July 2, 2026.

- Facebook Login modality: `POST graph.facebook.com/v26.0/{PAGE_ID}/messages`, Instagram-scoped recipient ID from inbound, Page access token with **MESSAGE** task and `instagram_manage_messages`.
- This documentation does not require `pages_messaging` for this Instagram route. No extra permission was requested.
- Standard Access restricts sends to people with an app role. The test recipient role and Page task must be independently accredited before real dispatch. App Live and successful inbound alone do not certify outbound access.
- Conservative text limits: <1000 characters and <=1000 UTF-8 bytes.

## Not yet ready for a real reply

The certified historical DM has only a HMAC subject, not a recoverable IGSID. It remains blocked; no heuristics/backfill.

Before a separately authorized real reply:

1. Review/deploy the capture adapter to isolated DEV and the authenticated manual route to the intended DEV operator runtime, never the public webhook route. This turn did not expand the isolated deployment with an admin API.
2. Provision a dedicated `INSTAGRAM_MANUAL_RECIPIENT_KEY` as Preview Secret; enable `INSTAGRAM_MANUAL_CAPTURE_ENABLED` in DEV only. Existing Social HMAC/secret remain server-side.
3. Capture one future signed customer DM. Confirm same thread, role-eligible tester and service window.
4. Reuse **`SOCIAL_INSTAGRAM_PAGE_ACCESS_TOKEN`**, the existing Preview credential name, without extracting it. Ensure it is available in the chosen DEV operator runtime through a separately reviewed secure provisioning path. Do not pull/copy secrets to local files.
5. Verify the Page token MESSAGE task and effective `instagram_manage_messages`; if Advanced Access/App Review is required, stop before requesting it.
6. Explicitly set `INSTAGRAM_MANUAL_AUTHORIZED_INPUT` to that observation key and `INSTAGRAM_MANUAL_REPLY_ENABLED=true` in DEV only. Default remains OFF. Review the exact manual text, then perform one explicit human action.

No claim that provider accepts sending has been made without a real authorized test.

## Reproduction

JavaScript: `node --test tests/instagramManualSender.test.mjs tests/instagramObserver.test.mjs tests/instagramThreadBoundary.test.mjs`.

PostgreSQL: set `IG_PG_DEPS` to a disposable directory containing `pg`, and `IG_PG_BIN` to PostgreSQL binaries, then run `node tests/instagramManualPostgres.mjs`. The script creates/drops only its own local ephemeral DB, mocks Graph and never reads remote credentials.

Hosted: `tests/instagramManualDev.sql`, only against the DEV project, all fixtures inside rollback. It uses an existing authorized DEV actor without exporting identity data.
