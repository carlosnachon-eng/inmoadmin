-- DEV ONLY. Elimina exclusivamente objetos marcados por bootstrap 202608180005.
begin;
do $$ declare name text; begin
  foreach name in array array['shadow_ai_decisions','shadow_ai_runs','shadow_context_query_audit','shadow_human_evaluations','shadow_context_matches','shadow_messages','shadow_ingestion_events','shadow_conversations'] loop
    if to_regclass('public.'||name) is not null and coalesce(obj_description(to_regclass('public.'||name),'pg_class'),'') <> 'dev-bootstrap:202608180005:fase-2a-p0-shadow' then
      raise exception 'Rollback bloqueado: %.% no pertenece a P0 shadow', 'public', name;
    end if;
  end loop;
end $$;
drop function if exists public.ingest_shadow_message(jsonb,jsonb);
drop function if exists public.shadow_authorized_role();
drop table if exists public.shadow_ai_decisions;
drop table if exists public.shadow_ai_runs;
drop table if exists public.shadow_human_evaluations;
drop table if exists public.shadow_context_query_audit;
drop table if exists public.shadow_context_matches;
drop table if exists public.shadow_messages;
drop table if exists public.shadow_ingestion_events;
drop table if exists public.shadow_conversations;
commit;
