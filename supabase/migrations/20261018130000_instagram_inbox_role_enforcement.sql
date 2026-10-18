create or replace function public.ig_business_threads_v1(p_connection uuid,p_actor uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x order by x.last_activity desc),'[]'::jsonb) from (
  select e.thread_ref,max(e.occurred_at) as last_activity,
         'instagram_login_business'::text as provider,'instagram_dm'::text as thread_type,
         max(a.alias) as alias
  from instagram_business_private.events e
  join instagram_business_private.connections c on c.id=e.connection_id
  left join instagram_business_private.thread_aliases a on a.connection_id=e.connection_id and a.thread_ref=e.thread_ref
  where e.connection_id=p_connection
    and c.active
    and instagram_business_private.operator(p_connection,p_actor)
    and instagram_business_private.thread_visible(p_connection,e.thread_ref,p_actor)
  group by e.thread_ref order by max(e.occurred_at) desc limit 100
 ) x;
$$;

create or replace function public.ig_business_history_v1(p_connection uuid,p_thread text,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not instagram_business_private.operator(p_connection,p_actor)
    or not exists(select 1 from instagram_business_private.connections where id=p_connection and active)
    or not instagram_business_private.thread_visible(p_connection,p_thread,p_actor)
 then return null; end if;
 return jsonb_build_object(
  'rows',(select coalesce(jsonb_agg(x order by x.occurred_at),'[]'::jsonb) from (
   select e.*, 'instagram_login_business'::text as provider,'instagram_dm'::text as thread_type,
   exists(select 1 from instagram_business_private.attention t
          where t.connection_id=p_connection and t.thread_ref=p_thread and paused) as paused,
   exists(select 1 from instagram_business_private.actions a
          where a.connection_id=e.connection_id and a.outbound_ref=e.message_ref and a.status='accepted') as manual_confirmed,
   (select a.status from instagram_business_private.actions a
    where a.connection_id=e.connection_id and a.input=e.event_ref
    order by a.reserved_at desc limit 1) as status,
   (select a.action from instagram_business_private.actions a
    where a.connection_id=e.connection_id and a.input=e.event_ref
    order by a.reserved_at desc limit 1) as last_action_id
   from instagram_business_private.events e
   where e.connection_id=p_connection and e.thread_ref=p_thread
   order by e.occurred_at desc limit 100
  ) x),
  'tombstones',(select coalesce(jsonb_agg(message_ref),'[]'::jsonb)
                from instagram_business_private.events
                where connection_id=p_connection and thread_ref=p_thread and kind='unsent')
 );
end;
$$;

create or replace function public.ig_business_input_v1(p_connection uuid,p_input text,p_actor uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with target as (
  select e.*
  from instagram_business_private.events e
  join instagram_business_private.connections c on c.id=e.connection_id
  where e.connection_id=p_connection
    and e.event_ref=p_input
    and c.active
    and instagram_business_private.operator(p_connection,p_actor)
    and instagram_business_private.thread_visible(p_connection,e.thread_ref,p_actor)
    and e.kind='inbound'
    and e.recipient_box is not null
    and e.occurred_at<=clock_timestamp()
    and e.occurred_at>clock_timestamp()-interval '23 hours'
 ), chosen as (
  select t.* from target t
  where not exists (
   select 1 from instagram_business_private.events u
   where u.connection_id=t.connection_id and u.message_ref=t.message_ref and u.kind='unsent'
  )
  and not exists (
   select 1 from instagram_business_private.events x
   where x.connection_id=t.connection_id and x.message_ref=t.message_ref and x.kind='inbound'
     and (x.thread_ref<>t.thread_ref or x.subject_ref<>t.subject_ref)
  )
  order by case when t.source='webhook' then 0 else 1 end,t.occurred_at desc limit 1
 )
 select to_jsonb(e)||jsonb_build_object('provider',c.provider,'thread_type','instagram_dm','deleted',false,'ambiguous',false)
 from chosen e join instagram_business_private.connections c on c.id=e.connection_id;
$$;

create or replace function public.ig_business_thread_alias_v1(
 p_connection uuid,p_thread text,p_actor uuid,p_op text,p_alias text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_alias text;
begin
 if not instagram_business_private.operator(p_connection,p_actor)
    or not instagram_business_private.thread_visible(p_connection,p_thread,p_actor)
 then raise exception 'forbidden'; end if;
 if p_thread !~ '^[a-f0-9]{64}$' then raise exception 'bad_thread'; end if;
 if not exists(select 1 from instagram_business_private.events e join instagram_business_private.connections c on c.id=e.connection_id
               where e.connection_id=p_connection and e.thread_ref=p_thread and c.active) then raise exception 'thread_missing'; end if;
 if p_op='get' then
  select a.alias into v_alias from instagram_business_private.thread_aliases a
  where a.connection_id=p_connection and a.thread_ref=p_thread;
  return jsonb_build_object('alias',v_alias);
 elsif p_op='set' then
  if p_alias is null or btrim(p_alias)='' then
   delete from instagram_business_private.thread_aliases where connection_id=p_connection and thread_ref=p_thread;
   return jsonb_build_object('alias',null);
  end if;
  v_alias:=btrim(p_alias);
  if char_length(v_alias)>80 or v_alias ~ '[[:cntrl:]]' then raise exception 'bad_alias'; end if;
  insert into instagram_business_private.thread_aliases(connection_id,thread_ref,alias,updated_by)
  values(p_connection,p_thread,v_alias,p_actor)
  on conflict(connection_id,thread_ref) do update set alias=excluded.alias,updated_by=excluded.updated_by,updated_at=clock_timestamp();
  return jsonb_build_object('alias',v_alias);
 else raise exception 'bad_op'; end if;
end;
$$;

create or replace function public.ig_business_thread_contact_v1(
 p_connection uuid,p_thread text,p_actor uuid,p_op text,p_phone text default null,p_email text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_phone text;v_email text;
begin
 if not instagram_business_private.operator(p_connection,p_actor)
    or not instagram_business_private.thread_visible(p_connection,p_thread,p_actor)
 then raise exception 'forbidden'; end if;
 if p_thread !~ '^[a-f0-9]{64}$' then raise exception 'bad_thread'; end if;
 if not exists(select 1 from instagram_business_private.events e join instagram_business_private.connections c on c.id=e.connection_id
               where e.connection_id=p_connection and e.thread_ref=p_thread and c.active) then raise exception 'thread_missing'; end if;
 if p_op='get' then
  select phone,email into v_phone,v_email from instagram_business_private.thread_contacts
  where connection_id=p_connection and thread_ref=p_thread;
  return jsonb_build_object('phone',v_phone,'email',v_email);
 elsif p_op='set' then
  v_phone:=nullif(btrim(coalesce(p_phone,'')),'');
  v_email:=nullif(lower(btrim(coalesce(p_email,''))),'');
  if v_phone is not null and (char_length(v_phone)<7 or char_length(v_phone)>32 or v_phone ~ '[[:cntrl:]]') then raise exception 'bad_phone'; end if;
  if v_email is not null and (char_length(v_email)<5 or char_length(v_email)>254 or v_email ~ '[[:cntrl:]]' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'bad_email'; end if;
  if v_phone is null and v_email is null then
   delete from instagram_business_private.thread_contacts where connection_id=p_connection and thread_ref=p_thread;
   return jsonb_build_object('phone',null,'email',null);
  end if;
  insert into instagram_business_private.thread_contacts(connection_id,thread_ref,phone,email,updated_by)
  values(p_connection,p_thread,v_phone,v_email,p_actor)
  on conflict(connection_id,thread_ref) do update set phone=excluded.phone,email=excluded.email,updated_by=excluded.updated_by,updated_at=clock_timestamp();
  return jsonb_build_object('phone',v_phone,'email',v_email);
 else raise exception 'bad_op'; end if;
end;
$$;

create or replace function public.ig_business_thread_client_v1(
 p_connection uuid,p_thread text,p_actor uuid,p_op text,p_client uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_client uuid;
begin
 if p_thread is null or p_thread='' or p_op not in ('get','set') then raise exception 'invalid_args'; end if;
 if not instagram_business_private.operator(p_connection,p_actor)
    or not instagram_business_private.thread_visible(p_connection,p_thread,p_actor)
 then raise exception 'forbidden'; end if;
 if p_op='get' then
  select client_id into v_client from instagram_business_private.thread_clients where connection_id=p_connection and thread_ref=p_thread;
  return jsonb_build_object('client_id',v_client);
 end if;
 if p_client is null or not exists(select 1 from public.clientes where id=p_client) then raise exception 'invalid_client'; end if;
 insert into instagram_business_private.thread_clients(connection_id,thread_ref,client_id,linked_by,linked_at)
 values(p_connection,p_thread,p_client,p_actor,clock_timestamp())
 on conflict(connection_id,thread_ref) do update
 set client_id=excluded.client_id,linked_by=excluded.linked_by,linked_at=excluded.linked_at;
 return jsonb_build_object('client_id',p_client);
end;
$$;

create or replace function public.ig_business_thread_assignment_v1(
 p_connection uuid,p_thread text,p_actor uuid,p_op text,p_advisor uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row instagram_business_private.thread_assignments%rowtype;v_name text;
begin
 if p_thread is null or p_thread='' or p_op not in ('get','set') then raise exception 'invalid_args'; end if;
 if not instagram_business_private.operator(p_connection,p_actor)
    or not instagram_business_private.thread_visible(p_connection,p_thread,p_actor)
 then raise exception 'forbidden'; end if;
 if p_op='get' then
  select * into v_row from instagram_business_private.thread_assignments where connection_id=p_connection and thread_ref=p_thread;
  if not found then return jsonb_build_object('advisor_id',null,'advisor_name',null,'source',null); end if;
  select coalesce(full_name,email) into v_name from public.profiles where id=v_row.advisor_id;
  return jsonb_build_object('advisor_id',v_row.advisor_id,'advisor_name',v_name,'source','manual','assigned_at',v_row.assigned_at);
 end if;
 if p_advisor is null or not exists(select 1 from public.profiles where id=p_advisor and active=true and role_id in ('asesor','gerente_ventas','admin'))
 then raise exception 'invalid_advisor'; end if;
 insert into instagram_business_private.thread_assignments(connection_id,thread_ref,advisor_id,assigned_by,assigned_at)
 values(p_connection,p_thread,p_advisor,p_actor,clock_timestamp())
 on conflict(connection_id,thread_ref) do update
 set advisor_id=excluded.advisor_id,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at;
 select coalesce(full_name,email) into v_name from public.profiles where id=p_advisor;
 return jsonb_build_object('advisor_id',p_advisor,'advisor_name',v_name,'source','manual');
end;
$$;

create or replace function public.ig_business_thread_route_v1(
 p_connection uuid,p_thread text,p_actor uuid,p_op text,p_department text default null,p_plaza uuid default null,p_source text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row instagram_business_private.thread_routes%rowtype;v_plaza_name text;
begin
 if p_thread is null or p_thread='' or p_op not in ('get','set') then raise exception 'invalid_args'; end if;
 if not instagram_business_private.operator(p_connection,p_actor)
    or not instagram_business_private.thread_visible(p_connection,p_thread,p_actor)
 then raise exception 'forbidden'; end if;
 if p_op='get' then
  select * into v_row from instagram_business_private.thread_routes where connection_id=p_connection and thread_ref=p_thread;
  if not found then return jsonb_build_object('department','sales','plaza_id',null,'plaza_name',null,'source','channel_default'); end if;
  if v_row.plaza_id is not null then select name into v_plaza_name from public.commercial_plazas where id=v_row.plaza_id; end if;
  return jsonb_build_object('department',v_row.department,'plaza_id',v_row.plaza_id,'plaza_name',v_plaza_name,'source',v_row.source);
 end if;
 if p_department not in ('sales','legal','administration','unclassified') then raise exception 'invalid_department'; end if;
 if p_plaza is not null and not exists(select 1 from public.commercial_plazas where id=p_plaza and active) then raise exception 'invalid_plaza'; end if;
 insert into instagram_business_private.thread_routes(connection_id,thread_ref,department,plaza_id,source,classified_by,classified_at)
 values(p_connection,p_thread,p_department,p_plaza,coalesce(nullif(p_source,''),'manual'),p_actor,clock_timestamp())
 on conflict(connection_id,thread_ref) do update
 set department=excluded.department,plaza_id=excluded.plaza_id,source=excluded.source,classified_by=excluded.classified_by,classified_at=excluded.classified_at;
 if p_plaza is not null then select name into v_plaza_name from public.commercial_plazas where id=p_plaza; end if;
 return jsonb_build_object('department',p_department,'plaza_id',p_plaza,'plaza_name',v_plaza_name,'source',coalesce(nullif(p_source,''),'manual'));
end;
$$;

create or replace function public.ig_business_thread_metadata_v1(p_connection uuid,p_actor uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'thread_ref',x.thread_ref,'advisor_id',x.advisor_id,'advisor_name',coalesce(p.full_name,p.email),
   'department',coalesce(r.department,'sales'),'plaza_id',r.plaza_id,'plaza_name',cp.name,
   'route_source',coalesce(r.source,'channel_default')
 )),'[]'::jsonb)
 from (
   select distinct e.thread_ref,
    coalesce(
      (select c.asesor_id from instagram_business_private.thread_clients tc join public.clientes c on c.id=tc.client_id
       where tc.connection_id=p_connection and tc.thread_ref=e.thread_ref and c.asesor_id is not null limit 1),
      (select ta.advisor_id from instagram_business_private.thread_assignments ta
       where ta.connection_id=p_connection and ta.thread_ref=e.thread_ref limit 1)
    ) advisor_id
   from instagram_business_private.events e
   where e.connection_id=p_connection
     and instagram_business_private.operator(p_connection,p_actor)
     and instagram_business_private.thread_visible(p_connection,e.thread_ref,p_actor)
 ) x
 left join public.profiles p on p.id=x.advisor_id
 left join instagram_business_private.thread_routes r on r.connection_id=p_connection and r.thread_ref=x.thread_ref
 left join public.commercial_plazas cp on cp.id=r.plaza_id;
$$;

drop policy if exists instagram_business_outbound_insert on storage.objects;
create policy instagram_business_outbound_insert on storage.objects
for insert to authenticated
with check (
 bucket_id='instagram-business-outbound'
 and (storage.foldername(name))[1]=(auth.uid())::text
 and exists(
  select 1 from public.profiles p
  where p.id=auth.uid() and p.active=true
    and p.role_id in ('admin','coord_operaciones','gerente_ventas','asesor','juridico')
 )
);
