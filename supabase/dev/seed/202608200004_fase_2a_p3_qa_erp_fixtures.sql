-- DEV ONLY. Fixtures ERP sintéticos y namespaced para P3 v7.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq). Sin PII ni datos productivos.
begin;
do $$ begin
  if coalesce(obj_description('public.shadow_messages'::regclass,'pg_class'),'') <> 'dev-bootstrap:202608180005:fase-2a-p0-shadow'
     or not exists(select 1 from public.profiles where id='7d4ec199-c7b4-4528-b646-bdd2dc94c4e1' and active and role_id='admin') then
    raise exception 'FASE2A-P3-QA bloqueado: DEV/bootstrap/perfil QA incompatible';
  end if;

  if exists(select 1 from public.properties where id in ('f2a30000-0000-4000-8100-000000000001','f2a30000-0000-4000-8100-000000000002') and name not like 'FASE2A-P3-QA %')
     or exists(select 1 from public.contracts where id='f2a30000-0000-4000-8200-000000000001' and property_name not like 'FASE2A-P3-QA %')
     or exists(select 1 from public.payments where id='f2a30000-0000-4000-8300-000000000001' and property_name not like 'FASE2A-P3-QA %')
     or exists(select 1 from public.maintenance_tickets where id='f2a30000-0000-4000-8400-000000000001' and title not like 'FASE2A-P3-QA %')
     or exists(select 1 from public.servicios_inmueble where id in ('f2a30000-0000-4000-8500-000000000001','f2a30000-0000-4000-8500-000000000002') and notas not like 'FASE2A-P3-QA %')
     or exists(select 1 from public.pagos_servicios where id in ('f2a30000-0000-4000-8600-000000000001','f2a30000-0000-4000-8600-000000000002') and subido_por <> 'FASE2A-P3-QA')
     or exists(select 1 from public.owner_payments where id='f2a30000-0000-4000-8700-000000000001' and notes not like 'FASE2A-P3-QA %')
     or exists(select 1 from public.llaves where id='f2a30000-0000-4000-8800-000000000001' and notas not like 'FASE2A-P3-QA %')
     or exists(select 1 from public.administrative_case_controls where context_key='maintenance_ticket:f2a30000-0000-4000-8400-000000000001' and updated_by <> '7d4ec199-c7b4-4528-b646-bdd2dc94c4e1') then
    raise exception 'FASE2A-P3-QA bloqueado: colisión con objetos no pertenecientes al fixture';
  end if;
end $$;

insert into public.properties(id,name,status,owner_email) values
 ('f2a30000-0000-4000-8100-000000000001','FASE2A-P3-QA Montpellier 101','ocupada','fase2a-p3-owner@qa.invalid'),
 ('f2a30000-0000-4000-8100-000000000002','FASE2A-P3-QA Montpellier 202','ocupada','fase2a-p3-owner@qa.invalid')
on conflict(id) do update set name=excluded.name,status=excluded.status,owner_email=excluded.owner_email;

insert into public.contracts(id,property_id,tenant_id,start_date,end_date,monthly_rent,status,tenant_name,tenant_email,property_name,commission_type,commission_value,owner_name,rent_receiver) values
 ('f2a30000-0000-4000-8200-000000000001','f2a30000-0000-4000-8100-000000000001',null,current_date-120,current_date+245,12500,'activo','FASE2A-P3-QA Inquilino','fase2a-p3-tenant@qa.invalid','FASE2A-P3-QA Montpellier 101','porcentaje',10,'FASE2A-P3-QA Owner','inmobiliaria')
on conflict(id) do update set property_id=excluded.property_id,status=excluded.status,property_name=excluded.property_name;

insert into public.payments(id,contract_id,amount,due_date,payment_date,status,receipt_url,tenant_name,tenant_email,property_name,recibido_por) values
 ('f2a30000-0000-4000-8300-000000000001','f2a30000-0000-4000-8200-000000000001',12500,date_trunc('month',current_date)::date+4,current_date,'pagado',null,'FASE2A-P3-QA Inquilino','fase2a-p3-tenant@qa.invalid','FASE2A-P3-QA Montpellier 101','emporio')
