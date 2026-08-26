do $$ begin
  if to_regclass('public.shadow_media_interpretations') is null then raise exception 'missing shadow_media_interpretations'; end if;
  if not (select relrowsecurity from pg_class where oid='public.shadow_media_interpretations'::regclass) then raise exception 'RLS disabled'; end if;
  if has_table_privilege('anon','public.shadow_media_interpretations','SELECT,INSERT,UPDATE,DELETE') then raise exception 'anon access present'; end if;
  if has_table_privilege('authenticated','public.shadow_media_interpretations','SELECT,INSERT,UPDATE,DELETE') then raise exception 'authenticated access present'; end if;
  if not has_table_privilege('service_role','public.shadow_media_interpretations','SELECT,INSERT,UPDATE') then raise exception 'service_role grants missing'; end if;
  if has_table_privilege('service_role','public.shadow_media_interpretations','DELETE') then raise exception 'service_role delete should remain unavailable'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and tablename='shadow_media_interpretations' and indexname='shadow_media_interpretation_content_runtime_uidx') then raise exception 'idempotency index missing'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='shadow_media_interpretations') then raise exception 'unexpected client policy'; end if;
end $$;
select status,count(*) from public.shadow_media_interpretations group by status order by status;
