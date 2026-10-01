# Social Routing v1 — foundation, exclusive routing and attribution

Scope: separate branch `codex/social-routing-v1`, based on main
`30beba05a1a53741915137c2e65066a547f5ed98`. No Content Agent, publisher, CMS,
Private Replies configuration, TikTok connection, new CRM, scheduler or round robin.
No production access, variables, deployment, database migration or real provider calls.

## Implemented architecture

```text
Respond signed webhook → existing event journal
  ├─ Social flag OFF / Administration 544519 / non-message event → existing path
  └─ Social flag ON + message.received + existing commercial channel
       → existing sanitizer + read-only confirmed identity lookup
       → deterministic routing (existing Legal/Owner predicates reused)
       → capture_social_route_v1: decision + ONE specialist queue, one transaction
            ├─ SALES → existing Sales V2 → existing workflow / ACK / SLA
            ├─ OWNER → existing Propietarios IA
            ├─ LEGAL → existing Jurídico IA → existing handoff where appropriate
            └─ ADMINISTRATION / EXISTING_CLIENT / HUMAN_REVIEW / UNKNOWN
                 → persisted human-review queue, NO specialist or automatic message
```

The admin-only, read-only `/social-routing` page and
`GET /api/operaciones/social-routing` expose the last 100 decisions with opaque
references. They do not send, assign, resolve identities or grant Administration
capabilities. `queued_specialist` means queued, not proof of completion.
Human-review destinations are a local review queue, **not** a newly configured
Respond team assignment; an operator must attend them in the existing systems.

Routing precedence: sensitive/complaint/emergency → ambiguous identity →
Administration → existing client → existing Legal intent → existing Owner
intent/recent Owner context → Sales intent → recent destination continuity →
WhatsApp-compatible commercial fallback → UNKNOWN. No classification model added.
Only one destination is immutable for a message, including retry deliveries with
a different event ID. Persistence failure never falls through to another agent.

Administration inquiries arriving through social remain on their original channel;
they are **never** forged into channel 544519 or passed to restricted admin tools.
The existing 544519 webhook chain is unchanged with either flag value.

## Attribution and identity

Persisted: `source_platform`, `source_channel_id`, `source_event_id`,
`source_message_id`, `source_post_id`, `source_comment_id`, `source_ad_id`,
`source_campaign_id`, `source_property_id`, `source_metadata`.

- Platform is the configured mapping: 497382 Instagram, 497385 TikTok,
  498219 WhatsApp, 515318 Messenger. This does not establish API support or connect
  any channel. Only received-message events are eligible, not public comments.
- Post/comment/ad/campaign accept explicit `source.*_id`, the corresponding
  top-level object `.id`, or `message.referral` / `referral` ID fields. These are
  input adapters, **not a claim that Respond currently supplies these fields**.
- Property attribution accepts explicit `source.property_id` as an Inmoadmin
  public property reference; a unique catalog match is required. Otherwise NULL.
- `source.metadata` / `source_metadata` keeps only provided enum values:
  `origin_kind` (dm/private_reply/comment/ad/post/reel/story) and
  `media_type` (text/image/video/audio). Unknown or absent metadata → NULL.
  Arbitrary free text/URLs/provider bodies are not copied into attribution.
- No absent attribution is reconstructed from conversation text. UI projects ID
  fields to opaque references; the authoritative journal retains their exact values.
- Respond contact ID remains the channel/provider identity. Read-only confirmed
  canonical links are reused, without audits, new links, phone/name matching or
  cross-network joins. Conflicts/multiple links → human review.
- `client_identities` / `respond_identity_links.inmoadmin_client_id` are **not**
  interchangeable with commercial `clientes.id`. Social appointment sync accepts
  only one explicit existing `gv_opportunities.cliente_id` for that Respond
  contact. Missing/ambiguous client linkage → `needs_confirmation`, no new client.

## Appointment and handoff guarantees

Existing `respond_appointment_sync`, `citas`, date parsing, property resolution,
Respond-to-profile mapping and advisor precedence remain in use.

