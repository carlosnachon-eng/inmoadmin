# Descripción preparada; no aplicada por falta de permiso

El intento soportado de editar PR #133 devolvió HTTP 403 `Resource not accessible by integration`.
No se reintentó por otro mecanismo. Hace falta permiso de edición de pull requests en la
integración GitHub (o edición manual por un administrador autorizado). El texto listo para
la descripción aparece a continuación; no representa el cuerpo actual del PR.

---

## Estado consolidado — revisión solamente
PR #133 permanece **Draft**. Sin merge ni deployment. SQL Supabase DEV cerrado; **NO-GO para declarar completa la integración o iniciar rollout** por el acceso local faltante descrito abajo. No se ha demostrado un defecto funcional.

- Rama: `codex/condominium-owner-canonical-identity`.
- HEAD publicado actual: consultar la cabecera del Draft PR; el código funcional sigue certificado en el SHA indicado abajo.
- Código funcional certificado: `e0cdda009dc1d9fbb92ccd67b1977bc18ab7d8bf`.
- Main/merge-base verificados: `58bc401c79749bc5140104f304c639b789256c69`; candidato funcional ahead 2 / behind 0, mergeable. No se mezclaron cambios ajenos.
- La actualización modifica **sólo documentación/evidencia**, incluido un archivo de 36.994 bytes con el paquete certificado. Código de aplicación, pruebas funcionales, migración y `vercel.json` idénticos al HEAD funcional certificado.

## Certificación SQL Supabase DEV — CERRADA, no repetir
Destino exclusivo: **inmoadmin-dev / hjfwjnejbcpmknvfpdcq**.
Resultado real: **`DATABASE_CERTIFICATION_PASS` — 8/8 archivos, 72 assertions PASS**.

- Migración y checks instalados manualmente por el usuario; salida visible en ambos: `Success. No rows returned`. No se reaplicaron ni repitieron.
- Cuatro conexiones independientes al Session pooler oficial DEV: CA oficial, TLS estricto, hostname y autenticación verificados.
- Concurrencia observada mediante `pg_blocking_pids`: B bloqueada por A antes del COMMIT en las dos carreras; no ejecución secuencial.
- Mismo contacto: A `confirmed`, B `already_confirmed`; una sola confirmación/auditoría.
- Dos contactos / misma identidad: A `confirmed`, B `rejected / respond_identity_conflict`; rechazo auditado.
- Idempotencia prepare/confirm/revoke PASS.
- Rechazo no-admin probado con **`asesor` existente**, NO con `coord_operaciones`, que no existe en DEV. Admin inactivo e inexistente rechazados.
- Autorización probada bajo `anon`, `authenticated` y `service_role`, no todas las llamadas como postgres.
- FK `profiles_id_fkey`, NOT NULL, RLS, triggers y funciones del producto preservados; fixtures Auth sintéticos compatibles y campos obligatorios completos.
- Limpieza **PASS, `remaining: []`**, incluidos actores Auth, perfiles y auditorías sintéticas. Sin contraseñas/sesiones/invitaciones/correos/SMS en esa certificación SQL.
- No hubo nuevos SQL, fixtures ni usuarios durante esta actualización documental.

