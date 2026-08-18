-- DEV ONLY — PREPARADO, NO EJECUTADO.
-- Dataset sintético FASE1-QA para inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- Aplicar únicamente mediante apply_202608180003_fase_1_operational_stress_seed.sh.

begin;

do $$
begin
  if obj_description('public.servicios_inmueble'::regclass, 'pg_class')
       <> 'dev-bootstrap:202608180002:fase-1-operational-sources' then
    raise exception 'FASE1-QA: bootstrap DEV no detectado';
  end if;
  if not exists (select 1 from public.profiles where id='00000000-0000-4000-8000-000000000001' and active) then
    raise exception 'FASE1-QA: falta perfil admin DEV sintético';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='properties' and column_name='owner_email') then
    raise exception 'FASE1-QA: properties.owner_email sigue ausente';
  end if;
  if to_regclass('public.cash_movements') is null
     or coalesce(obj_description(to_regclass('public.cash_movements'), 'pg_class'), '')
       <> 'dev-bootstrap:202608180004:fase-1-work-center-source-gaps' then
    raise exception 'FASE1-QA: cash_movements sigue ausente o no pertenece al bootstrap DEV esperado';
  end if;
end;
$$;

-- Cartera ficticia: dos propietarios y cuatro inmuebles sin direcciones ni PII.
insert into public.properties (id, name, status, owner_email)
values
 ('f1000000-0000-4000-8100-000000000001','FASE1-QA Torre Nube 101','ocupada','fase1-owner-a@qa.invalid'),
 ('f1000000-0000-4000-8100-000000000002','FASE1-QA Torre Nube 202','ocupada','fase1-owner-a@qa.invalid'),
 ('f1000000-0000-4000-8100-000000000003','FASE1-QA Patio Solar 1','ocupada','fase1-owner-b@qa.invalid'),
 ('f1000000-0000-4000-8100-000000000004','FASE1-QA Patio Solar 2','ocupada','fase1-owner-b@qa.invalid')
on conflict (id) do nothing;

insert into public.contracts (
 id, property_id, tenant_id, start_date, end_date, monthly_rent, status,
 tenant_name, tenant_email, property_name, commission_type, commission_value,
 owner_name, rent_receiver
)
values
 ('f1100000-0000-4000-8100-000000000001','f1000000-0000-4000-8100-000000000001',null,current_date-180,current_date+180,12000,'activo','FASE1-QA Inquilino A1','fase1-tenant-a1@qa.invalid','FASE1-QA Torre Nube 101','porcentaje',10,'FASE1-QA Owner A','inmobiliaria'),
 ('f1100000-0000-4000-8100-000000000002','f1000000-0000-4000-8100-000000000002',null,current_date-180,current_date+180,9000,'activo','FASE1-QA Inquilino A2','fase1-tenant-a2@qa.invalid','FASE1-QA Torre Nube 202','porcentaje',10,'FASE1-QA Owner A','propietario'),
 ('f1100000-0000-4000-8100-000000000003','f1000000-0000-4000-8100-000000000003',null,current_date-180,current_date+180,15000,'activo','FASE1-QA Inquilino B1','fase1-tenant-b1@qa.invalid','FASE1-QA Patio Solar 1','fijo',1500,'FASE1-QA Owner B','inmobiliaria'),
 ('f1100000-0000-4000-8100-000000000004','f1000000-0000-4000-8100-000000000004',null,current_date-180,current_date+20,8000,'activo','FASE1-QA Inquilino B2','fase1-tenant-b2@qa.invalid','FASE1-QA Patio Solar 2','porcentaje',8,'FASE1-QA Owner B','inmobiliaria')
on conflict (id) do nothing;

insert into public.payments (id,contract_id,amount,due_date,payment_date,status,receipt_url,tenant_name,tenant_email,property_name,recibido_por)
values
 ('f1200000-0000-4000-8100-000000000001','f1100000-0000-4000-8100-000000000001',12000,date_trunc('month',current_date)::date+4,current_date,'pagado',null,'FASE1-QA Inquilino A1','fase1-tenant-a1@qa.invalid','FASE1-QA Torre Nube 101','emporio'),
 ('f1200000-0000-4000-8100-000000000002','f1100000-0000-4000-8100-000000000002',9000,date_trunc('month',current_date)::date+4,current_date,'pagado',null,'FASE1-QA Inquilino A2','fase1-tenant-a2@qa.invalid','FASE1-QA Torre Nube 202','propietario'),
 ('f1200000-0000-4000-8100-000000000003','f1100000-0000-4000-8100-000000000003',15000,date_trunc('month',current_date)::date+4,current_date,'pagado',null,'FASE1-QA Inquilino B1','fase1-tenant-b1@qa.invalid','FASE1-QA Patio Solar 1','emporio'),
 ('f1200000-0000-4000-8100-000000000004','f1100000-0000-4000-8100-000000000004',8000,current_date-12,null,'atrasado',null,'FASE1-QA Inquilino B2','fase1-tenant-b2@qa.invalid','FASE1-QA Patio Solar 2',null),
 ('f1200000-0000-4000-8100-000000000005','f1100000-0000-4000-8100-000000000004',8000,current_date-3,null,'en_revision','https://example.invalid/fase1-qa/rent-receipt.pdf','FASE1-QA Inquilino B2','fase1-tenant-b2@qa.invalid','FASE1-QA Patio Solar 2',null)
