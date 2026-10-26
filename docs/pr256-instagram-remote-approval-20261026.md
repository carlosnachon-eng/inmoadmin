# PR #256 — Instagram remote populated approval

## Scope

Preview-only QA of commit `c87289d2fa974ab20debc3b579186e1a8509ca8f`.
No application code, secrets, permissions, Production, Meta configuration or senders changed.
The existing `syntheticQa` adapter supplied synthetic Instagram/source/property facts;
Admin authentication, signed bridge, encryption, Supabase DEV RPCs and journal were real.
This is not certification of a new organic webhook or live Meta/property reading.

## Evidence

- QA observer: `dpl_9i6u4GTB1iWjkFFz6SbjFHAgTxGe`, Preview READY.
- QA Inbox: `dpl_EJ4mutRyBiGpEojer1KpuMd6bZsJ`, Preview READY.
- Dedicated disposable connection: `725e2e98-88ce-45f3-bb9f-576863a45f04`.
- Evaluation recorded `proposed` at 2026-10-26 14:50:34.864747 UTC.
- Approval recorded `approved` at 2026-10-26 14:50:55.353226 UTC.
- SQL independently confirmed actor present, encrypted decision/approval envelopes,
  and provider `instagram_login_business`; no ciphertext or credentials exported.
- Browser showed the edited synthetic text and “Aprobada y registrada. Envío deshabilitado.”
  Full refresh and reopening Comments retrieved the same approved text.
- Counts before cleanup: 1 event, 1 approved review, 1 approval audit, 0 actions.
- Initial attempt interrupted on Oct 23 was rejected as stale after the five-minute
  window. The guard was not changed; its disposable fixture was removed before this run.
- Targeted `commentSyntheticPreview.test.mjs` and `commentReviewBridge.test.mjs`:
  18/18 PASS on Oct 26 (tamper, auth, replay, sender guard, environment isolation).

## Cleanup and boundaries

Deleted only the dedicated synthetic connection and scoped events/reviews/audit/request
records. Post-cleanup SQL confirmed zero rows across connections, events, reviews,
audit, bridge_requests, property_links and actions for that connection.
All commercial-comment senders remained OFF. No publication, claim or dispatch.
Restored branch-only COMMENT_REVIEW_BRIDGE_URL to the normal observer
`emporio-instagram-observer-hy1yo93c3-carlosnachon-engs-projects.vercel.app`.
Restored Inbox deployment `dpl_2LCbn7Xa2RMVEKYpo2m2JMUPjyqd` is READY,
commit unchanged (`c87289d`).
Temporary QA adapters cannot write after connection removal and also expire.

Screenshot: `/private/tmp/pr256-instagram-remote-approved-20261026.png`.
PR remains unmerged. This approval test alone is not a whole-PR MERGE recommendation.
