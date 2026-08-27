do $$ begin
  if to_regclass('public.shadow_conversation_actions') is null then raise exception 'shadow_conversation_actions missing'; end if;
  if not (select relrowsecurity from pg_class where oid='public.shadow_conversation_actions'::regclass) then raise exception 'RLS must be enabled'; end if;
  if has_table_privilege('anon','public.shadow_conversation_actions','SELECT')
    or has_table_privilege('anon','public.shadow_conversation_actions','INSERT')
    or has_table_privilege('anon','public.shadow_conversation_actions','UPDATE')
    or has_table_privilege('anon','public.shadow_conversation_actions','DELETE') then raise exception 'anon must have no access'; end if;
  if has_table_privilege('authenticated','public.shadow_conversation_actions','SELECT')
    or has_table_privilege('authenticated','public.shadow_conversation_actions','INSERT')
    or has_table_privilege('authenticated','public.shadow_conversation_actions','UPDATE')
    or has_table_privilege('authenticated','public.shadow_conversation_actions','DELETE') then raise exception 'authenticated must have no direct access'; end if;
  if not has_table_privilege('service_role','public.shadow_conversation_actions','SELECT')
    or not has_table_privilege('service_role','public.shadow_conversation_actions','INSERT')
    or not has_table_privilege('service_role','public.shadow_conversation_actions','UPDATE') then raise exception 'service_role allowlist missing'; end if;
  if has_table_privilege('service_role','public.shadow_conversation_actions','DELETE')
    or has_table_privilege('service_role','public.shadow_conversation_actions','TRUNCATE')
    or has_table_privilege('service_role','public.shadow_conversation_actions','REFERENCES')
    or has_table_privilege('service_role','public.shadow_conversation_actions','TRIGGER') then raise exception 'service_role destructive privileges unavailable'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and tablename='shadow_conversation_actions' and indexname='shadow_conversation_actions_turn_uidx') then raise exception 'turn idempotency index missing'; end if;
  if exists(select 1 from public.shadow_conversation_actions) then raise exception 'migration must not seed conversation actions'; end if;
end $$;