on conflict (id) do nothing;

insert into public.property_expenses (id,property_name,category,description,amount,paid_by,payment_method,date,notes,created_by)
values ('f1700000-0000-4000-8100-000000000001','FASE1-QA Torre Nube 101','luz','FASE1-QA CFE pagada por Emporio',850,'propietario','transferencia',current_date,'FASE1-QA gasto ligado','qa-admin-fase1-dev@emporio.test')
on conflict (id) do nothing;

insert into public.servicios_inmueble (id,property_name,tipo,periodicidad,aplica,quien_paga,notas)
values
 ('f1500000-0000-4000-8100-000000000001','FASE1-QA Torre Nube 101','agua','mensual',true,'inquilino','FASE1-QA próximo'),
 ('f1500000-0000-4000-8100-000000000002','FASE1-QA Torre Nube 101','internet','mensual',true,'inquilino','FASE1-QA vencido'),
 ('f1500000-0000-4000-8100-000000000003','FASE1-QA Torre Nube 202','mantenimiento','mensual',true,'inquilino','FASE1-QA comprobante'),
 ('f1500000-0000-4000-8100-000000000004','FASE1-QA Torre Nube 202','cfe','bimestral',true,'inquilino','FASE1-QA sin ancla'),
 ('f1500000-0000-4000-8100-000000000005','FASE1-QA Patio Solar 1','predial','anual',true,'propietario','FASE1-QA sin ancla'),
 ('f1500000-0000-4000-8100-000000000006','FASE1-QA Patio Solar 1','gas','recarga',true,'inquilino','FASE1-QA sin faltante'),
 ('f1500000-0000-4000-8100-000000000007','FASE1-QA Torre Nube 101','luz','mensual',true,'propietario','FASE1-QA Emporio por conciliar')
on conflict (id) do nothing;

insert into public.pagos_servicios (id,servicio_id,property_name,tipo,periodo,fecha_limite,status,comprobante_url,monto,subido_por,gasto_id)
values
 ('f1600000-0000-4000-8100-000000000001','f1500000-0000-4000-8100-000000000001','FASE1-QA Torre Nube 101','agua',to_char(current_date,'YYYY-MM'),current_date+3,'pendiente',null,400,'FASE1-QA',null),
 ('f1600000-0000-4000-8100-000000000002','f1500000-0000-4000-8100-000000000002','FASE1-QA Torre Nube 101','internet',to_char(current_date,'YYYY-MM'),current_date-5,'pendiente',null,600,'FASE1-QA',null),
 ('f1600000-0000-4000-8100-000000000003','f1500000-0000-4000-8100-000000000003','FASE1-QA Torre Nube 202','mantenimiento',to_char(current_date,'YYYY-MM'),current_date+2,'en_revision','https://example.invalid/fase1-qa/service-receipt.pdf',900,'FASE1-QA',null),
 ('f1600000-0000-4000-8100-000000000007','f1500000-0000-4000-8100-000000000007','FASE1-QA Torre Nube 101','luz',to_char(current_date,'YYYY-MM'),current_date,'pagado',null,850,'FASE1-QA','f1700000-0000-4000-8100-000000000001')
on conflict (id) do nothing;

insert into public.owner_payments (id,owner_name,owner_email,period_description,total_rent,total_commission,total_liquid,amount_paid,payment_method,payment_date,status,notes,rent_receiver)
values ('f1800000-0000-4000-8100-000000000001','FASE1-QA Owner B','fase1-owner-b@qa.invalid',
  (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month from current_date)::int]||' '||extract(year from current_date)::int,
  15000,1500,13500,5000,'transferencia',current_date,'pagado_parcial','FASE1-QA parcial','inmobiliaria')
