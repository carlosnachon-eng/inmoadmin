do $$
begin
  if to_regclass('public.shadow_admin_outbound_canaries') is null then raise exception 'canary table missing'; end if;
  if not (select relrowsecurity from pg_class where oid='public.shadow_admin_outbound_canaries'::regclass) then raise exception 'canary RLS must be enabled'; end if;
  if has_table_privilege('anon','public.shadow_admin_outbound_canaries','SELECT')
    or has_table_privilege('authenticated','public.shadow_admin_outbound_canaries','SELECT') then
    raise exception 'canary client access forbidden';
  end if;
  if not has_table_privilege('service_role','public.shadow_admin_outbound_canaries','SELECT') then
    raise exception 'canary service_role read missing';
  end if;
  if has_table_privilege('service_role','public.shadow_admin_outbound_canaries','INSERT')
    or has_table_privilege('service_role','public.shadow_admin_outbound_canaries','UPDATE')
    or has_table_privilege('service_role','public.shadow_admin_outbound_canaries','DELETE') then
    raise exception 'canary direct service_role mutation forbidden';
  end if;
  if to_regprocedure('public.arm_shadow_admin_outbound_canary(timestamp with time zone)') is null then raise exception 'canary arm function missing'; end if;
  if to_regprocedure('public.disable_shadow_admin_outbound_canary(uuid,text)') is null then raise exception 'canary kill switch missing'; end if;
  if to_regprocedure('public.claim_shadow_admin_outbound_canary(text,uuid,timestamp with time zone)') is null then raise exception 'canary claim missing'; end if;
  if not has_function_privilege('service_role','public.arm_shadow_admin_outbound_canary(timestamp with time zone)','EXECUTE')
    or not has_function_privilege('service_role','public.disable_shadow_admin_outbound_canary(uuid,text)','EXECUTE')
    or not has_function_privilege('service_role','public.claim_shadow_admin_outbound_canary(text,uuid,timestamp with time zone)','EXECUTE') then
    raise exception 'canary service_role execute allowlist missing';
  end if;
  if has_function_privilege('anon','public.claim_shadow_admin_outbound_canary(text,uuid,timestamp with time zone)','EXECUTE')
    or has_function_privilege('authenticated','public.claim_shadow_admin_outbound_canary(text,uuid,timestamp with time zone)','EXECUTE') then
    raise exception 'canary claim must remain server-side';
  end if;
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='shadow_admin_outbound_messages' and column_name='canary_id'
  ) then raise exception 'outbound canary link missing'; end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.shadow_admin_outbound_messages'::regclass and tgname='sync_shadow_admin_outbound_canary_result' and not tgisinternal) then
    raise exception 'canary sender result trigger missing';
  end if;
  if exists(select 1 from public.shadow_admin_outbound_canaries) then raise exception 'migration must not arm or seed a canary'; end if;
end $$;
