create table if not exists instagram_business_private.thread_routes (
  connection_id uuid not null references instagram_business_private.connections(id) on delete cascade,
  thread_ref text not null,
  department text not null default 'sales',
  plaza_id uuid null references public.commercial_plazas(id),
  source text not null default 'channel_default',
  classified_by uuid null references public.profiles(id),
  classified_at timestamptz not null default now(),
  primary key(connection_id,thread_ref),
  constraint thread_routes_department_check check (department in ('sales','legal','administration','unclassified'))
);
alter table instagram_business_private.thread_routes enable row level security;
drop policy if exists thread_routes_service_all on instagram_business_private.thread_routes;
create policy thread_routes_service_all
on instagram_business_private.thread_routes
for all to service_role using(true) with check(true);

create or replace function public.ig_business_thread_route_v1(
  p_connection uuid,
  p_thread text,
  p_actor uuid,
  p_op text,
  p_department text default null,
  p_plaza uuid default null,
  p_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row instagram_business_private.thread_routes%rowtype;
  v_plaza_name text;
begin
  if p_thread is null or p_thread='' or p_op not in ('get','set') then raise exception 'invalid_args'; end if;
  if not exists(select 1 from public.profiles where id=p_actor and active=true and role_id in ('admin','coord_operaciones')) then raise exception 'forbidden'; end if;
  if not exists(select 1 from instagram_business_private.connections where id=p_connection and active) then raise exception 'forbidden'; end if;

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

revoke all on function public.ig_business_thread_route_v1(uuid,text,uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.ig_business_thread_route_v1(uuid,text,uuid,text,text,uuid,text) to service_role;

create or replace function public.ig_business_thread_metadata_v1(
  p_connection uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if not exists(select 1 from public.profiles where id=p_actor and active=true and role_id in ('admin','coord_operaciones')) then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'thread_ref',x.thread_ref,
      'advisor_id',x.advisor_id,
      'advisor_name',coalesce(p.full_name,p.email),
      'department',coalesce(r.department,'sales'),
      'plaza_id',r.plaza_id,
      'plaza_name',cp.name,
      'route_source',coalesce(r.source,'channel_default')
    ))
    from (
      select thread_ref,advisor_id
      from instagram_business_private.thread_assignments
      where connection_id=p_connection
    ) x
    left join public.profiles p on p.id=x.advisor_id
    left join instagram_business_private.thread_routes r on r.connection_id=p_connection and r.thread_ref=x.thread_ref
    left join public.commercial_plazas cp on cp.id=r.plaza_id
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.ig_business_thread_metadata_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ig_business_thread_metadata_v1(uuid,uuid) to service_role;
