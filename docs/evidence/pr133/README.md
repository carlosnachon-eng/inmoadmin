# PR #133: cierre de evidencia para revisión

Actualizado: 2026-09-21. Destino de la certificación SQL: **inmoadmin-dev / hjfwjnejbcpmknvfpdcq**.
Código funcional certificado: `e0cdda009dc1d9fbb92ccd67b1977bc18ab7d8bf`.
Los cambios posteriores de esta entrega son exclusivamente documentación/evidencia; no cambian la aplicación, pruebas funcionales, migración ni configuración.

## Dictamen consolidado

**SQL Supabase DEV e integración: cerrados, `DATABASE_CERTIFICATION_PASS` e `INTEGRATION_DEV_PASS`; no repetir.**
**NO-GO para instalar el soporte productivo ahora:** faltan verificación del catálogo productivo y acceso soportado para verificar despliegue/gates/reversión. La integración está aprobada con el alcance real documentado; no hay fallo funcional demostrado ni se exige crear Preview. Ver [dictamen y procedimiento](rollout-review.md).

| Evidencia | Estado | Alcance real |
| --- | --- | --- |
| Migración y checks en Supabase DEV | Ejecutados previamente por el usuario | Salida visible: `Success. No rows returned` en ambos. No reaplicados ni repetidos. |
| SQL conductual en Supabase DEV | **PASS: 8/8 archivos, 72 assertions** | Dos carreras concurrentes con bloqueo efectivo, idempotencia y limpieza sin residuos. Cerrado antes de este cambio documental. |
| Seguridad del lanzador local | **14/14 PASS previo** | Destino/TLS, hashes, sanitización de errores y orquestación simulada. No equivale a pruebas de aplicación conectada a DEV. |
| Paquete SQL en PostgreSQL local | **72 assertions PASS previo** | Validación local previa a DEV; evidencia distinta de la ejecución remota. |
| UI, endpoint, gateway y observabilidad locales/simulados | PASS previamente documentado | UI real con hooks/transporte/sesión sintéticos; integración de módulos con PostgreSQL local. No autentica contra Supabase DEV. |
| UI local → endpoint real → Supabase DEV → contexto previo a 3A → observabilidad | **INTEGRATION_DEV_PASS, cerrado** | UI/Auth/autorización/endpoint/DEV reales; Respond/modelo simulados; positivo aprobado, asesor 403 admin_required, limpieza sin residuos. |
| Listado directo de deployments Vercel | **PENDIENTE: acceso soportado no disponible** | No hay conector/CLI Vercel disponible. No se reintentó la automatización del navegador bloqueada ni se consultaron Secrets. |

La evidencia local previa de suite completa (986/986) y build PASS corresponde al mismo árbol funcional; no se volvió a ejecutar SQL para actualizar documentación. Ver [informe de implementación](../../condominium-owner-canonical-identity-dev.md).

## Evidencia duradera y reproducibilidad de la revisión

- [Resultados sanitizados de Supabase DEV](supabase-dev-sql-evidence.json): resultado por archivo/assertion, roles de actores, conexiones, carreras y limpieza. Proyección del informe original; su SHA-256 se conserva dentro del JSON. Sin contraseñas, tokens, sesiones ni registros de personas reales.
- [Paquete SQL ejecutado, archivado](sql-dev-certified-package.tar.gz): los ocho SQL, lanzador temporal, pruebas locales del lanzador, validador PostgreSQL local, diff de la corrección de fixtures y manifiesto. Son **bytes originales de la certificación cerrada**, no nuevos tests de aplicación ni instrucciones para volver a ejecutarlos.
- [Manifiesto del paquete](sql-package-integrity.sha256): doce artefactos certificados, rutas relativas; coincide con el manifiesto dentro del archivo.
- [Integridad de evidencias publicadas](evidence-integrity.sha256): hashes del informe sanitizado, archivo y manifiesto.
- [Informe integrado real](integration-dev-report.md), [JSON sanitizado](integration-dev-evidence.json), [paquete utilizado](integration-dev-certified-package.tar.gz) y [manifiesto](integration-package-integrity.sha256): evidencia histórica cerrada, sin secretos/sesiones/tokens. No ejecutar de nuevo.
- [Revisión de rollout](rollout-review.md) y [consulta de catálogo preparada](production-catalog-readonly.sql): documentación de precondiciones; consulta productiva **no ejecutada** por falta de acceso soportado.

Para revisar la integridad, extraer el archivo en un directorio temporal vacío y ejecutar allí únicamente `shasum -a 256 -c package-integrity.sha256`. Esta operación no ejecuta SQL ni abre conexiones. No ejecutar los scripts archivados: contienen rutas históricas de la estación local y corresponden a una certificación ya cerrada. El archivo conserva incluso el formato original para no alterar hashes.

## SQL DEV aprobado: detalles verificables

Ventana UTC del lanzador (captura, catálogo y ejecución): `2026-09-21T05:59:58.645Z` a `2026-09-21T06:08:15.290Z`.
Session pooler oficial del proyecto autorizado, puerto 5432, CA oficial, `rejectUnauthorized=true`, validación normal del hostname y autenticación verificadas. Se revisaron catálogo/FK/NOT NULL/triggers antes de las escrituras sintéticas; las seis funciones instaladas coincidían con la migración certificada.

| Archivo | Assertions PASS | Duración observada |
| --- | ---: | ---: |
| 01 conductuales + ROLLBACK | 52 | 312 ms |
| 02 preparación de fixtures concurrentes | 5 | No instrumentada por separado |
| 03 mismo contacto A | 2 | 433 ms |
| 04 mismo contacto B | 1 | 162 ms |
| 05 misma identidad A | 2 | 415 ms |
| 06 misma identidad B | 2 | 140 ms |
| 07 verificación persistida | 7 | 101 ms |
| 08 limpieza | 1 | 272 ms |

