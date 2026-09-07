\set ON_ERROR_STOP on
\pset pager off

begin;
set local role postgres;
select pg_advisory_xact_lock(hashtext('fase2-production-backfill-20260907'));

create temporary table backfill_targets(event_type text,event_id text,primary key(event_type,event_id)) on commit drop;
insert into backfill_targets(event_type,event_id) values
    ('APARTADO','6cb096fe-7002-4743-9ef7-1f10ac2872e2'),
    ('APARTADO','ee14d486-a237-4105-9194-fdcad8e30040'),
    ('APARTADO','e6e23e1f-80e0-45f6-ad4f-da1105215b4c'),
    ('CIERRE','926'),('CIERRE','927'),('CIERRE','928'),('CIERRE','929'),
    ('CITA','09d23325-7ada-48fb-8ddd-4623f6c9255d'),
    ('CITA','5dddfd9c-a69e-4c22-aa1c-f7ca0d8d1c00'),
    ('CITA','c9c777d5-1876-4775-8c4e-1e2ac31e04f5'),
    ('CITA','28c775bf-f590-430a-9b12-49c5977fbe0a'),
    ('CITA','b53db9d8-aa19-4b2d-9624-af96cbd8961a'),
    ('CITA','add84299-289d-4fc0-99f0-25608e9d43fa'),
    ('CITA','87833977-2d28-487c-be20-7d44917ef0f3'),
    ('CITA','c6ed639a-14e5-4392-b251-c7a3af4c28f1'),
    ('CITA','6779f2b8-b013-433a-9560-0c6e446a99d4'),
    ('CITA','e6e9dc09-a6f9-4453-b1cf-9e4855687505'),
    ('CITA','13b02e0e-356a-4086-bccb-af994ead0334'),
    ('CITA','74a13c09-9df0-4a93-b9fa-274a62138314'),
    ('CITA','07f70438-291c-49b8-8275-a7cde11e7e0d'),
    ('CITA','9ba29d3d-da7d-4de2-8dc8-1965b5adf7e2'),
    ('CITA','c5d3fdab-42a8-4d5e-809b-0f57d9ada163'),
    ('CITA','8f273eb7-c740-4626-aff9-dba9b306c64a'),
    ('CITA','f103b65b-feea-4d1c-bce6-a4d608b50660'),
    ('CITA','4c49eb3a-7a55-41ea-a9bd-0b03230a327c'),
    ('CITA','af488e23-469b-4be9-81fc-aaf66b4f13b5'),
    ('CITA','dbb09072-d65e-4b0b-a3ea-15c42a90d21f'),
    ('CITA','f8d4ec8a-690d-4a9d-a8d1-2d36fcdb6392'),
    ('CITA','fa143372-0fd9-46a5-a8a9-dbd86a6a80b7'),
    ('CITA','1ceb4a4c-4009-41e0-93ee-6cbc02c9fe85');

create temporary table backfill_resolved on commit drop as
with events as (
  select t.event_type,t.event_id,c.fecha_hora occurred_at,c.propiedad_id,c.asesor_id advisor_id
  from backfill_targets t join public.citas c on t.event_type='CITA' and c.id=t.event_id::uuid
  union all
  select t.event_type,t.event_id,coalesce(r.created_at,r.fecha::timestamp),r.propiedad_id,r.asesor_id
  from backfill_targets t join public.recibos_apartado r on t.event_type='APARTADO' and r.id=t.event_id::uuid
  union all
  select t.event_type,t.event_id,c.fecha_cierre::timestamp,c.propiedad_id,coalesce(c.advisor_profile_id,r.asesor_id)
  from backfill_targets t join public.cierres c on t.event_type='CIERRE' and c.id=t.event_id::bigint
  left join public.recibos_apartado r on r.id=c.recibo_id
), base as (
  select e.*,p.plaza_id,ms.n member_count,ms.team_id member_team,mr.n manager_count,mr.team_id manager_team
  from events e join public.propiedades p on p.id=e.propiedad_id
  left join lateral (
    select count(*) n,(array_agg(m.team_id order by m.joined_at desc))[1] team_id
    from public.sales_team_memberships m where m.advisor_profile_id=e.advisor_id
      and m.joined_at<=e.occurred_at::date and (m.left_at is null or m.left_at>=e.occurred_at::date)
  ) ms on true
  left join lateral (
    select count(*) n,(array_agg(r.team_id order by r.starts_at desc))[1] team_id
    from public.sales_team_responsibilities r
    join public.sales_teams st on st.id=r.team_id and st.plaza_id=p.plaza_id
    join public.profiles pr on pr.id=r.responsible_profile_id and pr.role_id='gerente_ventas'
    where r.responsible_profile_id=e.advisor_id and r.starts_at<=e.occurred_at::date
      and (r.ends_at is null or r.ends_at>=e.occurred_at::date)
  ) mr on true
), scoped as (
  select b.*,case when member_count=1 then member_team
    when member_count=0 and manager_count=1 then manager_team end team_id
  from base b
)
select s.*,rr.n responsible_count,rr.responsible_id
from scoped s
join public.sales_teams st on st.id=s.team_id and st.plaza_id=s.plaza_id
left join lateral (
  select count(*) n,(array_agg(r.responsible_profile_id order by r.starts_at desc))[1] responsible_id
  from public.sales_team_responsibilities r where r.team_id=s.team_id
    and r.starts_at<=s.occurred_at::date and (r.ends_at is null or r.ends_at>=s.occurred_at::date)
) rr on true;

