\set ON_ERROR_STOP on
\pset pager off

-- Solo lectura. Replica la resolución aprobada de Fase 2 sin inferencias por texto.
with events as (
  select 'CITA'::text event_type,c.id::text event_id,c.fecha_hora occurred_at,
    c.propiedad_id,c.asesor_id advisor_id
  from public.citas c where c.fecha_hora::date>=date '2026-09-01'
  union all
  select 'APARTADO',r.id::text,coalesce(r.created_at,r.fecha::timestamp),
    r.propiedad_id,r.asesor_id
  from public.recibos_apartado r where r.fecha>=date '2026-09-01'
  union all
  select 'CIERRE',c.id::text,c.fecha_cierre::timestamp,c.propiedad_id,
    coalesce(c.advisor_profile_id,r.asesor_id)
  from public.cierres c left join public.recibos_apartado r on r.id=c.recibo_id
  where c.fecha_cierre>=date '2026-09-01'
), base as (
  select e.*,pr.plaza_id,
    coalesce(to_jsonb(pr)->>'nombre',to_jsonb(pr)->>'titulo',to_jsonb(pr)->>'direccion',pr.id::text) property_name,
    ms.n member_count,ms.team_id member_team,mr.n manager_count,mr.team_id manager_team
  from events e
  left join public.propiedades pr on pr.id=e.propiedad_id
  left join lateral (
    select count(*) n,(array_agg(m.team_id order by m.joined_at desc))[1] team_id
    from public.sales_team_memberships m
    where m.advisor_profile_id=e.advisor_id and m.joined_at<=e.occurred_at::date
      and (m.left_at is null or m.left_at>=e.occurred_at::date)
  ) ms on true
  left join lateral (
    select count(*) n,(array_agg(r.team_id order by r.starts_at desc))[1] team_id
    from public.sales_team_responsibilities r
    join public.sales_teams t on t.id=r.team_id and t.plaza_id=pr.plaza_id
    join public.profiles p on p.id=r.responsible_profile_id and p.role_id='gerente_ventas'
    where r.responsible_profile_id=e.advisor_id and r.starts_at<=e.occurred_at::date
      and (r.ends_at is null or r.ends_at>=e.occurred_at::date)
  ) mr on true
), scoped as (
  select b.*,case when member_count=1 then member_team
    when member_count=0 and manager_count=1 then manager_team end team_id
  from base b
), resolved as (
  select s.*,x.code plaza_code,t.code team_code,a.full_name advisor_name,a.email advisor_email,
    rr.n responsible_count,rr.responsible_id,rp.full_name responsible_name,rp.email responsible_email,
    case
      when s.propiedad_id is null then 'PENDING_ATTRIBUTION:MISSING_PROPERTY'
      when s.plaza_id is null then 'PENDING_ATTRIBUTION:MISSING_PROPERTY_PLAZA'
      when s.advisor_id is null then 'PENDING_ATTRIBUTION:MISSING_ADVISOR'
      when member_count>1 then 'ERROR:MULTIPLE_TEAM_MEMBERSHIPS'
      when member_count=0 and manager_count>1 then 'ERROR:MULTIPLE_MANAGER_TEAMS'
      when member_count=0 and manager_count=0 then 'PENDING_ATTRIBUTION:MISSING_TEAM_MEMBERSHIP'
      when t.plaza_id is distinct from s.plaza_id then 'PENDING_ATTRIBUTION:TEAM_PLAZA_MISMATCH'
      when coalesce(rr.n,0)=0 then 'PENDING_ATTRIBUTION:MISSING_TEAM_RESPONSIBLE'
      when rr.n>1 then 'ERROR:MULTIPLE_TEAM_RESPONSIBLES'
      else 'ATTRIBUTABLE'
    end resolution
  from scoped s
  left join public.commercial_plazas x on x.id=s.plaza_id
  left join public.sales_teams t on t.id=s.team_id
  left join public.profiles a on a.id=s.advisor_id
  left join lateral (
    select count(*) n,(array_agg(r.responsible_profile_id order by r.starts_at desc))[1] responsible_id
    from public.sales_team_responsibilities r where r.team_id=s.team_id
      and r.starts_at<=s.occurred_at::date and (r.ends_at is null or r.ends_at>=s.occurred_at::date)
  ) rr on true
  left join public.profiles rp on rp.id=rr.responsible_id
)
select event_type,event_id,occurred_at,propiedad_id,property_name,plaza_code,team_code,
  advisor_id,advisor_name,advisor_email,responsible_id,responsible_name,responsible_email,
  resolution,
  case when resolution='ATTRIBUTABLE'
    then 'FK propiedad + plaza_id + membresía/responsabilidad vigente + equipo de la misma plaza'
    else 'Sin propiedad; no se infiere por texto, asesor ni estado' end evidence
from resolved
order by resolution,event_type,occurred_at,event_id;
