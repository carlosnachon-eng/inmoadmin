# Respond Growth: safe degraded mode

Scope: Inmoadmin commercial automation only. No Respond plan, channel, webhook,
workflow, billing, token, Meta Admin sender or database schema changes.

## Release basis

Based on live Production `2bf0e5af946bf2e58c7b3a5f5b927e51fcdd907d`, not the
older main revision. Preserve the deployed property KPI and tenant submission
hotfixes. The release diff must be compared with this exact production SHA.

## Operational hold

`lib/respondDegradedMode.js` fences commercial queue claims, execution recovery,
all three lane processors, Sales sender, Owner/Legal send boundaries, handoffs,
SLA, watchdog, recovery cron, and the operator return-to-AI endpoint.
The eight commercial cron entry points authenticate normally and return disabled
before accessing jobs. Historical/unmanaged inputs cannot bypass the lane fence.
Existing enable flags cannot lift the hold. No jobs, leases or journals are
deleted, reset, completed or retried. Durable webhook enqueue remains intact;
pending count can still increase while webhooks remain enabled.

Do not remove the hold to drain backlog. Any future commercial cutover needs
separate review, fresh human-attention evidence and a new NOT_BEFORE boundary.
This release does not change #165 ordering or #168 pause SQL/semantics.

## Read surfaces

Mi Trabajo and Mi Gerencia share WorkCenterView: show historical source warning
and latest scoped snapshot timestamp. Snapshot rows no longer produce current
work items, assignment priorities or open/unanswered metrics. Unknown metrics
are null/—, not zero. Other native Inmoadmin work remains available.
Ventas IA Sombra and Social Routing show the same warning and last source update;
the former no longer claims the stored assignee is the current owner.
Historic interventions, runs, reviews and journals remain retained.

## Handoffs (read-only audit, 2026-10-11 23:34 UTC)

| Workflow | Accredited current caller/use | Downgrade dependency |
| --- | --- | --- |
| Sales V2 — Handoff a asesor — v1 | Code callers fenced; last durable assignment request 2026-10-02 04:09 UTC; URL absent in audited Production config | Not required for current native Respond Sales operation |
| Jurídico IA — Handoff — v1 | Code caller fenced; URL configured but durable handoff count 0 | No current use accredited; not required for current operation |
| P2 — Route Administración — v1 | No exact caller found in inspected application; no current execution accredited | No current dependency accredited; preserved, not deleted |

This is not a claim that every possible external caller has been exhaustively
inventoried. Published status alone is not execution evidence.

Production baseline: 1,519 pending jobs with attempts=0; 42 completed jobs,
last completion October 6; 38 complete executions, last October 6.

## Plans and limits

Respond's official [pricing](https://respond.io/pricing) lists Developer API,
Workflows and AI Agents in Growth. [Developer Webhooks](https://respond.io/help/integrations/webhooks)
and Incoming Webhook triggers require Advanced. Native Inbox/canals are not
changed by this release. Existing full API reconciliation is not a new realtime
replacement and does not authorize commercial processing.

## Verification

Focused local tests: `node --test tests/respondGrowthHold.test.mjs tests/managementInterventionUx.test.mjs`.
No real models, messages, worker invocation, replay or production fixtures.
Postdeploy: verify SHA/READY/aliases, authenticated read surfaces, job attempts and
execution timestamps. Never call a production worker to test its disabled state.
Do not change the Respond subscription in this task.
