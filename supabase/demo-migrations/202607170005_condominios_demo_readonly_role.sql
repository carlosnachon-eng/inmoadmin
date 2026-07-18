begin;

do $$
begin
  if current_setting('app.settings.environment', true) is distinct from 'demo'
     or current_setting('app.settings.project_ref', true) is distinct from 'kmxzvcngfrzcasedtexw' then
    raise exception 'OPERACIÓN CANCELADA: EL DESTINO NO ESTÁ CONFIRMADO COMO AMBIENTE DEMO.';
  end if;
end
$$;

insert into public.roles(id,nombre,descripcion,es_externo)
values (
  'solo_lectura_demo',
  'Sólo lectura demo',
  'Perfil ficticio P0.5 sin permisos de edición',
  false
)
on conflict (id) do update set
  nombre=excluded.nombre,
  descripcion=excluded.descripcion,
  es_externo=excluded.es_externo;

insert into public.permisos_modulo(role_id,modulo,puede_ver,puede_editar,alcance)
values ('solo_lectura_demo','condominios',true,false,'tenant-demo')
on conflict (role_id,modulo) do update set
  puede_ver=excluded.puede_ver,
  puede_editar=excluded.puede_editar,
  alcance=excluded.alcance;

update public.profiles
   set role_id='solo_lectura_demo', updated_at=now()
 where email in (
   'p05.a.solo_lectura@example.invalid',
   'p05.b.solo_lectura@example.invalid'
 );

commit;
