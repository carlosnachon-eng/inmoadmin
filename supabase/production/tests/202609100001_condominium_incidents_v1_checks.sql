do $$ begin
 if (select count(*) from public.maintenance_tickets where legacy_record)<>47 then raise exception 'LEGACY_TICKET_COUNT_CHANGED'; end if;
 if exists(select 1 from public.maintenance_tickets where not legacy_record) then raise exception 'V1_REAL_ACTIVITY_UNEXPECTED'; end if;
 if not (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.maintenance_tickets'::regclass) then raise exception 'TICKET_FORCE_RLS_MISSING'; end if;
 if not (select relforcerowsecurity from pg_class where oid='public.maintenance_ticket_updates'::regclass) or not (select relforcerowsecurity from pg_class where oid='public.maintenance_ticket_evidence'::regclass) then raise exception 'CHILD_FORCE_RLS_MISSING'; end if;
 if (select public from storage.buckets where id='condominium-incident-evidence') then raise exception 'INCIDENT_BUCKET_PUBLIC'; end if;
end $$;
select 'CONDOMINIUM_INCIDENTS_V1_POSTCHECK_OK' as result;
