begin;
alter table commercial_comment_private.connections add column observation_only boolean not null default false;
alter table commercial_comment_private.connections add constraint observation_sender_closed check(not observation_only or not sender_enabled);
-- No existing connection is altered or enabled by this migration.
create function commercial_comment_private.deny_observation_action() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from commercial_comment_private.connections where platform=new.platform and connection_id=new.connection_id and observation_only) then
  raise exception 'observation_has_no_actions' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function commercial_comment_private.deny_observation_action() from public,anon,authenticated,service_role;
create trigger observation_no_actions before insert or update on commercial_comment_private.actions
for each row execute function commercial_comment_private.deny_observation_action();
create function public.comment_observation_v1(p_platform text,p_connection uuid,p_actor uuid,p_op text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=p_actor and active and role_id in ('admin','gerente_ventas')) then raise exception 'forbidden' using errcode='42501';end if;
 perform 1 from commercial_comment_private.connections where platform=p_platform and connection_id=p_connection and active and observation_only and not sender_enabled for share;
 if not found then raise exception 'observation_closed' using errcode='42501';end if;
 if p_op in ('list','events','capture','evaluate','approve') then
  return public.comment_review_v1(p_platform,p_connection,p_actor,p_op,p_data);
 elsif p_op in ('bind_property','read_property') then
  return public.comment_property_link_v1(p_platform,p_connection,p_actor,case when p_op='bind_property' then 'bind' else 'read' end,p_data);
 end if;
 raise exception 'observation_operation_denied' using errcode='42501';
end $$;
revoke all on function public.comment_observation_v1(text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.comment_observation_v1(text,uuid,uuid,text,jsonb) to service_role;
commit;
