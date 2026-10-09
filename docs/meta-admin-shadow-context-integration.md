# Meta Admin Shadow Context: local integration

Base: `ddab4d48f96ff6e3455961dc18a6e3b4353f9384`.

Entry: `runMetaAdminShadowOnceWithContext`, wired through the existing authenticated
operator endpoint. Its existing server-side Supabase client supplies context reads.
No new endpoint, caller, webhook, cron or self-invoke trigger is introduced.

The existing runner claims the exact input, invokes the shared canonical readers
only for matched identity, projects their result to a strict model DTO, and
rechecks the snapshot immediately before the single OpenAI request. The DB client
never reaches the model. Tools remain empty. Unmatched never invokes the readers.

Projection includes accredited roles, opaque unique entity references, current
contract dates/rent and authorized current-month payment records. It excludes
raw identity IDs, names, contact information and receipt links. Ambiguity supplies
only a clarification state and does not query amounts. Revoked relationships
supply no private context. Unaccredited condominium fees remain unavailable.

After the intercepted proposal, context is resolved again and compared, followed
by the existing snapshot post-gate. Changed context or applicable human evidence
invalidates the proposal. No sender exists; completion never authorizes delivery.
The Respond wrapper and shared readers are unchanged.

Local certification uses fixtures and an intercepted proposal function; it proves
the model request contains authorized facts, not real-model response quality.
Reader mutation methods throw and tests assert no calls. Durable claim/start/finish
journal writes remain intentional; zero writes means zero business/context writes.
Revalidation is not an atomic database snapshot or proof of unseen Meta events.

No new migration, remote database access, real model, merge or production deployment.
Published as a separate review PR stacked on #180; production remains unchanged.

Focused certification: 37/37 PASS (18 integration/projection tests selected by
name, 19 operator authentication/journal/one-shot tests). No full suite repeated.
Includes missing-context-client fail-closed, matched/unmatched, ambiguity,
revocation, condominium insufficient context and post-model human invalidation.
Models real=0, sends=0, remote writes=0; journal effects simulated in memory.
