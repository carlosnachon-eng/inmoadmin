begin;

do $$
begin
  if current_setting('app.settings.environment', true) is distinct from 'demo'
     or current_setting('app.settings.project_ref', true) is distinct from 'kmxzvcngfrzcasedtexw' then
    raise exception 'OPERACIÓN CANCELADA: EL DESTINO NO ESTÁ CONFIRMADO COMO AMBIENTE DEMO.';
  end if;
end
$$;

create extension if not exists pgcrypto;

create table if not exists public.roles (
  id text primary key,
  nombre text not null,
  descripcion text,
  es_externo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  role text,
  role_id text references public.roles(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permisos_modulo (
  id uuid primary key default gen_random_uuid(),
  role_id text not null references public.roles(id) on delete cascade,
  modulo text not null,
  puede_ver boolean not null default false,
  puede_editar boolean not null default false,
  alcance text,
  unique (role_id, modulo)
);

create table if not exists public.condominios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  direccion text,
  total_unidades integer not null default 0 check (total_unidades >= 0),
  cuota_mensual numeric(14,2) not null default 0 check (cuota_mensual >= 0),
  honorarios_emporio numeric(14,2) not null default 0 check (honorarios_emporio >= 0),
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.unidades_condominio (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  numero text not null,
  piso text,
  propietario_nombre text,
  propietario_email text,
  propietario_telefono text,
  residente_nombre text,
  residente_email text,
  residente_telefono text,
  residente_es_propietario boolean not null default false,
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.cuotas_condominio (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  unidad_id uuid not null references public.unidades_condominio(id) on delete cascade,
  periodo text not null,
  monto numeric(14,2) not null check (monto >= 0),
  status text not null default 'pendiente'
    check (status in ('pendiente','pagado','atrasado','cancelado')),
  fecha_vencimiento date,
  fecha_pago date,
  comprobante_url text,
  recibo_url text,
  pagado_por text,
  metodo_pago text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gastos_condominio (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  concepto text not null,
  categoria text,
  monto numeric(14,2) not null check (monto >= 0),
  fecha date not null,
  proveedor text,
  comprobante_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.roles(id,nombre,descripcion,es_externo) values
  ('admin','Administrador demo','Rol interno ficticio para P0.5',false),
  ('condomino','Condómino demo','Rol externo ficticio para P0.5',true)
on conflict (id) do update set
  nombre=excluded.nombre,
  descripcion=excluded.descripcion,
  es_externo=excluded.es_externo;

insert into public.permisos_modulo(role_id,modulo,puede_ver,puede_editar,alcance)
values ('admin','condominios',true,true,'demo')
on conflict (role_id,modulo) do update set
  puede_ver=excluded.puede_ver,
  puede_editar=excluded.puede_editar,
  alcance=excluded.alcance;

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

commit;
