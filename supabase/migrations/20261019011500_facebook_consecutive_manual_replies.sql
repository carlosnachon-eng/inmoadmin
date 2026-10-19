-- Multiple human replies in an open Meta window; one durable action per click.
-- No retry of the same action and no overlap while a dispatch is uncertain.
begin;
alter table facebook_messenger_private.actions
 drop constraint if exists actions_connection_id_input_ref_key;
create index if not exists fb_messenger_actions_by_input
 on facebook_messenger_private.actions(connection_id,input_ref,claimed_at desc);
create or replace function public.fb_messenger_reserve_v1(p_args jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare c uuid:=(p_args->>'connection')::uuid; n integer;
begin
 perform 1 from facebook_messenger_private.connections where id=c for update;
 if not facebook_messenger_private.send_allowed(c,p_args->>'input',(p_args->>'actor')::uuid,(p_args->>'generation')::bigint) then return false; end if;
 -- A prior uncertain/dispatching action must be reconciled before further outbound.
 if exists(select 1 from facebook_messenger_private.actions a
  join facebook_messenger_private.events e on e.connection_id=a.connection_id and e.event_ref=a.input_ref
  join facebook_messenger_private.events target on target.connection_id=c
   and target.thread_ref=e.thread_ref and target.event_ref=p_args->>'input'
  where a.connection_id=c and a.state in ('claimed','dispatching','uncertain')) then return false; end if;
 insert into facebook_messenger_private.actions(connection_id,action_id,input_ref,actor_id,lease,generation,text_box)
 values(c,(p_args->>'action')::uuid,p_args->>'input',(p_args->>'actor')::uuid,(p_args->>'lease')::uuid,(p_args->>'generation')::bigint,p_args->'text_box')
 on conflict(action_id) do nothing;
 get diagnostics n=row_count;return n=1;
end $$;
revoke all on function public.fb_messenger_reserve_v1(jsonb) from public,anon,authenticated;
grant execute on function public.fb_messenger_reserve_v1(jsonb) to service_role;
-- Do not widen read permissions. Show newest durable action state only, no row multiplication.
create or replace function public.fb_messenger_inbox_v1(p_connection uuid,p_actor uuid,p_thread text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $inbox$
declare result jsonb; is_supervisor boolean;
begin
 if not exists(select 1 from public.profiles where id=p_actor and active and role_id in ('admin','coord_operaciones','gerente_ventas','asesor','juridico'))
 or not exists(select 1 from facebook_messenger_private.connections where id=p_connection and enabled) then return null; end if;
 select exists(select 1 from public.profiles where id=p_actor and active and role_id in ('admin','gerente_ventas')) into is_supervisor;
 if p_thread is not null and not (is_supervisor or facebook_messenger_private.allowed(p_connection,p_thread,p_actor,false)) then return null; end if;
 if p_thread is null then
  select coalesce(jsonb_agg(to_jsonb(t) order by t.occurred_at desc,t.thread_ref),'[]'::jsonb) into result from (
   select e.thread_ref,max(e.occurred_at) as occurred_at from facebook_messenger_private.events e
   where e.connection_id=p_connection and (is_supervisor or facebook_messenger_private.allowed(p_connection,e.thread_ref,p_actor,false))
   group by e.thread_ref order by max(e.occurred_at) desc,e.thread_ref limit 100
  ) t;
 else
  select coalesce(jsonb_agg(to_jsonb(t) order by t.occurred_at,t.event_ref),'[]'::jsonb) into result from (
   select e.*,a.state as action_state,
    exists(select 1 from facebook_messenger_private.events d where d.connection_id=e.connection_id and d.message_ref=e.message_ref and d.kind='deleted') as deleted,
    facebook_messenger_private.allowed(p_connection,e.thread_ref,p_actor,true)
     and e.kind='inbound' and e.occurred_at>now()-interval '23 hours' and e.occurred_at<=now()
     and not exists(select 1 from facebook_messenger_private.actions x
      join facebook_messenger_private.events original on original.connection_id=x.connection_id and original.event_ref=x.input_ref
      where x.connection_id=e.connection_id and original.thread_ref=e.thread_ref
       and x.state in ('claimed','dispatching','uncertain')) as reply_allowed
   from facebook_messenger_private.events e
   left join lateral (select state from facebook_messenger_private.actions x
    where x.connection_id=e.connection_id and x.input_ref=e.event_ref
    order by x.claimed_at desc,x.action_id desc limit 1) a on true
   where e.connection_id=p_connection and e.thread_ref=p_thread
   order by e.occurred_at desc,e.event_ref desc limit 200
  ) t;
 end if;
 return jsonb_build_object('rows',result,'sender_enabled',(select sender_enabled from facebook_messenger_private.connections where id=p_connection));
end $inbox$;
revoke all on function public.fb_messenger_inbox_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fb_messenger_inbox_v1(uuid,uuid,text) to service_role;
commit;