on conflict(id) do update set contract_id=excluded.contract_id,status=excluded.status,property_name=excluded.property_name;

insert into public.maintenance_tickets(id,property_id,title,description,category,priority,status,created_at,updated_at,payer,charged_amount,advance_paid,advance_amount,descontado_de_liquidacion,property_name) values
 ('f2a30000-0000-4000-8400-000000000001','f2a30000-0000-4000-8100-000000000001','FASE2A-P3-QA Fuga Montpellier','Fixture resoluble P3 v7','plomeria','urgente','nuevo',now()-interval '2 hours',now()-interval '2 hours','inquilino',0,false,0,false,'FASE2A-P3-QA Montpellier 101')
on conflict(id) do update set property_id=excluded.property_id,status=excluded.status,property_name=excluded.property_name;

insert into public.servicios_inmueble(id,property_name,tipo,periodicidad,aplica,quien_paga,notas) values
 ('f2a30000-0000-4000-8500-000000000001','FASE2A-P3-QA Montpellier 101','agua','mensual',true,'inquilino','FASE2A-P3-QA servicio agua resoluble'),
 ('f2a30000-0000-4000-8500-000000000002','FASE2A-P3-QA Montpellier 101','cfe','bimestral',true,'inquilino','FASE2A-P3-QA servicio CFE resoluble')
on conflict(id) do update set property_name=excluded.property_name,tipo=excluded.tipo,periodicidad=excluded.periodicidad,notas=excluded.notas;

insert into public.pagos_servicios(id,servicio_id,property_name,tipo,periodo,fecha_limite,status,comprobante_url,monto,subido_por,gasto_id) values
 ('f2a30000-0000-4000-8600-000000000001','f2a30000-0000-4000-8500-000000000001','FASE2A-P3-QA Montpellier 101','agua',to_char(current_date,'YYYY-MM'),current_date+3,'pendiente',null,480,'FASE2A-P3-QA',null),
 ('f2a30000-0000-4000-8600-000000000002','f2a30000-0000-4000-8500-000000000002','FASE2A-P3-QA Montpellier 101','cfe',to_char(current_date,'YYYY-MM'),current_date+10,'pendiente',null,920,'FASE2A-P3-QA',null)
on conflict(id) do update set servicio_id=excluded.servicio_id,property_name=excluded.property_name,periodo=excluded.periodo,status=excluded.status;

insert into public.owner_payments(id,owner_name,owner_email,period_description,total_rent,total_commission,total_liquid,amount_paid,payment_method,payment_date,status,notes,rent_receiver) values
 ('f2a30000-0000-4000-8700-000000000001','FASE2A-P3-QA Owner','fase2a-p3-owner@qa.invalid','FASE2A-P3-QA periodo',12500,1250,11250,0,'transferencia',current_date,'pendiente','FASE2A-P3-QA liquidación resoluble','inmobiliaria')
on conflict(id) do update set period_description=excluded.period_description,status=excluded.status,notes=excluded.notes;

insert into public.llaves(id,numero,propiedad,en_resguardo,portador_nombre,fecha_prestamo,notas,activa) values
 ('f2a30000-0000-4000-8800-000000000001',9301,'FASE2A-P3-QA Montpellier 101',true,'FASE2A-P3-QA Resguardo',null,'FASE2A-P3-QA llave resoluble',true)
on conflict(id) do update set propiedad=excluded.propiedad,en_resguardo=excluded.en_resguardo,notas=excluded.notas,activa=excluded.activa;

insert into public.administrative_case_controls(context_key,corrected_priority,resolution_status,updated_by) values
 ('maintenance_ticket:f2a30000-0000-4000-8400-000000000001','P1','open','7d4ec199-c7b4-4528-b646-bdd2dc94c4e1')
on conflict(context_key) do update set corrected_priority=excluded.corrected_priority,resolution_status=excluded.resolution_status,updated_by=excluded.updated_by;
commit;
