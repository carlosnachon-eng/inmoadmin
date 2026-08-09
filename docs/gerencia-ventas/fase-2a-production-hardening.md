# Fase 2A production hardening

Estado: preparado para revision. No se ha aplicado en Produccion.

## Variables por entorno

Servidor:

- `APP_ENV`: `production` en Produccion, `dev` o `preview` fuera de Produccion.
- `SUPABASE_ENVIRONMENT`: `production` o `dev`.
- `FASE_2A_ENABLED`: `true` solo cuando el esquema productivo ya este aplicado y aprobado.
- `SUPABASE_SERVICE_ROLE_KEY`: solo servidor, nunca cliente.
- `RESPOND_IO_TOKEN`: token Developer API por entorno. `RESPOND_IO_API_TOKEN` se acepta solo como compatibilidad temporal.
- `RESPOND_IO_WORKSPACE_ID`: workspace usado para deep-links.
- `RESPOND_IO_PROFILE_MAP`: JSON opcional solo DEV/Preview para alias auditables. En Produccion se ignora.

Cliente:

- `NEXT_PUBLIC_APP_ENV`: `production`, `preview` o `dev`.
- `NEXT_PUBLIC_FASE_2A_ENABLED`: controla visibilidad de menu y rutas cliente. No sustituye el guard del servidor.

## Proteccion de Supabase

Las APIs Fase 2A validan el project ref:

- Produccion acepta solo `bnzrnizrmonjxlktbhlp`.
- Preview/Development aceptan solo `hjfwjnejbcpmknvfpdcq`.
- URLs desconocidas o variables incompletas fallan cerradas.
- Si `VERCEL_ENV=production`, esa senal gana sobre variables manuales mal configuradas.

## Sincronizacion Respond.io

- La carga inicial es solo lectura.
- La sincronizacion se ejecuta solo con el boton `Sincronizar conversaciones`.
- Solo `admin` y `gerente_ventas` pueden llamar el endpoint de sync.
- El endpoint no escribe en Respond.io.
- El endpoint guarda metadata autorizada en snapshots.
- No actualiza oportunidades ni responsables automaticamente.
- No almacena cuerpos de mensajes, adjuntos, audios ni transcripciones.

## Migraciones

- `supabase/migrations/202608080007_fase_2a_production_hardening.sql` es el paquete productivo idempotente.
- `supabase/dev/` conserva los SQL usados para inmoadmin-dev y no debe ejecutarse contra Produccion.
- `supabase/reports/202608080008_citas_confirmacion_dry_run.sql` es solo lectura.
- `supabase/reports/202608080009_fase_2a_preflight.sql` es solo lectura y debe ejecutarse antes de aplicar 007.

La migracion productiva:

- crea tablas Fase 2A;
- habilita RLS;
- crea policies por scope `ventas`/`global`;
- agrega campos estructurados a `cierres`;
- agrega campos de confirmacion a `citas` sin backfill automatico;
- agrega defensa de base contra intervenciones activas duplicadas por `contextKey`.

No contiene:

- seed;
- UUIDs DEV;
- usuarios sinteticos;
- referencias al proyecto DEV;
- UPDATE de citas historicas.

## Estado inicial esperado en Produccion

Antes de cargar datos Fase 2A:

- oportunidades: vacio;
- snapshots Respond.io: vacio;
- intervenciones: vacio;
- disponibilidad: sin configurar;
- supervision: requiere autorizacion para insertar relaciones reales.

La UI debe mostrar estados honestos de falta de datos y no conclusiones comerciales definitivas basadas en ceros vacios.
