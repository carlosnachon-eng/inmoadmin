-- Ejecutar exclusivamente en inmoadmin-dev hjfwjnejbcpmknvfpdcq.
do $$
begin
  if coalesce(obj_description('public.ingest_shadow_message(jsonb,jsonb)'::regprocedure,'pg_proc'),'')
       <> 'dev-bootstrap:202608190002:fase-2a-p1-respond-admin' then
    raise exception 'Marcador P1 Respond/Admin ausente';
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid='public.shadow_conversations'::regclass
      and conname='shadow_conversations_provider_check' and pg_get_constraintdef(oid) like '%respond_admin%'
  ) then raise exception 'Provider respond_admin no permitido'; end if;
  if not exists (
    select 1 from pg_constraint where conrelid='public.shadow_messages'::regclass
      and conname='shadow_messages_direction_check' and pg_get_constraintdef(oid) like '%outbound_human%'
  ) then raise exception 'Dirección outbound_human no permitida'; end if;
  if has_function_privilege('anon','public.ingest_shadow_message(jsonb,jsonb)','execute')
     or has_function_privilege('authenticated','public.ingest_shadow_message(jsonb,jsonb)','execute') then
    raise exception 'Ingesta Shadow expuesta fuera de service_role';
  end if;
  if not has_function_privilege('service_role','public.ingest_shadow_message(jsonb,jsonb)','execute') then
    raise exception 'service_role sin ingesta Shadow';
  end if;
end $$;
