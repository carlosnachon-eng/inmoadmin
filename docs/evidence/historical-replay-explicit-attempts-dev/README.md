# HISTORICAL_REPLAY_EXPLICIT_ATTEMPTS_DEV_PASS

Date: 2026-09-26.
Target: **inmoadmin-dev / hjfwjnejbcpmknvfpdcq**.
Candidate: `codex/historical-replay-explicit-attempts` at `6f966d5553a17408dc6eb0d8a00ba6c5ca66680b`.

Only the two remaining checks were executed. Previously approved migration/catalog, FK/uniqueness/RLS/grants, Auth/authorization, concurrent idempotency and local certifications were not repeated. Auth login and fixture creation here were setup dependencies, not a repeat of those test suites.

## 1. UI and GET of attempt 2 — PASS

One synthetic original case in `error`, one explicit child, one synthetic administrator and one cohort were created in DEV. No real conversation or identity was used.

- Original case reference: `0e72410725e24b2c`.
- Child attempt reference: `3daff13055bb491c93a1974449af8b53`.
- Creation through the actual UI confirmation action: HTTP **201**.
- Subsequent GET: HTTP **200**, original `error`, child `pending`, attempt number 2, parent reference exactly equal to the original case reference.
- Browser reload showed both articles, visible under the open Historical Replay panel, with separate states and the correct parent reference.
- The pending child had NULL usage and no inherited provider model or privacy receipts.
- No browser exceptions or framework error overlay were observed. The earlier unrecorded UI exception was not reproduced; no product fix was necessary or inferred.

Evidence: [GET projection](pending-get-evidence.json), [original before execution](pending-pending-original.png), [new pending attempt](pending-pending-attempt2.png).

## 2. Independent result — PASS

The UI executed the child exactly once: HTTP **200**, status **completed**.

| Evidence | Original attempt 1 | New attempt 2 |
|---|---|---|
| Status after execution | error | completed |
| Error | synthetic_original_error | NULL |
| Model label | synthetic-original-provider | synthetic-replay-attempt-two |
| Input/output tokens | 17 / 3 (seeded synthetic evidence) | 31 / 7 (synthetic provider response) |
| Privacy receipts | 0 | 1, from the normal verifier/serialization path against the synthetic transport |
| 3B | unmeasured | human_handoff |
| requires_human / auto_send_eligible | unmeasured | true / false |

The complete original row, serialized from the same real PostgREST SELECT before creation and after execution, was **byte-for-byte identical**. Its before/after UI screenshots are also byte-identical (same SHA-256 in the manifest).

GET and UI after reload showed both outcomes separately. The new child referenced the original correctly; no old receipt, model or usage was copied into the child.

Evidence: [original after execution](pending-completed-original.png), [completed child](pending-completed-attempt2.png), [browser state/network statuses](pending-ui-state-completed-after.json).

## Real versus synthetic components

- Real: Next UI, Supabase DEV Auth/session/profile, existing endpoint factory `createHistoricalReplayHandler`, server-side authorization and same-origin checks, DEV RPC, persistence, GET projection and UI rendering.
- The temporary loopback test host loaded the **unchanged endpoint factory from the candidate** at the same route. It used the existing `executeCase` dependency seam to call the **real `executeHistoricalReplayCase`**, supplying only an in-memory test environment and a synthetic `fetchImpl`.
- The real reduced schema, privacy verification, decoder, finalization and 3B functions ran. No operational tools were requested or executed.
- Synthetic: provider HTTP response, provider model label and usage. Exactly one synthetic fetch callback, **zero network calls to Anthropic or any other external provider**.
- `provider_invoked=true` in this fixture's receipt means the **synthetic transport callback** was invoked. It is not evidence of a real Anthropic request. The final payload and serialized-body checks were real code-path checks.
- The local process/runtime gate variables remained false. The existing test dependency used an in-memory environment object for the synthetic executor only; no Supabase, Vercel or Production configuration was changed, and no real provider credential was present.
- Auth, authorization, RPC and DEV responses were not simulated. Unrelated API routes were blocked by the temporary test host; no unrelated features are certified here.
- Playwright already installed on the Mac was reused; the agent-browser CLI was unavailable. Only synthetic fixture article screenshots were retained, not the full authenticated page.

## Cleanup — PASS, zero residues

Deleted only this execution's child attempt, original case and cohort through the authorized DEV connection, with exact IDs and ownership filters. Then signed out the synthetic sessions and deleted the synthetic Auth actor through the official Auth admin API. No protections were disabled.

Final read-only counts: attempts 0, cases 0, cohorts 0, reviews 0, Auth users 0, profiles 0, sessions 0, refresh tokens 0, Auth identities 0. No matching Auth security events were found by the synthetic actor identifiers.

The browser, local server and driver exited. The administrative key, session tokens and generated test password were held only in memory and discarded. The temporary dependency symlink was removed.

## Final state

- Two pending checks completed; driver summary **10 PASS / 0 FAIL**, including their subchecks and cleanup.
- Product HEAD unchanged and worktree clean.
- No product code changes, additional migrations, publication, Preview/deployment, Production operations, real model calls, banking case, outbound, R1 or canary.
- No remaining certification blocker within these two checks.
- This closes the pending portion of the previous partial DEV report; it does not authorize publication or rollout.

The temporary driver/server are not part of this published artifact subset. See [initial certification](initial-certification.md) for the earlier DEV/catalog/Auth/concurrency scope, and `manifest.sha256` for the integrity of these sanitized reports and captures. These artifacts document closed tests; they are not instructions to rerun them.
