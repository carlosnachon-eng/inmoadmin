# Instagram manual DEV — deployment and remaining real-test gates

Verified 2026-10-12 06:08:06 UTC (00:08 Mexico). Supersedes the previous report's not-deployed status.

## Deployed

- Project: `emporio-instagram-observer-dev` / `prj_SaVgfFB5j4ucvmmQXqAOBkXBnc9Q`.
- Team: `team_nFiHWu1EoYRlSsoIUFnJPupd`.
- Deployment: `dpl_5XRaYmyALnkQ7V664qjjADmb8C2D`, **READY**, staging/Preview only.
- Ready UTC: `2026-10-12T06:04:38.112Z`.
- URL: https://emporio-instagram-observer-6s0kfpfei-carlosnachon-engs-projects.vercel.app
- Public webhook alias unchanged: `emporio-instagram-observer-dev-carlosnachon-engs-projects.vercel.app/api/webhooks/instagram`.
- Manual route: protected deployment hostname + `/api/manual/instagram`.
- Native isolated-runtime source: `/private/tmp/instagram-observer-isolated`.

Preview-only dedicated AES-GCM key provisioned as Secret. Existing Social Page credential reused by name, not extracted. Capture flag true; manual sender flag **false**; no input allowlisted.

## Binding and source boundaries

AEAD binds Social app + expected Page + Instagram account + `instagram_dm` thread fingerprint + HMAC subject + native message + observation key. Both encryption and decryption reject mismatched supplied app/Page/account/thread. Recipient remains encrypted in the private journal target table, never returned by the operator endpoint. Future signed inbound only; no backfill.

Shared manual validation extracted without behavior changes from the existing Meta Inbox module, avoiding bundling the WhatsApp sender into the isolated deployment. The WhatsApp manual regression tests still pass.

## Certification

- **101/101** focused repository tests PASS (including binding tamper and unchanged manual validation behavior).
- **14/14** isolated-runtime tests PASS (receiver, protected host boundary, authenticated role, injected recipient rejection, encrypted capture RPC).
- Local PostgreSQL PASS: independent-session concurrency yields one winner; real RPC + runner with Graph mocked; pause before dispatch; terminal failure/no replay.
- Hosted DEV SQL fixtures PASS including stale window, contradictory native-thread observations, ACL/RLS, append-only journal, unique action/input, no historical retrofit and exact echo status. All fixtures rolled back.
- At final cut: targets/actions/pauses/manual events = **0/0/0/0**.
- Hosted simultaneous concurrency not independently tested; local concurrency is certified.

No new migration in this turn. Existing DEV migration `20261012055251_instagram_manual_sender_dev_v1` remains unchanged, source and ledger SHA-256:

`d3c1e6e42240f05f1e9404c70efe58051ae3373be193024e3188ab64d4a74e7f`

## Hosted HTTP checks

- Anonymous webhook GET without challenge: **403** (expected validation refusal).
- Manual route on public webhook alias: **404** (not exposed).
- Manual route on immutable protected hostname: **302** to Vercel authentication (expected).
- Protected authenticated application path not yet certified end-to-end: automated temporary bypass was rejected by tool policy; no bypass was created. Existing Chrome-session navigation also returned `net::ERR_BLOCKED_BY_CLIENT`. No extension/protection changes made.
- Manual route additionally requires an actual Supabase DEV user session and current Admin/Operations profile; Vercel Authentication alone is deliberately insufficient. No Production session reuse, service-role impersonation or automatic claim.

## Remaining real test

1. A new DM after rollout from the permitted test account, then verify its encrypted target and exact source. None arrived by the cut.
2. Authenticated Admin/Operations session in Supabase DEV, without sharing tokens in chat; complete authenticated endpoint verification.
3. Verify tester eligibility/current Meta access and enable only the exact accredited input for the one manual action. Default remains OFF until then.
4. Send one explicit manual response, inspect terminal outcome and Respond. Never retry uncertain outcomes.

Real reply: **NOT_ATTEMPTED**, not accepted/failed. Models **0**; sends **0**; no business writes. Respond, routing, subscriptions and Production unchanged.
