# Supabase migrations

Este directorio contiene migraciones SQL versionadas para Inmoadmin.

Reglas operativas:

- Ninguna migracion debe ejecutarse directamente en Produccion sin validarse antes en Supabase dev/preview.
- Las migraciones deben ser aditivas siempre que sea posible.
- Los cambios destructivos requieren autorizacion explicita y plan de rollback.
- Cada migracion debe poder revisarse como archivo SQL antes de ejecutarse.
- Las migraciones que agreguen tablas deben incluir RLS y policies desde el primer cambio.
- Las migraciones que toquen informacion comercial historica no deben reinterpretar datos ambiguos automaticamente.

Flujo recomendado:

1. Crear o actualizar el proyecto Supabase dev/preview.
2. Cargar variables de entorno locales contra dev/preview.
3. Ejecutar migraciones en dev/preview.
4. Validar login, permisos y modulos criticos.
5. Generar datos de prueba o sanitizados.
6. Abrir PR con migracion y cambios de aplicacion.
7. Revisar SQL antes de cualquier ejecucion productiva.

Estado Fase 2A:

- `migrations/` contiene un paquete productivo revisable, aditivo e
  idempotente.
- `dev/` conserva bootstrap, seed y SQL aplicados manualmente en
  `inmoadmin-dev`. No forma parte del flujo productivo.
- `reports/` contiene consultas dry-run de solo lectura.
- Ningun seed DEV debe ejecutarse contra Produccion.
