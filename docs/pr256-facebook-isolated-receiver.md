# Facebook comment evaluation and isolated DEV ingress

## Latest verified state (2026-10-21)

- Meta accepted the isolated callback challenge. App-level Page `feed` v26.0
  is the only subscribed field. With the new app's Page token, the subscription
  POST returned `success:true`; a subsequent GET identified app
  `2220237475209417` and exactly `subscribed_fields:["feed"]`.
- Page token identity was verified in Graph Explorer as Page
  `119960324707764`, EMPORIO INMOBILIARIO. The preceding user-token permission
  read showed pages_show_list, pages_manage_metadata, pages_read_engagement
  and pages_read_user_content granted. This is not backend token introspection.
- Owner saved `FACEBOOK_COMMENTS_DEV_PAGE_ACCESS_TOKEN` in the isolated DEV
  project's Edge Function Secrets (dashboard timestamp 2026-10-21 22:59:45 UTC).
  Only presence/metadata were inspected; no token value was retrieved.
- Remote function is ACTIVE and its source digest still matches the receiver
  deployment. This receiver does not read the Page token; no authenticated
  backend credential-health operation is implemented for this isolated app.
- Read-only DB check confirms the dedicated connection is inactive and its
  sender is false. Do not claim capture readiness or backend token-health PASS.
- Privacy URL was saved; Meta's publishing checklist says required app
  configuration is complete. App remains unpublished. Publication, authenticated
  token health/read adapter, capture activation and real-event certification
  remain separate pending steps. No production changes or outbound calls.

Earlier notes below describe the provisioning sequence, not current readiness.

## Implemented

- Facebook read evaluation requires `pages_read_engagement` and
  `pages_read_user_content`, not `pages_manage_engagement`. Existing credential
  binding, freshness, role checks and Messenger token checks remain in force.
- Exact membership is checked on `/{owned-post}/comments?fields=id&limit=100&filter=toplevel`.
  A candidate missing from that bounded sample is unverified; pagination URLs
  are never followed. The subsequent node must have the exact candidate ID
  and no parent comment. Instagram's media contract is unchanged.
- Reply pagination or missing reply-author IDs still means unknown, not proof
  of no external response. No publishing permission is inferred from reading.

## Deployed closed in DEV, NOT connected to Meta

`supabase/functions/facebook-comments-dev` is a separate ingress with explicit
`FACEBOOK_COMMENTS_DEV_ENABLED=true` opt-in, exact DEV project guard and sender
OFF requirement. The isolated DEV URL is:

`https://hjfwjnejbcpmknvfpdcq.supabase.co/functions/v1/facebook-comments-dev`

It validates the challenge, caps raw body bytes, rejects content encoding,
validates HMAC/account, encrypts comments and invokes only the existing
`comment_review_v1` capture operation. Duplicate events rely on the existing
database unique key. No capture RPC for Messenger, action claim, Meta write,
token refresh or dispatch capability is present. No schema migration needed.

On 2026-10-21 the separate function was deployed as version 1 with JWT
verification disabled for Meta ingress (HMAC remains mandatory for POST).
A direct GET returned HTTP 404 `disabled`, confirming the absent/closed gate.
The existing Messenger receiver was not replaced. The receiver reads only `FACEBOOK_COMMENTS_DEV_*` variables;
it never falls back to Messenger variables. A literal
`FACEBOOK_COMMENTS_DEV_MANUAL_SEND_ENABLED=false` is required. Gate remains
absent/closed until separate provisioning completes.

## Unresolved real delivery boundary

Meta app `Emporio Comentarios DEV` (`2220237475209417`) was created with the
owner's explicit approval under the existing Emporio business portfolio.
It remains unpublished. `pages_manage_metadata`, `pages_read_engagement` and
`pages_read_user_content` were added with explicit approval and show ready for
testing, not proof of token grant. The app secret is stored under its dedicated
DEV name (value not inspected). A new capture connection
`74c3f858-c4f6-40af-a068-6ef159819a87` exists with active=false and
sender_enabled=false. New keys await owner secure save. Token provisioning,
challenge and Page `feed` subscription are not yet certified.
No production app settings were changed.

