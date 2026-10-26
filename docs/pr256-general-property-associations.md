# General comment evaluation and durable property association — DEV

2026-10-23, PR #256. No Production, publications, claims or sender activation.

## Changes

- Removed the scoped EB-UW8871 certification override from the runtime dependency
  graph; retained it only as a test fixture. Previously approved evidence remains
  unchanged and the UI labels it as historical/manual, not current inventory.
- Facebook evaluation processes a bounded batch of eligible captured comments,
  verifies each publication/comment and external replies via read-only Meta,
  and records the ordinary deterministic decision. Approved/consumed reviews
  are preserved, not silently reapproved. Persistence rejection is not success.
- Private property registry is keyed by platform + connection + post HMAC.
  Explicit Admin/Gerencia confirmation uses a captured, decrypted comment and
  current Meta ownership/membership proof. No native IDs are accepted from UI.
- RPC checks actor, active connection, sender OFF, captured event and a unique
  published property in the same database. Encrypted evidence + actor/time,
  immutable binding, audit, advisory lock, duplicate-safe confirmation. A
  conflicting property is rejected rather than silently replacing the binding.
- Evaluation reads current property fields; registry stores no price or copied
  listing. Missing/unpublished/ambiguous inventory, conflicting references,
  uncertain Meta state or tampering cannot produce a proposal. Decimal-string
  integer prices are validated without accepting unsafe integers or free text.
- Shared Instagram evaluation can read the same scoped registry. Its existing
  bridge only permits the registry read, not binding writes. Facebook has the
  authenticated confirmation UI. Instagram confirmation UI/bridge writes remain
  pending; no remote Instagram bridge replacement claimed in this change.

## Verification

- 117/117 targeted Node tests PASS; includes general multi-comment evaluation,
  preserved approval, encrypted links, exact binding, changed current prices,
  unavailable property, role/sender/tamper denial and synthetic bridge regression.
- Disposable PostgreSQL: 30 existing checks, durable bridge fixture and 16 new
  association checks PASS (concurrency, idempotency, conflict, role, cross-channel,
  cross-connection, absent property, ACL/RLS). Local database removed by finally.
- Local Next build PASS, 81 pages. Google Fonts optimization warnings only.
- Migration `20261023184956_comment_property_association.sql` applied only to
  Supabase DEV hjfwjnejbcpmknvfpdcq. RPC anon/authenticated=false,
  service_role=true; private table RLS=true. No direct table grants.
- DEV review Edge v17 ACTIVE, JWT=true; 20-file bundle excludes certification
  override. No secrets regenerated or transferred.
- Advisors: new private table's no-policy INFO is intentional deny-all with
  service-only authorized RPC; unrelated existing public RLS/Auth advisories
  unchanged. https://supabase.com/docs/guides/database/database-linter

## Limits / NO MERGE for full launch

## Authenticated Preview QA (2026-10-23)

- Runtime commit `35dbb467d366a0fb9b5a70ff16ca648f032d6ad4`, deployment
  `dpl_CZtom3zKHHkgJ9d3MZ2kbiE4d4B6` READY.
- General Facebook evaluation completed for 20 real captured DEV comments in
  the authenticated Inbox. Journal: 21 reviews total, including the previous
  approved certification preserved; 6 ambiguous escalations, 1 property/freshness
  escalation, 2 empty/reaction ignored, 4 own/nested ignored, 7 existing-action
  suppressions. No new unsupported commercial proposal was produced.
- One explicit association attempt for the previously confirmed EB-UW8871
  returned the visible unavailable/unpublished DEV-property message. No link
  or binding audit was created. This is a negative real Preview test, not a
  successful real-property association.
- Final DEV checks: property links=0, binding audits=0, actions=0,
  senders enabled=0, prior approved reviews=1. Positive durable associations
  were certified only with isolated synthetic PostgreSQL/Node fixtures.
- No Production access, publication, merge or remote synthetic-data insertion.

## Remaining launch limits

EB-UW8871 still does not exist in DEV. No artificial binding to another property,
no Production lookup/copy, and no current-availability assertion. The real
comment's approved certification evidence is not general inventory proof.
Bounded evaluation covers at most 20 eligible entries from the current 200-event
reader; this is not a background queue or exhaustive historical processing.
Private replies and public dispatch remain disabled. Registry replacement/revoke
workflow and Instagram binding writes require a subsequent scoped change.
