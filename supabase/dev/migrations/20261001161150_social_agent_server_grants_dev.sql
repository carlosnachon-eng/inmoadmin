-- DEV ONLY: inmoadmin-dev / hjfwjnejbcpmknvfpdcq. Not a Production rollout artifact.
-- CLI-generated version; deliberately outside the standard migrations directory.
-- Existing server operations only. No data changes, RLS/policy changes, DELETE,
-- sequence grants, public/client grants or default-privilege changes.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
declare t text;
begin
  -- This named DEV-only baseline was installed by the preceding certification.
  -- The caller must also pin the Supabase project to hjfwjnejbcpmknvfpdcq.
  if not exists (select 1 from supabase_migrations.schema_migrations
      where version='20261001154342' and name='social_routing_v1_dev_baseline_existing_migrations') then
    raise exception 'social_dev_baseline_not_accredited';
  end if;
  foreach t in array array['owner_agent_v1_inbound_messages','owner_agent_v1_runs',
    'owner_agent_v1_auto_outbound','legal_agent_v1_inbound_messages','legal_agent_v1_runs',
    'legal_agent_v1_auto_outbound','legal_agent_v1_handoffs','respond_appointment_sync'] loop
    if to_regclass('public.'||t) is null then raise exception 'social_dev_grant_dependency_missing'; end if;
    if not (select relrowsecurity from pg_class where oid=to_regclass('public.'||t))
      or exists(select 1 from pg_policy where polrelid=to_regclass('public.'||t)) then
      raise exception 'social_dev_rls_policy_precondition_changed';
    end if;
    if has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,REFERENCES')
      or has_any_column_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,REFERENCES') then
      raise exception 'social_dev_client_acl_precondition_changed';
    end if;
  end loop;
end $$;

-- Capture/claim/status updates, outbound delivery journal status, handoff receipts,
-- and the existing appointment-sync state machine.
grant select,insert,update on
  public.owner_agent_v1_inbound_messages,
  public.owner_agent_v1_auto_outbound,
  public.legal_agent_v1_inbound_messages,
  public.legal_agent_v1_handoffs,
  public.respond_appointment_sync
to service_role;

-- Current code inserts finished runs; Legal inserts an outbound journal entry
-- without later UPDATE. SELECT is needed for server reads/INSERT RETURNING.
grant select,insert on
  public.owner_agent_v1_runs,
  public.legal_agent_v1_runs,
  public.legal_agent_v1_auto_outbound
to service_role;

do $$
declare t text; needs_update boolean;
begin
  foreach t in array array['owner_agent_v1_inbound_messages','owner_agent_v1_runs',
    'owner_agent_v1_auto_outbound','legal_agent_v1_inbound_messages','legal_agent_v1_runs',
    'legal_agent_v1_auto_outbound','legal_agent_v1_handoffs','respond_appointment_sync'] loop
    needs_update := t in ('owner_agent_v1_inbound_messages','owner_agent_v1_auto_outbound',
      'legal_agent_v1_inbound_messages','legal_agent_v1_handoffs','respond_appointment_sync');
    if not has_table_privilege('service_role','public.'||t,'SELECT')
      or not has_table_privilege('service_role','public.'||t,'INSERT')
      or has_table_privilege('service_role','public.'||t,'UPDATE') <> needs_update
      or has_table_privilege('service_role','public.'||t,'DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or not (select relrowsecurity from pg_class where oid=to_regclass('public.'||t))
      or exists(select 1 from pg_policy where polrelid=to_regclass('public.'||t)) then
      raise exception 'social_dev_minimal_acl_postcheck_failed';
    end if;
  end loop;
end $$;
commit;
