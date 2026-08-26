begin;

alter table public.respond_identity_audit
  drop constraint if exists respond_identity_audit_event_type_check;
alter table public.respond_identity_audit
  add constraint respond_identity_audit_event_type_check check (
    event_type in (
      'candidate_created','confirmed','rejected','revoked','conflict_detected',
      'resolved','unresolved','bootstrap_evaluated'
    )
  );

comment on constraint respond_identity_audit_event_type_check on public.respond_identity_audit
  is 'Eventos Identity Bridge; bootstrap_evaluated registra cohortes históricas explícitas sin PII';

commit;
