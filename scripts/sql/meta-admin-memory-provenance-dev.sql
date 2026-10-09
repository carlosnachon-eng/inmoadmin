-- DEV controlled fixtures only. No outgoing calls. All fixture writes rollback.
begin;
insert into public.meta_observer_admin_scope(waba_id,phone_number_id,enabled) values('1297760461811288','1198305790026665',true);
insert into meta_admin_private.capture_config(waba_id,phone_number_id,enabled,installed_at,not_before)
values('1297760461811288','1198305790026665',true,statement_timestamp(),statement_timestamp());
insert into public.client_identities(id,status,phone_digest) values('a0000000-0000-4000-8000-000000000001','active',repeat('c',64));
insert into public.client_identity_roles(client_identity_id,role_kind,status) values('a0000000-0000-4000-8000-000000000001','tenant','active');
insert into public.properties(id,name,status) values('a0000000-0000-4000-8000-000000000002','Memory DEV synthetic property','ocupada');
insert into public.contracts(id,property_id,tenant_client_id,start_date,end_date,monthly_rent,status)
values('a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001',current_date-30,current_date+330,1234,'activo');
insert into public.client_source_links(client_identity_id,source_type,source_id,role_kind,link_status,match_method,confirmed_by,confirmed_at)
select 'a0000000-0000-4000-8000-000000000001','active_contract_tenant','a0000000-0000-4000-8000-000000000003','tenant','confirmed','human_resolution',id,clock_timestamp()
from public.profiles where active is true order by id limit 1;
do $$declare n integer; receipt uuid; input uuid; t timestamptz;begin
 for n in 1..3 loop
  receipt:=('b0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  input:=('c0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;t:=clock_timestamp();
  insert into public.meta_observer_events(id,waba_id,phone_number_id,event_key,native_message_id,event_type,category,source_field,occurred_at,message_type,author_evidence,body_sha256)
  values(receipt,'1297760461811288','1198305790026665','message.received:wamid.memorydev'||n,'wamid.memorydev'||n,'message.received','inbound','messages',t,'text','human_authorship_unproven',repeat('a',64));
  insert into meta_admin_private.inbound_inputs(id,meta_observer_event_id,waba_id,phone_number_id,native_message_id,occurred_at,message_type,sender_ref,sender_ciphertext,exact_phone_digest,sender_evidence,sanitized_text,capture_reason)
  values(input,receipt,'1297760461811288','1198305790026665','wamid.memorydev'||n,t,'text',repeat(case when n=3 then 'e' else 'b' end,64),
    jsonb_build_object('v',1,'iv',repeat('0',24),'tag',repeat('0',32),'data',repeat('0',20)),repeat(case when n=3 then 'f' else 'c' end,64),'signed_from_and_wa_id',
    case when n=1 then 'Tengo una pregunta del contrato' when n=2 then 'Cuándo vence mi contrato' else 'Hola' end,'captured');
  insert into meta_admin_private.native_subject_evidence(meta_observer_event_id,subject_ref,key_tag,evidence_state,evidence_source)
  values(receipt,repeat(case when n=3 then 'e' else 'b' end,64),repeat('d',64),'exact','signed_from');
 end loop;
end $$;
set local role service_role;
do $$declare p jsonb; h jsonb;begin
 p:=public.meta_admin_memory_evidence_v1('c0000000-0000-4000-8000-000000000002');
 if p->>'audience'<>'external_verified' or (p->>'authorizes_private_data')::boolean is distinct from false then raise exception 'external_failed'; end if;
 h:=public.meta_admin_memory_history_v1('c0000000-0000-4000-8000-000000000002');
 if jsonb_array_length(h)<>2 or exists(select 1 from jsonb_array_elements(h) r where r->>'provenance'<>'customer_inbound') then raise exception 'history_failed'; end if;
 p:=public.meta_admin_memory_evidence_v1('c0000000-0000-4000-8000-000000000003');
 if p->>'audience'<>'unknown' or public.meta_admin_memory_history_v1('c0000000-0000-4000-8000-000000000003')<>'[]'::jsonb then raise exception 'unknown_failed'; end if;
end $$;
reset role;
-- Link only the synthetic canonical identity to a known internal profile; never modify a real profile.
update public.client_identities set auth_user_id=(select id from public.profiles where active is true order by id limit 1)
where id='a0000000-0000-4000-8000-000000000001';
set local role service_role;
do $$begin
 if public.meta_admin_memory_evidence_v1('c0000000-0000-4000-8000-000000000002')->>'audience'<>'internal'
  or public.meta_admin_memory_history_v1('c0000000-0000-4000-8000-000000000002')<>'[]'::jsonb then raise exception 'staff_failed'; end if;
end $$;
reset role;
update public.client_identities set auth_user_id=null where id='a0000000-0000-4000-8000-000000000001';
-- Export ONLY synthetic fixture data for the intercepted JS integration replay.
select jsonb_build_object('source','inmoadmin-dev synthetic transaction','checked_at',clock_timestamp(),
 'proof',public.meta_admin_memory_evidence_v1('c0000000-0000-4000-8000-000000000002'),
 'history',public.meta_admin_memory_history_v1('c0000000-0000-4000-8000-000000000002'),
 'snapshot',public.meta_admin_shadow_snapshot_v1('c0000000-0000-4000-8000-000000000002'),
 'tables',jsonb_build_object(
  'client_identities',(select jsonb_agg(to_jsonb(c)) from public.client_identities c where id='a0000000-0000-4000-8000-000000000001'),
  'client_identity_roles',(select jsonb_agg(to_jsonb(r)) from public.client_identity_roles r where client_identity_id='a0000000-0000-4000-8000-000000000001'),
  'client_source_links',(select jsonb_agg(to_jsonb(l)-array['confirmed_by','confirmed_at']) from public.client_source_links l where client_identity_id='a0000000-0000-4000-8000-000000000001'),
  'properties',(select jsonb_agg(to_jsonb(p)) from public.properties p where id='a0000000-0000-4000-8000-000000000002'),
  'contracts',(select jsonb_agg(to_jsonb(c)) from public.contracts c where id='a0000000-0000-4000-8000-000000000003')
 ),'sql_checks','PASS external/unknown/staff/native history') as result;
rollback;
