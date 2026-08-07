# Migraciones exclusivas del demo de condominios

Este directorio contiene únicamente el esquema base y las concesiones necesarias
para reconstruir el proyecto Supabase independiente de demostración.

Estas migraciones:

- no forman parte del flujo de migraciones productivas;
- sólo se ejecutan mediante `scripts/run-condominios-demo-migrations.mjs`;
- exigen `APP_ENV=demo`, `SUPABASE_ENVIRONMENT=demo` y la referencia autorizada;
- abortan si la referencia o URL coincide con producción;
- pueden destruirse y reconstruirse porque no contienen información real.

Las migraciones potencialmente promovibles se encuentran en
`supabase/migrations/` y requieren una revisión y despliegue separados. La
existencia de este directorio no autoriza su ejecución en producción.
