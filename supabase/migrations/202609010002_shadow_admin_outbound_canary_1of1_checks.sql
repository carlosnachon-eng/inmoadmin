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
  if not exists(
    select 1
    from pg_index i
    join pg_class idx on idx.oid=i.indexrelid
    where idx.relnamespace='public'::regnamespace
      and idx.relname='shadow_admin_outbound_canaries_single_open_uidx'
      and i.indrelid='public.shadow_admin_outbound_canaries'::regclass
      and i.indisunique and i.indisvalid and i.indisready
      and position('(1)' in replace(lower(pg_get_indexdef(i.indexrelid)),' ',''))>0
      and position('status' in lower(coalesce(pg_get_expr(i.indpred,i.indrelid),'')))>0
      and position('open' in lower(coalesce(pg_get_expr(i.indpred,i.indrelid),'')))>0
  ) then raise exception 'single-open canary index missing or invalid'; end if;

  if not exists(
    select 1
    from pg_index i
    join pg_class idx on idx.oid=i.indexrelid
    where idx.relnamespace='public'::regnamespace
      and idx.relname='shadow_admin_outbound_canaries_claimed_action_uidx'
      and i.indrelid='public.shadow_admin_outbound_canaries'::regclass
      and i.indisunique and i.indisvalid and i.indisready
      and position('(claimed_action_id)' in replace(lower(pg_get_indexdef(i.indexrelid)),' ',''))>0
      and position('claimed_action_id' in lower(coalesce(pg_get_expr(i.indpred,i.indrelid),'')))>0
      and position('is not null' in lower(coalesce(pg_get_expr(i.indpred,i.indrelid),'')))>0
  ) then raise exception 'claimed-action canary index missing or invalid'; end if;

  if not exists(
    select 1
    from pg_index i
    join pg_class idx on idx.oid=i.indexrelid
    where idx.relnamespace='public'::regnamespace
      and idx.relname='shadow_admin_outbound_canaries_claimed_outbound_uidx'
      and i.indrelid='public.shadow_admin_outbound_canaries'::regclass
      and i.indisunique and i.indisvalid and i.indisready
      and position('(claimed_outbound_id)' in replace(lower(pg_get_indexdef(i.indexrelid)),' ',''))>0
      and position('claimed_outbound_id' in lower(coalesce(pg_get_expr(i.indpred,i.indrelid),'')))>0
      and position('is not null' in lower(coalesce(pg_get_expr(i.indpred,i.indrelid),'')))>0
  ) then raise exception 'claimed-outbound canary index missing or invalid'; end if;

  if not exists(
    select 1
    from pg_index i
    join pg_class idx on idx.oid=i.indexrelid
    where idx.relnamespace='public'::regnamespace
      and idx.relname='shadow_admin_outbound_messages_canary_uidx'
      and i.indrelid='public.shadow_admin_outbound_messages'::regclass
      and i.indisunique and i.indisvalid and i.indisready
      and position('(canary_id)' in replace(lower(pg_get_indexdef(i.indexrelid)),' ',''))>0
      and position('canary_id' in lower(coalesce(pg_get_expr(i.indpred,i.indrelid),'')))>0
      and position('is not null' in lower(coalesce(pg_get_expr(i.indpred,i.indrelid),'')))>0
  ) then raise exception 'outbound canary unique index missing or invalid'; end if;

  if not exists(
    select 1 from pg_constraint c
    where c.conrelid='public.shadow_admin_outbound_canaries'::regclass
      and c.contype='c'
      and position('max_claims=1' in replace(lower(pg_get_constraintdef(c.oid)),' ',''))>0
  ) then raise exception 'max_claims=1 constraint missing'; end if;

  if not exists(
    select 1 from pg_constraint c
    where c.conrelid='public.shadow_admin_outbound_canaries'::regclass
      and c.contype='c'
      and position('allowed_action' in lower(pg_get_constraintdef(c.oid)))>0
      and position('acknowledge_received_information' in lower(pg_get_constraintdef(c.oid)))>0
  ) then raise exception 'single allowed canary action constraint missing'; end if;

  if not exists(
    select 1 from pg_constraint c
    where c.conrelid='public.shadow_admin_outbound_canaries'::regclass
      and c.contype='c'
      and position('status' in lower(pg_get_constraintdef(c.oid)))>0
      and position('any' in lower(pg_get_constraintdef(c.oid)))>0
      and position('open' in lower(pg_get_constraintdef(c.oid)))>0
      and position('closed' in lower(pg_get_constraintdef(c.oid)))>0
      and position('disabled' in lower(pg_get_constraintdef(c.oid)))>0
  ) then raise exception 'canary status domain constraint missing'; end if;

  if not exists(
    select 1 from pg_constraint c
    where c.conrelid='public.shadow_admin_outbound_canaries'::regclass
      and c.contype='c'
      and position('status=''open''' in replace(lower(pg_get_constraintdef(c.oid)),' ',''))>0
      and position('status=''closed''' in replace(lower(pg_get_constraintdef(c.oid)),' ',''))>0
      and position('status=''disabled''' in replace(lower(pg_get_constraintdef(c.oid)),' ',''))>0
      and position('claimed_count=0' in replace(lower(pg_get_constraintdef(c.oid)),' ',''))>0
      and position('claimed_count=1' in replace(lower(pg_get_constraintdef(c.oid)),' ',''))>0
      and position('claimed_action_idisnull' in replace(lower(pg_get_constraintdef(c.oid)),' ',''))>0
      and position('claimed_action_idisnotnull' in replace(lower(pg_get_constraintdef(c.oid)),' ',''))>0
      and position('claimed_outbound_idisnull' in replace(lower(pg_get_constraintdef(c.oid)),' ',''))>0
      and position('claimed_outbound_idisnotnull' in replace(lower(pg_get_constraintdef(c.oid)),' ',''))>0
      and position('first_claim_consumed' in lower(pg_get_constraintdef(c.oid)))>0
      and position('manual_kill_switch' in lower(pg_get_constraintdef(c.oid)))>0
      and position('preflight_abort' in lower(pg_get_constraintdef(c.oid)))>0
  ) then raise exception 'canary claim/state coherence constraint missing'; end if;

  if not exists(
    select 1
    from pg_trigger t
    where t.tgrelid='public.shadow_admin_outbound_messages'::regclass
      and t.tgname='sync_shadow_admin_outbound_canary_result'
      and not t.tgisinternal
      and t.tgenabled='O'
      and t.tgfoid='public.sync_shadow_admin_outbound_canary_result()'::regprocedure
      and t.tgtype=21
      and cardinality(t.tgattr::smallint[])=2
      and (
        select count(*)
        from pg_attribute a
        where a.attrelid=t.tgrelid
          and a.attnum=any(t.tgattr::smallint[])
          and a.attname in ('status','provider_message_id')
      )=2
  ) then raise exception 'canary sender result trigger binding/events invalid'; end if;

  if exists(select 1 from public.shadow_admin_outbound_canaries) then raise exception 'migration must not arm or seed a canary'; end if;
  if exists(select 1 from public.shadow_admin_outbound_messages where canary_id is not null) then raise exception 'migration must not claim outbound work'; end if;
end $$;
