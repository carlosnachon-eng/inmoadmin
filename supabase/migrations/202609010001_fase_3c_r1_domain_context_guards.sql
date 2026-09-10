-- Fase 3C: property_handover normalizado en 3B y handoff interno sensible no ejecutable.
-- Sólo amplía constraints; no modifica ni reinterpreta filas existentes.
begin;

alter table public.shadow_conversation_actions
  drop constraint if exists shadow_conversation_actions_case_domain_check;
alter table public.shadow_conversation_actions
  add constraint shadow_conversation_actions_case_domain_check check (
    case_domain in ('maintenance','payment','administrative_pending','property_handover')
  );

alter table public.shadow_historical_replay_cases
  drop constraint if exists shadow_historical_replay_cases_case_domain_check;
alter table public.shadow_historical_replay_cases
  add constraint shadow_historical_replay_cases_case_domain_check check (
    case_domain in ('maintenance','payment','administrative_pending','property_handover')
  );

alter table public.shadow_conversation_actions
  drop constraint if exists shadow_conversation_actions_operational_follow_up_check;
alter table public.shadow_conversation_actions
  add constraint shadow_conversation_actions_operational_follow_up_check check (
    operational_follow_up is null or (
      jsonb_typeof(operational_follow_up) = 'object'
      and operational_follow_up->>'executable' = 'false'
      and (
        (
          operational_follow_up->>'type' = 'third_party_administrative_follow_up'
          and operational_follow_up->>'status' = 'pending_human_authorization'
        )
        or (
          operational_follow_up->>'type' = 'sensitive_internal_handoff'
          and operational_follow_up->>'status' = 'pending_human_review'
          and operational_follow_up->>'reason' = 'cost_and_responsibility_require_human_review'
        )
      )
    )
  );

comment on constraint shadow_conversation_actions_case_domain_check on public.shadow_conversation_actions is
  'Dominios 3B normalizados; property_handover siempre queda fuera del sender y R1 hasta confirmación operativa';
comment on constraint shadow_conversation_actions_operational_follow_up_check on public.shadow_conversation_actions is
  'Seguimientos internos sanitizados y no ejecutables; admite handoff humano por costo/responsabilidad';

commit;
