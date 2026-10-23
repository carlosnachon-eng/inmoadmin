# Instagram durable associations — DEV certification

Runtime commit: `0db636284fce3f5838a8356050bc362fa4fa0401`.

## Implemented

- Instagram confirmation UI in the existing Inbox, same explicit property reference
  and confirmation contract as Facebook; no native ID or connection supplied by UI.
- Signed bridge accepts only the exact bind operation. Authenticated active
  Admin/Gerencia, sender OFF, nonce replay protection, exact review revision,
  captured event and encrypted native identifiers are required.
- Meta ownership and comment/media membership are read server-side before the
  existing shared encrypted registry RPC can write. No new permissions or schema.
- Direct DEV API and observer bridge reuse the same adapter and shared binder.
  Unknown ownership, stale review, missing property, cross-channel/connection
  binding and malformed confirmation fail closed. No sender or OAuth capability.

## Tests

- 118/118 targeted JS tests PASS; Next build PASS (81 pages, font-download
  optimization warnings only).
- Disposable PostgreSQL: 30 existing checks + 16 association checks PASS.
  Integrated real bridge/RPC fixture additionally certifies Instagram bind,
  one durable link/audit, replay rejection, idempotent confirmation, evaluation
  through decrypted association, approval and refresh. Local DB removed in finally.
- These fixtures simulate Meta and use public synthetic keys, never live tokens.

## Authenticated remote Preview

- QA Inbox `dpl_BR2rzErnaTorXeG6o96Fpg5zCvu2` READY.
- Temporary QA bridge `dpl_H3QfeaY6Gvf2ZzHUAxmshhTVYocR` READY, Preview-only,
  no aliases, time-limited. Real Auth, profile, bridge signature and DEV RPCs;
  Meta, captured comment and property facts explicitly synthetic.
- Disposable connection `725e2e98-88ce-45f3-bb9f-576863a45f04` and synthetic
  property `EMP-QA256`; no production content copied.
- Initial evaluation escalated without a property reference. Manual confirmation
  displayed "Asociación durable registrada". Independent DB check: one encrypted
  link to the exact fixture property, no public reference in ciphertext envelope.
- Reevaluation produced a synthetic price proposal. Full browser refresh retained
  the proposal. Repeat confirmation returned "La asociación ya estaba registrada".
- Independent counts: links=1, binding audits=1, actions=0, enabled senders=0.
- No approval/publication was performed remotely in this run.

## Restoration and scope

- Delete only the exact synthetic connection's links, nonces, audits, reviews,
  events, connection and exact synthetic property after QA; verify zero residuals.
- Restore branch-only bridge URL to normal observer
  `emporio-instagram-observer-euzm8vsmu-carlosnachon-engs-projects.vercel.app`.
  Normal observer deployment `dpl_7iZmxaE9c7wFC57ZQ1DTBCxM5ttR` READY.
- No migrations, secret regeneration, Production changes, publications or merge.
- This certifies the association path, not Meta publishing or a real Instagram
  property association. EB-UW8871 remains absent from DEV. General historical
  batching and association replacement/revocation remain separate pending work.
