begin;
do $$
declare before_count bigint; before_fp text; after_fp text;
begin
 select count(*),md5(coalesce(string_agg(md5(row_to_json(t)::text),'' order by t.id::text),'')) into before_count,before_fp from public.maintenance_tickets t where t.legacy_record;
 if exists(select 1 from public.maintenance_tickets where legacy_record and unidad_id is not null) then raise exception 'LEGACY_BACKFILL_FORBIDDEN'; end if;
 if not (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.maintenance_tickets'::regclass) then raise exception 'RLS_FORCE_MISSING'; end if;
 if (select public from storage.buckets where id='condominium-incident-evidence') then raise exception 'INCIDENT_BUCKET_PUBLIC'; end if;
 if has_table_privilege('anon','public.maintenance_ticket_updates','SELECT') or has_table_privilege('anon','public.maintenance_ticket_evidence','SELECT') then raise exception 'ANON_ACCESS'; end if;
 if exists(select 1 from pg_policies where schemaname='public' and tablename='maintenance_tickets' and cmd='DELETE' and qual not like '%legacy_record%') then raise exception 'V1_PHYSICAL_DELETE_ALLOWED'; end if;
 select md5(coalesce(string_agg(md5(row_to_json(t)::text),'' order by t.id::text),'')) into after_fp from public.maintenance_tickets t where t.legacy_record;
 if before_fp<>after_fp then raise exception 'LEGACY_FINGERPRINT_CHANGED'; end if;
end $$;
select 'CONDOMINIUM_INCIDENTS_V1_TESTS_OK' as result;
rollback;
