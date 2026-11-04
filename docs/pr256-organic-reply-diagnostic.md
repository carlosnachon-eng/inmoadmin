# Organic Facebook reply-state diagnosis — DEV only

2026-10-21, PR #256. Authenticated Admin Preview, isolated Comments DEV connection. No journal evaluation/approval or send invoked during this diagnosis.

## Confirmed cause

The unchanged `inspectMetaComment` reader requires `node.comments.data` from the expanded comment node. Meta returned HTTP 200 but omitted that expansion. `Array.isArray(replies?.data)` was false, causing `reply_state_unverified`. No token, permission, owner, comment membership, parent or decryption failure occurred in the observed reads. Why Meta omits this expansion is not established; it must not be interpreted as an empty reply list.

## Read-only evidence

- Owned publication: HTTP 200, exact ID and Page owner match.
- Post comments membership: HTTP 200, 100 rows, exact target once. A next page exists, but exact membership is already proved; no claim about exhaustive post comments is made.
- Exact comment node: HTTP 200, ID match, no parent, not hidden, expanded comments absent.
- Separate `GET /v26.0/{bound_comment}/comments?fields=id,from&limit=100`: HTTP 200, `data` array, zero replies, no next page.
- Result: `verified_separate_edge`, `replies_verified=true`, `page_replied=false`, `binding=true`, `writes=0`. This is a point-in-time public reply check, not evidence about private messaging or future replies.

The diagnostic uses the unchanged reader first, and only when its reply verification is incomplete reads the separate edge. It never follows paging URLs or accepts native IDs from the UI. It requires exactly one organic captured event, existing Admin/Gerencia authentication, exact DEV configuration and token health. It exposes only status, numeric errors, counts and booleans.

## Safety and tests

- 106/106 targeted tests PASS, including omitted expansion, complete reply edge, missing authors, membership failure, parent presence, Graph errors and no sensitive-value exposure.
- Sender OFF; actions=0; audit count unchanged at 2. Existing evaluation remains escalated, not rewritten by diagnosis.
- No Production, Meta permissions, credentials, receiver callback, publishing, merge or response changes.
- DEV review function v11 ACTIVE, JWT verification retained.
- Screenshot: `docs/evidence/pr256-review/organic-facebook-reply-diagnostic.png`.

Next code change, not applied here: have the commercial reader verify replies via the separately documented edge when expansion is absent, retaining exact membership and fail-closed pagination/identity checks. Property attribution remains independently unverified.
