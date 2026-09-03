begin;

alter table public.properties
  add column if not exists administration_ended_at date;

comment on column public.properties.administration_ended_at is
  'Último día en que Emporio presta el servicio de administración. No termina contratos, renovaciones ni comercialización.';

create index if not exists idx_properties_administration_ended_at
  on public.properties (administration_ended_at)
  where administration_ended_at is not null;

update public.properties
set administration_ended_at = date '2026-08-31'
where id in (
  '1cf5fef9-b332-46b4-85f9-0b3dc6d8023c',
  '481438ba-8598-4787-bad8-ee560b38c469',
  'b4a86eeb-2d76-4a1a-83ac-ed6d297a24cf',
  '1ae6a1d6-c138-4d42-952e-9ab4f1b30761',
  '21002948-a04c-45bc-9f8a-4f97cdaca7bf',
  '70c222f4-3ba2-4d67-b3be-f835a60d77e8',
  '9ce6b9af-a3fe-427b-b2fd-bc4e25a02d82',
  '90087997-fbc6-4ef7-88aa-284d9509f8e9',
  '93ec1343-3234-4e60-9e14-e8a57f797ee3',
  'cfea0f34-db20-4813-89bf-b7af507096a9',
  'ddb25d01-1cd0-4df2-933d-9ac24667621e'
);

delete from public.comisiones_admin ca
using public.contracts c, public.properties p
where ca.contract_id = c.id
  and c.property_name = p.name
  and p.administration_ended_at = date '2026-08-31'
  and ca.periodo >= '2026-09'
  and ca.status = 'pendiente';

delete from public.payments pay
using public.contracts c, public.properties p
where pay.contract_id = c.id
  and c.property_name = p.name
  and p.administration_ended_at = date '2026-08-31'
  and pay.due_date > p.administration_ended_at
  and pay.status <> 'pagado';

commit;
