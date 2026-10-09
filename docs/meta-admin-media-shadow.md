# Meta Admin media + memory Shadow (review draft)

No production installation, real model call, sender or backfill is part of this change.

## Reuse and flow

Existing signed Meta receiver → existing atomic capture/subject RPC → encrypted media reference on the same private inbound row. A new installation epoch rejects hydration of older deliveries. No URL, caption, filename, raw payload or token is persisted. AES-GCM AAD binds scope, native event/message and subject/key tag; the row/foreign key binds the input ID. Existing encrypted sender remains unchanged.

Existing operator → canonical context + `createEvidenceBackedConversationReader` → unique Shadow claim → media reservation bound to the started claim → authenticated Graph metadata/download → existing DNS pinning, SSRF, size, MIME/magic and PDF validation → OpenAI structured interpretation → sanitized observation in `conversation_memory` projection → existing Admin proposal → post-gates. No dynamic tools.

`pipeline.js` is not invoked wholesale because it contains Respond ingestion/audit writes. Its existing network and interpretation validators are reused directly; only transport/provider adapters are new. Existing Anthropic/Respond flows are unchanged. Meta never falls back to Anthropic.

## Limits and safety

- Interpretation requires matched, externally accredited audience. Unmatched/unknown media stops as incomplete context without interpretation or Admin proposal. Staff remains blocked. Text-only anonymous behavior is unchanged.
- Image JPEG/PNG/WebP and PDF ≤5 MiB; existing PDF validation ≤10 pages. Audio/video references can be captured but interpretation remains unsupported.
- Historical media without a reference stays blocked. No API retrieves missing historical IDs.
- Exact Graph and `lookaside.fbsbx.com` host allowlists; bearer redirects forbidden. Metadata size capped at 64 KiB. File size and SHA-256 must match.
- Uses existing server-side `META_ADMIN_OUTBOUND_ACCESS_TOKEN` only for GET retrieval. This does not enable sending. Missing/invalid credentials fail closed; no secrets were inspected/configured.
- `OPENAI_API_KEY` and `OPENAI_ADMIN_AGENT_MODEL` only. No Respond identity/transport requirement.
- A media invocation can make at most **two distinct model requests**: one interpretation and one Admin proposal. `start` consumes the execution with both counters zero. Separate token-bound CAS RPCs durably mark `media_model_calls` immediately before media OpenAI dispatch and `model_calls` immediately before Admin `propose`. Retrieval, interpretation or post-media-gate failure terminates without an Admin call. No retry/reclaim after a crash or uncertainty. A crash between a durable dispatch mark and HTTP remains uncertain; these marks are not confirmation of provider receipt/billing. Historical rows are not retrospectively reconstructed.
- Fresh gates are checked after download immediately before interpretation, again before proposal, and after proposal. Changed memory/context/evidence invalidates or blocks. Before any proposal exists the journal remains blocked/uncertain, never fabricates an invalidated proposal.
- Interpretation is ephemeral and included only in the current memory projection. It does not rewrite durable episode revisions or turn an ambiguous episode into an authorized one. Durable future reinterpretation/cache is not introduced.
- Receipt image = observed content only, never bank reconciliation, payment validation or canonical amount/status.
- Retrieval/validation/interpretation failure produces a marker + incomplete context and stops this attempt before Admin proposal. No inferred attachment content.

## Migration

`20261009135000_meta_admin_media_capture.sql` must be installed before the new receiver code in any future authorized rollout. It adds encrypted columns, epoch and one-attempt journal; replaces only the existing capture/snapshot/history/evidence functions needed to recognize media. Private RLS and existing ACL remain; new RPC `meta_admin_shadow_media_claim_v1(uuid,uuid)` is service-role-only. No source journal updates, global default changes, cron or automatic caller.

Apply the subsequent proposed `20261009141006_meta_admin_shadow_model_accounting.sql` before running this revision. It adds `media_model_calls`, minimally replaces the journal state CHECK and start/finish RPCs, and adds service-role-only `meta_admin_shadow_admin_model_start_v1(uuid,uuid)` / `meta_admin_shadow_media_model_start_v1(uuid,uuid)`. No direct table grants or historical updates. Neither migration has been applied remotely by this change.

Rollback before activation: keep existing code. After a future authorized rollout: revert code while retaining additive evidence; never reset attempts or replay. Rollout itself is not authorized here.

## Local evidence

Focused JavaScript tests cover capture/decryption/AAD, no metadata leakage, download allowlist/DNS/redirect/size/MIME, mocked OpenAI image/PDF, receipt safety, memory operator integration, media post-echo invalidation and legacy media validators. All provider calls intercepted.

`tests/metaAdminMediaPostgres.mjs` installs actual prerequisite/migration SQL in a disposable local PostgreSQL, tests durable future capture, duplicate preservation, snapshot/history, ACL/defaults, two independent concurrent sessions (one winner), replay rejection and no historical hydration. No hosted DEV/Production certification claimed.

OpenAI file input format follows [official file-input documentation](https://developers.openai.com/api/docs/guides/file-inputs). Live Graph retrieval and actual model quality remain untested in this local phase.

### Accounting correction certification (local only)

145 focused JavaScript checks and 25 local PostgreSQL scenarios PASS. The five requested cases run through real local RPC/journal transitions with intercepted OpenAI:

| Case | Admin `model_calls` | `media_model_calls` |
| --- | ---: | ---: |
| Retrieval failure | 0 | 0 |
| Media OpenAI failure | 0 | 1 |
| Post-media gate failure | 0 | 1 |
| Media + Admin complete | 1 | 1 |
| Text complete | 1 | 0 (result field absent) |

Independent-session CAS, wrong-token rejection, terminal replay rejection, zero-call terminal state and service-role-only ACL verified. No real models, sends, hosted DEV or Production operations.
