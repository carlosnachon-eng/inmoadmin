create or replace function public.ig_business_thread_client_v1(
  p_connection uuid,
  p_thread text,
  p_actor uuid,
  p_op text,
  p_client uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_client uuid;
begin
  if p_thread is null or p_thread='' or p_op not in ('get','set') then raise exception 'invalid_args'; end if;
  if not exists(select 1 from public.profiles where id=p_actor and active=true and role_id in ('admin','coord_operaciones')) then raise exception 'forbidden'; end if;
  if not exists(select 1 from instagram_business_private.connections where id=p_connection and active) then raise exception 'forbidden'; end if;

  if p_op='get' then
    select client_id into v_client
    from instagram_business_private.thread_clients
    where connection_id=p_connection and thread_ref=p_thread;
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

revoke all on function public.ig_business_thread_client_v1(uuid,text,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.ig_business_thread_client_v1(uuid,text,uuid,text,uuid) to service_role;

create or replace function public.ig_business_thread_assignment_v1(
  p_connection uuid,
  p_thread text,
  p_actor uuid,
  p_op text,
  p_advisor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row instagram_business_private.thread_assignments%rowtype;
  v_name text;
begin
  if p_thread is null or p_thread='' or p_op not in ('get','set') then raise exception 'invalid_args'; end if;
  if not exists(select 1 from public.profiles where id=p_actor and active=true and role_id in ('admin','coord_operaciones')) then raise exception 'forbidden'; end if;
  if not exists(select 1 from instagram_business_private.connections where id=p_connection and active) then raise exception 'forbidden'; end if;

  if p_op='get' then
    select * into v_row
    from instagram_business_private.thread_assignments
    where connection_id=p_connection and thread_ref=p_thread;
    if not found then return jsonb_build_object('advisor_id',null,'advisor_name',null,'source',null); end if;
    select coalesce(full_name,email) into v_name from public.profiles where id=v_row.advisor_id;
    return jsonb_build_object('advisor_id',v_row.advisor_id,'advisor_name',v_name,'source','manual','assigned_at',v_row.assigned_at);
  end if;

  if p_advisor is null or not exists(select 1 from public.profiles where id=p_advisor and active=true and role_id in ('asesor','gerente_ventas','admin')) then raise exception 'invalid_advisor'; end if;

  insert into instagram_business_private.thread_assignments(connection_id,thread_ref,advisor_id,assigned_by,assigned_at)
  values(p_connection,p_thread,p_advisor,p_actor,clock_timestamp())
  on conflict(connection_id,thread_ref) do update
    set advisor_id=excluded.advisor_id,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at;

  select coalesce(full_name,email) into v_name from public.profiles where id=p_advisor;
  return jsonb_build_object('advisor_id',p_advisor,'advisor_name',v_name,'source','manual');
end;
$$;

revoke all on function public.ig_business_thread_assignment_v1(uuid,text,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.ig_business_thread_assignment_v1(uuid,text,uuid,text,uuid) to service_role;
