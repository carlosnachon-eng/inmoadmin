-- Rollback conservador. Aborta si el portal ya contiene accesos, documentos o archivos.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$
begin
  if exists(select 1 from public.condominium_unit_portal_access)
     or exists(select 1 from public.condominium_owner_documents)
     or exists(select 1 from public.cuotas_condominio where owner_proof_storage_path is not null or owner_receipt_storage_path is not null)
     or exists(select 1 from storage.objects where bucket_id='condominium-owner-private') then
    raise exception 'ROLLBACK ABORTADO: existe actividad del portal';
  end if;
end $$;

drop function if exists public.condominium_owner_storage_path(text,uuid);
drop function if exists public.condominium_owner_attach_fee_proof(uuid,text);
drop function if exists public.condominium_owner_portal_snapshot(uuid);
drop function if exists public.condominium_owner_portal_units();
drop table public.condominium_owner_documents;
drop table public.condominium_unit_portal_access;
-- Supabase protege storage.buckets contra DELETE SQL directo. El bucket privado
-- vacío se conserva; retirarlo posteriormente requiere la API administrativa de Storage.
alter table public.cuotas_condominio drop column owner_proof_storage_path,drop column owner_receipt_storage_path;

create or replace function public.condominium_owner_has_unit(p_condominio_id uuid,p_unidad_id uuid default null)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.condominium_owner_portal_allowed(p_condominio_id) and exists(
    select 1 from public.unidades_condominio u
    where u.condominio_id=p_condominio_id and u.activo=true
      and (p_unidad_id is null or u.id=p_unidad_id)
      and public.condominium_auth_email()<>''
      and public.condominium_auth_email() in (lower(coalesce(u.propietario_email,'')),lower(coalesce(u.residente_email,'')))
  )
$$;

create or replace function public.condominium_external_fee_update_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then return new; end if;
  if public.condominium_internal_permission('condominios',true) then return new; end if;
  if not public.condominium_owner_has_unit(old.condominio_id,old.unidad_id) then
    raise exception using errcode='42501',message='No autorizado para modificar esta cuota.';
  end if;
  if new.id is distinct from old.id or new.condominio_id is distinct from old.condominio_id
     or new.unidad_id is distinct from old.unidad_id or new.periodo is distinct from old.periodo
     or new.monto is distinct from old.monto or new.fecha_vencimiento is distinct from old.fecha_vencimiento
     or new.fecha_pago is distinct from old.fecha_pago or new.pagado_por is distinct from old.pagado_por
     or new.forma_pago is distinct from old.forma_pago or new.notas is distinct from old.notas
     or new.recibo_url is distinct from old.recibo_url or new.status<>'pendiente'
  then raise exception using errcode='42501',message='El portal sólo puede adjuntar un comprobante pendiente.';
  end if;
  return new;
end $$;

commit;
