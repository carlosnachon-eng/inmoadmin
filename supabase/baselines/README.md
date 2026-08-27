# Baseline condominal ya aplicado

Este directorio conserva copias byte por byte de las dos migraciones condominales ejecutadas manualmente en DEV y Producción antes de existir un historial de migraciones Supabase en el proyecto.

## Archivos y huellas

- `applied/202608250001_condominium_preimplementation_foundation.sql`
  SHA-256: `57ba8ee236694ad1857de7a97dc4e3624b40db609016ae108840017b44dc935b`
- `applied/202608250002_condominium_rls_hardening.sql`
  SHA-256: `d480cdcb6eaaf87609418e011ca315fd73693e264f43fcddd3bfd33b5507578e`

Fuente auditada: rama histórica `codex/genova-phase-2-preimplementation`, commit `3154b2303b377ef236f71008c5209c8485f015fc`.

## Guardrail obligatorio

Estos archivos están deliberadamente fuera de `supabase/migrations`: **no deben volver a ejecutarse en DEV ni Producción**. Contienen `create table` y políticas que fallarían o podrían producir deriva si se intentaran reaplicar.

DEV y Producción no tienen actualmente `supabase_migrations.schema_migrations`. Por ello queda prohibido usar `supabase db push` en esos proyectos hasta realizar una reconciliación integral del historial de todas las migraciones del repositorio, no sólo las condominales.

Para el portal MVP:

1. ejecutar primero `supabase/production/tests/202608270001_condominium_baseline_checks.sql` en modo lectura;
2. aplicar únicamente el SQL específico del portal mediante ejecución controlada y autorización independiente;
3. no marcar parcialmente versiones como aplicadas, porque eso no resolvería las demás migraciones históricas del repositorio;
4. mantener una ruta separada para instalaciones nuevas: aplicar estos dos archivos en orden antes de la migración del portal.

Esta estrategia incorpora al repositorio la fuente exacta ya aplicada sin modificar esquema, datos o historial remoto.
