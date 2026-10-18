create table if not exists instagram_business_private.assignment_notifications (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references instagram_business_private.connections(id) on delete cascade,
  thread_ref text not null,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  notification_type text not null default 'thread_assigned',
  created_at timestamptz not null default now(),
  read_at timestamptz null,
  unique(connection_id,thread_ref,recipient_id,created_at)
);
alter table instagram_business_private.assignment_notifications enable row level security;
drop policy if exists assignment_notifications_service_all on instagram_business_private.assignment_notifications;
create policy assignment_notifications_service_all
on instagram_business_private.assignment_notifications
for all to service_role using(true) with check(true);

create index if not exists assignment_notifications_recipient_idx
on instagram_business_private.assignment_notifications(recipient_id,read_at,created_at desc);

create or replace function public.ig_business_assignment_notify_v1(
  p_connection uuid,p_thread text,p_actor uuid,p_recipient uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not instagram_business_private.operator(p_connection,p_actor)
     or not instagram_business_private.thread_visible(p_connection,p_thread,p_actor)
  then raise exception 'forbidden'; end if;
  if not exists(
    select 1 from public.profiles
    where id=p_recipient and active
      and role_id in ('admin','coord_operaciones','gerente_ventas','asesor','juridico')
  ) then raise exception 'invalid_recipient'; end if;

  insert into instagram_business_private.assignment_notifications(
    connection_id,thread_ref,recipient_id,actor_id
  ) values(p_connection,p_thread,p_recipient,p_actor)
  returning id into v_id;

  return jsonb_build_object('id',v_id,'created',true);
end;
$$;
revoke all on function public.ig_business_assignment_notify_v1(uuid,text,uuid,uuid)
from public,anon,authenticated;
grant execute on function public.ig_business_assignment_notify_v1(uuid,text,uuid,uuid) to service_role;

create or replace function public.ig_business_notifications_v1(
  p_connection uuid,p_actor uuid,p_op text,p_thread text default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_rows jsonb;
begin
  if not exists(
    select 1 from public.profiles
    where id=p_actor and active
      and role_id in ('admin','coord_operaciones','gerente_ventas','asesor','juridico')
  ) then raise exception 'forbidden'; end if;
  if not exists(
    select 1 from instagram_business_private.canary_operators
    where connection_id=p_connection and actor=p_actor and active
  ) then raise exception 'forbidden'; end if;

  if p_op='list' then
    select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb)
    into v_rows
    from (
      select n.id,n.thread_ref,n.created_at,n.read_at,n.notification_type,
             coalesce(a.alias,'Prospecto Instagram') as contact_name
      from instagram_business_private.assignment_notifications n
      left join instagram_business_private.thread_aliases a
        on a.connection_id=n.connection_id and a.thread_ref=n.thread_ref
      where n.connection_id=p_connection
        and n.recipient_id=p_actor
        and instagram_business_private.thread_visible(p_connection,n.thread_ref,p_actor)
      order by n.created_at desc limit 50
    ) x;

    return jsonb_build_object(
      'rows',v_rows,
      'unread_count',(
        select count(*)
        from instagram_business_private.assignment_notifications n
        where n.connection_id=p_connection
          and n.recipient_id=p_actor
          and n.read_at is null
          and instagram_business_private.thread_visible(p_connection,n.thread_ref,p_actor)
      )
    );
  elsif p_op='read-thread' then
    if p_thread is null or not instagram_business_private.thread_visible(p_connection,p_thread,p_actor)
    then raise exception 'forbidden'; end if;

    update instagram_business_private.assignment_notifications
    set read_at=coalesce(read_at,clock_timestamp())
    where connection_id=p_connection
      and recipient_id=p_actor
      and thread_ref=p_thread
      and read_at is null;

    return jsonb_build_object('ok',true);
  else
    raise exception 'invalid_op';
  end if;
end;
$$;
revoke all on function public.ig_business_notifications_v1(uuid,uuid,text,text)
from public,anon,authenticated;
grant execute on function public.ig_business_notifications_v1(uuid,uuid,text,text) to service_role;

create or replace function instagram_business_private.notify_new_unassigned_thread()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.kind<>'inbound' then return new; end if;

  if exists(
    select 1 from instagram_business_private.events e
    where e.connection_id=new.connection_id
      and e.thread_ref=new.thread_ref
      and e.id<>new.id
  ) then return new; end if;

  if exists(
    select 1 from instagram_business_private.thread_assignments a
    where a.connection_id=new.connection_id and a.thread_ref=new.thread_ref
  ) then return new; end if;

  insert into instagram_business_private.assignment_notifications(
    connection_id,thread_ref,recipient_id,actor_id,notification_type
  )
  select new.connection_id,new.thread_ref,p.id,p.id,'new_unassigned'
  from public.profiles p
  where p.active
    and p.role_id='gerente_ventas'
    and p.id in (
      select d.advisor_profile_id
      from public.v_sales_team_directory d
      where d.team_name='Ventas Puebla'
    )
    and exists(
      select 1 from instagram_business_private.canary_operators o
      where o.connection_id=new.connection_id and o.actor=p.id and o.active
    )
    and not exists(
      select 1
      from instagram_business_private.assignment_notifications n
      where n.connection_id=new.connection_id
        and n.thread_ref=new.thread_ref
        and n.recipient_id=p.id
        and n.notification_type='new_unassigned'
    );

  return new;
end;
$$;

drop trigger if exists trg_instagram_notify_new_unassigned_thread
on instagram_business_private.events;

create trigger trg_instagram_notify_new_unassigned_thread
after insert on instagram_business_private.events
for each row
execute function instagram_business_private.notify_new_unassigned_thread();