With Social ON, commercial lifecycle captures carry immutable
`social_routing_version=1`. A missing channel uses the existing contact snapshot;
if still unknown it returns `appointment_channel_unresolved` and creates no booking.
This condition requires operator investigation; there is no name-based fallback.
The old behavior is retained for unmarked legacy rows / flag OFF, not silently
rewritten or backfilled. Before activation, drain/review old pending appointment
rows to prevent overlapping old/new workers for the same booking.

`commit_social_appointment_v1` locks the sync row, verifies unique client linkage,
serializes the existing advisor/client/property tuple with a transaction advisory
lock, preserves the existing ±30 minute duplicate criterion, and commits the cita,
unique sync key and sync status together. A second worker returns the same cita.
A late losing worker cannot overwrite a committed `created` row with `failed`.

Social handoffs have a DB-bound marker. Assignment and subsequent ACK have separate
durable reservations. Once reserved, an uncertain network result is never retried
automatically. This is **at-most-once transport attempt**, not a claim of exactly-once
delivery inside Respond. A crash before sending may leave zero deliveries and
requires human reconciliation. Existing SLA policy is retained: a later genuine
SLA reassignment has a separate step key; retrying that step cannot assign twice.
There is no additional round robin or advisor mapping.

Social inbound rows cannot reset from processing/processed/failed to captured.
An uncertain processing failure remains stopped for human inspection, rather than
replaying an agent that may already have sent. Existing non-Social retries are unchanged.

## Migration (versioned only, NOT applied to Supabase)

`supabase/migrations/20261001134913_social_routing_v1.sql`:

- Additive transaction; dependency precheck; lock timeout 3 s, statement timeout 30 s.
- New server-only `social_message_routes`, `social_handoff_effects`,
  `social_appointment_keys`. RLS enabled, no anon/authenticated grants/policies;
  service role has SELECT, mutations only through narrow security-definer RPCs
  with fixed empty search path.
- Route uniqueness: event ID and `(channel, contact, message)`; unique specialist
  binding. Triggers reject another specialist capturing the same message, including
  a concurrent legacy insert using the same advisory lock.
- Existing inbound/handoff tables gain nullable route FKs; appointment sync gains
  a nullable version marker. Binding triggers prevent reassignment/clearing.
- Receipt primary key `(kind, handoff_id, phase)`, single-use token; only RPC may
  reserve/finish. The polymorphic handoff key is validated by RPC against the
  existing Sales or Legal handoff table; it is not a polymorphic PostgreSQL FK.
- Appointment key PK/FK to sync plus FK to cita. Indexes cover route chronology,
  review queue, property/canonical FK lookups, handoff routes and cita-key lookup.
- No UPDATE/DELETE/backfill of existing records during installation. DDL locks on
  existing lane tables can briefly block writes; timeout aborts the transaction.
- Catalog postcheck: `supabase/checks/social_routing_v1.sql`.
- Empty-only uninstall: `supabase/rollback/social_routing_v1_empty_only.sql`.
  It refuses any Social evidence; never use CASCADE or remove populated audit data.

## Certification, 2026-10-01

All model/Respond IO in the added tests is synthetic/intercepted. The PostgreSQL
certificate uses a disposable **loopback-only** database, real independent
connections and `pg_blocking_pids`, the existing lane migrations and minimal fixture
tables for upstream catalog dependencies. It is not a hosted Supabase DEV certificate.

| Verification | Result |
|---|---|
| New Social tests | 56/56 PASS |
| Directed Social + channel router + Administration adapter/security | 100/100 PASS |
| Local PostgreSQL | 40/40 checks PASS, cluster removed |
| Full suite | 1709/1712 PASS; 3 pre-existing failures, see below |
| Next production build with synthetic configuration | PASS |
| `git diff --check` / JSON / Preview rule preservation | PASS |

