-- Fase 2 Veracruz — DEV ONLY. Produccion permanece NO-GO.
begin;
set local role postgres;

create table if not exists public.commercial_attribution_attempts (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('CITA','APARTADO','CIERRE')),
  event_key text not null,
  outcome text not null check (outcome in ('ATTRIBUTED','PENDING_ATTRIBUTION','ALREADY_ATTRIBUTED','ERROR')),
  reason text,
  details jsonb not null default '{}'::jsonb,
  actor_profile_id uuid references public.profiles(id),
  attempted_at timestamptz not null default now()
);
create index if not exists idx_commercial_attribution_attempts_event
  on public.commercial_attribution_attempts(event_type,event_key,attempted_at desc);
create index if not exists idx_commercial_attribution_attempts_pending
  on public.commercial_attribution_attempts(outcome,attempted_at desc)
  where outcome in ('PENDING_ATTRIBUTION','ERROR');

alter table public.commercial_attribution_attempts enable row level security;
grant select on public.commercial_attribution_attempts to authenticated;
grant all on public.commercial_attribution_attempts to service_role;
drop policy if exists commercial_attribution_attempts_read on public.commercial_attribution_attempts;
create policy commercial_attribution_attempts_read
  on public.commercial_attribution_attempts for select to authenticated
  using (
    public.current_profile_role_id()='admin'
    or actor_profile_id=auth.uid()
    or exists (
      select 1
      from public.commercial_attributions a
      where (a.cita_id::text=event_key or a.recibo_apartado_id::text=event_key or a.cierre_id::text=event_key)
        and (a.advisor_profile_id=auth.uid() or a.responsible_profile_id=auth.uid())
    )
  );

