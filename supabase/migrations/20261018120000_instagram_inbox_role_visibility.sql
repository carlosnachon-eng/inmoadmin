create table if not exists instagram_business_private.inbox_scope_overrides(
  connection_id uuid not null references instagram_business_private.connections(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  scope_type text not null check(scope_type in ('all','plaza','department')),
  plaza_id uuid null references public.commercial_plazas(id),
  department text null check(department in ('sales','legal','administration','unclassified')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(connection_id,actor_id)
);
alter table instagram_business_private.inbox_scope_overrides enable row level security;
drop policy if exists inbox_scope_overrides_service_all on instagram_business_private.inbox_scope_overrides;
create policy inbox_scope_overrides_service_all
on instagram_business_private.inbox_scope_overrides
for all to service_role using(true) with check(true);

insert into instagram_business_private.inbox_scope_overrides(connection_id,actor_id,scope_type,plaza_id,department)
select
 c.id,d.advisor_profile_id,'plaza',d.plaza_id,'sales'
from instagram_business_private.connections c
cross join public.v_sales_team_directory d
where c.provider='instagram_login_business'
  and c.active
  and d.full_name='Cinthia Hernandez Martinez'
  and d.plaza_name='Veracruz'
on conflict(connection_id,actor_id) do update
set scope_type=excluded.scope_type,
    plaza_id=excluded.plaza_id,
    department=excluded.department,
    active=true;

create or replace function instagram_business_private.thread_visible(
  p_connection uuid,
  p_thread text,
  p_actor uuid
) returns boolean
language sql stable
security definer
set search_path=''
as $$
with actor as (
 select p.id,p.role_id
 from public.profiles p
 where p.id=p_actor and p.active
),
route as (
 select coalesce(r.department,'sales') department,r.plaza_id
 from (select 1) z
 left join instagram_business_private.thread_routes r
   on r.connection_id=p_connection and r.thread_ref=p_thread
),
effective_assignment as (
 select coalesce(
   (select c.asesor_id
      from instagram_business_private.thread_clients tc
      join public.clientes c on c.id=tc.client_id
     where tc.connection_id=p_connection and tc.thread_ref=p_thread and c.asesor_id is not null
     limit 1),
   (select ta.advisor_id
      from instagram_business_private.thread_assignments ta
     where ta.connection_id=p_connection and ta.thread_ref=p_thread
     limit 1)
 ) advisor_id
),
ov as (
 select o.scope_type,o.plaza_id,o.department
 from instagram_business_private.inbox_scope_overrides o
 where o.connection_id=p_connection and o.actor_id=p_actor and o.active
)
select exists(select 1 from actor) and (
 exists(select 1 from actor where role_id='admin')
 or exists(select 1 from ov,route where ov.scope_type='all')
 or exists(select 1 from ov,route where ov.scope_type='plaza' and route.department=coalesce(ov.department,'sales') and route.plaza_id=ov.plaza_id)
 or exists(select 1 from ov,route where ov.scope_type='department' and route.department=ov.department)
 or exists(select 1 from actor,route where actor.role_id='coord_operaciones' and route.department='administration')
 or exists(select 1 from actor,route where actor.role_id='juridico' and route.department='legal')
 or exists(
   select 1 from actor,route
   where actor.role_id='gerente_ventas'
     and route.department='sales'
     and (
       route.plaza_id is null
       or exists(
         select 1 from public.v_sales_team_directory d
         where d.advisor_profile_id=p_actor and d.plaza_id=route.plaza_id
       )
     )
 )
 or exists(
   select 1 from actor,effective_assignment
   where actor.role_id='asesor' and effective_assignment.advisor_id=p_actor
 )
);
$$;

revoke all on function instagram_business_private.thread_visible(uuid,text,uuid)
from public,anon,authenticated,service_role;

create or replace function public.ig_business_visibility_preview_v1(
 p_connection uuid,
 p_actor uuid
) returns jsonb
language sql stable
security definer
set search_path=''
as $$
 select jsonb_build_object(
   'actor_id',p_actor,
   'role_id',(select role_id from public.profiles where id=p_actor),
   'visible_threads',count(*)
 )
 from (
   select distinct e.thread_ref
   from instagram_business_private.events e
   where e.connection_id=p_connection
     and instagram_business_private.thread_visible(p_connection,e.thread_ref,p_actor)
 ) x;
$$;
revoke all on function public.ig_business_visibility_preview_v1(uuid,uuid)
from public,anon,authenticated;
grant execute on function public.ig_business_visibility_preview_v1(uuid,uuid) to service_role;
