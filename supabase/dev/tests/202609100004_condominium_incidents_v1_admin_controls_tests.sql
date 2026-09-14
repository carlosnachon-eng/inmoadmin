begin;
do $$
declare
  operator_id uuid:=gen_random_uuid(); editor_id uuid:=gen_random_uuid(); inactive_id uuid:=gen_random_uuid(); external_id uuid:=gen_random_uuid(); partner_id uuid:=gen_random_uuid();
  condo_id uuid:=gen_random_uuid(); unit_id uuid:=gen_random_uuid(); qa_ticket_id uuid:=gen_random_uuid(); category_id uuid:=gen_random_uuid(); partner_agency_id uuid:=gen_random_uuid(); updated public.maintenance_tickets;
begin
  insert into public.roles(id,nombre,descripcion,es_externo) values('propietario','Propietario QA','Externo QA',true) on conflict(id) do nothing;
  insert into auth.users(instance_id,id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    ('00000000-0000-0000-0000-000000000000',operator_id,'authenticated','authenticated','incident.operator.qa@example.invalid','{}','{}',now(),now()),
    ('00000000-0000-0000-0000-000000000000',editor_id,'authenticated','authenticated','incident.editor.qa@example.invalid','{}','{}',now(),now()),
    ('00000000-0000-0000-0000-000000000000',inactive_id,'authenticated','authenticated','incident.inactive.qa@example.invalid','{}','{}',now(),now()),
    ('00000000-0000-0000-0000-000000000000',external_id,'authenticated','authenticated','incident.external.qa@example.invalid','{}','{"rol_pretendido":"propietario"}',now(),now()),
    ('00000000-0000-0000-0000-000000000000',partner_id,'authenticated','authenticated','incident.partner.qa@example.invalid','{}','{}',now(),now());
  update public.profiles set role_id='admin',active=true where id in(operator_id,editor_id,partner_id);
  update public.profiles set role_id='admin',active=false where id=inactive_id;
  insert into public.partner_agencies(id,nombre_comercial) values(partner_agency_id,'QA INCIDENT PARTNER');
  insert into public.partner_users(auth_user_id,partner_agency_id,active) values(partner_id,partner_agency_id,true);
  insert into public.condominios(id,nombre,activo) values(condo_id,'QA INCIDENT ADMIN CONTROLS',true);
  insert into public.unidades_condominio(id,condominio_id,numero,activo,propietario_nombre,residente_es_propietario) values(unit_id,condo_id,'QA-ADMIN',true,'QA',true);
  insert into public.maintenance_categories(id,condominio_id,code,name,created_by) values(category_id,condo_id,'general','General QA',operator_id);
  insert into public.maintenance_tickets(id,condominio_id,unidad_id,reporter_profile_id,title,description,category,priority,status,created_by,idempotency_key,incident_origin,legacy_record,payer)
  values(qa_ticket_id,condo_id,unit_id,operator_id,'Control administrativo','Descripción QA','general','media','nuevo',operator_id::text,gen_random_uuid(),'administration',false,'propietario');

  perform set_config('request.jwt.claim.sub',operator_id::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',operator_id,'role','authenticated')::text,true); set local role authenticated;
  updated:=public.condominium_admin_update_incident_v1(qa_ticket_id,condo_id,null,'alta',editor_id,true,null,'internal',null);
  if updated.priority<>'alta' or updated.responsible_profile_id<>editor_id then raise exception 'ADMIN_CONTROLS_VALID_UPDATE_FAILED'; end if;
  if (select count(*) from public.maintenance_ticket_updates u where u.ticket_id=qa_ticket_id and visibility='internal' and body in('Prioridad actualizada','Responsable actualizado'))<>2 then raise exception 'ADMIN_CONTROLS_AUDIT_FAILED'; end if;
  updated:=public.condominium_admin_update_incident_v1(qa_ticket_id,condo_id,null,null,null,true,null,'internal',null);
  if updated.responsible_profile_id is not null then raise exception 'ADMIN_CONTROLS_UNASSIGN_FAILED'; end if;

  begin perform public.condominium_admin_update_incident_v1(qa_ticket_id,condo_id,null,'critica',null,false,null,'internal',null); raise exception 'INVALID_PRIORITY_ALLOWED'; exception when others then if sqlerrm not like '%INVALID_PRIORITY%' then raise; end if; end;
  begin perform public.condominium_admin_update_incident_v1(qa_ticket_id,condo_id,null,null,gen_random_uuid(),true,null,'internal',null); raise exception 'MISSING_RESPONSIBLE_ALLOWED'; exception when others then if sqlerrm not like '%INVALID_RESPONSIBLE%' then raise; end if; end;
  begin perform public.condominium_admin_update_incident_v1(qa_ticket_id,condo_id,null,null,inactive_id,true,null,'internal',null); raise exception 'INACTIVE_RESPONSIBLE_ALLOWED'; exception when others then if sqlerrm not like '%INVALID_RESPONSIBLE%' then raise; end if; end;
  begin perform public.condominium_admin_update_incident_v1(qa_ticket_id,condo_id,null,null,external_id,true,null,'internal',null); raise exception 'EXTERNAL_RESPONSIBLE_ALLOWED'; exception when others then if sqlerrm not like '%INVALID_RESPONSIBLE%' then raise; end if; end;
  begin perform public.condominium_admin_update_incident_v1(qa_ticket_id,condo_id,null,null,partner_id,true,null,'internal',null); raise exception 'PARTNER_RESPONSIBLE_ALLOWED'; exception when others then if sqlerrm not like '%INVALID_RESPONSIBLE%' then raise; end if; end;
  reset role;

  perform set_config('request.jwt.claim.sub',external_id::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',external_id,'role','authenticated')::text,true); set local role authenticated;
  begin perform public.condominium_admin_update_incident_v1(qa_ticket_id,condo_id,null,'baja',null,false,null,'internal',null); raise exception 'EXTERNAL_UPDATE_ALLOWED'; exception when others then if sqlerrm not like '%OPERATION_NOT_ALLOWED%' then raise; end if; end;
  reset role;
end $$;
select 'CONDOMINIUM_INCIDENTS_V1_ADMIN_CONTROLS_TESTS_OK' as result;
rollback;