do $$
declare v_targets integer;v_resolved integer;v_invalid integer;
begin
  select count(*) into v_targets from backfill_targets;
  select count(*) into v_resolved from backfill_resolved;
  select count(*) into v_invalid from backfill_resolved
  where propiedad_id is null or plaza_id is null or advisor_id is null or team_id is null
    or member_count>1 or manager_count>1 or responsible_count<>1 or responsible_id is null;
  if v_targets<>30 then raise exception 'BACKFILL_ABORTED target count %, expected 30',v_targets; end if;
  if v_resolved<>30 then raise exception 'BACKFILL_ABORTED resolved count %, expected 30',v_resolved; end if;
  if v_invalid<>0 then raise exception 'BACKFILL_ABORTED invalid resolutions %',v_invalid; end if;
end $$;

create temporary table backfill_inserted on commit drop as
with inserted as (
  insert into public.commercial_attributions(
    cita_id,recibo_apartado_id,cierre_id,plaza_id,team_id,advisor_profile_id,
    responsible_profile_id,occurred_at,source,created_by
  )
  select case when event_type='CITA' then event_id::uuid end,
    case when event_type='APARTADO' then event_id::uuid end,
    case when event_type='CIERRE' then event_id::bigint end,
    plaza_id,team_id,advisor_id,responsible_id,occurred_at,
    'fase2:backfill:20260907:strong-structured-evidence',null
  from backfill_resolved
  on conflict do nothing
  returning id,cita_id,recibo_apartado_id,cierre_id
)
select * from inserted;

select r.event_type,r.event_id,
  case when i.id is not null then 'ATTRIBUTED' else 'ALREADY_ATTRIBUTED' end outcome,
  'STRONG_STRUCTURED_EVIDENCE' reason
from backfill_resolved r
left join backfill_inserted i on i.cita_id::text=r.event_id
  or i.recibo_apartado_id::text=r.event_id or i.cierre_id::text=r.event_id
order by r.event_type,r.occurred_at,r.event_id;

do $$
declare v_attributed integer;v_duplicates integer;
begin
  select count(*) into v_attributed from backfill_targets t
  join public.commercial_attributions a on a.cita_id::text=t.event_id
    or a.recibo_apartado_id::text=t.event_id or a.cierre_id::text=t.event_id;
  select count(*) into v_duplicates from (
    select t.event_type,t.event_id,count(a.*) n from backfill_targets t
    join public.commercial_attributions a on a.cita_id::text=t.event_id
      or a.recibo_apartado_id::text=t.event_id or a.cierre_id::text=t.event_id
    group by t.event_type,t.event_id having count(a.*)<>1
  ) d;
  if v_attributed<>30 then raise exception 'BACKFILL_ABORTED attributed %, expected 30',v_attributed; end if;
  if v_duplicates<>0 then raise exception 'BACKFILL_ABORTED duplicate targets %',v_duplicates; end if;
end $$;

select 'SUMMARY' check_name,count(*) targets,
  (select count(*) from backfill_inserted) attributed_now,
  count(*)-(select count(*) from backfill_inserted) already_attributed
from backfill_targets;

\if :{?execute}
commit;
\else
\echo 'DRY RUN: transaction rolled back; use -v execute=1 only after reviewing this output.'
rollback;
\endif
