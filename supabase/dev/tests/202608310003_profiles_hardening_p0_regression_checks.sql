begin transaction read only;

do $$
declare
  v_genova uuid := '2a224000-0000-4000-8000-000000000001';
  v_tecaxco uuid := '2a223000-0000-4000-8000-000000000001';
  v_second uuid := '2a223000-0000-4000-8000-000000000002';
  v_table text;
begin
  if (select count(*) from public.unidades_condominio where condominio_id=v_tecaxco)<>6 then
    raise exception 'REGRESSION: Tecaxco sanitizado cambió unidades';
  end if;
  if exists(select 1 from public.condominium_operation_controls where condominio_id=v_tecaxco) then
    raise exception 'REGRESSION: Tecaxco dejó de ser legacy';
  end if;
  if (select count(*) from public.unidades_condominio where condominio_id=v_second)<>4 then
    raise exception 'REGRESSION: segundo tenant cambió unidades';
  end if;
  if (select count(*) from public.unidades_condominio where condominio_id=v_genova)<>24 then
    raise exception 'REGRESSION: Génova sintética cambió unidades';
  end if;
  if not exists(
    select 1 from public.condominium_operation_controls
    where condominio_id=v_genova and lifecycle_status='preimplementation'
      and owner_portal_enabled=false
  ) then
    raise exception 'REGRESSION: controles Génova sintética cambiaron';
  end if;
  if (select count(*) from public.condominium_historical_accounts where condominio_id=v_genova)<>24 then
    raise exception 'REGRESSION: cuentas históricas Génova cambiaron';
  end if;
  if (select count(*) from public.condominium_historical_payments where condominio_id=v_genova)<>41 then
    raise exception 'REGRESSION: pagos históricos Génova cambiaron';
  end if;
  if (select count(*) from public.condominium_historical_recoveries where condominio_id=v_genova)<>0 then
    raise exception 'REGRESSION: aparecieron recuperaciones Génova';
  end if;

  if not exists(select 1 from public.roles where id='antive_transition' and es_externo=true) then
    raise exception 'REGRESSION: rol Antive transición ausente';
  end if;

  foreach v_table in array array[
    'shadow_conversations','shadow_messages','shadow_ingestion_events',
    'shadow_context_matches','shadow_human_evaluations',
    'shadow_context_query_audit','shadow_ai_runs','shadow_ai_decisions'
  ] loop
    if to_regclass('public.'||v_table) is null then raise exception 'REGRESSION: falta tabla Shadow %',v_table; end if;
    if not (select relrowsecurity from pg_class where oid=to_regclass('public.'||v_table)) then raise exception 'REGRESSION: RLS Shadow inactivo en %',v_table; end if;
    if has_table_privilege('anon','public.'||v_table,'select') or has_table_privilege('anon','public.'||v_table,'insert') then raise exception 'REGRESSION: anon obtuvo acceso Shadow %',v_table; end if;
  end loop;
  if exists(
    select 1 from pg_policies
    where schemaname='public' and tablename like 'shadow_%'
      and (coalesce(qual,'')='true' or coalesce(with_check,'')='true')
  ) then
    raise exception 'REGRESSION: apareció policy Shadow abierta';
  end if;
end $$;

select 'PROFILES_HARDENING_P0_REGRESSION_CHECKS_OK' as result;
rollback;
