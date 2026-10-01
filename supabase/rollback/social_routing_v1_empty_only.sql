-- NOT a normal rollout step. Separate operator approval required.
-- Prefer flag OFF with schema/evidence retained. This uninstall refuses ANY protected data.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.social_message_routes,public.social_handoff_effects,public.social_appointment_keys,
 public.sales_agent_v2_inbound_messages,public.owner_agent_v1_inbound_messages,public.legal_agent_v1_inbound_messages,
 public.sales_agent_v2_handoffs,public.legal_agent_v1_handoffs,public.respond_appointment_sync in access exclusive mode;
do $$ begin
 if exists(select 1 from public.social_message_routes) or exists(select 1 from public.social_handoff_effects)
 or exists(select 1 from public.social_appointment_keys)
 or exists(select 1 from public.respond_appointment_sync where social_routing_version is not null)
 then raise exception 'social_rollback_refused_evidence_exists'; end if;
end $$;
drop trigger social_sales_inbound_guard on public.sales_agent_v2_inbound_messages;
drop trigger social_owner_inbound_guard on public.owner_agent_v1_inbound_messages;
drop trigger social_legal_inbound_guard on public.legal_agent_v1_inbound_messages;
drop trigger social_sales_handoff_binding on public.sales_agent_v2_handoffs;
drop trigger social_legal_handoff_binding on public.legal_agent_v1_handoffs;
drop trigger social_appointment_binding on public.respond_appointment_sync;
drop index public.social_owner_context_idx,public.social_appointment_context_idx;
drop function public.capture_social_route_v1(jsonb),public.reserve_social_effect_v1(text,uuid,text),public.finish_social_effect_v1(uuid,text,text),public.commit_social_appointment_v1(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text),public.guard_social_inbound_v1(),public.bind_social_handoff_v1(),public.guard_social_appointment_v1();
alter table public.sales_agent_v2_inbound_messages drop column social_route_id;
alter table public.owner_agent_v1_inbound_messages drop column social_route_id;
alter table public.legal_agent_v1_inbound_messages drop column social_route_id;
alter table public.sales_agent_v2_handoffs drop column social_route_id;
alter table public.legal_agent_v1_handoffs drop column social_route_id;
alter table public.respond_appointment_sync drop column social_routing_version;
drop table public.social_appointment_keys,public.social_handoff_effects,public.social_message_routes;
commit;