### Evidencia duradera en el PR
- [Cierre consolidado y separación de evidencias](https://github.com/carlosnachon-eng/inmoadmin/blob/e3685405994bc0dd31f105f4cf108ab965805968/docs/evidence/pr133/README.md).
- [Resultados sanitizados por prueba/conexión/carrera/limpieza](https://github.com/carlosnachon-eng/inmoadmin/blob/e3685405994bc0dd31f105f4cf108ab965805968/docs/evidence/pr133/supabase-dev-sql-evidence.json).
- [Paquete ejecutado archivado byte a byte](https://github.com/carlosnachon-eng/inmoadmin/blob/e3685405994bc0dd31f105f4cf108ab965805968/docs/evidence/pr133/sql-dev-certified-package.tar.gz): ocho SQL, lanzador, validación local, diff de fixtures y manifiesto. Archivo de revisión, no nuevo sistema de pruebas ni instrucción para repetir SQL.
- [Manifiesto de hashes del paquete](https://github.com/carlosnachon-eng/inmoadmin/blob/e3685405994bc0dd31f105f4cf108ab965805968/docs/evidence/pr133/sql-package-integrity.sha256).
- [Integridad de las evidencias publicadas](https://github.com/carlosnachon-eng/inmoadmin/blob/e3685405994bc0dd31f105f4cf108ab965805968/docs/evidence/pr133/evidence-integrity.sha256).

Integridad: **12/12 artefactos del paquete y 3/3 evidencias OK**; conteos y campos sanitizados coherentes. No credenciales ni PII real.

## Integración UI local → endpoint real → DEV → gateway → observabilidad
**NO EJECUTADA por acceso local faltante; no PASS ni fallo funcional.**

La aplicación requiere una `NEXT_PUBLIC_SUPABASE_ANON_KEY` DEV válida y una `SUPABASE_SERVICE_ROLE_KEY` DEV válida; no están configuradas en el entorno local ni hay archivo local de configuración en este worktree (sólo `.env.example`). La URL DEV es conocida. No hay sesión sintética vigente ni credencial PostgreSQL conservada tras terminar el proceso anterior.

El endpoint real usa `auth.getUser` y perfil real en Supabase antes de la RPC. La conexión SQL aprobada no sustituye esa autenticación. No se sustituyeron Auth, autorización server-side o acceso DEV con mocks para declarar aprobada la integración. Preparación/limpieza mediante PostgreSQL requiere recuperar acceso DEV autorizado vigente, sin volver a ejecutar la suite SQL cerrada.

- Recorridos positivos nuevos: **0**.
- Rechazos de sesión no autorizada ejecutados contra DEV en esta fase: **0**.
- Nuevos actores/sesiones/fixtures: **0**; no hubo limpieza adicional necesaria.
- Respond/modelo pueden ser simulados sintéticamente según autorización, pero **no se ejecutaron en esta fase**. No se llamó a proveedores externos.

La evidencia previa de UI/componentes/endpoint/gateway/observabilidad sigue siendo **local/simulada**, distinta de SQL remoto. La aprobación SQL no certifica por sí sola el recorrido de aplicación.

## Validación local previa y actualización documental
- Árbol funcional previo: dirigidas 56/56; suite 986/986; build PASS con valores ficticios y gates OFF. Son resultados previos, no pruebas integradas DEV.
- Lanzador local previo: 14/14 PASS. Paquete PostgreSQL local previo: 72 assertions PASS. Separados de la ejecución en Supabase DEV.
- Actualización actual: validación de integridad/evidencia PASS; diff fuera de `docs/**` contra el candidato funcional vacío; `git diff --check` PASS. No se repitió SQL.
- [Informe de implementación con alcance y límites](https://github.com/carlosnachon-eng/inmoadmin/blob/e3685405994bc0dd31f105f4cf108ab965805968/docs/condominium-owner-canonical-identity-dev.md).

## Vercel — pendiente independiente
La regla específica permanece:
```json
{"git":{"deploymentEnabled":{"codex/condominium-owner-canonical-identity":false}}}
```
Crons/configuración ajena intactos. Sin deployment manual, CLI ni deploy hooks; sin credenciales productivas en Preview.

**Preview: no ejecutado: deployment automático deshabilitado**, no PASS.
**Verificación directa de deployments en Vercel: PENDIENTE** por falta de herramienta/CLI soportada disponible; no se reintentó la automatización de navegador previamente bloqueada ni se consultaron Secrets. La ausencia previa de registros en GitHub no equivale a comprobar Vercel directamente. Este pendiente no impidió ni reabre la certificación SQL.

## Límites
Sin cambios funcionales adicionales, nuevas migraciones, merge, producción, backfill, confirmaciones de personas reales ni cambios de flags productivos (confirmación/outbound/R1/canary). Sin Blindaje Legal. Pendientes concretos: integración autenticada DEV y metadatos directos de Vercel. Draft para revisión, sin permiso de rollout.
