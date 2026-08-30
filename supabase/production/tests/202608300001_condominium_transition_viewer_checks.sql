begin transaction read only;
do $$
declare policy_count integer;
begin
  if not exists(select 1 from public.roles where id='antive_transition' and nombre='Antive — Transición / Consulta' and es_externo=true) then
    raise exception 'CHECK: falta rol externo Antive';
  end if;
  if to_regprocedure('public.condominium_transition_viewer_permission(uuid,text)') is null then
    raise exception 'CHECK: falta helper transition viewer';
  end if;
  select count(*) into policy_count from pg_policies where schemaname='public' and policyname in (
    'cuotas_transition_viewer_select','historical_recoveries_transition_viewer_select',
    'maintenance_transition_viewer_select','operation_controls_transition_viewer_select'
  ) and cmd='SELECT' and roles='{authenticated}';
  if policy_count<>4 then raise exception 'CHECK: faltan políticas SELECT del visor Antive'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and policyname like '%transition_viewer%' and cmd<>'SELECT') then
    raise exception 'CHECK: transition viewer recibió política de escritura';
  end if;
  if has_function_privilege('anon','public.condominium_transition_viewer_permission(uuid,text)','execute') then
    raise exception 'CHECK: anon puede ejecutar helper transition viewer';
  end if;
end $$;
select 'CONDOMINIUM_TRANSITION_VIEWER_CHECKS_OK' as result;
rollback;

