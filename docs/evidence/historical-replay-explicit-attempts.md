# Historical Replay — intentos explícitos, evidencia inmutable

## Estado de certificación y publicación

Certificación funcional cerrada en el HEAD
`6f966d5553a17408dc6eb0d8a00ba6c5ca66680b`:
**HISTORICAL_REPLAY_EXPLICIT_ATTEMPTS_DEV_PASS**.
Evidencia sanitizada e integridad:
[informe DEV completo](historical-replay-explicit-attempts-dev/README.md),
[instalación/Auth/concurrencia DEV](historical-replay-explicit-attempts-dev/initial-certification.md)
y [manifiesto](historical-replay-explicit-attempts-dev/manifest.sha256).

UI, Auth, autorización, endpoint, RPC, persistencia y GET fueron reales contra
Supabase DEV. Sólo el proveedor/modelo/usage fueron sintéticos; no hubo llamadas
a Anthropic. El original permaneció byte-for-byte intacto; intento 2 tuvo resultado
propio; limpieza sin residuos. La evidencia SQL local y la evidencia DEV siguen
separadas. La migración **no está aplicada en Producción por esta entrega**.

Para publicar se integró exclusivamente `main`
`e4801685ab34083839b252bf8a4984104208b6d5` (PR #148), sin conflictos.
Merge local: `e3cfd126dcdb5d45b92b4b02e133fe5ca8b3a5ea`.
Los tres archivos de Partner de ese commit se conservan idénticos a `main`;
los seis archivos funcionales/tests/SQL de attempts siguen idénticos al candidato
certificado. Sólo se incorpora documentación DEV y la exclusión de Preview
`git.deploymentEnabled["codex/historical-replay-explicit-attempts"]=false`.
Crons, otras exclusiones, gates y variables permanecen intactos.

Validación posterior a integrar `main`: dirigidas **626/626 PASS**, suite
**1,363/1,363 PASS**, build **PASS**, `git diff --check` **PASS** y estructura de
`vercel.json` **PASS**. No se repitió PostgreSQL local ni la certificación DEV.
Preview: **no ejecutado; deployment automático de esta rama deshabilitado**,
no se presenta como un check verde. No hay workflow GitHub ni script de deployment
en `package.json` versionados; no se invocaron vías alternativas de despliegue.

## Alcance de la certificación local original

Rama: `codex/historical-replay-explicit-attempts`.
Base: `5cc620fa6bb9e16d60edfe3e7fc180a3ab2fd545` (`origin/main` al comenzar).
El cambio ajeno de Partners/Blindaje en esa base se conserva sin modificarlo.

Durante la certificación local original: no publicación, PR, deployment, conexión a Supabase DEV/Producción, Replay real,
Anthropic, caso bancario ni cambios de gates durante esta entrega. Sólo fixtures
sintéticos y PostgreSQL efímero local. La autorización de implementar este
mecanismo no se interpreta como autorización de reejecutar el caso real.

## Diagnóstico y elección mínima

La restricción está en `public.shadow_historical_replay_cases`:
`UNIQUE (historical_turn_key, evaluation_runtime_version)`, declarada en
`202608280001_fase_3b_eval_historical_replay.sql:42`.
La fila representa el caso y también su primer resultado. Volver a preparar el
mismo turno/runtime colisiona; `execute_one` sólo reclama filas `pending`.

Se revisaron `shadow_ai_runs`, `shadow_ai_explicit_retry_audit`,
`202608290002_auto_real_explicit_retry.sql` y `lib/shadow/ai/explicitRetry.js`.
Ese mecanismo pertenece a Auto-Real: exige un mensaje/turno operacional vigente,
usa otra máquina de estados y audita runs naturales. Reutilizarlo para Replay
mezclaría modos de ejecución. Las tablas de cohortes/reviews tampoco representan
un intento independiente. No se cambia su contrato.

Solución: conservar el caso como **intento 1** y añadir únicamente una tabla hija
`shadow_historical_replay_attempts` para los intentos 2+. Sin backfill, copia de
resultados antiguos, alteración de runtime ni modificación de la unicidad.

Cada hijo referencia el caso original y, desde el intento 3, su intento padre.
Tiene estado, resultados, receipts, modelo, usage, errores y diagnósticos propios;
`result_safe` y tokens empiezan en `NULL`. El snapshot y el grounding de entrada
se leen del caso original. `current_state` / `current_canonical_mapping`
continúan significando lo mismo; no se prometen datos operacionales congelados.

## Creación, ejecución y permisos

1. `POST prepare_retry`: sesión con perfil **admin activo**, same-origin,
   `authorization=explicit_admin_retry`, caso y padre explícitos. No permite
   pasar runtime, status ni resultados. La UI confirma con el usuario y obtiene
   una sesión fresca inmediatamente antes del POST.
2. RPC `prepare_historical_replay_retry(uuid, uuid, uuid)`: vuelve a comprobar el
   perfil en DB; bloquea el caso y, si corresponde, el padre; exige `error`.
   Registra actor, fecha y clase de autorización. La acción sólo crea `pending`:
   **cero proveedor/tools**.
3. Un hijo por padre, incluyendo un solo hijo inicial por caso. Dos clics o
   transacciones simultáneas reciben el mismo intento (201 nuevo / 200 existente).
   Repetir una solicitud antigua nunca crea un intento adicional, aunque su hijo
   haya finalizado. Crear el siguiente requiere otra acción sobre el hijo `error`.
4. `execute_one` con `attemptId` exige también admin activo/same-origin. Reclama
   atómicamente `pending → running`; sólo el ganador usa el **mismo executor**
   reducido de Replay. Los verificadores de privacidad, límite de dos rondas,
   tools read-only, grounding, 3A/3B y gates no se modifican.
5. El guardado escribe sólo el hijo reclamado. Los estados terminales son
   inmutables y el caso original se bloquea contra update/delete al tener retry.
   Nunca se resetea `error → pending`. Un `running` huérfano queda fail-closed;
   no hay recuperación automática ni otro retry por timeout.

La migración habilita RLS y revoca acceso de `anon`/`authenticated`. `service_role`
puede leer y actualizar exclusivamente columnas de resultado; no insertar
directamente, borrar ni cambiar parentesco/actor. Sólo la RPC `SECURITY DEFINER`,
con `search_path` vacío y objetos cualificados, puede crear hijos. Los triggers
no son RPC ejecutables por roles de aplicación. Estas decisiones siguen las
guías de privilegios mínimos y transacciones cortas de la skill Supabase.

## GET y UI

- Intento 1 conserva su error y resultado; intento 2+ muestra estado, referencia
  opaca propia y referencia del padre. Receipts se etiquetan como **rondas**, no
  como intentos.
- Cada resultado pasa por las proyecciones sanitizadas existentes; no se infiere
  la causa de filas legacy ni se mezcla telemetría entre intentos.
- Los retries sólo son visibles/operables para admin activo. El acceso anterior
  de `coord_operaciones` a casos originales no se amplía a retries.
- Crear y ejecutar son botones/confirmaciones separados. Bloqueo síncrono contra
  doble clic; sin retry automático ante error de red ni pérdida de respuesta.
- Métricas, selección de cohorte y reviews originales se conservan. No se elige
  automáticamente el mejor resultado ni se incluyen retries en el denominador
  original. No se añaden valoraciones humanas automáticas ni reviews de hijos.
- Lectura acotada a los 100 casos ya expuestos y 500 hijos; exceder el límite de
  hijos devuelve `replay_attempt_history_limit`, sin presentar historia parcial.

## Migración y límites de instalación

Nueva migración aditiva, aplicada después en **Supabase DEV**, no en Producción:
`20260925160512_historical_replay_attempts.sql`.

Dependencias: tablas de casos/cohortes/reviews existentes, `profiles(id, role_id,
active)`, roles Supabase `anon`, `authenticated`, `service_role` y
`gen_random_uuid()`. No se modifica ninguna migración anterior.

Incluye una transacción, `lock_timeout=3s` y `statement_timeout=15s` para el DDL.
Crear el trigger en la tabla de casos necesita un lock de tabla; la instalación
debe abortar ante timeout/error. La RPC usa locks por caso/padre, sin mantenerlos
durante llamadas al modelo. Hay índices para las FK y la unicidad de hijos.

Certificación DEV completada con su esquema real (informe enlazado arriba).
Orden productivo futuro, sujeto a autorización independiente: instalar la
migración antes del código que consulta la tabla y
verificar permisos/objetos. No hace falta backfill. La migración no ejecuta casos
ni habilita proveedor/outbound. Revertir la aplicación **no** revierte resultados:
mantener tabla, auditoría y triggers; no borrar evidencia ni volver a `pending`.

## Certificación ejecutada

| Validación | Resultado |
| --- | --- |
| Dirigidas (34 nuevas + regresiones) | **626/626 PASS** |
| Suite completa de la base vigente | **1,363/1,363 PASS** |
| PostgreSQL local real | **35/35 PASS** |
| Next.js 14.1 build | **PASS**, 75/75 páginas |
| `git diff --check` | **PASS** |

Sin tests fallidos, omitidos o cancelados. Node v24.19.0, entorno `env -i`; build
con URL loopback y claves sintéticas, sin credenciales ni llamadas de modelo.
Dependencias de la aplicación reutilizadas mediante enlace temporal, sin editar
`package.json` ni lockfile.

Pruebas de UI: función real de acción y JSX real compilado con SWC/renderizado
con React; Auth, sesión, fetch y almacenamiento son dobles sintéticos. No se
presentan como autenticación real de Supabase ni prueba de navegador productivo.
Cubren confirmación/cancelación, token fresco, sesión expirada/ausente, no-admin,
doble clic, fallo de red sin retry, referencias de parentesco y resultados separados.

`scripts/test-historical-replay-attempts-postgres.mjs` crea un clúster efímero
exclusivamente en `127.0.0.1` con `embedded-postgres@18.4.0-beta.17` y `pg@8.23.0`,
instalados fuera del repositorio. **No es un lanzador para DEV/Producción** y no
acepta cadena de conexión externa. Aplica las dos migraciones base y la nueva
sólo allí; usa roles sintéticos y `SET ROLE service_role/anon/authenticated`.
Auth del endpoint y executor son simulados; el endpoint y PostgreSQL son reales.

Evidencia SQL observada:

- Restricción de unicidad anterior idéntica antes/después.
- Admin activo permitido; `asesor`, admin inactivo e inexistente rechazados.
- `anon`/`authenticated` no pueden leer/crear; service no puede insertar sin RPC,
  borrar hijos ni modificar actor/parentesco.
- Raíz `pending/running/completed/not_evaluable` rechazada; hijos pending/running/
  completed rechazados. Sólo `error` permite crear otro intento explícito.
- **Carrera de creación:** A mantiene su transacción; `pg_blocking_pids(B)`
  contiene A. Tras COMMIT, B devuelve el hijo de A: uno solo.
- **Carrera de ejecución:** A mantiene `pending → running` sin commit; B queda
  bloqueado por A. Tras COMMIT, A afectó una fila y B cero.
- El snapshot completo del original (`row_to_json(...)::text`) permanece
  byte-for-byte idéntico; igual para el hijo fallido al crear intento 3.
- Endpoint→DB crea sin ejecutar; la ejecución sintética posterior persiste usage
  y modelo propios; GET distingue error original y completion del hijo.
- Todos los clientes/transacciones se cierran; clúster y directorio sintético
  eliminados, con verificación de ausencia (`ENOENT`). **Sin fixtures residuales.**

Comandos reproducibles (sin credenciales):

```sh
node --test tests/shadowOutputPrivacyDiagnostics.test.mjs \
  tests/shadowReducedOutputSchema.test.mjs tests/shadowProviderHttpDiagnostics.test.mjs \
  tests/shadowModelPrivacyTelemetry.test.mjs tests/shadowFinalModelPrivacy.test.mjs \
  tests/shadowPhase3AGateway.test.mjs tests/shadowAi*.test.mjs \
  tests/shadowHistoricalReplay*.test.mjs tests/shadowConversationActions3B.test.mjs \
  tests/condominiumCanonicalIdentity.test.mjs tests/preModelSanitizer.test.mjs
node --test tests/*.test.mjs
REPLAY_LOCAL_PG_RUNTIME=/ruta/temporal/con/paquetes node scripts/test-historical-replay-attempts-postgres.mjs
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-build-only \
  SUPABASE_SERVICE_ROLE_KEY=synthetic-build-only node node_modules/next/dist/bin/next build
git diff --check
```

SHA-256 de los artefactos SQL/local:

- Migración: `3a34fb16b1f2aa9bfec12214f78aa3669b578e7d1dfd613723457fe495592ecc`
- Script PostgreSQL: `d9f67ad90df80c0f22f0713007909de6bfd515f85e36664bc3a09fd0b69fb42d`

**Dictamen: GO para publicación y revisión; no es autorización de rollout
productivo.** DEV cerrado. Pendientes independientes: revisión del PR, autorización
de instalación productiva/merge/deployment y cualquier Replay real por separado.
