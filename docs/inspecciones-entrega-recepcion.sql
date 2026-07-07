-- Módulo: Inspección de Entrega-Recepción de Inmueble
-- Ejecutar en Supabase SQL Editor antes de usar /inspecciones.

create extension if not exists pgcrypto;

create table if not exists public.plantillas_inspeccion (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo_inmueble text not null check (tipo_inmueble in ('casa','departamento','local_comercial','oficina','bodega','terreno','otro')),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nombre, tipo_inmueble)
);

create table if not exists public.plantilla_inspeccion_secciones (
  id uuid primary key default gen_random_uuid(),
  plantilla_id uuid not null references public.plantillas_inspeccion(id) on delete cascade,
  nombre text not null,
  orden integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.plantilla_inspeccion_elementos (
  id uuid primary key default gen_random_uuid(),
  seccion_id uuid not null references public.plantilla_inspeccion_secciones(id) on delete cascade,
  nombre text not null,
  requiere_foto boolean not null default false,
  requiere_observacion boolean not null default false,
  orden integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.inspecciones (
  id uuid primary key default gen_random_uuid(),
  inmueble_id uuid references public.properties(id) on delete set null,
  contrato_id uuid references public.contracts(id) on delete set null,
  plantilla_id uuid references public.plantillas_inspeccion(id) on delete set null,
  tipo_inmueble text not null default 'otro' check (tipo_inmueble in ('casa','departamento','local_comercial','oficina','bodega','terreno','otro')),
  tipo_inspeccion text not null default 'entrega_recepcion' check (tipo_inspeccion in ('entrega_recepcion')),
  fecha date not null default current_date,
  hora time without time zone not null default current_time,
  recibido_por text,
  entregado_por text,
  estatus text not null default 'borrador' check (estatus in ('borrador','en_revision','con_observaciones','pendiente_presupuesto','pendiente_autorizacion_propietario','cerrada')),
  observaciones_generales text,
  firma_inquilino_url text,
  firma_representante_url text,
  pdf_url text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  cerrada_por uuid references auth.users(id) on delete set null,
  cerrada_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inspeccion_respuestas (
  id uuid primary key default gen_random_uuid(),
  inspeccion_id uuid not null references public.inspecciones(id) on delete cascade,
  elemento_id uuid not null references public.plantilla_inspeccion_elementos(id) on delete cascade,
  estado text not null default 'sin_observaciones' check (estado in ('sin_observaciones','observacion_menor','requiere_reparacion','no_aplica')),
  observacion text,
  prioridad text check (prioridad in ('baja','media','alta') or prioridad is null),
  responsable text check (responsable in ('emporio','propietario','inquilino','pendiente_definir') or responsable is null),
  costo_estimado numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inspeccion_id, elemento_id)
);

create table if not exists public.inspeccion_fotografias (
  id uuid primary key default gen_random_uuid(),
  inspeccion_id uuid not null references public.inspecciones(id) on delete cascade,
  respuesta_id uuid references public.inspeccion_respuestas(id) on delete cascade,
  categoria text not null default 'otros',
  url text not null,
  descripcion text,
  created_at timestamptz not null default now()
);

create table if not exists public.inspeccion_medidores (
  id uuid primary key default gen_random_uuid(),
  inspeccion_id uuid not null references public.inspecciones(id) on delete cascade,
  tipo text not null check (tipo in ('luz','agua','gas','otro')),
  numero_medidor text,
  lectura text,
  foto_url text,
  observaciones text,
  created_at timestamptz not null default now()
);

create table if not exists public.inspeccion_inventario (
  id uuid primary key default gen_random_uuid(),
  inspeccion_id uuid not null references public.inspecciones(id) on delete cascade,
  concepto text not null,
  cantidad integer not null default 1,
  observaciones text,
  created_at timestamptz not null default now()
);

create index if not exists idx_inspecciones_estatus on public.inspecciones(estatus);
create index if not exists idx_inspecciones_fecha on public.inspecciones(fecha desc);
create index if not exists idx_inspecciones_inmueble on public.inspecciones(inmueble_id);
create index if not exists idx_inspecciones_contrato on public.inspecciones(contrato_id);
create index if not exists idx_inspeccion_respuestas_inspeccion on public.inspeccion_respuestas(inspeccion_id);
create index if not exists idx_inspeccion_fotos_inspeccion on public.inspeccion_fotografias(inspeccion_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_plantillas_inspeccion_updated on public.plantillas_inspeccion;
create trigger trg_plantillas_inspeccion_updated
before update on public.plantillas_inspeccion
for each row execute function public.set_updated_at();

drop trigger if exists trg_inspecciones_updated on public.inspecciones;
create trigger trg_inspecciones_updated
before update on public.inspecciones
for each row execute function public.set_updated_at();

drop trigger if exists trg_inspeccion_respuestas_updated on public.inspeccion_respuestas;
create trigger trg_inspeccion_respuestas_updated
before update on public.inspeccion_respuestas
for each row execute function public.set_updated_at();

alter table public.plantillas_inspeccion enable row level security;
alter table public.plantilla_inspeccion_secciones enable row level security;
alter table public.plantilla_inspeccion_elementos enable row level security;
alter table public.inspecciones enable row level security;
alter table public.inspeccion_respuestas enable row level security;
alter table public.inspeccion_fotografias enable row level security;
alter table public.inspeccion_medidores enable row level security;
alter table public.inspeccion_inventario enable row level security;

drop policy if exists inspecciones_authenticated_select on public.plantillas_inspeccion;
create policy inspecciones_authenticated_select on public.plantillas_inspeccion for select using (auth.role() = 'authenticated');
drop policy if exists inspecciones_authenticated_select on public.plantilla_inspeccion_secciones;
create policy inspecciones_authenticated_select on public.plantilla_inspeccion_secciones for select using (auth.role() = 'authenticated');
drop policy if exists inspecciones_authenticated_select on public.plantilla_inspeccion_elementos;
create policy inspecciones_authenticated_select on public.plantilla_inspeccion_elementos for select using (auth.role() = 'authenticated');

drop policy if exists inspecciones_authenticated_all on public.inspecciones;
create policy inspecciones_authenticated_all on public.inspecciones for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists inspecciones_respuestas_authenticated_all on public.inspeccion_respuestas;
create policy inspecciones_respuestas_authenticated_all on public.inspeccion_respuestas for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists inspecciones_fotos_authenticated_all on public.inspeccion_fotografias;
create policy inspecciones_fotos_authenticated_all on public.inspeccion_fotografias for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists inspecciones_medidores_authenticated_all on public.inspeccion_medidores;
create policy inspecciones_medidores_authenticated_all on public.inspeccion_medidores for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists inspecciones_inventario_authenticated_all on public.inspeccion_inventario;
create policy inspecciones_inventario_authenticated_all on public.inspeccion_inventario for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists inspeccion_plantillas_admin_all on public.plantillas_inspeccion;
create policy inspeccion_plantillas_admin_all on public.plantillas_inspeccion
for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role_id in ('admin','coord_operaciones','gerente_ventas'))
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role_id in ('admin','coord_operaciones','gerente_ventas'))
);

