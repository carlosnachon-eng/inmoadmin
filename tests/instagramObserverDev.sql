-- Controlled synthetic fixtures; entire transaction is rolled back, including receipts.
begin;
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if has_function_privilege(r,'public.observe_instagram_dev_v1(text,text,jsonb)','EXECUTE')
      or has_schema_privilege(r,'instagram_observer_private','USAGE')
      or has_table_privilege(r,'instagram_observer_private.events','SELECT') then raise exception 'ACL fail'; end if;
  end loop;
  if not has_function_privilege('service_role','public.observe_instagram_dev_v1(text,text,jsonb)','EXECUTE')
    or has_schema_privilege('service_role','instagram_observer_private','USAGE')
    or has_table_privilege('service_role','instagram_observer_private.events','INSERT')
    or has_table_privilege('service_role','instagram_observer_private.events','UPDATE')
    or has_table_privilege('service_role','instagram_observer_private.events','DELETE') then raise exception 'service ACL fail'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='instagram_observer_private' and c.relkind='r' and not c.relrowsecurity) then raise exception 'RLS fail'; end if;
end $$;
set local role service_role;
do $$
declare a jsonb; b jsonb; e jsonb := jsonb_build_array(jsonb_build_object(
 'observation_key',repeat('a',64),'kind','dm','native_id','mid.DEV_SYNTHETIC',
 'subject_ref',repeat('b',64),'media_id',null,'parent_id',null,
 'occurred_at','2026-10-11T00:00:00Z','provenance','customer_inbound','relation_state','exact_subject'));
begin
 a := public.observe_instagram_dev_v1('17841440384433670',repeat('c',64),e);
 b := public.observe_instagram_dev_v1('17841440384433670',repeat('c',64),e);
 if a <> '{"durable":true,"inserted":1,"duplicates":0}'::jsonb
   or b <> '{"durable":true,"inserted":0,"duplicates":1}'::jsonb then raise exception 'idempotence fail'; end if;
 begin
   perform public.observe_instagram_dev_v1('foreign',repeat('d',64),e);
   raise exception 'scope accepted';
 exception when others then if sqlerrm <> 'instagram_observation_invalid' then raise; end if; end;
 begin
   perform public.observe_instagram_dev_v1('17841440384433670',repeat('d',64),jsonb_build_array(e->0 || '{"text":"must not persist"}'::jsonb));
   raise exception 'extra field accepted';
 exception when others then if sqlerrm <> 'instagram_projection_invalid' then raise; end if; end;
 begin
   perform public.observe_instagram_dev_v1('17841440384433670',repeat('d',64),jsonb_build_array(e->0 || '{"observation_key":null}'::jsonb));
   raise exception 'null accepted';
 exception when not_null_violation then null; end;
 begin
   perform public.observe_instagram_dev_v1('17841440384433670',repeat('d',64),jsonb_build_array(e->0 || jsonb_build_object('observation_key',repeat('e',64),'provenance','human_confirmed')));
   raise exception 'human invented';
 exception when check_violation then null; end;
 begin
   perform count(*) from instagram_observer_private.events;
   raise exception 'direct read accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS' as result, 'ACL/RLS/service-role RPC/idempotence/scope/allowlist/no invented human/atomic rollback' as checks;
rollback;
select (select count(*) from instagram_observer_private.events) as events_remaining,
 (select count(*) from instagram_observer_private.receipts) as receipts_remaining;
