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

Estado actual:

- La carpeta se crea para preparar Fase 2A de Gerencia de Ventas.
- La primera migracion es revisable y no ha sido ejecutada.
- `bootstrap/` contiene un esquema base minimo para DEV cuando el proyecto
  dev/preview esta vacio. No debe ejecutarse en Produccion.
