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
     where tc.connection_id=p_connection
       and tc.thread_ref=p_thread
       and c.asesor_id is not null
     limit 1),
   (select ta.advisor_id
      from instagram_business_private.thread_assignments ta
     where ta.connection_id=p_connection
       and ta.thread_ref=p_thread
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
 or exists(select 1 from ov,route where ov.scope_type='plaza'
   and route.department=coalesce(ov.department,'sales')
   and route.plaza_id=ov.plaza_id)
 or exists(select 1 from ov,route where ov.scope_type='department'
   and route.department=ov.department)
 or exists(select 1 from actor,route
   where actor.role_id='coord_operaciones'
     and route.department='administration')
 or exists(select 1 from actor,route
   where actor.role_id='juridico'
     and route.department='legal')
 or exists(
   select 1
   from actor,route,effective_assignment ea
   where actor.role_id='gerente_ventas'
     and route.department='sales'
     and (
       (
         ea.advisor_id is null
         and (
           route.plaza_id is null
           or exists(
             select 1
             from public.v_sales_team_directory mgr
             where mgr.advisor_profile_id=p_actor
               and mgr.plaza_id=route.plaza_id
           )
         )
       )
       or ea.advisor_id=p_actor
       or exists(
         select 1
         from public.v_sales_team_directory mgr
         join public.v_sales_team_directory assignee
           on assignee.team_id=mgr.team_id
         where mgr.advisor_profile_id=p_actor
           and assignee.advisor_profile_id=ea.advisor_id
       )
     )
 )
 or exists(
   select 1
   from actor,effective_assignment ea
   where actor.role_id='asesor'
     and ea.advisor_id=p_actor
 )
);
$$;
