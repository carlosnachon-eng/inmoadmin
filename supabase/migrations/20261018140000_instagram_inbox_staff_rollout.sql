create or replace function instagram_business_private.operator(p_connection uuid,p_actor uuid)
returns boolean language sql stable set search_path='' as $$
 select exists(
   select 1 from public.profiles p
   where p.id=p_actor and p.active
     and p.role_id in ('admin','coord_operaciones','gerente_ventas','asesor','juridico')
 )
 and exists(
   select 1 from instagram_business_private.canary_operators o
   where o.connection_id=p_connection and o.actor=p_actor and o.active
 );
$$;

insert into instagram_business_private.canary_operators(connection_id,actor,active)
select c.id,p.id,true
from instagram_business_private.connections c
join public.profiles p on p.active
where c.provider='instagram_login_business'
  and c.active
  and (
    p.role_id in ('admin','coord_operaciones','juridico','gerente_ventas')
    or p.id in (select advisor_profile_id from public.v_sales_team_directory)
  )
on conflict(connection_id,actor) do update set active=true;
