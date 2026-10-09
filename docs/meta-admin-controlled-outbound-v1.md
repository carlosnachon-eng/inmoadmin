# Meta Admin Controlled Outbound v1 — review only

Base main: `20b5c70d053594f5509681a3ec933e3be167bc23`.
No deployment, endpoint/caller wiring, credential configuration or production SQL.

## Design

The existing OpenAI Admin shadow pipeline, unique claim, tools=0 and model
post-gate remain unchanged. A separate internal capability accepts only the
explicitly allowlisted input's already-complete matched proposal. It never calls
the model, Respond, workflows or business mutation APIs.

1. OFF unless `META_ADMIN_CONTROLLED_OUTBOUND_ENABLED=true` and exact UUID equals
   `META_ADMIN_CONTROLLED_OUTBOUND_INPUT_ID`. No list, ranges, wildcard or fallback.
2. Load the completed OpenAI journal and accredited encrypted recipient. Reuse the
   canonical readers by identity, not model-selected IDs. Read agreement/payments;
   ambiguous/revoked/insufficient context rejects the entire proposal.
3. Repeat existing fresh snapshot/edit/revoke/echo gates; matched only, <=5s,
   known same_subject/unknown/conflict blocks. The inbound must be within 24h.
4. Strict closed grammar: exact recognized question plus exact server-rendered
   factual response must match the existing proposed_response. Never rewrite the
   proposal or use an LLM's risk score as authorization. Extra text fails closed.
5. Authenticate AES-GCM with original observation AAD; verify native subject HMAC
   and canonical phone digest. Decrypted address exists only in memory and is the
   sole recipient. No caller/model recipient parameter.
6. Reserve an additive journal, unique on input and native inbound. A unique global
   pilot slot permits ONE dispatch total, even if the env allowlist changes.
7. Resolve context again, compare hashes; durable CAS reserved -> dispatch_started
   consumes the attempt before HTTP. Re-read snapshot immediately after CAS.
8. POST once to Meta v26 `/1198305790026665/messages`, redirects disabled, timeout
   15s. No sender retry, SDK retry, reset/reclaim, expiry cleanup or alternate input.
9. Persist accepted/failed/uncertain. 2xx + native wamid means accepted, NOT sent.
   Timeout/5xx/malformed result/crash stay uncertain or dispatch_started and cannot
   be repeated. Even a known 4xx is terminal, never retried.
10. Read sent/delivered/read/failed evidence from the existing signed observer by
    exact outbound wamid + WABA/phone. No temporal matching or modification of
    source journals. Out-of-order/duplicate receipts are read as independent
    facts; failed plus delivered/read is contradictory and needs human review.

## Narrow initial policy

Supported exact questions/responses: receipt acknowledgment, contract expiry,
single current-month payment due date and single recorded payment status. All
require matched identity and ready context, including acknowledgment.

No arbitrary prose entailment claim: a correct paraphrase still requires review.
Schedules, general operational instructions and other free-form confirmations
remain review-only until an accredited source and explicit validator exist.
No amounts, balances, grace periods, discounts, commissions, fee inference,
negotiation, complaints/disputes/threats/legal questions or contract changes.
The prior real grace-period proposal is NOT eligible for this sender.

Handoff means an exact-input `review_required` journal record visible through the
service-only status RPC, not a notification, assignment, workflow or queue worker.
No UI/automatic caller is introduced. Operator must review this journal before any
future pilot. Failed/uncertain also require human review.

## SQL/security

Proposed additive SQL: `scripts/sql/meta-admin-controlled-outbound.sql`.
One private RLS table, no direct service_role/anon/authenticated access. Six
service-role-only fixed RPCs: load, reserve, start, finish, review, status. No
generic schema/SQL access, default privilege changes or source-table alterations.
Existing `shadow_once_runs.send_calls=0` remains intact; transport attempts are
audited separately. Thus zero business writes does not mean zero journal writes.

Only in a separately authorized future rollout: install reviewed SQL, provision a
dedicated scoped messaging token `META_ADMIN_OUTBOUND_ACCESS_TOKEN` securely,
confirm original capture AES/HMAC keys in runtime, authorize one NEW eligible
input, and wire an authenticated manual caller. No such caller is shipped here.
OFF before/after pilot; keep journal, no delete/reset. Unknown dispatch outcome
requires investigation, never a second send. No expansion without review.

## Certification and limits

- Local sender: synthetic context, ciphertext, journal and intercepted HTTP only.
- Local PostgreSQL: exact proposed SQL against disposable fixture tables; RLS,
  ACL, CAS/replay/status assertions and two actual concurrent claim connections.
- Hosted DEV: identical SQL logic with schema/function identifiers renamed into
  an isolated fixture namespace; real PostgreSQL/RPC checks in one transaction,
  ROLLBACK, independent cleanup=0. No existing DEV sources changed. This is NOT
  certification against real source constraints/PostgREST or actual Meta transport.
- No real models, sends, production access or enabled flag.
- Existing shadow post-gate validates the proposal; current sender checks context
  again. Database reads are not one atomic snapshot with Meta delivery. An unseen
  or in-flight human echo cannot be ruled out; this is not Human Attention v1.
  The limited pilot is not evidence of native durable human-pause completeness.
- An accepted message cannot be unsent by a later gate. The consumed journal
  prevents retries, but this does not guarantee remote exactly-once delivery.
- Read receipts may never arrive. Never infer read/delivery from HTTP alone.

No production readiness claim until adapter/source-schema and operator pilot
prerequisites are reviewed. This patch prepares the isolated transport capability.
