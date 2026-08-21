do $$ begin
  if (select count(*) from public.inmoadmin_operational_events where idempotency_key like 'FASE2A-OP-EVENT-QA:%')<>4 then raise exception 'Outbox fixtures != 4'; end if;
  if (select count(*) from public.shadow_operational_events where payload_safe->>'ticketId' like 'f2a40000-%')<>4 then raise exception 'Shadow operational fixtures != 4'; end if;
  if exists(select 1 from public.inmoadmin_operational_events where idempotency_key like 'FASE2A-OP-EVENT-QA:%' and processed_at is null) then raise exception 'Fixture pendiente tras éxito'; end if;
  if not exists(select 1 from public.shadow_operational_events where maintenance_scope='managed_property' and property_id is not null) then raise exception 'Managed scope inválido'; end if;
  if not exists(select 1 from public.shadow_operational_events where maintenance_scope='external_job' and property_id is null and payload_safe ? 'workReference') then raise exception 'External scope inválido'; end if;
  if exists(select 1 from public.inmoadmin_operational_events where payload_safe::text ~* '(https?://|[[:alnum:]._%+-]+@[[:alnum:].-]+)') then raise exception 'PII/URL en payload'; end if;
  if exists(select 1 from public.inmoadmin_operational_events e cross join lateral jsonb_object_keys(e.payload_safe) k where k not in ('eventType','ticketId','quoteId','maintenanceScope','propertyId','workReference','priority','payer','status','quoteStatus','ticketStatus','amount','providerCost','occurredAt')) then raise exception 'Campo no allowlisted en payload'; end if;
  if has_table_privilege('anon','public.inmoadmin_operational_events','select') or has_table_privilege('anon','public.shadow_operational_events','select') then raise exception 'anon tiene acceso'; end if;
  if has_table_privilege('authenticated','public.inmoadmin_operational_events','insert,update,delete') or has_table_privilege('authenticated','public.shadow_operational_events','insert,update,delete') then raise exception 'authenticated puede escribir'; end if;
  if not (select relrowsecurity from pg_class where oid='public.inmoadmin_operational_events'::regclass) or not (select relrowsecurity from pg_class where oid='public.shadow_operational_events'::regclass) then raise exception 'RLS apagado'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename in ('inmoadmin_operational_events','shadow_operational_events') and (qual='true' or with_check='true')) then raise exception 'Policy abierta'; end if;
  if exists(select 1 from public.shadow_ai_runs r join public.shadow_messages m on m.id=r.message_id where m.external_message_id like 'FASE2A-OP-EVENT-QA%') then raise exception 'AI run creado'; end if;
end $$;
select event_type,maintenance_scope,count(*) from public.shadow_operational_events where payload_safe->>'ticketId' like 'f2a40000-%' group by event_type,maintenance_scope order by 1,2;