drop policy if exists inspeccion_plantilla_secciones_admin_all on public.plantilla_inspeccion_secciones;
create policy inspeccion_plantilla_secciones_admin_all on public.plantilla_inspeccion_secciones
for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role_id in ('admin','coord_operaciones','gerente_ventas'))
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role_id in ('admin','coord_operaciones','gerente_ventas'))
);

drop policy if exists inspeccion_plantilla_elementos_admin_all on public.plantilla_inspeccion_elementos;
create policy inspeccion_plantilla_elementos_admin_all on public.plantilla_inspeccion_elementos
for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role_id in ('admin','coord_operaciones','gerente_ventas'))
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role_id in ('admin','coord_operaciones','gerente_ventas'))
);

insert into storage.buckets (id, name, public)
values ('inspecciones', 'inspecciones', true)
on conflict (id) do nothing;

drop policy if exists inspecciones_storage_read on storage.objects;
create policy inspecciones_storage_read on storage.objects
for select using (bucket_id = 'inspecciones');

drop policy if exists inspecciones_storage_insert on storage.objects;
create policy inspecciones_storage_insert on storage.objects
for insert with check (bucket_id = 'inspecciones' and auth.role() = 'authenticated');

drop policy if exists inspecciones_storage_update on storage.objects;
create policy inspecciones_storage_update on storage.objects
for update using (bucket_id = 'inspecciones' and auth.role() = 'authenticated')
with check (bucket_id = 'inspecciones' and auth.role() = 'authenticated');

