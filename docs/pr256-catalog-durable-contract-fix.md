# PR #256 — catalog and durable acknowledgement correction

Runtime commit: `3c8b19bfd81252cd1d73c7cbd62b4b0218636e9e`.

## Changes

- Map the inventory contract `sale` / `rental` to public copy `venta` /
  `renta mensual`. Unknown values still fail closed. Do not accept old test-only
  `venta` / `renta` as inventory enum values.
- Instagram evaluation requires capture acknowledgement `inserted: 0|1` and
  evaluation acknowledgement `recorded|unchanged`. Missing, stale, consumed,
  malformed or unknown acknowledgements cannot produce a successful evaluation.
- Closed diagnostic vocabulary adds `capture_not_recorded` and
  `evaluation_not_recorded`. No upstream messages, identifiers or values exposed.
- Correct synthetic inventory adapters to the real enum contract.
- No migration, access-control, cipher, sender or publishing changes.

## Verification

- 120/120 focused JS tests PASS. Sale and rental tested on both platforms;
  unknown operations and malformed acknowledgements rejected without retries.
- Disposable PostgreSQL: 30 review checks + 16 association checks PASS.
- Integrated signed bridge with real local RPC/encryption: association once,
  reevaluation, approval, replay rejection and reload persistence PASS.
- Real PostgreSQL rejection of a deleted event returns HTTP 503 with
  `evaluation_not_recorded`; previous approval is preserved and actions remain 0.
- Meta/Auth/inventory responses are mocked in that integrated fixture; this is
  not new Meta certification. The legacy isolated journal suite tests one
  synthetic claim/start; no real dispatch or remote sender enablement occurred.
- Next build PASS, 81 pages, synthetic public build configuration. Initial local
  attempt without public Supabase build configuration failed; rerun used no keys.

## DEV/Preview

- Corrected observer Preview READY: `dpl_E7Uxm4yGthLAUPEDYcDPN8yjKicY`.
- Inmoadmin Preview READY: `dpl_7h8iVAJcheAYBDwys8kMt2pCiM4v`.
- Updated only the non-secret COMMENT_REVIEW_BRIDGE_URL scoped to
  `codex/comments-observation-approval` Preview. Production unchecked; no secrets
  changed. New destination is the corrected isolated observer Preview.
- Authenticated Admin UI read and evaluation work through that bridge. Instagram
  returned 0 processed / no reviews: this only certifies the empty remote path.
- Real component UI QA with synthetic sale/rental proposals: desktop approval,
  390px CSS viewport rental approval and retained state PASS, 2 memory-only
  approvals, 0 sends. This is not remote durable approval or physical phone QA.
- Authenticated Preview was also inspected at 400px browser device emulation.
  Populated remote Instagram approval was NOT repeated in this run. Do not label
  the entire populated remote/mobile flow certified based on the empty view.
- Browser showed 503s on unrelated Messenger names/read-state and 404 on the
  direct Instagram endpoint; these were not changed or diagnosed in this task.

## Evidence and cleanup

Local screenshots: `/private/tmp/pr256-contract-desktop.png`,
`/private/tmp/pr256-contract-mobile.png`,
`/private/tmp/pr256-contract-preview-desktop.png`,
`/private/tmp/pr256-contract-preview-mobile.png`.

Only local disposable synthetic databases and memory-only UI data were used.
No remote fixture rows were inserted. PostgreSQL fixture cleanup runs in finally;
memory-only UI fixtures disappear when its process stops. Remote evaluation may
leave its normal replay-protection nonce; preserve this security journal.
DEV query confirmed zero enabled commercial-comment senders. No publications,
merge or Production access. General batching, CRM opportunity creation and Meta
publishing certification remain outside this bounded fix.
