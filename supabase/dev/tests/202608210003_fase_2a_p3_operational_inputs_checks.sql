do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name='operational_event_id' and is_nullable='YES') then raise exception 'operational_event_id ausente'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='shadow_ai_runs' and column_name='message_id' and is_nullable='YES') then raise exception 'message_id debe admitir NULL sólo para operational input'; end if;
  if not exists(select 1 from pg_constraint where conname='shadow_ai_runs_input_kind_check') then raise exception 'input kind constraint ausente'; end if;
  if not (select relrowsecurity from pg_class where oid='public.shadow_ai_runs'::regclass) then raise exception 'RLS off'; end if;
  if has_table_privilege('anon','public.shadow_ai_runs','SELECT') or has_table_privilege('anon','public.shadow_ai_runs','INSERT') then raise exception 'anon con privilegios'; end if;
  if has_table_privilege('authenticated','public.shadow_ai_runs','INSERT') or has_table_privilege('authenticated','public.shadow_ai_runs','UPDATE') or has_table_privilege('authenticated','public.shadow_ai_runs','DELETE') then raise exception 'authenticated con escritura directa'; end if;
end $$;