create or replace function public.resolve_commercial_attribution(
  p_event_type text,
  p_event_key text
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_type text := upper(trim(coalesce(p_event_type,'')));
  v_property_id uuid;
  v_plaza_id uuid;
  v_advisor_id uuid;
  v_occurred_at timestamptz;
  v_team_id uuid;
  v_responsible_id uuid;
  v_membership_count integer;
  v_responsibility_count integer;
  v_existing_id uuid;
begin
  if v_type not in ('CITA','APARTADO','CIERRE') then
    return jsonb_build_object('resolution','ERROR','reason','UNSUPPORTED_EVENT_TYPE');
  end if;

  if v_type='CITA' then
    select c.propiedad_id,c.asesor_id,c.fecha_hora,a.id
      into v_property_id,v_advisor_id,v_occurred_at,v_existing_id
    from public.citas c
    left join public.commercial_attributions a on a.cita_id=c.id
    where c.id=p_event_key::uuid;
  elsif v_type='APARTADO' then
    select r.propiedad_id,r.asesor_id,coalesce(r.created_at,r.fecha::timestamptz),a.id
      into v_property_id,v_advisor_id,v_occurred_at,v_existing_id
    from public.recibos_apartado r
    left join public.commercial_attributions a on a.recibo_apartado_id=r.id
    where r.id=p_event_key::uuid;
  else
    select c.propiedad_id,coalesce(c.advisor_profile_id,r.asesor_id),
           coalesce(c.fecha_cierre::timestamptz,c.created_at),a.id
      into v_property_id,v_advisor_id,v_occurred_at,v_existing_id
    from public.cierres c
    left join public.recibos_apartado r on r.id=c.recibo_id
    left join public.commercial_attributions a on a.cierre_id=c.id
    where c.id=p_event_key::bigint;
  end if;

  if not found then
    return jsonb_build_object('resolution','ERROR','reason','EVENT_NOT_FOUND');
  end if;
  if v_existing_id is not null then
    return jsonb_build_object('resolution','ALREADY_ATTRIBUTED','reason','ATTRIBUTION_EXISTS','attribution_id',v_existing_id);
  end if;
  if v_occurred_at is null then
    return jsonb_build_object('resolution','INCOMPLETE','reason','MISSING_EVENT_DATE');
  end if;
  if v_occurred_at::date < date '2026-09-01' then
    return jsonb_build_object('resolution','EXCLUDED','reason','BEFORE_EFFECTIVE_DATE','occurred_at',v_occurred_at);
  end if;
  if v_property_id is null then
    return jsonb_build_object('resolution','INCOMPLETE','reason','MISSING_PROPERTY');
  end if;
  select plaza_id into v_plaza_id from public.propiedades where id=v_property_id;
  if v_plaza_id is null then
    return jsonb_build_object('resolution','INCOMPLETE','reason','MISSING_PROPERTY_PLAZA','property_id',v_property_id);
  end if;
  if v_advisor_id is null then
    return jsonb_build_object('resolution','INCOMPLETE','reason','MISSING_ADVISOR','property_id',v_property_id,'plaza_id',v_plaza_id);
  end if;

  select count(*),(array_agg(team_id order by joined_at desc))[1]
    into v_membership_count,v_team_id
  from public.sales_team_memberships
  where advisor_profile_id=v_advisor_id
    and joined_at<=v_occurred_at::date
    and (left_at is null or left_at>=v_occurred_at::date);
  if v_membership_count=0 then
    select count(*),(array_agg(r.team_id order by r.starts_at desc))[1]
      into v_membership_count,v_team_id
    from public.sales_team_responsibilities r
    join public.sales_teams t on t.id=r.team_id and t.plaza_id=v_plaza_id
    join public.profiles p on p.id=r.responsible_profile_id and p.role_id='gerente_ventas'
    where r.responsible_profile_id=v_advisor_id
      and r.starts_at<=v_occurred_at::date
      and (r.ends_at is null or r.ends_at>=v_occurred_at::date);
  end if;
  if v_membership_count=0 then
    return jsonb_build_object('resolution','INCOMPLETE','reason','MISSING_TEAM_MEMBERSHIP','advisor_profile_id',v_advisor_id);
  elsif v_membership_count>1 then
    return jsonb_build_object('resolution','AMBIGUOUS','reason','MULTIPLE_TEAM_MEMBERSHIPS','advisor_profile_id',v_advisor_id,'count',v_membership_count);
  end if;
  if not exists(select 1 from public.sales_teams where id=v_team_id and plaza_id=v_plaza_id) then
    return jsonb_build_object('resolution','INCOMPLETE','reason','TEAM_PLAZA_MISMATCH','team_id',v_team_id,'plaza_id',v_plaza_id);
  end if;

  select count(*),(array_agg(responsible_profile_id order by starts_at desc))[1]
    into v_responsibility_count,v_responsible_id
  from public.sales_team_responsibilities
  where team_id=v_team_id
    and starts_at<=v_occurred_at::date
    and (ends_at is null or ends_at>=v_occurred_at::date);
  if v_responsibility_count=0 then
    return jsonb_build_object('resolution','INCOMPLETE','reason','MISSING_TEAM_RESPONSIBLE','team_id',v_team_id);
  elsif v_responsibility_count>1 then
    return jsonb_build_object('resolution','AMBIGUOUS','reason','MULTIPLE_TEAM_RESPONSIBLES','team_id',v_team_id,'count',v_responsibility_count);
  end if;

  return jsonb_build_object(
    'resolution','ATTRIBUTABLE','reason','STRONG_STRUCTURED_EVIDENCE',
    'property_id',v_property_id,'plaza_id',v_plaza_id,'team_id',v_team_id,
    'advisor_profile_id',v_advisor_id,'responsible_profile_id',v_responsible_id,
    'occurred_at',v_occurred_at
  );
exception when invalid_text_representation then
  return jsonb_build_object('resolution','ERROR','reason','INVALID_EVENT_KEY');
when others then
  return jsonb_build_object('resolution','ERROR','reason','RESOLUTION_EXCEPTION','error',sqlerrm);
end;
$$;

create or replace function public.attribute_commercial_event(
  p_event_type text,
  p_event_key text,
  p_actor_profile_id uuid default auth.uid()
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_type text := upper(trim(coalesce(p_event_type,'')));
  v_resolution jsonb;
  v_resolution_status text;
  v_attribution_id uuid;
  v_outcome text;
begin
  v_resolution:=public.resolve_commercial_attribution(v_type,p_event_key);
  v_resolution_status:=v_resolution->>'resolution';

  if v_resolution_status='ALREADY_ATTRIBUTED' then
    v_outcome:='ALREADY_ATTRIBUTED';
    v_attribution_id=(v_resolution->>'attribution_id')::uuid;
  elsif v_resolution_status='ATTRIBUTABLE' then
    if v_type='CITA' then
      insert into public.commercial_attributions(
        cita_id,plaza_id,team_id,advisor_profile_id,responsible_profile_id,occurred_at,source,created_by
      ) values (
        p_event_key::uuid,(v_resolution->>'plaza_id')::uuid,(v_resolution->>'team_id')::uuid,
        (v_resolution->>'advisor_profile_id')::uuid,(v_resolution->>'responsible_profile_id')::uuid,
        (v_resolution->>'occurred_at')::timestamptz,'fase2:auto:cita',p_actor_profile_id
      ) on conflict do nothing returning id into v_attribution_id;
    elsif v_type='APARTADO' then
      insert into public.commercial_attributions(
        recibo_apartado_id,plaza_id,team_id,advisor_profile_id,responsible_profile_id,occurred_at,source,created_by
      ) values (
        p_event_key::uuid,(v_resolution->>'plaza_id')::uuid,(v_resolution->>'team_id')::uuid,
        (v_resolution->>'advisor_profile_id')::uuid,(v_resolution->>'responsible_profile_id')::uuid,
        (v_resolution->>'occurred_at')::timestamptz,'fase2:auto:apartado',p_actor_profile_id
      ) on conflict do nothing returning id into v_attribution_id;
    else
      insert into public.commercial_attributions(
        cierre_id,plaza_id,team_id,advisor_profile_id,responsible_profile_id,occurred_at,source,created_by
      ) values (
        p_event_key::bigint,(v_resolution->>'plaza_id')::uuid,(v_resolution->>'team_id')::uuid,
        (v_resolution->>'advisor_profile_id')::uuid,(v_resolution->>'responsible_profile_id')::uuid,
        (v_resolution->>'occurred_at')::timestamptz,'fase2:auto:cierre',p_actor_profile_id
      ) on conflict do nothing returning id into v_attribution_id;
    end if;
    if v_attribution_id is null then
      v_outcome:='ALREADY_ATTRIBUTED';
      select id into v_attribution_id from public.commercial_attributions
      where cita_id::text=p_event_key or recibo_apartado_id::text=p_event_key or cierre_id::text=p_event_key
      limit 1;
    else
      v_outcome:='ATTRIBUTED';
    end if;
  elsif v_resolution_status='ERROR' then
    v_outcome:='ERROR';
  else
    v_outcome:='PENDING_ATTRIBUTION';
  end if;

  insert into public.commercial_attribution_attempts(event_type,event_key,outcome,reason,details,actor_profile_id)
  values(v_type,p_event_key,v_outcome,v_resolution->>'reason',v_resolution,p_actor_profile_id);

  return jsonb_build_object(
    'status',v_outcome,'event_type',v_type,'event_key',p_event_key,
    'attribution_id',v_attribution_id,'reason',v_resolution->>'reason','resolution',v_resolution
  );
exception when others then
  begin
    insert into public.commercial_attribution_attempts(event_type,event_key,outcome,reason,details,actor_profile_id)
    values(case when v_type in ('CITA','APARTADO','CIERRE') then v_type else 'CITA' end,
      coalesce(p_event_key,''),'ERROR','ATTRIBUTION_EXCEPTION',jsonb_build_object('error',sqlerrm),p_actor_profile_id);
  exception when others then null;
  end;
  return jsonb_build_object('status','ERROR','event_type',v_type,'event_key',p_event_key,'reason','ATTRIBUTION_EXCEPTION','error',sqlerrm);
end;
$$;

revoke all on function public.resolve_commercial_attribution(text,text) from public,anon,authenticated;
grant execute on function public.resolve_commercial_attribution(text,text) to service_role;
revoke all on function public.attribute_commercial_event(text,text,uuid) from public,anon,authenticated;
grant execute on function public.attribute_commercial_event(text,text,uuid) to service_role;

create or replace function public.commercial_attribution_source_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_type text; v_key text; v_result jsonb;
begin
  v_type:=case tg_table_name when 'citas' then 'CITA' when 'recibos_apartado' then 'APARTADO' else 'CIERRE' end;
  v_key:=new.id::text;
  begin
    v_result:=public.attribute_commercial_event(v_type,v_key,auth.uid());
  exception when others then
    begin
      insert into public.commercial_attribution_attempts(event_type,event_key,outcome,reason,details,actor_profile_id)
      values(v_type,v_key,'ERROR','TRIGGER_EXCEPTION',jsonb_build_object('error',sqlerrm),auth.uid());
    exception when others then null;
    end;
  end;
  return new;
end;
$$;

drop trigger if exists trg_commercial_attribution_citas on public.citas;
create trigger trg_commercial_attribution_citas
after insert or update of propiedad_id,asesor_id,fecha_hora on public.citas
for each row execute function public.commercial_attribution_source_trigger();
drop trigger if exists trg_commercial_attribution_apartados on public.recibos_apartado;
create trigger trg_commercial_attribution_apartados
after insert or update of propiedad_id,asesor_id,fecha,created_at on public.recibos_apartado
for each row execute function public.commercial_attribution_source_trigger();
drop trigger if exists trg_commercial_attribution_cierres on public.cierres;
create trigger trg_commercial_attribution_cierres
after insert or update of propiedad_id,advisor_profile_id,recibo_id,fecha_cierre on public.cierres
for each row execute function public.commercial_attribution_source_trigger();

create or replace function public.prevent_commercial_attribution_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'commercial_attributions are immutable; create a reviewed correction instead';
end;
$$;
drop trigger if exists trg_commercial_attributions_immutable on public.commercial_attributions;
create trigger trg_commercial_attributions_immutable
before update or delete on public.commercial_attributions
for each row execute function public.prevent_commercial_attribution_mutation();

alter table public.kpis_diarios add column if not exists advisor_profile_id uuid references public.profiles(id);
create index if not exists idx_kpis_diarios_advisor_fecha
  on public.kpis_diarios(advisor_profile_id,fecha);
update public.kpis_diarios k set advisor_profile_id=p.id
from public.profiles p
where k.advisor_profile_id is null and lower(trim(k.email))=lower(trim(p.email))
  and not exists(select 1 from public.profiles p2 where lower(trim(p2.email))=lower(trim(p.email)) and p2.id<>p.id);

create or replace view public.v_sales_team_directory
with (security_invoker=true) as
select m.id membership_id,m.advisor_profile_id,p.email,p.full_name,p.participa_kpis,
  m.joined_at,m.left_at,t.id team_id,t.code team_code,t.name team_name,
  x.id plaza_id,x.code plaza_code,x.name plaza_name
from public.sales_team_memberships m
join public.profiles p on p.id=m.advisor_profile_id
join public.sales_teams t on t.id=m.team_id
join public.commercial_plazas x on x.id=t.plaza_id
union all
select r.id,r.responsible_profile_id,p.email,p.full_name,p.participa_kpis,
  r.starts_at,r.ends_at,t.id,t.code,t.name,x.id,x.code,x.name
from public.sales_team_responsibilities r
join public.profiles p on p.id=r.responsible_profile_id and p.role_id='gerente_ventas'
join public.sales_teams t on t.id=r.team_id
join public.commercial_plazas x on x.id=t.plaza_id
where not exists(
  select 1 from public.sales_team_memberships m
  where m.team_id=r.team_id and m.advisor_profile_id=r.responsible_profile_id
);
grant select on public.v_sales_team_directory to authenticated,service_role;

create or replace view public.v_commercial_kpi_events
with (security_invoker=true) as
select a.id attribution_id,'CITA'::text event_type,c.id::text event_key,a.occurred_at,a.plaza_id,p.code plaza_code,
  a.team_id,t.code team_code,a.advisor_profile_id,a.responsible_profile_id,
  1::integer citas_agendadas,
  case when c.estado in ('efectiva','calificada') then 1 else 0 end::integer citas_efectivas,
  case when c.estado='calificada' then 1 else 0 end::integer citas_calificadas,
  0::integer apartados,0::integer cierres,0::numeric ingresos
from public.commercial_attributions a join public.citas c on c.id=a.cita_id
join public.commercial_plazas p on p.id=a.plaza_id join public.sales_teams t on t.id=a.team_id
union all
select a.id,'APARTADO',r.id::text,a.occurred_at,a.plaza_id,p.code,a.team_id,t.code,a.advisor_profile_id,a.responsible_profile_id,
  0,0,0,1,0,0::numeric
from public.commercial_attributions a join public.recibos_apartado r on r.id=a.recibo_apartado_id
join public.commercial_plazas p on p.id=a.plaza_id join public.sales_teams t on t.id=a.team_id
union all
select a.id,'CIERRE',c.id::text,a.occurred_at,a.plaza_id,p.code,a.team_id,t.code,a.advisor_profile_id,a.responsible_profile_id,
  0,0,0,0,1,coalesce(c.comision,0)::numeric
from public.commercial_attributions a join public.cierres c on c.id=a.cierre_id
join public.commercial_plazas p on p.id=a.plaza_id join public.sales_teams t on t.id=a.team_id;
grant select on public.v_commercial_kpi_events to authenticated,service_role;

create or replace function public.get_sales_kpis_by_scope(
  p_start date,p_end date,p_plaza_code text default null,p_team_code text default null
) returns table(
  plaza_code text,team_code text,advisor_profile_id uuid,citas_agendadas bigint,citas_efectivas bigint,
  citas_calificadas bigint,apartados bigint,cierres bigint,ingresos numeric
) language sql stable security definer set search_path=public,pg_temp as $$
  select e.plaza_code,e.team_code,e.advisor_profile_id,
    sum(e.citas_agendadas)::bigint,sum(e.citas_efectivas)::bigint,sum(e.citas_calificadas)::bigint,
    sum(e.apartados)::bigint,sum(e.cierres)::bigint,sum(e.ingresos)::numeric
  from public.v_commercial_kpi_events e
  where e.occurred_at>=(p_start::timestamp at time zone 'America/Mexico_City')
    and e.occurred_at<((p_end+1)::timestamp at time zone 'America/Mexico_City')
    and (p_plaza_code is null or e.plaza_code=upper(trim(p_plaza_code)))
    and (p_team_code is null or e.team_code=upper(trim(p_team_code)))
    and (
      auth.role()='service_role' or public.current_profile_role_id()='admin'
      or e.advisor_profile_id=auth.uid() or e.responsible_profile_id=auth.uid()
    )
  group by e.plaza_code,e.team_code,e.advisor_profile_id
  order by e.plaza_code,e.team_code,e.advisor_profile_id;
$$;
revoke all on function public.get_sales_kpis_by_scope(date,date,text,text) from public,anon;
grant execute on function public.get_sales_kpis_by_scope(date,date,text,text) to authenticated,service_role;

create or replace function public.get_sales_kpi_events_by_scope(
  p_start date,p_end date,p_team_code text
) returns table(
  event_type text,event_key text,occurred_at timestamptz,plaza_code text,team_code text,
  advisor_profile_id uuid,citas_agendadas integer,citas_efectivas integer,citas_calificadas integer,
  apartados integer,cierres integer,ingresos numeric
) language sql stable security definer set search_path=public,pg_temp as $$
  select e.event_type,e.event_key,e.occurred_at,e.plaza_code,e.team_code,e.advisor_profile_id,
    e.citas_agendadas,e.citas_efectivas,e.citas_calificadas,e.apartados,e.cierres,e.ingresos
  from public.v_commercial_kpi_events e
  where e.occurred_at>=(p_start::timestamp at time zone 'America/Mexico_City')
    and e.occurred_at<((p_end+1)::timestamp at time zone 'America/Mexico_City')
    and e.team_code=upper(trim(p_team_code))
    and (
      auth.role()='service_role' or public.current_profile_role_id()='admin'
      or e.advisor_profile_id=auth.uid() or e.responsible_profile_id=auth.uid()
    )
  order by e.occurred_at,e.event_type,e.event_key;
$$;
revoke all on function public.get_sales_kpi_events_by_scope(date,date,text) from public,anon;
grant execute on function public.get_sales_kpi_events_by_scope(date,date,text) to authenticated,service_role;

create or replace function public.report_commercial_attribution_backfill(p_start date,p_end date)
returns table(event_type text,event_key text,event_date date,classification text,reason text,resolution jsonb)
language sql stable security definer set search_path=public,pg_temp as $$
  with events as (
    select 'CITA'::text event_type,c.id::text event_key,c.fecha_hora::date event_date from public.citas c
    where c.fecha_hora::date between p_start and p_end
    union all
    select 'APARTADO',r.id::text,r.fecha from public.recibos_apartado r where r.fecha between p_start and p_end
    union all
    select 'CIERRE',c.id::text,c.fecha_cierre from public.cierres c where c.fecha_cierre between p_start and p_end
  ), resolved as (
    select e.*,public.resolve_commercial_attribution(e.event_type,e.event_key) resolution from events e
  )
  select event_type,event_key,event_date,
    case resolution->>'resolution'
      when 'ATTRIBUTABLE' then 'ATTRIBUTABLE'
      when 'AMBIGUOUS' then 'AMBIGUOUS'
      when 'INCOMPLETE' then 'INCOMPLETE'
      else 'EXCLUDED'
    end classification,
    resolution->>'reason',resolution
  from resolved order by event_date,event_type,event_key;
$$;
revoke all on function public.report_commercial_attribution_backfill(date,date) from public,anon,authenticated;
grant execute on function public.report_commercial_attribution_backfill(date,date) to service_role;

commit;
