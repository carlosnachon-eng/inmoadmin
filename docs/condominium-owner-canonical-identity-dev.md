# Propietarios condominales: entrega DEV/local

Rama: `codex/condominium-owner-canonical-identity`. Base: `58bc401` (main, PR #130).
Informe original de implementación y fixtures sintéticos locales. Sin datos ni credenciales productivas,
sin confirmaciones reales, backfill, merge o deployment. La rama está publicada como Draft PR #133.

## Estado de certificación actualizado — 2026-09-21

La certificación SQL en Supabase DEV quedó cerrada con `DATABASE_CERTIFICATION_PASS`:
8/8 archivos, 72 assertions PASS, dos carreras con bloqueo efectivo observado, idempotencia
y limpieza sin residuos. No se volvió a ejecutar durante esta actualización documental.
El rechazo no-admin en DEV se probó con `asesor`, no con `coord_operaciones`.

Evidencia sanitizada, paquete ejecutado y manifiesto verificable conservados en
[docs/evidence/pr133](evidence/pr133/README.md). Allí se separan la instalación/checks
manuales, SQL ejecutado en Supabase DEV, pruebas locales/simuladas e integración real.
El recorrido UI local → endpoint real → DEV → gateway → observabilidad quedó cerrado
con **INTEGRATION_DEV_PASS**: UI/Auth/autorización/endpoint/Supabase DEV reales, Respond y
modelo simulados, caso positivo aprobado, asesor rechazado con 403 admin_required y
limpieza sin residuos. No repetir ninguna de las dos certificaciones cerradas.
La comprobación directa de deployments Vercel permanece pendiente por acceso soportado.
El catálogo productivo y la vía operativa de instalación/despliegue también siguen sin
verificar. Ver [revisión final](evidence/pr133/rollout-review.md): NO-GO para instalar
por esas precondiciones, no por un fallo funcional ni por ausencia deliberada de Preview.

## A. Capacidad y límites de confianza

- Fuente explícita `condominium_unit_owner`; procedencia `unidades_condominio.id` +
  `condominio_id`, verificando `propietario_telefono` y `activo`, además de `condominios.activo`.
- Reutiliza candidatos/reconciliación, `client_identities`, rol `owner`,
  `client_source_links` y `respond_identity_links`. No crea tablas/directorio de personas.
- Unidad/condominio son referencias propias; `properties`/`contracts` no se leen ni se crean
  para resolver la relación condominal. No se requiere contrato de arrendamiento.
- Se reutiliza el endpoint administrativo `POST /api/operaciones/client-reconciliation`
  mediante acciones `condominium_list/prepare/confirm/reject/revoke`. No hay endpoint por caso.
- UI dentro de Coordinador IA — Sombra: sólo administrador activo, sesión fresca en cada
  acción, misma sesión/perfil, same-origin, revisión explícita y resultado individual visible.
  No hay retry automático; doble clic simultáneo se contiene también en UI.
- Prepare requiere el gate existente de preparación. Confirm/reject/revoke requieren
  los gates existentes de escritura de reconciliación e identity confirmation. Todos
  fallan cerrados si no son explícitamente `true`; no se cambia ningún flag del entorno.
- El servidor relee Respond antes de preparar/confirmar. El browser nunca aporta
  digest/hash/evidencia del teléfono. SQL verifica evidencia <=60 segundos, también después
  de esperas de locks, y vuelve a comprobar fuente, actor, identidad y conflictos.
- Una revisión numérica de origen invalida evidencia cuando cambia propietario registrado,
  teléfono, unidad/condominio o estado. Incluso cambiar el propietario manteniendo el teléfono
  bloquea la aprobación anterior; no se copia ni compara el nombre para atribuir identidad.
- No se fusionan personas por teléfono/nombre. Un teléfono compartido sin ancla estructurada
  se rechaza. Una identidad canónica preexistente sin fuente inequívoca también se rechaza.
- Para añadir otra unidad a una identidad condominal ya aprobada, el admin debe revisar y
  seleccionar explícitamente ese modo. El destino se deriva del **mismo contacto Respond
  ya confirmado**, no de un UUID de identidad aportado por el caller ni de una búsqueda por
  teléfono. Se guarda como candidato y requiere una aprobación posterior independiente.
  No se admite mezclar dominios/roles ni unir identidades preexistentes.
- Varias unidades aprobadas: identidad resuelta, lista estructurada de unidades y
  `ambiguousUnitContext=true`; ninguna seleccionada. No se usa texto/dirección para elegir.
- La identidad no concede autorización operativa, financiera, acceso al portal o a otras
  unidades. No cambia RLS del negocio ni usuarios/perfiles. Las guardas actuales de 3B
  permanecen; si una operación todavía exige contexto de Rentas, queda bloqueada, no se
  sustituye `propertyId` con un ID de unidad.

## B. Integración, observabilidad y migración

El gateway carga sólo vínculos aprobados de esta fuente antes de la primera llamada 3A y
revalida en rondas posteriores. La sanitización certificada sigue ejecutándose antes del
modelo. Contexto nuevo allowlisted: dominio, rol, referencias unidad/condominio y ambigüedad.
Sin nombres/teléfonos/digests. El contexto enviado para las siete identidades previas
permanece sin los campos condominales nuevos. No se modifican prompts, 3B, tools financieras,
thresholds, reglas de auto-send ni las funciones/cohorte 7/7.

La atribución proviene del resultado de resolución realmente utilizado y persistido en el
run normal, nunca de inferencia retrospectiva. En runner se persiste sólo esta evidencia
estructurada adicional; state machine ya persistía los resultados. La vista existente
distingue identidad y unidad resueltas, fuente condominal, varias unidades/no determinada y
`unattributed`. `tool_results_json` continúa exclusivamente server-side.

Migración nueva (las aplicadas no se editan):
`202609180001_condominium_owner_canonical_identity.sql`.
Amplía discriminadores, agrega la referencia al condominio, versión de relación de origen y evidencia de candidato,
triggers de integridad de fuente, RPC transaccional y protección de rutas legacy.
Los confirmadores antiguos siguen disponibles para Rentas mediante wrappers con su misma
firma; rechazan candidatos condominales y sus cores no son ejecutables por roles de aplicación.
La RPC nueva permite únicamente `service_role`; el actor admin se valida en servidor y SQL.
Locks compatibles de contacto/identidad y fuente; creación serializada de identidad.
Atomicidad e idempotencia por candidato/unidad, sin lotes automáticos.

El archivo compañero `_checks.sql` es sólo inspección de esquema/permisos/definiciones;
no crea candidatos ni confirma. El harness local además ejecuta pruebas conductuales y
compara literalmente las definiciones históricas wrapper/core 7/7 antes/después.

### Reversión

- Antes de COMMIT, cualquier fallo revierte la migración transaccional.
- Rollback de aplicación no equivale a revertir confirmaciones. Conservar el esquema aditivo
  y los wrappers cerrados; no bajar discriminadores ni eliminar columnas con evidencia.
- Revocación semántica: acción administrativa explícita `condominium_revoke`, con los mismos
  permisos/gates, audita la relación revocada y conserva identidad/candidatos/historial.
  Sólo revoca el vínculo Respond si no queda ninguna relación condominal aprobada.
- No borrar auditoría ni reconfirmar tombstones automáticamente. No se entrega rollback SQL
  destructivo ni se ejecuta revocación productiva.

## C. Demostración y comprobaciones

Las referencias siguientes son **etiquetas de fixtures**: UUID, contactos y teléfonos del
harness son sintéticos. No son una lectura/replay/confirmación de los runs reales.

| Caso | Fuente de fixture | Recorrido local (no Supabase DEV) |
| --- | --- | --- |
| `85ced7b69096` | unidad `a0faedc4233c` | candidato → aprobación sintética → identidad/owner/unidad/condominio antes de 3A → observabilidad |
| `2b7e03328a31` | unidad `772c16cb082e` | mismo recorrido completo |
| `620988e68436` | unidad `9c7c70b2be1f` | mismo recorrido completo |
| `503f06b3cbdd` | sin asociación | sigue sin resolución; intento sintético contra fuente no coincidente rechazado |

Certificación local:

- Dirigidas: 63/63 PASS.
- Suite completa: 986/986 PASS.
- PostgreSQL local aislado: 54 checks PASS; migración desde esquema limpio + checks SQL;
  dos conexiones concurrentes sobre mismo contacto y sobre misma identidad; idempotencia;
  actores admin/no-admin/inactivo; fuentes inactivas; teléfono compartido/cambiado;
  evidencia vencida; cambio de propietario con mismo teléfono; ruta legacy bloqueada; unidad adicional explícita y revocación;
  cero teléfonos/nombres en auditoría; definiciones 7/7 idénticas y octava referencia rechazada.
- Los tests ejecutan los handlers JSX reales con hooks/transporte sintéticos: admin,
  sesión rotada, cancelación de confirmación, doble clic y ausencia de sesión.
- 3B real sobre fixtures de pago/servicio/mantenimiento/administración: conserva
  `requires_human=true` y `auto_send_eligible=false` cuando no existe evidencia operativa
  admitida. Identidad disponible no valida pagos ni habilita automatización.
- Build PASS con valores locales ficticios y gates OFF; sin archivo `.env` productivo.
  Aviso no bloqueante: no se pudieron descargar fuentes Google en el entorno restringido.
- `git diff --check` PASS.

Reproducir pruebas SQL: instalar `embedded-postgres` + `pg` en un runtime local separado;
ejecutar `CONDOMINIUM_DEV_PG_RUNTIME=<directorio-local> node scripts/test-condominium-identity-postgres.mjs`.
El script no lee `.env`, sólo crea una base efímera loopback con fixtures y la apaga al finalizar.
Certificación ejecutada con PostgreSQL 18 local; un rollout futuro requiere preflight del
esquema/versión del destino y autorización independiente. **GO para revisión, no autorización
para aplicar en Producción.**

## Diff de la entrega

- Backend reutilizable: `condominiumIdentity.js`, `condominiumIdentityApi.js`,
  `condominiumIdentityClient.js`; wiring en `pages/api/operaciones/client-reconciliation.js`.
- UI: `CondominiumIdentityReview.js`, `RunIdentityScope.js`, `coordinador-ia-sombra.js`.
- Resolver/integración: `identityBridge.js`, `context.js`, `phase3AGateway.js`, `runner.js`,
  `stateMachine.js`, `historicalReplay.js` (sólo wiring del gateway; no replay ejecutado).
- Observabilidad: `runIdentityObservability.js`.
- Migración aditiva y checks citados arriba.
- Tests: `condominiumCanonicalIdentity.test.mjs`, `condominiumIdentityUi.test.mjs`,
  `helpers/condominiumIdentityFixture.mjs`, `scripts/test-condominium-identity-postgres.mjs`;
  adaptación de contratos de prueba en `canonicalClientModel.test.mjs` y
  `shadowHistoricalReplay3BEval.test.mjs` para la nueva lectura autorizada de identidad.
- Este informe. Sin dependencias de aplicación añadidas, sin Blindaje Legal.
