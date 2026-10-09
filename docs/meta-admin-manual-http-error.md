# Manual Meta HTTP error persistence

Authorized rollout: additive migration installed before runtime deployment. No message executed.

- Manual transport opts into a sanitized projection; automatic callers retain their existing result contract.
- Persist only HTTP status, integer code/subcode, allowlisted exception type, sanitized message/details.
- Recognized provider prose is preserved. Unknown prose is redacted entirely rather than risking names, addresses, request echoes or other PII. This can limit textual diagnosis; numeric codes remain available. No claim of preserving every original description.
- Token, recipient, input text, native input ID, headers, request body and raw response are never persisted as diagnostics. Optional fbtrace_id is omitted.
- HTTP non-JSON failures retain their status with null error fields and remain uncertain. Network failures have no invented HTTP status.
- A new service-role-only finish RPC atomically inserts the terminal outcome and error in the existing private append-only journal. It uses the same action/token/start evidence and outcome uniqueness. No retry/reset/reclaim or attention changes.
- No new UI/API diagnostic exposure. Authorized DB inspection can read the narrow error column after a future human action.

## Verification

23/23 focused JS tests; 16/16 local PostgreSQL assertions, including two independent sessions. DEV real RPC/ACL/RLS, persistence, replay, unknown outcome and pause PASS; fixtures rolled back, cleanup 0. Hosted simultaneous concurrency not repeated; local independent-session concurrency PASS. Real sends/models 0.

Migration: `20261009185126_meta_admin_manual_http_error.sql`.
SHA-256: `ad0b0e1580070385e0cd12e8835af020da6ee2870f605cf7845be3240bf77bd9`.
DEV ledger: `20261009185138` (exact SHA verified).

## Rollout order

1. Generated timestamped migration using Supabase CLI; identical to `scripts/sql/meta-admin-manual-http-error.sql`; DEV certified.
2. Install the additive column/check and restricted RPC before deploying the runtime change.
3. Deploy; do not change outbound flags or invoke any sender.
4. A human explicitly submits a NEW manual action once. Never replay the prior failed action. Inspect its terminal journal; accepted is not proof of delivery.

Existing historical failures cannot acquire metadata that was discarded. Rolling back runtime code leaves the additive column/RPC and evidence intact.
