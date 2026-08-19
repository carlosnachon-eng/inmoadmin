-- Ejecutar exclusivamente en inmoadmin-dev hjfwjnejbcpmknvfpdcq.
do $$ declare name text; begin
  foreach name in array array['shadow_conversations','shadow_messages','shadow_ingestion_events','shadow_context_matches','shadow_human_evaluations','shadow_context_query_audit','shadow_ai_runs','shadow_ai_decisions'] loop
    if to_regclass('public.'||name) is null then raise exception 'Falta tabla %',name; end if;
    if not (select relrowsecurity from pg_class where oid=to_regclass('public.'||name)) then raise exception 'RLS inactivo en %',name; end if;
    if has_table_privilege('anon','public.'||name,'select') or has_table_privilege('anon','public.'||name,'insert') then raise exception 'anon tiene privilegio en %',name; end if;
  end loop;
  if exists(select 1 from pg_policies where schemaname='public' and tablename like 'shadow_%' and (qual='true' or with_check='true')) then raise exception 'Policy shadow abierta'; end if;
  if has_table_privilege('authenticated','public.shadow_messages','insert') then raise exception 'authenticated puede ingerir mensajes'; end if;
  if not has_table_privilege('authenticated','public.shadow_human_evaluations','insert') then raise exception 'Falta privilegio de evaluacion'; end if;
end $$;

do $$ begin
  if (select count(*) from public.shadow_messages where provider='synthetic' and external_message_id like 'FASE2A-P0-%') <> 20 then raise exception 'Seed esperado 20 mensajes'; end if;
  if exists(select 1 from public.shadow_messages where sanitized_text ~* '(https?://|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,})') then raise exception 'PII/URL no sanitizada'; end if;
  if exists(select external_message_id from public.shadow_messages where external_message_id is not null group by provider,external_message_id having count(*)>1) then raise exception 'Mensajes duplicados'; end if;
  if exists(select 1 from public.shadow_ai_runs where status <> 'not_executed') or exists(select 1 from public.shadow_ai_decisions where status <> 'not_executed') then raise exception 'IA fue ejecutada'; end if;
end $$;
