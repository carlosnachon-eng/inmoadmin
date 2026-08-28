-- Rollback conservador: sólo procede antes de registrar cualquier recuperación/evidencia.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$
begin
  if exists(select 1 from public.condominium_historical_recoveries) then
    raise exception 'ROLLBACK ABORTADO: existen recuperaciones históricas; no se eliminarán ni degradarán.';
  end if;
  if exists(select 1 from storage.objects where bucket_id='condominium-historical-evidence') then
    raise exception 'ROLLBACK ABORTADO: existe evidencia privada; no se eliminará.';
  end if;
end $$;

drop function if exists public.condominium_reverse_historical_recovery(uuid,text);
drop function if exists public.condominium_apply_historical_recovery(uuid,date,text);
drop function if exists public.condominium_create_historical_recovery(uuid,uuid,uuid,uuid,numeric,numeric,text,timestamptz,text,uuid,uuid);
drop function if exists public.condominium_create_historical_recovery(uuid,uuid,uuid,uuid,numeric,numeric,text,timestamptz,text,text,uuid,uuid);
drop trigger if exists condominium_historical_recovery_operation_guard on public.condominium_historical_recoveries;
drop function if exists public.condominium_historical_recovery_guard();

drop index if exists public.condominium_historical_recoveries_status_idx;
alter table public.condominium_historical_recoveries
  drop constraint if exists condominium_historical_recoveries_idempotency_unique,
  drop constraint if exists condominium_historical_recoveries_evidence_unique,
  drop constraint if exists condominium_historical_recoveries_state_audit_check,
  drop constraint if exists condominium_historical_recoveries_deposit_allocation_check,
  drop column if exists updated_at,
  drop column if exists current_fee_id,
  drop column if exists deposit_total,
  drop column if exists idempotency_key,
  drop column if exists reversed_at,
  drop column if exists reversed_by,
  drop column if exists reversal_reason,
  drop column if exists applied_at,
  drop column if exists applied_by,
  drop column if exists reconciled_at,
  drop column if exists reconciled_by,
  drop column if exists bank_confirmation_reference,
  drop column if exists custodian_organization,
  drop column if exists evidence_path,
  drop column if exists evidence_sha256,
  drop column if exists proof_received_at,
  drop column if exists payment_reference,
  alter column collected_at set not null;

-- Supabase protege storage.buckets contra DELETE SQL directo. El bucket vacío,
-- privado y sin políticas se conserva; puede retirarse por Storage API en una
-- intervención separada si no lo comparte ninguna versión desplegada.

-- Restaurar el snapshot exacto del Portal MVP previo.
create or replace function public.condominium_owner_portal_snapshot(p_unidad_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare target record; result jsonb;
begin
  select u.id,u.condominio_id,u.numero,c.nombre,c.cuota_mensual into target
  from public.unidades_condominio u join public.condominios c on c.id=u.condominio_id
  where u.id=p_unidad_id and u.activo=true and public.condominium_owner_has_unit(u.condominio_id,u.id);
  if not found then raise exception using errcode='42501',message='Unidad no autorizada.'; end if;
  result:=jsonb_build_object(
    'unit',jsonb_build_object('id',target.id,'number',target.numero,'condominiumId',target.condominio_id,'condominiumName',target.nombre,'monthlyFee',target.cuota_mensual),
    'historical',coalesce((select jsonb_agg(jsonb_build_object(
      'id',h.id,'sourceOrganization',h.source_organization,'sourceLabel',h.source_label,
      'cutoffDate',h.cutoff_date,'reportedCharges',h.reported_charges,'reportedPayments',h.reported_payments,
      'reportedBalance',h.reported_balance,'reviewStatus',h.review_status,'validatedCharges',h.validated_charges,
      'validatedPayments',h.validated_payments,'validatedBalance',h.validated_balance
    ) order by h.cutoff_date desc) from public.condominium_historical_accounts h
      where h.condominio_id=target.condominio_id and h.unidad_id=target.id),'[]'::jsonb),
    'historicalPayments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'period',p.reported_period,'amount',p.reported_amount,'receivedBy',p.received_by,
      'sourceLabel',p.source_label,'reviewStatus',p.review_status
    ) order by p.reported_period nulls last,p.created_at) from public.condominium_historical_payments p
      where p.condominio_id=target.condominio_id and p.unidad_id=target.id),'[]'::jsonb),
    'currentFees',coalesce((select jsonb_agg(jsonb_build_object(
      'id',q.id,'period',q.periodo,'amount',q.monto,'status',q.status,'dueDate',q.fecha_vencimiento,'paidAt',q.fecha_pago
    ) order by q.periodo desc) from public.cuotas_condominio q
      where q.condominio_id=target.condominio_id and q.unidad_id=target.id),'[]'::jsonb)
  );
  return result;
end $$;

revoke all on function public.condominium_owner_portal_snapshot(uuid) from public,anon;
grant execute on function public.condominium_owner_portal_snapshot(uuid) to authenticated,service_role;
commit;
