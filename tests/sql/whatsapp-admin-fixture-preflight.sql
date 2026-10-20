-- DEV-only QA preflight. Intentionally read-only: never enable capture to seed data.
-- Execute only against hjfwjnejbcpmknvfpdcq, not Production.
begin read only;
do $$
begin
 begin
  perform public.capture_meta_admin_shadow_v1(
   '1297760461811288','1198305790026665',repeat('a',64),
   '[]'::jsonb,statement_timestamp(),'[]'::jsonb);
  raise exception 'expected_capture_denial_missing';
 exception when check_violation then
  if sqlerrm <> 'meta_admin_capture_disabled' then raise; end if;
 end;
 begin
  perform public.observe_meta_admin_events_v1(
   '1297760461811288','1198305790026665',repeat('a',64),'[]'::jsonb);
  raise exception 'expected_scope_denial_missing';
 exception when insufficient_privilege then
  if sqlerrm <> 'meta_observer_scope_denied' then raise; end if;
 end;
end $$;
select '23514/meta_admin_capture_disabled' as capture_gate_verified,
 '42501/meta_observer_scope_denied' as observer_gate_verified,
 (select count(*) from public.meta_observer_events) as events_residual,
 (select count(*) from meta_admin_private.inbound_inputs) as inputs_residual,
 (select count(*) from meta_admin_private.native_subject_evidence) as evidence_residual;
rollback;
