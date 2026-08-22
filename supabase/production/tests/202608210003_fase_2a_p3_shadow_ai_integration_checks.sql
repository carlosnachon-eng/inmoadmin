do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name='operational_event_id') then raise exception 'operational_event_id ausente'; end if;
  if not exists(select 1 from pg_constraint where conname='shadow_ai_runs_input_kind_check') then raise exception 'input kind check ausente'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='shadow_ai_runs_operational_completed_uidx') then raise exception 'idempotencia operational ausente'; end if;
  if not (select relrowsecurity from pg_class where oid='public.shadow_ai_runs'::regclass) or not (select relrowsecurity from pg_class where oid='public.shadow_ai_decisions'::regclass) then raise exception 'RLS off'; end if;
  if has_table_privilege('anon','public.shadow_ai_runs','SELECT') or has_table_privilege('anon','public.shadow_ai_decisions','SELECT') then raise exception 'anon con acceso'; end if;
  if has_table_privilege('authenticated','public.shadow_ai_runs','INSERT') or has_table_privilege('authenticated','public.shadow_ai_runs','UPDATE') or has_table_privilege('authenticated','public.shadow_ai_runs','DELETE') then raise exception 'authenticated con escritura AI'; end if;
  if not has_table_privilege('service_role','public.shadow_ai_runs','INSERT') or not has_table_privilege('service_role','public.shadow_ai_decisions','INSERT') then raise exception 'service_role incompleto'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename in ('shadow_ai_runs','shadow_ai_decisions') and (qual='true' or with_check='true')) then raise exception 'policy abierta'; end if;
end $$;