Subsequent provisioning: owner saved all dedicated variables; receiver gate
`FACEBOOK_COMMENTS_DEV_ENABLED` was changed to true. Sender env remains false,
and database connection remains inactive/sender=false with zero events.
Runtime probes returned 403 `challenge_denied` for an unauthenticated GET and
403 `capture_denied` for an unsigned empty JSON POST; neither wrote an event.
These are negative controls, NOT a successful challenge or valid-HMAC proof.
Meta Page Webhooks form now has the isolated URL prepared, awaiting secure
verify-token entry and save. No fields or Page subscriptions have been activated.

The new app's Page Webhooks UI explicitly warns that unpublished apps receive
only dashboard test webhooks, not production data (including app role users).
An organic-comment certification cannot be promised while this app is
unpublished. Do not publish it automatically: obtain explicit authorization
after inspecting publishing requirements. App publication does not mean posting
content, but it is a distinct activation step, not covered by preparing the URL.
Use only new app credentials and dedicated connection/index/data/token keys;
do not overwrite shared Messenger or Instagram variables. The existing Preview
evaluation reader still uses its prior Messenger connection; connecting this
new comment-only identity to evaluation requires a separate read-only adapter,
not a silent replacement of Messenger credentials.

The existing app's Page callback points to Production. Creating a second URL
does NOT cause Meta to deliver there. Do not substitute the productive callback
or enable `feed` on it. A separately reviewed official isolation mechanism is
required before registration. If isolation requires another app, its app secret,
Page token and exact app/Page bindings must be provisioned separately; the
existing app token/secret cannot simply be assumed equivalent.

No real delivery, journal ingestion or commercial real-event PASS is claimed.
Receiver tests use signed synthetic payloads and an in-memory capture mock;
they do not substitute for deployed Deno + PostgreSQL certification.

## Verification

### Isolated credential health (DEV only)

Added `facebook-comments-dev-health`, JWT-protected and checking the caller's
active Admin/Gerencia profile with caller RLS. Preview exposes a separate
"Validar token · Emporio Comentarios DEV" operation. Only GET calls are made:
token introspection, Page identity and this app's `feed` subscription. Results
contain only sanitized booleans, scope names, expiry metadata and error codes.
No token refresh, capture activation, claims or sends are available. Dedicated
app/Page/connection configuration is pinned and sender must be explicitly OFF.

75/75 relevant synthetic JS tests passed. Deployed health function has JWT
verification enabled; unauthenticated access returns HTTP 401. DEV connection
remains `active=false`, `sender_enabled=false` before and after execution.

Authenticated real-token PASS at 2026-10-21T23:10:00.091Z on commit c748640,
Preview READY `dpl_AQzb9JSh9SKqKHawKihpPigtZ9wY`. Exact app and Page bindings
verified server-side; PAGE type; granted pages_show_list, pages_manage_metadata,
pages_read_engagement, pages_read_user_content and public_profile. This app's
Page subscription contains only feed. No writes or dispatches performed.
`expires_at=1792627200`, `data_access_expires_at=1800399028`: token has a short
remaining lifetime, NOT a durable/non-expiring credential. No renewal performed.
App remains unpublished and capture inactive; this is credential health proof,
not organic-webhook or commercial-processing certification.

Local Next build passed using synthetic public configuration (no credentials);
remote Preview build READY. Sanitized visual evidence:
`docs/evidence/pr256-review/isolated-dev-token-health-pass.png`.

66 JS tests PASS across receiver, observation, review, bridge, synthetic Preview
and Facebook read diagnostics. No real messages, credentials or customer data
are used by these tests. Build and Preview results are reported separately.

Official contract: https://developers.facebook.com/docs/graph-api/reference/comment/
`parent` is the parent comment for a reply, not the publication.
