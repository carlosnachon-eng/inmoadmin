begin;
do $$
declare admin_id uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); condo_a uuid:=gen_random_uuid(); condo_b uuid:=gen_random_uuid(); unit_a uuid:=gen_random_uuid(); unit_b uuid:=gen_random_uuid(); ticket uuid:=gen_random_uuid(); category uuid:=gen_random_uuid(); created public.maintenance_tickets; updated public.maintenance_tickets;
begin
 insert into public.roles(id,nombre,descripcion,es_externo) values('propietario','Propietario QA','Rol externo sintético para transacción QA',true) on conflict(id) do nothing;
 insert into auth.users(instance_id,id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('00000000-0000-0000-0000-000000000000',admin_id,'authenticated','authenticated','incident.admin.qa@example.invalid','{}'::jsonb,'{}'::jsonb,now(),now()),
 ('00000000-0000-0000-0000-000000000000',owner_id,'authenticated','authenticated','incident.owner.qa@example.invalid','{}'::jsonb,'{"rol_pretendido":"propietario"}'::jsonb,now(),now());
 update public.profiles set role_id='admin',active=true where id=admin_id;
 insert into public.condominios(id,nombre,activo) values(condo_a,'QA INCIDENTS V1 A',true),(condo_b,'QA INCIDENTS V1 B',true);
 insert into public.unidades_condominio(id,condominio_id,numero,activo,propietario_nombre,propietario_email,residente_es_propietario) values
 (unit_a,condo_a,'QA-01',true,'QA','incident.owner.qa@example.invalid',true),(unit_b,condo_b,'QA-02',true,'QA','other.qa@example.invalid',true);
 insert into public.condominium_operation_controls(condominio_id,lifecycle_status,owner_portal_enabled,communications_enabled,current_billing_enabled,receipts_enabled,real_payments_enabled,money_movements_enabled,activation_authorized_at,activation_authorized_by) values(condo_a,'active',true,false,true,true,true,false,now(),admin_id),(condo_b,'active',true,false,true,true,true,false,now(),admin_id);
 insert into public.condominium_unit_portal_access(condominio_id,unidad_id,email_normalized,access_kind,active,created_by) values(condo_a,unit_a,'incident.owner.qa@example.invalid','OWNER',true,admin_id);
 insert into public.maintenance_categories(id,condominio_id,code,name,created_by) values(category,condo_a,'plomeria','Plomería',admin_id);

 perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.email','incident.owner.qa@example.invalid',true); set local role authenticated;
 created:=public.condominium_create_incident_v1(ticket,condo_a,unit_a,category,'Fuga sintética','Descripción sintética sin datos reales','media',ticket,null,null,null,null,null);
 if created.id<>ticket or created.status<>'nuevo' or created.legacy_record then raise exception 'OWNER_CREATE_FAILED'; end if;
 if (select count(*) from public.maintenance_tickets where condominio_id=condo_a)<>1 then raise exception 'OWNER_SCOPE_FAILED'; end if;
 if exists(select 1 from public.maintenance_tickets where condominio_id=condo_b) then raise exception 'CROSS_CONDO_VISIBLE'; end if;
 begin
   perform public.condominium_create_incident_v1(gen_random_uuid(),condo_b,unit_b,null,'Intento cruzado','Debe ser rechazado por unidad','media',gen_random_uuid(),null,null,null,null,null);
   raise exception 'CROSS_CONDO_CREATE_ALLOWED';
 exception when insufficient_privilege then null; end;
 begin
   delete from public.maintenance_tickets where id=ticket;
   if found then raise exception 'V1_DELETE_ALLOWED'; end if;
 exception when insufficient_privilege then null; end;

 reset role; perform set_config('request.jwt.claim.sub',admin_id::text,true); perform set_config('request.jwt.claim.email','admin.qa@example.invalid',true); set local role authenticated;
 updated:=public.condominium_update_incident_v1(ticket,condo_a,'revisado','alta',admin_id,'Estamos revisando la incidencia.','resident',null);
 if updated.status<>'revisado' or updated.first_attended_at is null then raise exception 'ADMIN_REVIEW_FAILED'; end if;
 updated:=public.condominium_update_incident_v1(ticket,condo_a,'en_proceso',null,null,'Nota sólo interna.','internal',null);
 updated:=public.condominium_update_incident_v1(ticket,condo_a,'terminado',null,null,'Trabajo sintético concluido.','resident','Trabajo sintético concluido.');
 updated:=public.condominium_update_incident_v1(ticket,condo_a,'cerrado',null,null,'Cierre confirmado.','resident','Trabajo sintético concluido.');
 updated:=public.condominium_update_incident_v1(ticket,condo_a,'en_proceso',null,null,'Reapertura auditada.','resident',null);
 if updated.reopened_at is null then raise exception 'REOPEN_AUDIT_FAILED'; end if;
 if (select count(*) from public.maintenance_ticket_updates where ticket_id=ticket and visibility='internal')<>1 then raise exception 'INTERNAL_TIMELINE_FAILED'; end if;
 reset role;
end $$;
select 'CONDOMINIUM_INCIDENTS_V1_E2E_OK' as result;
rollback;
