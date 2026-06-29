# Control de vehículos para Chofer

## Decisión de arquitectura

El rol `chofer` debe usar el Checador, pero sus datos operativos no deben mezclarse con KPIs comerciales.

La tabla `checadas` debe seguir representando asistencia:

- email;
- nombre;
- tipo: entrada / salida / junta;
- fecha;
- ubicación GPS;
- puntualidad.

El detalle del vehículo debe guardarse en una tabla separada en una fase posterior, porque representa otra entidad operativa.

## Flujo recomendado

### Inicio de ruta / entrada

El chofer registra:

- auto que se lleva;
- kilometraje inicial;
- ubicación GPS de recolección;
- condición inicial del vehículo;
- nivel de gasolina, si se decide capturar;
- observaciones;
- fotos, opcional en V2.

### Cierre de ruta / salida

El chofer registra:

- auto que devuelve;
- kilometraje final;
- ubicación GPS de devolución;
- condición final del vehículo;
- incidencias;
- fotos, opcional en V2.

## Tabla sugerida para fase futura

```sql
create table public.vehiculos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  placas text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.checador_vehiculos_movimientos (
  id uuid primary key default gen_random_uuid(),
  checada_id uuid references public.checadas(id) on delete set null,
  vehiculo_id uuid references public.vehiculos(id) on delete restrict,
  chofer_email text not null,
  tipo text not null check (tipo in ('salida_vehiculo', 'regreso_vehiculo')),
  kilometraje integer not null,
  gasolina text,
  condicion text,
  observaciones text,
  lat numeric,
  lng numeric,
  created_at timestamptz not null default now()
);
```

## Reglas

- El chofer no participa en KPIs.
- El chofer no requiere estar físicamente en oficina para checar.
- El GPS sí se guarda para trazabilidad.
- El control de vehículo debe ser trazable, pero no debe contaminar `checadas`.
- Los reportes futuros de vehículos deben salir de `checador_vehiculos_movimientos`, no de KPIs.
