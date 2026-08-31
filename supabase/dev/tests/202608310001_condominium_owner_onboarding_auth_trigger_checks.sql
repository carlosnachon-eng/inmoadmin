-- Certificación read-only del contrato entre Admin Auth y el trigger productivo.
-- No crea identidades, perfiles, relaciones ni PII.
begin transaction read only;
set local statement_timeout='30s';

do $$
declare
  trigger_definition text;
  role_external boolean;
begin
  if to_regclass('public.partner_users') is null then
    raise exception 'TEST: falta partner_users para reproducir el chequeo productivo';
  end if;
  if to_regprocedure('public.handle_new_user()') is null then
    raise exception 'TEST: falta public.handle_new_user()';
  end if;

  select pg_get_functiondef('public.handle_new_user()'::regprocedure)
  into trigger_definition;

  if trigger_definition not ilike '%raw_user_meta_data%rol_pretendido%' then
    raise exception 'TEST: el trigger no consume rol_pretendido';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='auth'
      and c.relname='users'
      and not t.tgisinternal
      and t.tgenabled<>'D'
      and pg_get_triggerdef(t.oid) ilike '%handle_new_user%'
  ) then
    raise exception 'TEST: auth.users no ejecuta handle_new_user';
  end if;

  select es_externo into role_external
  from public.roles
  where id='propietario';

  if role_external is distinct from true then
    raise exception 'TEST: propietario no es un rol externo válido';
  end if;

  if exists (
    select 1 from public.permisos_modulo
    where role_id='propietario'
      and (puede_ver=true or puede_editar=true)
  ) then
    raise exception 'TEST: propietario conserva permisos internos incompatibles';
  end if;
end $$;

select jsonb_build_object(
  'status','CONDOMINIUM_OWNER_ONBOARDING_TRIGGER_OK',
  'writes',0,
  'role','propietario',
  'external',true
) as result;

rollback;
