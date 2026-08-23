begin;

alter table public.profiles
  add column if not exists participa_kpis boolean not null default true;

comment on column public.profiles.participa_kpis is
  'Controla si el perfil aparece y participa en rankings y KPIs comerciales diarios, sin cambiar su rol ni permisos.';

update public.profiles
set participa_kpis = false
where lower(email) in (
  'islas.amanda111@gmail.com',
  'asistente1@emporioinmobiliario.com.mx'
);

update public.profiles
set active = false
where lower(email) = 'asistente1@emporioinmobiliario.com.mx';

commit;