on conflict (id) do nothing;

insert into public.owner_payment_receipts (id,owner_name,owner_email,property_name,concepto,monto,forma_pago,comprobante_url,firma_url,periodo,fecha,created_by)
values
 ('f1900000-0000-4000-8100-000000000001','FASE1-QA Owner A','fase1-owner-a@qa.invalid','FASE1-QA Torre Nube 101','parcial',1000,'transferencia',null,null,to_char(current_date,'YYYY-MM'),current_date,'FASE1-QA'),
 ('f1900000-0000-4000-8100-000000000002','FASE1-QA Owner B','fase1-owner-b@qa.invalid','FASE1-QA Patio Solar 1','parcial',500,'efectivo',null,null,to_char(current_date,'YYYY-MM'),current_date,'FASE1-QA')
on conflict (id) do nothing;

insert into public.maintenance_tickets (id,title,description,category,priority,status,created_at,updated_at,payer,charged_amount,advance_paid,advance_amount,descontado_de_liquidacion,property_name)
values
 ('f1300000-0000-4000-8100-000000000001','FASE1-QA Fuga urgente','Caso urgente sintético','plomeria','urgente','nuevo',now()-interval '2 hours',now()-interval '2 hours','inquilino',0,false,0,false,'FASE1-QA Torre Nube 101'),
 ('f1300000-0000-4000-8100-000000000002','FASE1-QA Ticket estancado','Sin avance sintético','otro','media','revisado',now()-interval '60 hours',now()-interval '48 hours','inmobiliaria',0,false,0,false,'FASE1-QA Torre Nube 202'),
 ('f1300000-0000-4000-8100-000000000003','FASE1-QA Cotización pendiente','Espera propietario','otro','media','cotizado',now()-interval '96 hours',now()-interval '96 hours','propietario',0,false,0,false,'FASE1-QA Patio Solar 1'),
 ('f1300000-0000-4000-8100-000000000004','FASE1-QA Descuento anterior','Saldo propietario previo','otro','media','cerrado',date_trunc('month',current_date)-interval '10 days',date_trunc('month',current_date)-interval '5 days','propietario',3000,false,0,false,'FASE1-QA Torre Nube 101'),
 ('f1300000-0000-4000-8100-000000000005','FASE1-QA Cerrado sin ruido','No debe aparecer','otro','urgente','cerrado',now()-interval '10 days',now()-interval '9 days','inmobiliaria',0,false,0,false,'FASE1-QA Patio Solar 2')
on conflict (id) do nothing;

insert into public.maintenance_quotes (id,ticket_id,property_name,owner_email,payer,descripcion,costo_proveedor,monto_final,status,created_at,updated_at)
values ('f1400000-0000-4000-8100-000000000001','f1300000-0000-4000-8100-000000000003','FASE1-QA Patio Solar 1','fase1-owner-b@qa.invalid','propietario','FASE1-QA cotización',2000,2600,'pendiente',now()-interval '96 hours',now()-interval '96 hours')
on conflict (id) do nothing;

insert into public.llaves (id,numero,propiedad,en_resguardo,portador_nombre,fecha_prestamo,notas,activa)
values
 ('f1a00000-0000-4000-8100-000000000001',9101,'FASE1-QA Torre Nube 101',true,'FASE1-QA Resguardo',null,'FASE1-QA',true),
 ('f1a00000-0000-4000-8100-000000000002',9102,'FASE1-QA Torre Nube 202',false,'FASE1-QA Portador 1',now()-interval '12 hours','FASE1-QA',true),
 ('f1a00000-0000-4000-8100-000000000003',9103,'FASE1-QA Patio Solar 1',false,'FASE1-QA Portador 2',now()-interval '30 hours','FASE1-QA',true),
 ('f1a00000-0000-4000-8100-000000000004',9104,'FASE1-QA Patio Solar 2',false,'FASE1-QA Portador 3',now()-interval '80 hours','FASE1-QA',true)
on conflict (id) do nothing;

insert into public.operational_recurring_tasks (id,task_key,title,category,responsible_profile_id,recurrence_unit,recurrence_interval,due_time,timezone,next_due_at,lead_days,state,created_by,updated_by)
values ('f1b00000-0000-4000-8100-000000000001','fase1-qa:recurring:upcoming','FASE1-QA Revisión operativa próxima','supervision','00000000-0000-4000-8000-000000000003','day',7,time '10:00','America/Mexico_City',((current_date+2+time '10:00') at time zone 'America/Mexico_City'),5,'active','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

commit;
