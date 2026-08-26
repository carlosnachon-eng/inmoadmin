do $$
begin
  if exists(select 1 from public.client_identity_audit) then raise exception 'rollback_refused_audit_exists'; end if;
  if exists(select 1 from public.client_source_links where link_status='confirmed') then raise exception 'rollback_refused_source_links_exist'; end if;
  if exists(select 1 from public.respond_identity_links where client_identity_id is not null) then raise exception 'rollback_refused_bridge_usage_exists'; end if;
  if exists(select 1 from public.contracts where tenant_client_id is not null) then raise exception 'rollback_refused_tenant_usage_exists'; end if;
  if exists(select 1 from public.properties where owner_client_id is not null) then raise exception 'rollback_refused_owner_usage_exists'; end if;
end $$;

begin;
drop function if exists public.review_client_reconciliation_candidate(uuid,uuid,text);
drop function if exists public.confirm_client_reconciliation_candidate(uuid,uuid,uuid);
alter table public.respond_identity_links drop constraint if exists respond_identity_links_subject_check;
drop index if exists public.respond_identity_links_client_identity_idx;
alter table public.respond_identity_links drop column if exists client_identity_id;
alter table public.respond_identity_links alter column inmoadmin_client_id set not null;
drop index if exists public.properties_owner_client_idx;
alter table public.properties drop column if exists owner_client_id;
drop index if exists public.contracts_tenant_client_idx;
alter table public.contracts drop column if exists tenant_client_id;
drop table if exists public.client_identity_audit;
drop table if exists public.client_reconciliation_candidate_sources;
drop table if exists public.client_reconciliation_candidates;
drop table if exists public.client_source_links;
drop table if exists public.client_identity_roles;
drop table if exists public.client_identities;
commit;
