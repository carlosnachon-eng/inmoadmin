-- DEV-only: reproduce el contrato Auth que ya existe en Producción.
-- No crea usuarios, relaciones de portal ni PII.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

insert into public.roles(id,nombre,descripcion,es_externo)
values(
  'propietario',
  'Propietario',
  'Acceso externo individual al Portal Condómino',
  true
)
on conflict(id) do update set
  nombre=excluded.nombre,
  descripcion=excluded.descripcion,
  es_externo=true;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  rol_solicitado text;
begin
  rol_solicitado:=coalesce(new.raw_user_meta_data->>'rol_pretendido','asesor');
  if not exists(select 1 from public.roles where id=rol_solicitado) then
    rol_solicitado:='asesor';
  end if;

  insert into public.profiles(id,email,role,role_id)
  values(new.id,new.email,'staff',rol_solicitado);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

commit;
