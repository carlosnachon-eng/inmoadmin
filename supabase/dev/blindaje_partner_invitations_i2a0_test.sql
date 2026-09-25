-- Synthetic only, every fixture is rolled back. Run in DEV hjfwjnejbcpmknvfpdcq.
begin;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  op_a uuid := gen_random_uuid(); op_b uuid := gen_random_uuid();
  tenant uuid := gen_random_uuid(); owner uuid := gen_random_uuid(); other_tenant uuid := gen_random_uuid();
  h text := repeat('a',64); ho text := repeat('b',64);
begin
  if not (select relrowsecurity from pg_class where oid='public.blindaje_partner_invitations'::regclass) then raise exception 'RLS missing'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='blindaje_partner_invitations') then raise exception 'Unexpected policies'; end if;
  if has_table_privilege('anon','public.blindaje_partner_invitations','SELECT') or has_table_privilege('authenticated','public.blindaje_partner_invitations','INSERT') then raise exception 'Public grants'; end if;
  if has_function_privilege('anon','public.blindaje_link_invited_submission(text,text,uuid)','EXECUTE') or has_function_privilege('authenticated','public.blindaje_link_invited_submission(text,text,uuid)','EXECUTE') then raise exception 'Public RPC'; end if;
  insert into public.partner_agencies(id,nombre_comercial) values(a,'I2A.0 SQL A'),(b,'I2A.0 SQL B');
  insert into public.partner_operations(id,partner_agency_id) values(op_a,a),(op_b,b);
  insert into public.solicitudes_inquilino(id,origen_operacion,created_at) values(tenant,'partner',now()),(other_tenant,'partner',now());
  insert into public.propietarios_inmuebles(id,nombre_propietario,direccion_inmueble,origen_operacion,created_at) values(owner,'I2A.0 SQL Propietario','I2A.0 SQL Domicilio','partner',now());
  insert into public.blindaje_partner_invitations(partner_agency_id,partner_operation_id,role,token_hash,expires_at)
    values(a,op_a,'inquilino',h,now()+interval '30 days'),(a,op_a,'propietario',ho,now()+interval '30 days');
  if public.blindaje_link_invited_submission(repeat('c',64),'inquilino',tenant) then raise exception 'Invented allowed'; end if;
  if public.blindaje_link_invited_submission(h,'propietario',owner) then raise exception 'Wrong role allowed'; end if;
  if public.blindaje_link_invited_submission(h,'inquilino',owner) then raise exception 'Wrong table allowed'; end if;
  update public.blindaje_partner_invitations set expires_at=now()-interval '1 day' where token_hash=h;
  if public.blindaje_link_invited_submission(h,'inquilino',tenant) then raise exception 'Expired allowed'; end if;
  update public.blindaje_partner_invitations set expires_at=now()+interval '30 days',revoked_at=now() where token_hash=h;
  if public.blindaje_link_invited_submission(h,'inquilino',tenant) then raise exception 'Revoked allowed'; end if;
  update public.blindaje_partner_invitations set revoked_at=null where token_hash=h;
  update public.partner_agencies set status='suspendido' where id=a;
  if public.blindaje_link_invited_submission(h,'inquilino',tenant) then raise exception 'Inactive agency allowed'; end if;
  update public.partner_agencies set status='activo' where id=a;
  update public.partner_operations set solicitud_inquilino_id=tenant where id=op_b;
  if public.blindaje_link_invited_submission(h,'inquilino',tenant) then raise exception 'Other operation record allowed'; end if;
  update public.partner_operations set solicitud_inquilino_id=null where id=op_b;
  update public.solicitudes_inquilino set origen_operacion='b2c' where id=tenant;
  if public.blindaje_link_invited_submission(h,'inquilino',tenant) then raise exception 'Wrong origin allowed'; end if;
  update public.solicitudes_inquilino set origen_operacion='partner',created_at=now()-interval '2 days' where id=tenant;
  if public.blindaje_link_invited_submission(h,'inquilino',tenant) then raise exception 'Old record allowed'; end if;
  update public.solicitudes_inquilino set created_at=now() where id=tenant;
  if not public.blindaje_link_invited_submission(h,'inquilino',tenant) then raise exception 'Valid tenant denied'; end if;
  if not public.blindaje_link_invited_submission(h,'inquilino',tenant) then raise exception 'Identical retry denied'; end if;
  if public.blindaje_link_invited_submission(h,'inquilino',other_tenant) then raise exception 'Switching record allowed'; end if;
  if not public.blindaje_link_invited_submission(ho,'propietario',owner) then raise exception 'Valid owner denied'; end if;
  if not exists(select 1 from public.partner_operations where id=op_a and solicitud_inquilino_id=tenant and propietario_id=owner and status_partner='en_revision') then raise exception 'Wrong link result'; end if;
  if exists(select 1 from public.partner_operations where id=op_b and (solicitud_inquilino_id is not null or propietario_id is not null)) then raise exception 'Modified B'; end if;
end $$;
rollback;
select 'PASS I2A.0 SQL: RLS/grants, role/table/origin/recency, invalid/expired/revoked/inactive, cross-operation, both roles, replay; all fixtures rolled back' as result;
