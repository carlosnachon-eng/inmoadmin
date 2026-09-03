select name, administration_ended_at
from public.properties
where administration_ended_at = date '2026-08-31'
order by name;

select count(*) as future_unpaid_payments
from public.payments pay
join public.contracts c on c.id = pay.contract_id
join public.properties p on p.name = c.property_name
where p.administration_ended_at = date '2026-08-31'
  and pay.due_date > p.administration_ended_at
  and pay.status <> 'pagado';

select count(*) as future_pending_commissions
from public.comisiones_admin ca
join public.contracts c on c.id = ca.contract_id
join public.properties p on p.name = c.property_name
where p.administration_ended_at = date '2026-08-31'
  and ca.periodo >= '2026-09'
  and ca.status = 'pendiente';

select count(*) as active_contracts_preserved
from public.contracts c
join public.properties p on p.name = c.property_name
where p.administration_ended_at = date '2026-08-31'
  and c.status = 'activo';
