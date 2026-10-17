-- Read-only catalog postcheck. No fixture, no provider, no authorization.
begin read only;
set local statement_timeout='30s';
do $$
declare f record; item record;
begin
  if to_regclass('public.shadow_manual_prod_turn_control') is null then raise exception 'manual_prod_control_missing'; end if;
  if not(select relrowsecurity from pg_class where oid='public.shadow_manual_prod_turn_control'::regclass)
    or has_table_privilege('anon','public.shadow_manual_prod_turn_control','SELECT')
    or has_table_privilege('authenticated','public.shadow_manual_prod_turn_control','SELECT')
    or has_table_privilege('service_role','public.shadow_manual_prod_turn_control','DELETE')
    or has_table_privilege('service_role','public.shadow_manual_prod_turn_control','TRUNCATE')
    then raise exception 'manual_prod_acl_failed'; end if;
  for item in select priv from (values ('SELECT'),('INSERT'),('UPDATE')) as p(priv) loop
    if not has_table_privilege('service_role','public.shadow_manual_prod_turn_control',item.priv) then raise exception 'manual_prod_acl_failed'; end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid='public.shadow_manual_prod_turn_control'::regclass and contype='f'
    and confrelid in ('public.shadow_ai_manual_authorizations'::regclass,'public.shadow_ai_runs'::regclass))<>2 then raise exception 'manual_prod_fk_failed'; end if;
  if (select count(*) from pg_constraint where conrelid='public.shadow_manual_prod_turn_control'::regclass and contype in ('u','p'))<>4 then raise exception 'manual_prod_uniques_failed'; end if;
  if not exists(select 1 from pg_index where indexrelid=to_regclass('public.shadow_manual_prod_run_once_idx') and indisunique and indisvalid) then raise exception 'manual_prod_run_index_failed'; end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in
    ('authorize_manual_shadow_prod_turn','claim_manual_shadow_prod_turn','reserve_manual_shadow_prod_round','close_manual_shadow_prod_turn'))<>4 then raise exception 'manual_prod_rpc_missing'; end if;
  for f in select oid,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname in
    ('authorize_manual_shadow_prod_turn','claim_manual_shadow_prod_turn','reserve_manual_shadow_prod_round','close_manual_shadow_prod_turn') loop
    if f.prosecdef or not ('search_path=""'=any(f.proconfig)) or has_function_privilege('anon',f.oid,'EXECUTE')
      or has_function_privilege('authenticated',f.oid,'EXECUTE') or not has_function_privilege('service_role',f.oid,'EXECUTE') then raise exception 'manual_prod_rpc_acl_failed'; end if;
  end loop;
  for item in select * from (values
    ('shadow_manual_prod_control_immutable','shadow_manual_prod_turn_control'),('shadow_manual_prod_control_no_truncate','shadow_manual_prod_turn_control'),
    ('shadow_manual_prod_authorization_guard','shadow_ai_manual_authorizations'),('shadow_manual_prod_run_guard','shadow_ai_runs'),
    ('shadow_manual_prod_action_human_gate','shadow_conversation_actions'),('shadow_manual_prod_decision_immutable','shadow_ai_decisions'),
    ('shadow_manual_prod_sender_gate','shadow_admin_outbound_messages')) as expected(name,tab) loop
    if not exists(select 1 from pg_trigger where tgname=item.name and tgrelid=to_regclass('public.'||item.tab) and not tgisinternal and tgenabled='O')
      then raise exception 'manual_prod_trigger_missing: %',item.name; end if;
  end loop;
  if has_table_privilege('anon','public.shadow_manual_prod_turn_message_refs','SELECT')
    or has_table_privilege('authenticated','public.shadow_manual_prod_turn_message_refs','SELECT')
    or not has_table_privilege('service_role','public.shadow_manual_prod_turn_message_refs','SELECT')
    or not(select 'security_invoker=true'=any(reloptions) from pg_class where oid='public.shadow_manual_prod_turn_message_refs'::regclass) then raise exception 'manual_prod_view_acl_failed'; end if;
end $$;
select 'MANUAL_SHADOW_PROD_CATALOG_PASS' as result;
commit;
