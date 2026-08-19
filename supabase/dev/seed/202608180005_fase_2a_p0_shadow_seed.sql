-- DEV ONLY. Fixtures ERP mínimos FASE2A-QA; la ingesta shadow se ejecuta por el runner JS.
-- No inserta conversaciones, mensajes, matches ni auditorías directamente.
begin;
do $$ begin
  if coalesce(obj_description('public.shadow_messages'::regclass,'pg_class'),'') <> 'dev-bootstrap:202608180005:fase-2a-p0-shadow'
     or not exists(select 1 from public.profiles where id='7d4ec199-c7b4-4528-b646-bdd2dc94c4e1' and active and role_id='admin') then
    raise exception 'FASE2A-QA bloqueado: DEV/bootstrap/perfil QA incompatible';
  end if;
end $$;

insert into public.properties(id,name,status,owner_email) values
 ('f2a00000-0000-4000-8200-000000000001','FASE2A-QA Casa Nube 101','ocupada','fase2a-owner@qa.invalid'),
 ('f2a00000-0000-4000-8200-000000000002','FASE2A-QA Casa Nube 202','ocupada','fase2a-owner@qa.invalid')
on conflict(id) do nothing;

insert into public.contracts(id,property_id,tenant_id,start_date,end_date,monthly_rent,status,tenant_name,tenant_email,property_name,commission_type,commission_value,owner_name,rent_receiver) values
 ('f2a10000-0000-4000-8200-000000000001','f2a00000-0000-4000-8200-000000000001',null,current_date-90,current_date+275,11000,'activo','FASE2A-QA Inquilino','fase2a-tenant@qa.invalid','FASE2A-QA Casa Nube 101','porcentaje',10,'FASE2A-QA Owner','inmobiliaria'),
 ('f2a10000-0000-4000-8200-000000000002','f2a00000-0000-4000-8200-000000000002',null,current_date-400,current_date-30,9500,'vencido','FASE2A-QA Inquilino anterior','fase2a-former@qa.invalid','FASE2A-QA Casa Nube 202','porcentaje',10,'FASE2A-QA Owner','inmobiliaria')
on conflict(id) do nothing;

insert into public.payments(id,contract_id,amount,due_date,payment_date,status,receipt_url,tenant_name,tenant_email,property_name,recibido_por) values
 ('f2a20000-0000-4000-8200-000000000001','f2a10000-0000-4000-8200-000000000001',11000,date_trunc('month',current_date)::date+4,current_date,'pagado',null,'FASE2A-QA Inquilino','fase2a-tenant@qa.invalid','FASE2A-QA Casa Nube 101','emporio')
on conflict(id) do nothing;

insert into public.maintenance_tickets(id,title,description,category,priority,status,created_at,updated_at,payer,charged_amount,advance_paid,advance_amount,descontado_de_liquidacion,property_name) values
 ('f2a30000-0000-4000-8200-000000000001','FASE2A-QA Fuga lavabo','Fixture contextual','plomeria','urgente','nuevo',now()-interval '2 hours',now()-interval '2 hours','inquilino',0,false,0,false,'FASE2A-QA Casa Nube 101'),
 ('f2a30000-0000-4000-8200-000000000002','FASE2A-QA Mantenimiento resuelto','Fixture contextual cerrado','otro','media','cerrado',now()-interval '5 days',now()-interval '1 day','inmobiliaria',0,false,0,false,'FASE2A-QA Casa Nube 101')
on conflict(id) do nothing;

insert into public.servicios_inmueble(id,property_name,tipo,periodicidad,aplica,quien_paga,notas) values
 ('f2a50000-0000-4000-8200-000000000001','FASE2A-QA Casa Nube 101','agua','mensual',true,'inquilino','FASE2A-QA contexto agua'),
 ('f2a50000-0000-4000-8200-000000000002','FASE2A-QA Casa Nube 101','cfe','bimestral',true,'inquilino','FASE2A-QA contexto CFE')
on conflict(id) do nothing;
insert into public.pagos_servicios(id,servicio_id,property_name,tipo,periodo,fecha_limite,status,comprobante_url,monto,subido_por,gasto_id) values
 ('f2a60000-0000-4000-8200-000000000001','f2a50000-0000-4000-8200-000000000001','FASE2A-QA Casa Nube 101','agua',to_char(current_date,'YYYY-MM'),current_date+3,'pendiente',null,450,'FASE2A-QA',null),
 ('f2a60000-0000-4000-8200-000000000002','f2a50000-0000-4000-8200-000000000002','FASE2A-QA Casa Nube 101','cfe',to_char(current_date,'YYYY-MM'),current_date+10,'pendiente',null,800,'FASE2A-QA',null)
on conflict(id) do nothing;

insert into public.owner_payments(id,owner_name,owner_email,period_description,total_rent,total_commission,total_liquid,amount_paid,payment_method,payment_date,status,notes,rent_receiver) values
 ('f2a80000-0000-4000-8200-000000000001','FASE2A-QA Owner','fase2a-owner@qa.invalid','agosto 2026',11000,1100,9900,0,'transferencia',current_date,'pendiente','FASE2A-QA contexto liquidación','inmobiliaria')
on conflict(id) do nothing;

insert into public.llaves(id,numero,propiedad,en_resguardo,portador_nombre,fecha_prestamo,notas,activa) values
 ('f2aa0000-0000-4000-8200-000000000001',9201,'FASE2A-QA Casa Nube 101',true,'FASE2A-QA Resguardo',null,'FASE2A-QA contexto llave',true)
on conflict(id) do nothing;

insert into public.administrative_case_controls(context_key,corrected_priority,resolution_status,updated_by) values
 ('fase2a-qa:legal-review:house-101','P1','open','7d4ec199-c7b4-4528-b646-bdd2dc94c4e1')
on conflict(context_key) do nothing;
commit;
