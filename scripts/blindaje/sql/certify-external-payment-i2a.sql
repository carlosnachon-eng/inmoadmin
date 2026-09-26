-- Synthetic I2A-QA only; every fixture is rolled back. Sequence gaps are expected.
begin;
do $$
declare
  tenant uuid; owner uuid; agency uuid; operation uuid; partner_tenant uuid; partner_owner uuid;
  folio1 text; folio2 text; v_case_id uuid; payment_id uuid; payhash text; role_name text;
  i integer := 0; before_caja bigint; before_cobro text; after_cobro text; path text;
begin
  select count(*) into before_caja from public.poliza_caja;
  select md5(coalesce(string_agg(id::text || coalesce(to_jsonb(s)->>'cobro_investigacion',''),',' order by id),'')) into before_cobro from public.solicitudes_inquilino s where nombre_completo is null or nombre_completo not like 'I2A-QA%';
  foreach role_name in array array['inquilino','propietario'] loop
    i := i + 1;
    insert into public.blindaje_b2c_submission_tokens(role,token_hash,expires_at) values(role_name,repeat(i::text,64),now()+interval '2 hours');
    if role_name='inquilino' then
      insert into public.solicitudes_inquilino(nombre_completo,origen_operacion,blindaje_submission_claim_hash) values ('I2A-QA SQL tenant','b2c',repeat(i::text,64)) returning id into tenant;
    else
      insert into public.propietarios_inmuebles(nombre_propietario,direccion_inmueble,origen_operacion,blindaje_submission_claim_hash) values ('I2A-QA SQL owner','I2A-QA synthetic address','b2c',repeat(i::text,64)) returning id into owner;
    end if;
    execute 'set local role service_role';
    folio1 := public.blindaje_bootstrap_external_payment('b2c',repeat(i::text,64),role_name,repeat((i+2)::text,64));
    folio2 := public.blindaje_bootstrap_external_payment('b2c',repeat(i::text,64),role_name,repeat((i+4)::text,64));
    execute 'reset role';
    if folio1 is null or folio1 <> folio2 or folio1 !~ '^BL-[0-9]{4}-[0-9]{6}$' then raise exception 'B2C retry failed'; end if;
    if (select count(*) from public.blindaje_external_cases c where (c.solicitud_inquilino_id=tenant or c.propietario_id=owner)) <> i then raise exception 'B2C accidentally matched'; end if;
    if public.blindaje_bootstrap_external_payment('b2c',repeat(i::text,64),'wrong',repeat('a',64)) is not null then raise exception 'Wrong role accepted'; end if;
    update public.blindaje_b2c_submission_tokens set expires_at=now()-interval '1 second' where token_hash=repeat(i::text,64);
    if public.blindaje_bootstrap_external_payment('b2c',repeat(i::text,64),role_name,repeat('a',64)) is not null then raise exception 'Expired claim accepted'; end if;
  end loop;
  begin
    insert into public.solicitudes_inquilino(nombre_completo,origen_operacion,blindaje_submission_claim_hash) values ('I2A-QA duplicate','b2c',repeat('1',64));
    raise exception 'Duplicate claim accepted';
  exception when unique_violation then null; end;
  execute 'set local role anon';
  begin
    update public.solicitudes_inquilino set blindaje_submission_claim_hash=repeat('f',64) where id=tenant;
    raise exception 'Anon changed claim';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  execute 'set local role authenticated';
  begin
    update public.propietarios_inmuebles set blindaje_submission_claim_hash=null where id=owner;
    raise exception 'Authenticated changed claim';
  exception when insufficient_privilege then null; end;
  execute 'reset role';

  insert into public.partner_agencies(nombre_comercial,status) values ('I2A-QA SQL agency','activo') returning id into agency;
  -- Test both arrival orders with separate operations.
  for i in 1..2 loop
    insert into public.partner_operations(partner_agency_id) values(agency) returning id into operation;
    insert into public.solicitudes_inquilino(nombre_completo,origen_operacion) values('I2A-QA Partner tenant','partner') returning id into partner_tenant;
    insert into public.propietarios_inmuebles(nombre_propietario,direccion_inmueble,origen_operacion) values('I2A-QA Partner owner','I2A-QA address','partner') returning id into partner_owner;
    folio1 := null;
    foreach role_name in array (case when i=1 then array['inquilino','propietario'] else array['propietario','inquilino'] end) loop
      payhash := md5(operation::text||role_name)||md5(operation::text||role_name);
      insert into public.blindaje_partner_invitations(partner_agency_id,partner_operation_id,role,token_hash,expires_at) values(agency,operation,role_name,payhash,now()+interval '30 days');
      if public.blindaje_bootstrap_external_payment('partner',payhash,null,md5(payhash)||md5(payhash)) is not null then raise exception 'Unlinked invitation accepted'; end if;
      if not public.blindaje_link_invited_submission(payhash,role_name,case when role_name='inquilino' then partner_tenant else partner_owner end) then raise exception 'I2A.0 link failed'; end if;
      execute 'set local role service_role';
      folio2 := public.blindaje_bootstrap_external_payment('partner',payhash,null,md5(payhash)||md5(payhash));
      execute 'reset role';
      if folio2 is null or (folio1 is not null and folio1 <> folio2) then raise exception 'Partner canonical case failed'; end if;
      folio1 := folio2;
      update public.blindaje_partner_invitations set revoked_at=now() where token_hash=payhash;
      if public.blindaje_bootstrap_external_payment('partner',payhash,null,repeat('a',64)) is not null then raise exception 'Revoked invitation accepted'; end if;
    end loop;
    select id into v_case_id from public.blindaje_external_cases c where c.partner_operation_id=operation and c.solicitud_inquilino_id=partner_tenant and c.propietario_id=partner_owner;
    if v_case_id is null then raise exception 'Partner role associations missing'; end if;
    select id into payment_id from public.blindaje_investigation_payments p where p.case_id=v_case_id and p.amount=1000 and p.status='pending';
    if payment_id is null then raise exception 'Single payment missing'; end if;
    path := 'cases/'||v_case_id||'/investigation/'||payment_id||'/'||gen_random_uuid()||'.pdf';
    execute 'set local role service_role';
    if not public.blindaje_receive_payment_proof(md5(payhash)||md5(payhash),null,path,'application/pdf','I2A-QA.pdf','tercero','I2A-QA payer') then raise exception 'Proof failed'; end if;
    if public.blindaje_receive_payment_proof(md5(payhash)||md5(payhash),null,path,'application/pdf','I2A-QA.pdf','inquilino',null) then raise exception 'Stale replacement accepted'; end if;
    if not public.blindaje_receive_payment_proof(md5(payhash)||md5(payhash),path,replace(path,'.pdf','.png'),'image/png','I2A-QA.png','inquilino',null) then raise exception 'Replacement failed'; end if;
    execute 'reset role';
    if (select count(*) from public.blindaje_investigation_payments p where p.case_id=v_case_id)<>1 then raise exception 'Duplicate payment'; end if;
    update public.blindaje_case_access_tokens set revoked_at=now() where token_hash=md5(payhash)||md5(payhash);
    if public.blindaje_receive_payment_proof(md5(payhash)||md5(payhash),replace(path,'.pdf','.png'),path,'application/pdf','I2A-QA.pdf','inquilino',null) then raise exception 'Revoked payment token accepted'; end if;
  end loop;
  if (select count(*) from public.poliza_caja) <> before_caja then raise exception 'Accounting insert'; end if;
  select md5(coalesce(string_agg(id::text || coalesce(to_jsonb(s)->>'cobro_investigacion',''),',' order by id),'')) into after_cobro from public.solicitudes_inquilino s where nombre_completo is null or nombre_completo not like 'I2A-QA%';
  if before_cobro <> after_cobro then raise exception 'Existing investigation charge changed'; end if;
  -- Snapshot only existing rows; synthetic rows have no accounting modifications.
  if exists(select 1 from public.solicitudes_inquilino s where nombre_completo like 'I2A-QA%' and coalesce(to_jsonb(s)->>'cobro_investigacion','') not in ('','false','0')) then raise exception 'Investigation charge changed'; end if;
end $$;
rollback;
select 'PASS: B2C claims/retry, immutability, Partner both orders, canonical payment, proof CAS/replacement/revocation, no accounting; fixtures rolled back' as result;
