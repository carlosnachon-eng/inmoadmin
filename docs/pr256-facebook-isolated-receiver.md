# Facebook comment evaluation and isolated DEV ingress

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

## Prepared, NOT deployed or connected

`supabase/functions/facebook-comments-dev` is a separate ingress with explicit
`FACEBOOK_COMMENTS_DEV_ENABLED=true` opt-in, exact DEV project guard and sender
OFF requirement. The intended URL, after a future authorized deployment, is:

`https://hjfwjnejbcpmknvfpdcq.supabase.co/functions/v1/facebook-comments-dev`

It validates the challenge, caps raw body bytes, rejects content encoding,
validates HMAC/account, encrypts comments and invokes only the existing
`comment_review_v1` capture operation. Duplicate events rely on the existing
database unique key. No capture RPC for Messenger, action claim, Meta write,
token refresh or dispatch capability is present. No schema migration needed.

This function must eventually be deployed with JWT verification disabled for
Meta ingress (HMAC remains mandatory for POST). No such change is applied by
this PR. Existing project secrets are referenced in runtime, not copied or
regenerated. Gate remains absent/closed until separate provisioning approval.

## Unresolved real delivery boundary

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

65 JS tests PASS across receiver, observation, review, bridge, synthetic Preview
and Facebook read diagnostics. No real messages, credentials or customer data
are used by these tests. Build and Preview results are reported separately.

Official contract: https://developers.facebook.com/docs/graph-api/reference/comment/
`parent` is the parent comment for a reply, not the publication.
