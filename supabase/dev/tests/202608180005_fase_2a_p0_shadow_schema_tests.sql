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
  if (select count(*) from public.shadow_context_matches) = 0 then raise exception 'Pipeline QA no creó context matches'; end if;
  if (select count(*) from public.shadow_context_query_audit) = 0 then raise exception 'Pipeline QA no auditó consultas'; end if;
  if not exists(select 1 from public.shadow_context_matches where ambiguous) then raise exception 'Falta escenario de contexto ambiguo'; end if;
  if not exists(select 1 from public.shadow_messages m where not exists(select 1 from public.shadow_context_matches c where c.message_id=m.id)) then raise exception 'Falta escenario unresolved'; end if;
  if exists(select 1 from public.shadow_context_query_audit where result_count > 5) then raise exception 'Consulta superó límite 5'; end if;
  if not exists(select 1 from public.shadow_ingestion_events where sanitization_changed) then raise exception 'Fixture vivo de privacidad no fue sanitizado'; end if;
  if (select coalesce(sum(duplicate_count),0) from public.shadow_ingestion_events) <> 1 then raise exception 'Duplicado controlado esperado = 1'; end if;
  if exists(select 1 from public.shadow_context_query_audit where tool_name not in ('find_properties','find_active_contracts','get_payment_summary','get_service_period_status','get_maintenance_ticket_summary','get_work_center_case','get_key_custody_status','get_owner_liquidation_summary','get_policy_or_signature_case','get_condominium_fee_summary')) then raise exception 'Tool no allowlisted'; end if;
end $$;