Required matrix A–O: IG/FB Sales, Owner, Legal, Administration, complaint, UNKNOWN,
duplicate webhook, independent workflow/ACK retry, concurrent booking, homonyms,
present/missing attribution, WhatsApp OFF regression, Administration ON/OFF
regression are covered in `tests/social*.test.mjs` and the PostgreSQL script.
Signed webhook integration tests assert that a persisted decision precedes the only
selected specialist. No Social contact/lead insert exists. Catalog checks and
empty-only rollback/refusal are also exercised locally.

### Baseline failures — not concealed or fixed outside scope

Reproduced on an unmodified archive of base main `30beba05…` by running the three
affected files: 182/185 PASS, the same three failures.

1. `respondWebhookMultiHmac.test.mjs`: historical data-URL harness fails to replace
   existing agent imports (`salesCapture`, etc.); asynchronous module resolution error.
2. `shadowAiP3.test.mjs:591`: expected 18 tools, current base provides 19.
3. `shadowReducedOutputSchema.test.mjs:59`: expected 4355 schema bytes, current base
   provides 4383. No schema/tools/Shadow implementation changed by Social Routing.

The complete suite is therefore **not green**. This PR is for review, not an
assertion of unconditional merge/production readiness.

Commands (use the configured local Node runtime):

```sh
node --test tests/social*.test.mjs
node --test tests/social*.test.mjs tests/respondChannelRouter.test.mjs tests/shadowRespondAdminSecurity.test.mjs tests/shadowRespondAdminAdapter.test.mjs
node --test tests/*.test.mjs
SOCIAL_LOCAL_PG_RUNTIME=/path/to/local/runtime node scripts/test-social-routing-postgres.mjs
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL=https://synthetic-only.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-build-only SUPABASE_SERVICE_ROLE_KEY=synthetic-build-only node node_modules/next/dist/bin/next build
git diff --check
```

## Gates, rollout and rollback (proposed, NOT executed)

`SOCIAL_ROUTING_V1_ENABLED=false` by default; only exact `true` opts in. Server-only,
not NEXT_PUBLIC. No existing production gates changed. The branch alone is excluded
from Vercel Preview; crons and other rules are unchanged.

Before any activation:

1. Review this diff and address/explicitly disposition the three baseline failures.
2. Certify the migration against a representative Supabase DEV catalog, grants and
   authenticated review UI; hosted DEV was not accessed in this implementation.
3. Verify manually in Respond: channels connected; Ivonne/default assignment stopped;
   Sales and Legal handoffs Published with correct teams and repeat-trigger behavior;
   no second ACK inside workflows; 544519 untouched; advisor/profile mapping valid.
4. Verify actual webhook samples/attribution shape. Private Replies and TikTok
   integration remain outside this PR; do not assume comment/post/campaign delivery.
5. Obtain separate production migration/deployment/activation authority. Install
   ONLY the new migration with flag OFF, run catalog checks, deploy with flag OFF.
6. Drain/review legacy pending messages/bookings; avoid overlapping old deployment
   workers during cutover. Inventory uncertain handoff receipts before activation.
7. With explicit authorization, enable only Social flag for controlled traffic.
   Verify decision → exactly one inbound → expected existing agent/handoff;
   ensure human-review destinations create no admin execution. Check attribution,
   duplicate delivery and one appointment/assignment/ACK without financial operations.

Rollback: set Social flag OFF and apply configuration to runtime. Preserve schema,
decisions, appointments and receipts. OFF stops new Social capture, **not** an
already queued/in-flight specialist or a previously authorized SLA. Inventory and
quiesce those before any application rollback; never reset their consumed markers.
The existing legacy WhatsApp/router path resumes for new messages, so verify its
commercial cutover configuration first. Do not roll back to pre-marker workers
while Social work is pending. Empty-only SQL uninstall is a separate approved option
only before any Social traffic; after use, keep the evidence/schema.

Residual risks: deterministic classification has limited language coverage; no live
channel/workflow assurance yet; remote delivery cannot be proven exactly-once after
an uncertain network response; unmarked historical appointment rows retain their
legacy name matching/concurrency behavior; human queue needs operational ownership.
No new administrator permissions, marketing publishes, campaigns or production
communications are authorized by this change.
