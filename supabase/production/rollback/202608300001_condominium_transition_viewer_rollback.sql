begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$
begin
  if exists(select 1 from public.profiles where role_id='antive_transition') then
    raise exception 'ROLLBACK ABORTADO: existen perfiles Antive que deben conservarse y revocarse de forma conciliada.';
  end if;
end $$;

drop policy if exists cuotas_transition_viewer_select on public.cuotas_condominio;
drop policy if exists historical_recoveries_transition_viewer_select on public.condominium_historical_recoveries;
drop policy if exists maintenance_transition_viewer_select on public.maintenance_tickets;
drop policy if exists operation_controls_transition_viewer_select on public.condominium_operation_controls;
drop function if exists public.condominium_transition_viewer_permission(uuid,text);
delete from public.roles where id='antive_transition' and nombre='Antive — Transición / Consulta' and es_externo=true;
commit;

