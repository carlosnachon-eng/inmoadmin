do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='shadow_conversation_actions' and column_name='interaction_direction'
  ) then raise exception 'interaction_direction missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='shadow_conversation_actions' and column_name='operational_follow_up'
  ) then raise exception 'operational_follow_up missing'; end if;
  if has_table_privilege('anon','public.shadow_conversation_actions','SELECT')
    or has_table_privilege('authenticated','public.shadow_conversation_actions','SELECT') then
    raise exception 'client read must remain unavailable';
  end if;
  if not has_table_privilege('service_role','public.shadow_conversation_actions','SELECT,INSERT,UPDATE') then
    raise exception 'service_role allowlist missing';
  end if;
  if has_table_privilege('service_role','public.shadow_conversation_actions','DELETE')
    or has_table_privilege('service_role','public.shadow_conversation_actions','TRUNCATE')
    or has_table_privilege('service_role','public.shadow_conversation_actions','REFERENCES')
    or has_table_privilege('service_role','public.shadow_conversation_actions','TRIGGER') then
    raise exception 'service_role mutation surface too broad';
  end if;
end $$;