insert into public.permisos_modulo (role_id, modulo, puede_ver, puede_editar, alcance)
values
  ('coord_operaciones', 'inspecciones', true, true, 'todos'),
  ('gerente_ventas', 'inspecciones', true, true, 'todos'),
  ('juridico', 'inspecciones', true, false, 'todos')
on conflict (role_id, modulo) do nothing;

-- Plantillas base
with tipos(tipo, nombre) as (
  values
    ('casa','Casa'),
    ('departamento','Departamento'),
    ('local_comercial','Local comercial'),
    ('oficina','Oficina'),
    ('bodega','Bodega'),
    ('terreno','Terreno')
),
tpl as (
  insert into public.plantillas_inspeccion (nombre, tipo_inmueble, activo)
  select 'Entrega-recepción ' || nombre, tipo, true from tipos
  on conflict (nombre, tipo_inmueble) do update set activo = excluded.activo
  returning id, tipo_inmueble
),
secciones_base(nombre, orden) as (
  values
    ('Estado general y limpieza', 1),
    ('Accesos, llaves y seguridad', 2),
    ('Instalaciones y servicios', 3),
    ('Áreas interiores', 4),
    ('Áreas exteriores o comunes', 5)
),
secciones as (
  insert into public.plantilla_inspeccion_secciones (plantilla_id, nombre, orden)
  select tpl.id, secciones_base.nombre, secciones_base.orden
  from tpl cross join secciones_base
  where not exists (
    select 1 from public.plantilla_inspeccion_secciones s
    where s.plantilla_id = tpl.id and s.nombre = secciones_base.nombre
  )
  returning id, plantilla_id, nombre
)
insert into public.plantilla_inspeccion_elementos (seccion_id, nombre, requiere_foto, requiere_observacion, orden)
select s.id, e.nombre, e.requiere_foto, e.requiere_observacion, e.orden
from secciones s
join (
  values
    ('Estado general y limpieza','Limpieza general del inmueble', true, false, 1),
    ('Estado general y limpieza','Muros, plafones y pintura', true, false, 2),
    ('Estado general y limpieza','Pisos, zoclos y recubrimientos', true, false, 3),
    ('Accesos, llaves y seguridad','Puerta principal, chapas y cerraduras', true, false, 1),
    ('Accesos, llaves y seguridad','Llaves, controles, tarjetas y accesorios entregados', false, true, 2),
    ('Instalaciones y servicios','Instalación eléctrica visible', true, false, 1),
    ('Instalaciones y servicios','Instalación hidráulica y sanitaria visible', true, false, 2),
    ('Instalaciones y servicios','Medidores y servicios', true, false, 3),
    ('Áreas interiores','Cocina, muebles y accesorios', true, false, 1),
    ('Áreas interiores','Baños, canceles y accesorios', true, false, 2),
    ('Áreas interiores','Puertas, ventanas y cancelería', true, false, 3),
    ('Áreas exteriores o comunes','Fachada, patio, terraza o área exterior', true, false, 1),
    ('Áreas exteriores o comunes','Áreas comunes o cajones asignados', true, false, 2)
) as e(seccion, nombre, requiere_foto, requiere_observacion, orden)
on e.seccion = s.nombre
where not exists (
  select 1 from public.plantilla_inspeccion_elementos i
  where i.seccion_id = s.id and i.nombre = e.nombre
);
