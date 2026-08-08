# Runbook Supabase DEV/PREVIEW para Fase 2A

Estado: preparado, no ejecutado.
Fecha: 8 de agosto de 2026.

## Objetivo

Crear un entorno Supabase separado de Produccion para validar Fase 2A antes de
cualquier cambio productivo.

## Regla de aislamiento

Antes de ejecutar cualquier SQL debe confirmarse:

- `NEXT_PUBLIC_SUPABASE_URL` no apunta a `https://bnzrnizrmonjxlktbhlp.supabase.co`;
- `SUPABASE_SERVICE_ROLE_KEY` corresponde al proyecto DEV/PREVIEW;
- Vercel Preview no usa variables de Produccion;
- el dashboard de Supabase muestra el proyecto DEV/PREVIEW seleccionado;
- no hay conexiones abiertas al proyecto productivo durante la ejecucion.

Proyecto productivo conocido:

```text
https://bnzrnizrmonjxlktbhlp.supabase.co
```

## Acciones manuales en Supabase

No cuento en este entorno con una herramienta conectada para crear proyectos
Supabase. Estas acciones debe realizarlas la cuenta administradora en el
dashboard de Supabase:

1. Crear proyecto nuevo:
   - nombre sugerido: `inmoadmin-dev` o `inmoadmin-preview`;
   - region preferentemente igual o cercana a Produccion.
2. Copiar valores del proyecto DEV/PREVIEW:
   - Project URL;
   - anon public key;
   - service role key;
   - database password;
   - connection string.
3. Configurar `.env.local` local con valores DEV/PREVIEW.
4. Configurar Vercel Preview con valores DEV/PREVIEW.
5. Confirmar que Vercel Production conserva valores productivos.

## Variables esperadas en `.env.local` DEV

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<proyecto-dev>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-dev>
SUPABASE_SERVICE_ROLE_KEY=<service-role-dev>
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=<dev-secret>
RESEND_API_KEY=<dev-o-vacio>
EASYBROKER_API_KEY=<dev-o-vacio>
GOOGLE_SERVICE_ACCOUNT=<dev-o-vacio>
RESPOND_IO_TOKEN=
```

`RESPOND_IO_TOKEN` debe quedar vacio mientras la integracion siga solo en
diseno.

## Orden de ejecucion cuando DEV exista

1. Confirmar aislamiento:

```bash
node -e "console.log(process.env.NEXT_PUBLIC_SUPABASE_URL)"
```

Debe imprimir el proyecto DEV/PREVIEW, no Produccion.

2. Confirmar esquema base compatible:

- existen `profiles`, `roles`, `permisos_modulo`;
- existen `clientes`, `citas`, `seguimientos_cliente`;
- existen `propiedades`, `cierres`;
- existe el rol `admin`;
- existe el rol `gerente_ventas`;
- existe el rol `coord_operaciones`;
- existe el rol `asesor`.

Resultado observado el 8 de agosto de 2026: `inmoadmin-dev` esta aislado, pero
el esquema base esta vacio. Las tablas `profiles`, `roles`, `clientes`,
`citas`, `propiedades` y `cierres` todavia no existen.

Si DEV sigue vacio, ejecutar primero el bootstrap minimo DEV-only:

```text
supabase/bootstrap/202608080000_dev_minimal_base_schema.sql
```

Este bootstrap no es una replica completa de Produccion. Solo permite probar
Fase 2A con seed sintetico.

3. Ejecutar migracion en DEV/PREVIEW:

```text
supabase/migrations/202608080001_fase_2a_gerencia_ventas_base.sql
```

4. Ejecutar grants para REST/RLS en DEV/PREVIEW:

```text
supabase/migrations/202608080002_fase_2a_dev_grants.sql
```

Este script no desactiva RLS ni abre acceso anonimo. Solo permite que
`authenticated` y `service_role` tengan privilegios SQL suficientes para que
PostgREST pueda evaluar las policies.

5. Ejecutar correccion de RLS por scope:

```text
supabase/migrations/202608080003_fase_2a_scope_rls_fix.sql
```

Este script separa policies de disponibilidad y limita oportunidades al scope
`ventas`. Una relacion `operaciones` no concede acceso a oportunidades
comerciales.

6. Ejecutar seed minimo sintetico en DEV/PREVIEW:

```text
supabase/seed/202608080001_fase_2a_minimal_seed.sql
```

El seed no requiere usuarios Auth previos para cargarse desde SQL Editor o con
service role. Los campos que referencian `auth.users` se cargan como `null`.
Para pruebas RLS completas si se requieren usuarios Auth reales en DEV y
`profiles.id` alineado con `auth.users.id`.

5. Validar tablas nuevas:

```sql
select count(*) from public.gv_supervision_edges;
select count(*) from public.gv_advisor_availability;
select count(*) from public.gv_opportunities;
select count(*) from public.gv_opportunity_events;
```

6. Validar columnas nuevas en `cierres`:

```sql
select
  advisor_profile_id,
  operation_type_structured,
  operation_type_confidence,
  operation_type_source
from public.cierres
limit 5;
```

## Pruebas RLS por rol

Para pruebas completas se necesitan usuarios Auth reales en DEV con `profiles.id`
igual a `auth.users.id`.

Usuarios sugeridos:

| Rol | Email ficticio |
|---|---|
| admin | `admin.dev@emporio.test` |
| gerente_ventas | `guillermo.dev@emporio.test` |
| coord_operaciones | `coord.dev@emporio.test` |
| asesor | `ari.dev@emporio.test` |
| asesor | `ivan.dev@emporio.test` |

Casos esperados:

- Admin ve todo.
- Gerente ve sus oportunidades y oportunidades de asesores asignados en
  `gv_supervision_edges`.
- Gerente puede editar etapa, siguiente accion, fecha, riesgo y perdida de sus
  asesores.
- Coordinacion solo ve ambito expresamente asignado.
- Asesor ve y opera su propio espacio.
- Asesor no ve oportunidades ajenas.
- Ver como, cuando exista UI, debe ser lectura/supervision y no cambiar
  `auth.uid()`.

## Pruebas de auditoria

Validar que una intervencion de Gerencia registre:

```sql
select
  event_type,
  actor_profile_id,
  acted_as_profile_id,
  is_management_intervention,
  old_value,
  new_value,
  occurred_at
from public.gv_opportunity_events
where is_management_intervention = true
order by occurred_at desc;
```

Regla:

- `actor_profile_id` debe ser Guillermo/Gerencia real.
- `acted_as_profile_id` puede apuntar al asesor observado, pero no debe
  reemplazar al actor real.

## Rollback o correccion segura en DEV

En DEV/PREVIEW puede hacerse rollback recreando el proyecto o restaurando desde
backup. Para Produccion, la migracion es aditiva y debe revisarse de nuevo
antes de ejecutarse.

No se incluye rollback destructivo automatico porque aun no se ha autorizado
ejecucion productiva.
