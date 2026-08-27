-- Verificación de sólo lectura del baseline condominal ya aplicado.
begin transaction read only;

do $$
declare expected_tables text[]:=array[
  'condominium_operation_controls','condominium_sections',
  'condominium_unit_section_memberships','condominium_historical_accounts',
  'condominium_historical_payments','condominium_historical_recoveries',
  'condominium_provider_preparations','condominium_transition_items',
  'condominium_access_memberships'
];
declare expected_table text;
begin
  foreach expected_table in array expected_tables loop
    if to_regclass('public.'||expected_table) is null then
      raise exception 'BASELINE: falta tabla %',expected_table;
    end if;
  end loop;

  if to_regprocedure('public.condominium_owner_portal_allowed(uuid)') is null
     or to_regprocedure('public.condominium_internal_permission(text,boolean)') is null
     or to_regprocedure('public.condominium_membership_permission(uuid,text)') is null
     or to_regprocedure('public.condominium_owner_has_unit(uuid,uuid)') is null then
    raise exception 'BASELINE: faltan funciones de seguridad';
  end if;

  if exists(
    select 1 from pg_class
    where oid in (
      'public.condominios'::regclass,'public.unidades_condominio'::regclass,
      'public.cuotas_condominio'::regclass,'public.gastos_condominio'::regclass,
      'public.maintenance_tickets'::regclass
    ) and not relrowsecurity
  ) then raise exception 'BASELINE: RLS deshabilitado en tabla condominal'; end if;

  if not exists(
    select 1 from pg_trigger
    where tgrelid='public.cuotas_condominio'::regclass
      and tgname='condominium_fee_operation_guard' and not tgisinternal
  ) or not exists(
    select 1 from pg_trigger
    where tgrelid='public.cuotas_condominio'::regclass
      and tgname='condominium_external_fee_update_guard' and not tgisinternal
  ) then raise exception 'BASELINE: faltan guardas de cuotas'; end if;

  if exists(
    select 1 from information_schema.role_table_grants
    where table_schema='public'
      and table_name in ('condominios','unidades_condominio','cuotas_condominio','gastos_condominio')
      and grantee='anon'
  ) then raise exception 'BASELINE: anon conserva acceso condominal'; end if;
end $$;

select 'CONDOMINIUM_BASELINE_OK' as result;
rollback;
