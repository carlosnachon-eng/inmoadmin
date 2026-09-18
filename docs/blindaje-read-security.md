# Blindaje: candidate read security restriction

Status: DRAFT / NO-GO. Production must not be modified by this PR.
Dependency for increment 1 panel PR #131; not increment 2.

## Confirmed metadata (2026-09-17/18)

Both DEV and Production have the same relevant policies and grants:

| Object | Current protection | Finding |
| --- | --- | --- |
| solicitudes_inquilino | RLS disabled; anon and authenticated SELECT/UPDATE and other table grants | Priority security issue, not DEV-only |
| solicitudes_inquilino.select_equipo | authenticated SELECT USING(true), currently inactive because RLS is off | Simply enabling RLS is insufficient |
| solicitudes_inquilino.update_equipo_y_publico | public UPDATE USING(true) WITH CHECK(true) | Unsafe legacy public write dependency |
| partner_operations | RLS on; agency membership or has_module_permission('poliza',false) | Partner agency isolation exists |
| partner_participants | RLS on; no_direct_access ALL USING(false) WITH CHECK(false) | Intentional private backend access; retain |
| poliza_expedientes | RLS on; all_auth_expedientes ALL USING(true), delete_auth_expedientes DELETE USING(true) | Additional priority issue: authentication is not expediente authorization |

No client records were queried in Production. Production checks used pg_catalog,
information_schema and the role/module permission catalog only.
DEV lacked Juridico/Poliza role configuration. Production has active permission
configuration for admin/juridico, both alcance=todos. Synthetic QA roles were added
only to DEV; no real account was changed.

## Dependency analysis

- Public `pages/solicitud-inquilino.js` uses anonymous INSERT RETURNING id,
  then direct document/analysis UPDATE by id. A SELECT policy is needed for the
  current RETURNING call; closing reads without adapting this path breaks it.
- `pages/complementar-solicitud.js` anonymously SELECTs name/property/email and
  UPDATEs document bodies by id. An identifier is not sufficient authorization.
- Internal request detail/modal read documents and update approvals using the
  normal authenticated client. The candidate requires an active, non-external
  admin or explicit poliza permission, alcance=todos; edits require puede_editar.
- `pages/api/partners/participants.js` verifies normal user identity, active
  agency membership and operation ownership before private backend reads.
  The internal panel must not reuse that route as if staff were a Partner.
- The Partner operation screen reads its operation and participant route; it
  must not gain full application access merely because it knows an application ID.
- Existing public `link-submission` and participant/public ID routes also need
  capability review before claiming end-to-end public flow security. No changes
  to contracts, approvals, commissions, multi-plaza, or AI are included here.

## Candidate, not deployable migration

`supabase/security/blindaje_read_access_candidate.sql` is deliberately outside
`supabase/migrations`. It enables request RLS, narrows internal read/update and
removes dangerous grants. It does not open participant access or add a broad
authenticated policy. No data is changed.

The public transport must obtain a scoped, expiring authorization before
existing-document reads/updates; new submissions can use a server-validated
creation-only route. This changes access mechanics, not capture fields.
Existing unsigned complement links need an explicit compatibility/renewal plan.
Do not restore USING(true) to avoid that work.

Also prepare a separate restrictive expediente policy retaining legitimate
internal and own-Partner access. Do not layer another permissive SELECT on top
of the existing ALL USING(true), because it would not restrict anything.

## Actual DEV results

- Before restriction, a real synthetic Partner A context can read the synthetic
  application of Partner B. No Production data was used to demonstrate this.
- Candidate executed in PostgreSQL DEV inside BEGIN/ROLLBACK. Authorized
  internal roles read the synthetic request; inactive/no-profile/no-permission/
  alcance-propio/Partner contexts do not. A cannot read B, own operation remains
  readable, other operation remains hidden, direct participants remain denied.
- Anonymous application reads become empty. The existing public INSERT RETURNING
  id fails with insufficient_privilege. This is a confirmed regression/blocker,
  not a passed public-flow certification. Complement name/email reads also fail.
- ROLLBACK confirmed the preceding DEV RLS setting restored. No candidate policy
  was left active and no public regression was left deployed in DEV.
- This proposal cannot be applied to Production until the public transport and
  expediente authorization dependencies are resolved and recertified.

## Deployment and rollback

No Production deployment is authorized. Keep #131 draft and its feature flag
off in Production. This security PR is a dependency, not an automatic migration.
Test candidate SQL in DEV with BEGIN/ROLLBACK; record public regressions honestly.
For a later release, deploy the safe public transport first, certify all flows,
then apply the reviewed restriction. Rollback should disable the panel/affected
entry point, not reopen anonymous/global PII reading. During DEV transaction QA,
ROLLBACK restores the exact preceding policies without touching stored records.
