-- Rollback productivo explícito. Sólo procede si todos los objetos son de esta migración y están vacíos.
begin;

do $$
declare
  table_name text;
  object_count bigint;
begin
  foreach table_name in array array[
    'shadow_conversations','shadow_messages','shadow_ingestion_events',
    'shadow_context_matches','shadow_context_query_audit','shadow_human_evaluations',
    'shadow_ai_runs','shadow_ai_decisions'
  ] loop
    if to_regclass('public.' || table_name) is null then raise exception 'Falta objeto esperado %', table_name; end if;
    if coalesce(obj_description(to_regclass('public.' || table_name),'pg_class'),'')
       <> 'production-migration:202608190003:fase-2a-shadow' then raise exception 'Ownership no comprobado en %', table_name; end if;
    execute format('select count(*) from public.%I', table_name) into object_count;
    if object_count <> 0 then raise exception 'Rollback bloqueado: % contiene datos', table_name; end if;
  end loop;
  if coalesce(obj_description('public.shadow_authorized_role()'::regprocedure,'pg_proc'),'')
       <> 'production-migration:202608190003:fase-2a-shadow'
     or coalesce(obj_description('public.ingest_shadow_message(jsonb,jsonb)'::regprocedure,'pg_proc'),'')
       <> 'production-migration:202608190003:fase-2a-shadow' then
    raise exception 'Ownership de funciones Shadow no comprobado';
  end if;
end $$;

drop function public.ingest_shadow_message(jsonb,jsonb);
drop table public.shadow_ai_decisions;
drop table public.shadow_ai_runs;
drop table public.shadow_context_query_audit;
drop table public.shadow_human_evaluations;
drop table public.shadow_context_matches;
drop table public.shadow_messages;
drop table public.shadow_ingestion_events;
drop table public.shadow_conversations;
drop function public.shadow_authorized_role();

commit;
