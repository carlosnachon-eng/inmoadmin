-- Ejecutar después del rollback base y antes de reinstalar Incidencias V1.
do $$
declare
  status_definition text;
begin
  select pg_get_constraintdef(oid) into status_definition from pg_constraint
  where conrelid='public.maintenance_tickets'::regclass and conname='maintenance_tickets_status_check';
  if status_definition is distinct from 'CHECK ((status = ANY (ARRAY[''nuevo''::text, ''revisado''::text, ''cotizado''::text, ''aprobado''::text, ''en_proceso''::text, ''terminado''::text, ''cerrado''::text, ''cancelado''::text])))' then
    raise exception 'ROLLBACK_STATUS_CONSTRAINT_MISMATCH: %',status_definition;
  end if;
  if (select relrowsecurity is not true or relforcerowsecurity is true from pg_class where oid='public.maintenance_tickets'::regclass) then raise exception 'ROLLBACK_RLS_MISMATCH'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='maintenance_tickets' and column_name in ('unidad_id','reporter_profile_id','responsible_profile_id','idempotency_key','incident_origin','resolution_summary','first_attended_at','resolved_at','closed_at','reopened_at','last_public_update_at','legacy_record')) then raise exception 'ROLLBACK_V1_COLUMN_RESIDUE'; end if;
  if to_regclass('public.maintenance_categories') is not null or to_regclass('public.maintenance_ticket_updates') is not null or to_regclass('public.maintenance_ticket_evidence') is not null then raise exception 'ROLLBACK_V1_TABLE_RESIDUE'; end if;
  if to_regprocedure('public.condominium_create_incident_v1(uuid,uuid,uuid,uuid,text,text,text,text,uuid,uuid,text,text,text,integer)') is not null
     or to_regprocedure('public.condominium_update_incident_v1(uuid,uuid,text,text,uuid,text,text,text)') is not null
     or to_regprocedure('public.condominium_admin_update_incident_v1(uuid,uuid,text,text,uuid,boolean,text,text,text)') is not null then raise exception 'ROLLBACK_V1_RPC_RESIDUE'; end if;
  if exists(select 1 from storage.objects where bucket_id='condominium-incident-evidence') or exists(select 1 from storage.buckets where id='condominium-incident-evidence') then raise exception 'ROLLBACK_V1_STORAGE_RESIDUE'; end if;
  if not has_table_privilege('authenticated','public.maintenance_tickets','select,insert,update,delete') or has_table_privilege('anon','public.maintenance_tickets','select') then raise exception 'ROLLBACK_GRANT_MISMATCH'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='maintenance_tickets' and policyname in ('maintenance_hardened_select','maintenance_hardened_insert','maintenance_hardened_update','maintenance_hardened_delete'))<>4 then raise exception 'ROLLBACK_POLICY_MISMATCH'; end if;
end $$;
select 'CONDOMINIUM_INCIDENTS_V1_ROLLBACK_CERTIFIED' as result;