### Roles, concurrencia e idempotencia

- Tres actores sintéticos: administrador activo, **`asesor` activo como no-admin**, administrador inactivo. `coord_operaciones` no existe en este DEV y **no se declara probado**. Actor inexistente también rechazado.
- RPC invocada bajo roles reales `anon`, `authenticated` y `service_role`: los dos primeros rechazados; validación del actor y operación bajo `service_role`. `postgres` sólo preparó/inspeccionó fixtures, observó locks y limpió.
- Misma referencia: A `confirmed`, B `already_confirmed`.
- Dos contactos/una identidad: A `confirmed`, B `rejected / respond_identity_conflict`.
- Conexiones A/B distintas (`199214` / `199215`); A observó a B bloqueada por A mediante `pg_blocking_pids` antes del COMMIT en ambas carreras. No fueron ejecuciones consecutivas.
- Prepare/confirm/revoke idempotentes. Una sola confirmación/auditoría para mismo contacto; un ganador y un rechazo auditado para misma identidad.
- Guardas de teléfono compartido/cambiado, evidencia vencida, unidad/condominio inactivos, revocación y múltiples unidades PASS. Cohorte histórica 7/7 intacta; octava referencia rechazada.

### Corrección de fixtures y limpieza

La corrección no cambió el esquema: respetó `profiles.id → auth.users.id`, completó `condominios.nombre` y `unidades_condominio.numero`, y usó `asesor` existente. El trigger Auth instalado creó los perfiles; sólo se ajustaron esos perfiles sintéticos. No se generaron contraseñas, sesiones, invitaciones, correos ni SMS durante la certificación SQL.

01 finalizó en ROLLBACK; 02 registró los IDs propios antes de COMMIT; 08 eliminó exclusivamente las dependencias, auditoría y registros de esos fixtures, perfiles y Auth incluidos. No hubo cascadas, desactivación de RLS/triggers/restricciones ni borrados generales. **Inventario final: `remaining: []`.**

## Integración corta: aprobada y cerrada

Se ejecutó entre `2026-09-21T14:47:18.696Z` y `2026-09-21T14:49:04.349Z` sobre candidato `41b74c9abf919968791f6944d75c295261f0f2a0`. Acceso local exclusivo a DEV, claves modernas compatibles, PostgreSQL Session pooler con CA/TLS/hostname verificados. Las credenciales se capturaron sólo en memoria y se descartaron al terminar.

Un recorrido positivo real: UI/login Auth de admin → preparación de candidato → revisión explícita → RPC DEV → vínculo aprobado → resolver/gateway real antes de 3A → observabilidad real en API/UI. Antes de aprobar, el candidato siguió sin resolver. Una sesión real de `asesor` fue rechazada con HTTP 403 `admin_required`, sin efectos secundarios. La clave administrativa no apareció en los 13 artefactos cliente inspeccionados.

Respond y el modelo sí fueron simulados con respuestas sintéticas determinísticas; Auth, autorización y Supabase DEV no. Se invocó la función real del gateway localmente y se usó un run sintético de observabilidad, no ingestión natural ni replay. No es una prueba de calidad de 3A/3B ni de auto-send. Ver [alcance exacto](integration-dev-report.md).

Limpieza PASS: 2 actores y 2 sesiones retirados; cero filas propias en las 22 tablas verificadas, incluida auditoría de prueba. Aplicación/navegador apagados. No migraciones/checks/72 assertions repetidos ni cambios de producto para obtener PASS.

## Compatibilidad y Vercel

Comparación remota antes de esta publicación documental contra `main` vigente: base y merge-base `58bc401c79749bc5140104f304c639b789256c69`, `ahead_by=4`, `behind_by=0`; PR Draft/open/mergeable. `git ls-remote` confirmó los mismos refs. No hubo que traer cambios ajenos, rebase ni alterar funciones. Esta revisión añade sólo documentación/evidencia; árbol funcional idéntico al candidato integrado.

`vercel.json` mantiene la exclusión específica `git.deploymentEnabled["codex/condominium-owner-canonical-identity"]=false`. No hay workflows versionados de GitHub ni un hook Git local configurado en este worktree. No se invocó deployment manual, CLI ni hook. Preview: **no ejecutado deliberadamente; no PASS**.

La ausencia previa de registros de deployment/checks en GitHub no demuestra por sí sola ausencia de deployments en Vercel. La consulta directa de metadatos Vercel sigue pendiente; no hay conector/recurso/CLI disponible y no se repitió automatización bloqueada. Es independiente de las dos certificaciones aprobadas y no justifica repetirlas.

PR #133 permanece Draft. Sin merge, deployment, SQL productivo, migraciones nuevas, backfill, personas reales ni cambios de flags productivos. El cierre conserva ambas certificaciones; **no permite saltar el preflight de catálogo ni la verificación de acceso productivo**.

### Descripción del PR: permiso de edición pendiente

La evidencia sí fue publicada mediante push a la rama autorizada. El intento de actualizar
la descripción mediante la integración soportada de GitHub devolvió **HTTP 403,
`Resource not accessible by integration`**. No se repitió ni se usó otro mecanismo para
sortearlo. El cuerpo anterior del PR no refleja aún este cierre; requiere permiso de edición
de la vía soportada o una actualización manual autorizada; no se solicita ni amplía ningún permiso.
[Descripción preparada para aplicar](pr-description-proposed.md). Este pendiente documental
es distinto de las certificaciones SQL/integración aprobadas y de los accesos productivos pendientes.
