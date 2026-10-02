-- DEV-only permission probes. No fixture rows are written. Always ROLLBACK.
begin;
set local statement_timeout='30s';
do $$
declare tab text; role_name text; operation text; rejected boolean; checks int:=0;
begin
foreach tab in array array['owner_agent_v1_inbound_messages','owner_agent_v1_runs','owner_agent_v1_auto_outbound','legal_agent_v1_inbound_messages','legal_agent_v1_runs','legal_agent_v1_auto_outbound','legal_agent_v1_handoffs','respond_appointment_sync'] loop
 set local role service_role;
 execute format('select id from public.%I limit 0',tab); checks:=checks+1;
 execute format('insert into public.%I(id) select gen_random_uuid() where false returning id',tab); checks:=checks+1;
 if tab in ('owner_agent_v1_inbound_messages','owner_agent_v1_auto_outbound','legal_agent_v1_inbound_messages','legal_agent_v1_handoffs','respond_appointment_sync') then
  execute format('update public.%I set id=id where false returning id',tab); checks:=checks+1;
 else
  rejected:=false;
  begin execute format('update public.%I set id=id where false returning id',tab); exception when insufficient_privilege then rejected:=true; end;
  assert rejected; checks:=checks+1;
 end if;
 rejected:=false;
 begin execute format('delete from public.%I where false',tab); exception when insufficient_privilege then rejected:=true; end;
 assert rejected; checks:=checks+1;
 reset role;
 foreach role_name in array array['anon','authenticated'] loop
  execute format('set local role %I',role_name);
  foreach operation in array array['select id from public.%I limit 0','insert into public.%I(id) select gen_random_uuid() where false returning id','update public.%I set id=id where false','delete from public.%I where false'] loop
   rejected:=false;
   begin execute format(operation,tab); exception when insufficient_privilege then rejected:=true; end;
   assert rejected; checks:=checks+1;
  end loop;
  reset role;
 end loop;
end loop;
perform set_config('social.dev_acl_test',jsonb_build_object('result','PASS','checks',checks,'roles',array['service_role','anon','authenticated'],'rows_mutated',0,'rls_changed',false,'scope','permission probes only; application fixtures separately required')::text,true);
end $$;
select current_setting('social.dev_acl_test')::jsonb as result;
rollback;
