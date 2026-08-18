# Fase 1 — bootstrap DEV de fuentes operativas

Fecha de auditoría: 2026-08-18. Producción se consultó únicamente por metadata de
`information_schema`, `pg_catalog` y `storage.buckets`; no se exportaron filas de
negocio, archivos, PII ni secretos.

## Alcance y diferencias DEV

| Objeto esperado | Producción | DEV antes del bootstrap | Compatible | Acción necesaria |
|---|---|---|---|---|
| `servicios_inmueble` | 12 columnas, PK y FK opcional a `contracts` | Ausente | No | Crear con DDL productivo |
| `pagos_servicios` | 15 columnas, FK a servicios y gasto | Ausente | No | Crear después de servicios/gastos |
| `owner_payments` | 15 columnas y dos checks | Ausente | No | Crear; reemplazar policy pública insegura |
| `owner_payment_receipts` | 13 columnas y dos checks | Ausente | No | Crear; acceso operativo restringido |
| `property_expenses` | 11 columnas y tres checks | Ausente | No | Crear antes de `pagos_servicios` |
| `comisiones_admin` | 11 columnas, FK cascade y unique contrato/periodo | Ausente | No | Crear con constraints productivos |
| `llaves` | 11 columnas y unique parcial por número activo | Ausente | No | Crear tabla e índice parcial |

El estado corresponde a la opción **A: sólo este bootstrap y, después, la
migración nueva de Fase 1**. El bootstrap valida como precondiciones que DEV ya
tenga `contracts`, `properties` y la guarda
`current_profile_can_view_operations_work_center()`.

## Metadata productiva encontrada

No hay enums públicos, sequences explícitas, funciones dependientes ni triggers
de usuario para estas tablas. Los UUID usan `gen_random_uuid()`. Los únicos
índices adicionales a PK/unique son `llaves_numero_activa_unique` (`numero`,
parcial cuando `activa=true`). `pagos_servicios.contract_id` no tiene FK en
Producción; se conserva así para compatibilidad histórica.

RLS productivo no es un modelo seguro para copiar:

- `comisiones_admin`, `llaves` y `owner_payment_receipts` tienen RLS apagado;
- `owner_payments` y `property_expenses` tienen policy pública `ALL` con
  `USING true / WITH CHECK true`;
- `servicios_inmueble` y `pagos_servicios` tienen policies authenticated con
  condiciones verdaderas;
- los grants históricos incluyen a `anon` en las siete tablas.

El bootstrap DEV revoca `public`, `anon` y el acceso previo de `authenticated`,
habilita RLS y sólo concede lectura al rol autenticado que satisfaga la guarda
existente del Centro Operativo. No concede escritura directa a `authenticated`:
las mutaciones deben pasar por rutas server-side o RPC revisadas. `service_role`
conserva acceso de servidor para la API; ninguna clave se incorpora al SQL ni al
frontend.

Para que `CREATE TABLE IF NOT EXISTS` no oculte un esquema incompatible, cada
tabla creada recibe el marcador
`dev-bootstrap:202608180002:fase-1-operational-sources`. Una tabla homónima sin
ese marcador aborta la transacción antes del DDL. El rollback aplica la misma
guarda y se niega a eliminar objetos ajenos.

## Cruce con el repositorio

- `pages/api/operaciones/work-center.js` consume las siete tablas y sólo las
  columnas incluidas en este DDL. Las URLs de comprobantes se sanitizan después
  de la lectura por la capa compartida.
- `pages/propiedades.js`, `pages/inquilino.js` y `pages/propietario.js` usan
  servicios/pagos; `pages/propiedades.js` enlaza `pagos_servicios.gasto_id` con
  `property_expenses.id`.
- `pages/liquidaciones.js` usa las dos tablas de pagos a propietarios,
  `property_expenses` y `comisiones_admin`; tipos, defaults y checks coinciden.
- `pages/mantenimiento.js` no introduce una dependencia estructural adicional
  sobre estas siete tablas.
- `pages/api/cron-recordatorios.js` opera `payments` y cuotas de condominio; no
  consulta directamente estas siete fuentes.
- `docs/bi/inventario-tablas.csv` coincide en nombres y conteos de columnas.

Discrepancias deliberadamente fuera de alcance:

- La pantalla completa de `pages/checador.js` también requiere
  `llaves_movimientos`. No se agregó porque no es una de las siete fuentes del
  Work Center y hacerlo ampliaría el bootstrap hacia una réplica productiva.
- Producción tiene buckets públicos `receipts`, `llaves-fotos` y
  `mantenimiento-fotos`; `pages/liquidaciones.js` usa además `documentos`.
  Este bootstrap no crea buckets, policies de storage ni copia archivos. Son
  dependencias para uploads/flujo completo, no para leer el Work Center.
- Las policies DEV son intencionalmente más restrictivas que Producción. Los
  portales de propietario/inquilino no obtienen acceso directo con este
  bootstrap; habilitarlos exige una policy por identidad/inmueble separada y
  revisada, no una copia de `USING true`.

## Archivos y ejecución futura

- Bootstrap: `supabase/dev/bootstrap/202608180002_fase_1_operational_sources_schema.sql`
- Checks: `supabase/dev/tests/202608180002_fase_1_operational_sources_schema_tests.sql`
- Rollback: `supabase/dev/rollback/202608180002_fase_1_operational_sources_schema_rollback.sql`

Aplicación futura, únicamente con una URL de base de datos DEV obtenida de forma
segura y tras comprobar que contiene el ref DEV:

```sh
test "${SUPABASE_DEV_DB_URL#*hjfwjnejbcpmknvfpdcq*}" != "$SUPABASE_DEV_DB_URL"
psql "$SUPABASE_DEV_DB_URL" -v ON_ERROR_STOP=1 -f supabase/dev/bootstrap/202608180002_fase_1_operational_sources_schema.sql
psql "$SUPABASE_DEV_DB_URL" -v ON_ERROR_STOP=1 -f supabase/dev/tests/202608180002_fase_1_operational_sources_schema_tests.sql
```

Rollback DEV, sólo con autorización destructiva explícita:

```sh
test "${SUPABASE_DEV_DB_URL#*hjfwjnejbcpmknvfpdcq*}" != "$SUPABASE_DEV_DB_URL"
psql "$SUPABASE_DEV_DB_URL" -v ON_ERROR_STOP=1 -f supabase/dev/rollback/202608180002_fase_1_operational_sources_schema_rollback.sql
```

Antes de cualquiera de esos comandos se debe verificar otra vez el project ref
enlazado. No se ejecutó ninguno durante esta preparación.
