-- Review-only registry. No token, price, native Meta ID or property copy stored.
begin;
create table commercial_comment_private.property_links (
 platform text not null, connection_id uuid not null,
 post_ref text not null check(post_ref ~ '^[a-f0-9]{64}$'),
 property_id uuid not null references public.propiedades(id),
 confirmed_by uuid not null, confirmed_at timestamptz not null default clock_timestamp(),
 evidence_box jsonb not null check(jsonb_typeof(evidence_box)='object'),
 primary key(platform,connection_id,post_ref),
 foreign key(platform,connection_id) references commercial_comment_private.connections
);
alter table commercial_comment_private.property_links enable row level security;
revoke all on commercial_comment_private.property_links from public,anon,authenticated,service_role;
create index comment_property_links_property on commercial_comment_private.property_links(property_id);

-- Service-only RPC follows existing actor/connection authorization. Immutable binding:
-- a conflicting second confirmation fails closed, never silently replaces an association.
create function public.comment_property_link_v1(p_platform text,p_connection uuid,p_actor uuid,p_op text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare e commercial_comment_private.events; l commercial_comment_private.property_links; pid uuid; n integer;
begin
 if not exists(select 1 from public.profiles where id=p_actor and active and role_id in ('admin','gerente_ventas'))
 then raise exception 'forbidden' using errcode='42501'; end if;
 if not exists(select 1 from commercial_comment_private.connections where platform=p_platform and connection_id=p_connection and active and not sender_enabled)
 then raise exception 'connection_closed' using errcode='42501'; end if;
 if p_data->>'post_ref' is null or p_data->>'post_ref' !~ '^[a-f0-9]{64}$' then raise exception 'binding_shape';end if;
 if p_op='read' then
  select * into l from commercial_comment_private.property_links where platform=p_platform and connection_id=p_connection and post_ref=p_data->>'post_ref';
  return case when found then to_jsonb(l) else 'null'::jsonb end;
 end if;
 if p_op<>'bind' then raise exception 'operation_denied';end if;
 if p_data->>'property_public_id' is null or p_data->>'property_public_id' !~ '^[A-Z0-9][A-Z0-9-]{2,79}$'
 or jsonb_typeof(p_data->'evidence_box') is distinct from 'object' then raise exception 'binding_shape';end if;
 select * into e from commercial_comment_private.events where platform=p_platform and connection_id=p_connection and event_ref=p_data->>'event_ref' and post_ref=p_data->>'post_ref';
 if not found or e.deleted then return jsonb_build_object('status','event_unavailable');end if;
 if exists(select 1 from commercial_comment_private.events where platform=p_platform and connection_id=p_connection and comment_ref=e.comment_ref and (deleted or occurred_at>e.occurred_at)) then return jsonb_build_object('status','stale_event');end if;
 select count(*),min(id::text)::uuid into n,pid from public.propiedades where public_id=p_data->>'property_public_id' and status='published';
 if n<>1 then return jsonb_build_object('status','property_unavailable');end if;
 perform pg_advisory_xact_lock(hashtextextended(p_platform||p_connection::text||(p_data->>'post_ref'),1));
 select * into l from commercial_comment_private.property_links where platform=p_platform and connection_id=p_connection and post_ref=p_data->>'post_ref';
 if found then return jsonb_build_object('status',case when l.property_id=pid then 'unchanged' else 'association_conflict' end);end if;
 insert into commercial_comment_private.property_links(platform,connection_id,post_ref,property_id,confirmed_by,evidence_box)
 values(p_platform,p_connection,e.post_ref,pid,p_actor,p_data->'evidence_box');
 insert into commercial_comment_private.audit(platform,connection_id,comment_ref,revision,actor,kind)
 values(p_platform,p_connection,e.comment_ref,e.event_ref,p_actor,'property_bind');
 return jsonb_build_object('status','bound');
end $$;
revoke all on function public.comment_property_link_v1(text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.comment_property_link_v1(text,uuid,uuid,text,jsonb) to service_role;
commit;
