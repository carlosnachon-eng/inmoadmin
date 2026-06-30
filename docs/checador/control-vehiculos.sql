-- Control operativo de vehículos para el rol chofer.
-- Ejecutar en Supabase antes de usar el formulario de vehículo en /checador.

create table if not exists public.vehiculos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  placas text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.checador_vehiculos_movimientos (
  id uuid primary key default gen_random_uuid(),
  checada_id text,
  chofer_email text not null,
  chofer_nombre text,
  tipo text not null check (tipo in ('toma_vehiculo', 'cambio_vehiculo', 'regreso_vehiculo')),
  fecha date not null default current_date,
  vehiculo_id uuid references public.vehiculos(id) on delete set null,
  vehiculo_nombre text not null,
  vehiculo_anterior_id uuid references public.vehiculos(id) on delete set null,
  vehiculo_anterior_nombre text,
  kilometraje integer not null check (kilometraje > 0),
  gasolina text not null,
  condicion text,
  observaciones text,
  foto_tablero_url text,
  lat numeric,
  lng numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_checador_vehiculos_chofer_fecha
  on public.checador_vehiculos_movimientos (chofer_email, fecha desc, created_at desc);

create index if not exists idx_checador_vehiculos_vehiculo_fecha
  on public.checador_vehiculos_movimientos (vehiculo_id, fecha desc, created_at desc);

insert into public.vehiculos (nombre, placas, activo)
select 'Dolphin', null, true
where not exists (
  select 1 from public.vehiculos where lower(nombre) = lower('Dolphin')
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vehiculos-fotos',
  'vehiculos-fotos',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'vehiculos_fotos_select'
  ) then
    create policy vehiculos_fotos_select
      on storage.objects
      for select
      using (bucket_id = 'vehiculos-fotos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'vehiculos_fotos_insert_authenticated'
  ) then
    create policy vehiculos_fotos_insert_authenticated
      on storage.objects
      for insert
      to authenticated
      with check (bucket_id = 'vehiculos-fotos');
  end if;
end $$;
