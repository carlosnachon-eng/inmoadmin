-- Both arrival orders, entirely synthetic, with rollback.
begin;
set local role service_role;
do $$
declare agency_id uuid; op uuid; tenant uuid; owner_id uuid; actor uuid := gen_random_uuid(); first_role text;
 th text; oh text; ph text; first_folio text; second_folio text; c public.blindaje_external_cases; p public.blindaje_investigation_payments; before_count bigint;
begin
 select id into agency_id from public.partner_agencies where nombre_comercial like 'I2A-QA%' and status='activo' limit 1;
 assert agency_id is not null;
 foreach first_role in array array['propietario','inquilino'] loop
  insert into public.solicitudes_inquilino(nombre_completo,origen_operacion) values('I2B-QA late tenant','partner') returning id into tenant;
  insert into public.propietarios_inmuebles(nombre_propietario,origen_operacion,direccion_inmueble) values('I2B-QA late owner','partner','I2B-QA synthetic address') returning id into owner_id;
  insert into public.partner_operations(partner_agency_id,solicitud_inquilino_id,propietario_id) values(agency_id,tenant,owner_id) returning id into op;
  th:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');oh:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');ph:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  insert into public.blindaje_partner_invitations(partner_agency_id,partner_operation_id,role,token_hash,expires_at,linked_record_id)
   values(agency_id,op,'inquilino',th,now()+interval '1 day',tenant),(agency_id,op,'propietario',oh,now()+interval '1 day',owner_id);
  first_folio:=public.blindaje_bootstrap_external_payment('partner',case when first_role='inquilino' then th else oh end,null,ph);
  assert first_folio is not null;
  select * into c from public.blindaje_external_cases where folio=first_folio;
  select * into p from public.blindaje_investigation_payments where case_id=c.id;
  assert public.blindaje_receive_payment_proof(ph,null,'cases/'||c.id||'/investigation/'||p.id||'/'||gen_random_uuid()||'.pdf','application/pdf','I2B-QA.pdf',first_role,null);
  select count(*) into before_count from public.poliza_caja;
  assert public.blindaje_review_investigation_payment(p.id,'validate',actor,'I2B-QA',null)='validated';
  second_folio:=public.blindaje_bootstrap_external_payment('partner',case when first_role='inquilino' then oh else th end,null,encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'));
  assert second_folio=first_folio;
  assert (select count(*)=1 from public.blindaje_investigation_payments where case_id=c.id);
  assert (select count(*)=before_count+1 from public.poliza_caja);
  assert (select cobro_investigacion and monto_investigacion=1000 from public.solicitudes_inquilino where id=tenant);
  assert (select status='payment_validated' and solicitud_inquilino_id=tenant and propietario_id=owner_id from public.blindaje_external_cases where id=c.id);
 end loop;
end $$;
rollback;
select 'I2B Partner owner-first + tenant-first PASS (rolled back)' result;
