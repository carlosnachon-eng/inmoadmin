# Manual Real Shadow: soporte productivo 1/1, cerrado

Dictamen: **GO únicamente para revisión de PR**. **NO-GO para instalar o ejecutar el piloto** sin preflight y autorización independientes. No publicado ni desplegado.

Base: `52b03155971afd12ddfb8b2578bb28e69d6627a7`. Rama: `codex/manual-real-shadow-production-one-turn`.

La certificación anterior `MANUAL_REAL_SHADOW_DEV_PASS` permanece cerrada. Esta implementación nueva se probó localmente y contra un **sandbox PostgreSQL nativo 18.4 desechable**, con proveedor y autenticación sintéticos. No representa otra ejecución contra Supabase DEV real ni Auth real. No se leyó Producción, no se seleccionó un turno real y no se activó ninguna variable.

## Flujo y aislamiento

```text
turno ya capturado + messageRef elegido explícitamente
  → HTTPS canónico + Auth getUser + perfil admin activo
  → gate específico + entorno/proyecto/runtime exactos + otros gates OFF
  → authorize RPC: un control global vitalicio → una autorización
  → execute RPC: claim atómico → un run, sin retry
  → privacidad completa + serialización exacta verificada
  → reserva atómica irreversible de ronda (1 o 2) → transporte
  → decoder/aliases certificados → tools read-only → segunda ronda si corresponde
  → 3A + 3B + read-back → cierre irreversible → GET sanitizado y revisión humana
                                         ↘ ningún sender / R1 / evento operativo
```

Endpoint existente: `/api/operaciones/shadow-ai-real-run?mode=manual_turn`. Acciones `authorize`, `execute`, `close`; GET por `messageRef` o `authorizationRef`. No endpoint ni infraestructura paralelos. UI existente muestra estado, receipts, tools, runtime y cierre; no ofrece envío. Consultar estado antes de autorizar. Cierre disponible aunque una ejecución esté pendiente en el navegador.

`manual_prod_one_turn` / `manual-prod-one-turn-v1` son identificadores de modo y trazabilidad; no cambian el contenido de los prompts. El schema reducido, Tool Guide, aliasing, decoder, grounding, resolvers, tools y decisiones 3A/3B certificados no se modifican. El modo general conserva su schema original. El branding server-side separa DEV, Producción y Replay. La reserva se ejecuta después de ambas verificaciones, sobre el transporte que usa el mismo string ya verificado, inmediatamente antes de `fetch`.

`SHADOW_MANUAL_TURN_PRODUCTION_ENABLED` está documentado en `.env.example` como `false`. La ausencia de cualquier precondición bloquea ejecución. Sólo `VERCEL_ENV=production`, `SUPABASE_ENVIRONMENT=production`, URL exacta de `bnzrnizrmonjxlktbhlp`, origen `https://app.emporioinmobiliario.com.mx`, SHA/deployment acreditables y DEV gate literal `false` permiten acceder a la ruta productiva. Preview, localhost y aliases técnicos no canónicos no la habilitan. La API usa `getUser` y el perfil actual, no claims de rol editables; exige `admin` activo aunque el helper general también admita coordinadores. Las RPC vuelven a comprobar el perfil.

GET y cierre no requieren el gate de ejecución, ni que continúe el SHA autorizado. Sí requieren entorno/proyecto/origen correctos y admin activo. Cualquier admin activo puede cerrar; sólo el autor puede ejecutar. No hay consulta automática de pendientes ni cron.

## Migración propuesta; no aplicada fuera del sandbox

Artefacto separado: `supabase/migrations/20260929165153_manual_shadow_prod_one_turn.sql`, generado con `supabase migration new`. No copia ni requiere aplicar la migración DEV. No reemplaza las RPC DEV.

- `shadow_manual_prod_turn_control`: PK con único valor permitido `manual-prod-1of1-v1`, autorización única, run único, turno único. No reset, DELETE ni TRUNCATE del control; cierre irreversible. Snapshot/fingerprint/turn/runtime/deployment/gates inmutables. Un índice parcial adicional impide un segundo run de este modo durante toda su vida.
- Cuatro RPC server-only: `authorize_manual_shadow_prod_turn`, `claim_manual_shadow_prod_turn`, `reserve_manual_shadow_prod_round`, `close_manual_shadow_prod_turn`. SECURITY INVOKER, `search_path=''`; service role, perfil activo y propietario cuando corresponde.
- RLS sin políticas públicas en el control; sólo SELECT/INSERT/UPDATE para service role. Sin DELETE/TRUNCATE. Vista opaca de mensajes SECURITY INVOKER, service-only.
- Siete triggers protegen control, autorización, run, decisión, propuesta y sender. Sus funciones SECURITY DEFINER de cuerpo fijo y `search_path=''` consultan el control privado sin concedérselo a otros roles ni bloquear operaciones ajenas legítimas. No SQL dinámico. No se amplían grants en tablas existentes.
- El vínculo control → run → acción impide `approved_for_future_auto`, `sent`, reasignación de run/acción y encolado mediante el sender legacy, aun si se intenta cambiar telemetry. Preserva evidencia terminal. Se verificó además una actualización ajena autorizada sin acceso al control privado.
- Transacción con `lock_timeout=3s`, `statement_timeout=30s`; dependencias/ACL/colisiones/locks antes de DDL y checks de catálogo antes del COMMIT. Una discrepancia aborta. No UPDATE/DELETE/backfill/seed de datos existentes durante instalación.
- Locks: ALTER/CREATE TRIGGER, FK y CREATE INDEX pueden bloquear escritura sobre tablas existentes; se requiere ventana breve y repetir inspección de locks inmediatamente antes de instalar. El índice parcial no es concurrente porque pertenece a la transacción atómica; el timeout de 30 s limita el escaneo.
- Postcheck separado read-only: `supabase/production/tests/manual_shadow_prod_one_turn_checks.sql`; resultado `MANUAL_SHADOW_PROD_CATALOG_PASS` en el sandbox.

No usar `db push`. Antes de una instalación futura comprobar proyecto exacto, versión/catálogo y ausencia de colisiones; aplicar únicamente este archivo con cliente que aborte ante error. No se proporcionan credenciales ni se ejecutó procedimiento productivo.

## Gates: soporte instalado no equivale a ventana activa

| Variable / grupo | Estado requerido |
| --- | --- |
| `SHADOW_MANUAL_TURN_PRODUCTION_ENABLED` | OFF ahora y tras cierre; ON sólo en futura autorización independiente |
| `SHADOW_MANUAL_TURN_DEV_ENABLED` | `false` en Producción, incluso para GET/cierre |
| `SHADOW_CONVERSATION_ACTIONS_ENABLED` | `true` sólo como capacidad de cálculo/persistencia 3B durante la prueba; no envío |
| `SHADOW_AI_OUTPUT_MODE` | `anthropic_json_schema` durante ejecución |
| Admin/global outbound y canary | `false` |
| R1, reconciliación prepare/write, identity confirmation/review write | `false` |
| Auto Real, explicit retry, eventos operativos, backfill, legacy manual real | `false` |
| Historical Replay Anthropic y flags generales AI/producción/real messages | `false` |

Lista exacta OFF comprobada en código: `SHADOW_ADMIN_OUTBOUND_ENABLED`, `SHADOW_OUTBOUND_ENABLED`, `SHADOW_ADMIN_WORK_R1_ENABLED`, `SHADOW_ADMIN_OUTBOUND_CANARY_ENABLED`, `SHADOW_CLIENT_RECONCILIATION_PREPARE_ENABLED`, `SHADOW_CLIENT_RECONCILIATION_WRITE_ENABLED`, `SHADOW_IDENTITY_CONFIRMATION_ENABLED`, `SHADOW_AI_AUTO_REAL_ENABLED`, `SHADOW_HISTORICAL_REPLAY_ANTHROPIC_ENABLED`, `SHADOW_AI_ENABLED`, `SHADOW_AI_PRODUCTION_ENABLED`, `SHADOW_AI_ALLOW_REAL_MESSAGES`, `SHADOW_AI_MANUAL_REAL_ENABLED`, `SHADOW_IDENTITY_LINK_REVIEW_WRITE_ENABLED`, `SHADOW_AI_BACKFILL_REAL_ENABLED`, `SHADOW_AI_ALLOW_OPERATIONAL_EVENTS`, `SHADOW_AI_EXPLICIT_RETRY_ENABLED`.

El control guarda el conjunto allowlisted de 20 booleanos en la autorización; GET devuelve ese conjunto y el efectivo del proceso. Las pruebas sólo asignan valores en objetos de entorno sintéticos de su propio proceso. No acreditan el valor actual de variables Vercel.

## Escrituras exactas

Permitidas exclusivamente para el piloto:

1. `shadow_ai_manual_authorizations`: INSERT de una autorización; UPDATE de `consumed_at`/`ai_run_id` al claim. No renovar ni borrar.
2. `shadow_manual_prod_turn_control`: INSERT único; UPDATE de vínculo `run_id`, contador de reservas y `closed_at`, de forma monotónica.
3. `shadow_ai_runs`: INSERT único; UPDATE de estado/rounds/evidencia/telemetría/usage/diagnóstico hasta terminal. Snapshot y runtime permanecen congelados. Terminal inmutable.
4. `shadow_ai_decisions`: INSERT de decisión y `operational_resolution` del run. No mutación posterior.
5. `shadow_conversation_actions`: INSERT de resultado 3B ligado al mismo run/turno; sin promoción ni reasignación posterior. Revisión humana es inspección, no autorización de envío.

Prohibidas: nuevos mensajes/capturas, modificación del snapshot original, identidades, auditoría de identidad, candidatos, links, Auth/usuarios, contratos, pagos, servicios, tickets, trabajo R1, eventos operativos, cola outbound, envíos, retries, segundas autorizaciones/runs, DELETE/UPSERT y toda mutación/RPC desde tools. El control utiliza service role únicamente detrás de API/RPC; no concede esa autoridad al modelo.

Tools: las 18 de `READ_ONLY_SHADOW_TOOLS` permanecen intactas (`resolve_contact_identity`, `find_properties`, `find_active_contracts`, `get_payment_summary`, `get_service_period_status`, `get_maintenance_ticket_summary`, `get_work_center_case`, `get_key_custody_status`, `get_owner_liquidation_summary`, `get_policy_or_signature_case`, `get_condominium_fee_summary` y siete R0 de trabajo administrativo). Se invocan con proxy SELECT-only que rechaza insert/update/upsert/delete/RPC antes de llegar al cliente. `resolve_contact_identity` mantiene `audit:false`, también en su rama condominal. Ninguna tool de esa allowlist requirió habilitar escritura; se ensayó además una implementación sintética que intentó escribir y quedó bloqueada.

## Certificación y evidencia

`manual-real-shadow-production-sandbox.json` conserva comprobaciones y receipts sintéticos por escenario; manifiesto SHA-256 en `manual-real-shadow-production-manifest.json`. Sin identificadores de fixtures, aliases, credenciales, bodies ni PII.

| Nivel | Resultado |
| --- | --- |
| Focalizadas manual DEV + productivo | 99/99 PASS |
| Dirigidas Shadow + identidad condominal | 1,217/1,217 PASS |
| Suite completa | 1,694/1,694 PASS |
| Build Next 14.1 | PASS; avisos de optimización de Google Fonts por red, sin fallo de compilación |
| `git diff --check` | PASS |
| PostgreSQL nativo local | 24 grupos de checks PASS; 9 escenarios persistidos en bases independientes |

Escenarios: happy/ask_missing_information, no_message, identidad insuficiente + tool read-only + dos rondas, structured output inválido, output privacy failure, HTTP proveedor, timeout, 3B fallida después de 3A, cierre mientras el proveedor está en vuelo. En todos: un run, snapshot intacto, sin retry/modelo adicional, cierre, GET OFF y cero escrituras de identidad/outbound. La caída parcial conserva 3A pero no certifica completitud; timeout conserva receipt y usage/modelo desconocidos.

Las carreras de authorize, claim y reserve usaron conexiones PostgreSQL independientes: B permaneció bloqueada y `pg_blocking_pids(B)` identificó A; al COMMIT, la segunda autorización/claim fue idempotente y la reserva duplicada rechazada. Dos reservas máximo; una reserva consumida/incierta no se reutiliza.

También se probaron entorno/Preview/origen/no-admin, todos los gates, cierre OFF, errores de entrada/serialización antes de reservar o llamar al proveedor, pérdida de receipts, inyección de mutaciones por tools y preservación del flujo general. Un test estático previo que exigía exclusivamente branding DEV fue actualizado para comprobar ambos entornos mediante la misma capability, sin habilitar el schema reducido para ejecución general.

Limpieza: diez bases propias eliminadas y cluster desechable detenido. No fixtures en DEV compartido ni Producción. No se repitieron migración/certificación cerradas de Supabase DEV. El helper de Auth del sandbox es sintético; la consulta al perfil, endpoint handler, RPCs, locks, constraints y persistencia sí recorren la implementación con PostgreSQL nativo. No se realizó una nueva prueba browser + Auth real de esta ruta productiva.

Reproducir sin secretos: `node --test tests/shadowManualProduction.test.mjs tests/shadowManualTurn.test.mjs`; dirigidas `node --test tests/shadow*.test.mjs tests/condominiumCanonicalIdentity.test.mjs`; suite `node --test tests/*.test.mjs`; build `node node_modules/next/dist/bin/next build`. Sandbox: `MANUAL_LOCAL_PG_RUNTIME=/ruta/a/runtime-temporal node scripts/test-manual-shadow-production-postgres.mjs`, con `embedded-postgres@18.4.0-beta.17` y `pg@8.16.3`. No usar una cadena PostgreSQL remota; el script siempre crea localhost y deniega fetch externo. El resultado JSON PASS es obligatorio: exit 0 sin reporte no constituye certificación.

## PRE-GO futuro (no ejecutado)

- [ ] Revisión remota del diff y aprobación independiente de instalación; no merge/push incluidos aquí.
- [ ] Verificar SHA/deployment READY y código exacto que se instalaría; mantener gates OFF durante rollout.
- [ ] Preflight read-only de Producción exacta, catálogo/ACL/funciones/triggers/versiones/locks y ausencia de piloto/colisiones. El sandbox no sustituye este preflight.
- [ ] Autorización específica para aplicar únicamente la migración nueva; checks transaccionales y postcheck read-only PASS antes de desplegar/abrir capacidad.
- [ ] Acreditar valores efectivos de todos los gates, proyecto, origen, runtime y posibilidad real de GET/cierre OFF. No inferir secrets write-only.
- [ ] Elegir y revisar un solo messageRef: inbound de Administración, último turno asentado sin respuesta humana posterior, sin adjuntos, conversación ≤200 mensajes y contexto certificado. No finanzas/jurídico/contrato/autorización; revisión humana explícita del contenido/contexto y límites de provider.
- [ ] Autorizar de forma independiente una ventana productiva y un máximo de dos transmisiones sanitizadas de ese turno. No habilitar Auto, Replay, R1, outbound ni otro gate para eludir un fallo.
- [ ] Vía de cierre disponible para otro admin activo, y procedimiento de apagado/redeployment previamente acordado. Una reserva ya aceptada no equivale a entrega acreditada.

## POST-GO futuro y rollback

- [ ] Una autorización y un run, referencias/runtime/gates consistentes; ninguna segunda activación aunque venza el navegador.
- [ ] Read-back de receipts 1/2 con payload/body PASS, output mode, modelo/usage/duración; tools/source/éxito/filas y diagnósticos sanitizados.
- [ ] Decisión + 3A + 3B persistidas y vinculadas; `message_safe` con procedencia `semantic_conversation_guard_v1`, o null si no hay mensaje; `requires_human`, `auto_send_eligible`, `blocked_reason`, `would_resolve_without_human` sin inferir campos ausentes.
- [ ] `certified` requiere persistencia íntegra, receipts completos coincidentes con reservas y control cerrado. `completed` solo no sirve.
- [ ] Cierre irreversible del control, gate productivo OFF y runtime OFF READY; verificar read-only cero outbound/mutaciones de identidad/operativas cuando sea atribuible. Si faltan datos independientes, declararlo, no inventar PASS.
- [ ] Conservar evidencia ante error/timeout; sin reset, nuevo piloto ni retry. La revisión humana nunca habilita envío.

Rollback: antes del COMMIT cualquier error revierte todo DDL de esta transacción. Después de instalar, no down migration destructiva: cerrar el control con API autenticada (funciona OFF), apagar capacidad y revertir sólo aplicación al deployment acreditado cuando se autorice. Conservar control, autorización, run, decisión, propuesta y auditorías; nunca borrar para liberar la unicidad. Un nuevo piloto futuro requeriría otro diseño/autorización, no reset de esta tabla.

## Riesgos residuales / límites

1. PostgreSQL 18.4 local con schema base representativo no demuestra equivalencia completa del catálogo/RLS/Auth de Supabase Producción. Preflight e integración real de entorno son pendientes previos al piloto, no motivo para repetir la certificación DEV cerrada.
2. No browser productivo, deployment, metadata runtime, gates actuales ni candidato real inspeccionados. La UI se compiló y se probó su contrato estático/GET; no hay certificado visual nuevo.
3. El corte entre reserva DB y fetch no puede ser una transacción distribuida con Anthropic. El cierre linealiza reservas: ninguna nueva después de close; una transmisión ya reservada/en vuelo podría terminar. Se valida cierre de nuevo antes de tools/3A/3B; no puede retirarse contenido ya enviado. Estado incierto consume la reserva sin retry.
4. Un kill abrupto del proceso puede impedir receipt final/cierre automático. La autorización permanece consumida, existe límite de reservas/deadline y cierre independiente; no se debe interpretar ese run como completado ni reejecutarlo. Un fallo de persistencia/cierre se informa como incierto.
5. Los locks de instalación pueden afectar brevemente tablas existentes; abortar ante timeout/conflicto. No se evaluó carga real de Producción.
6. Service role/migration owner son autoridades confiables; no se pretende resistir a un superusuario que desactive triggers. El modelo y las tools no reciben ese cliente sin el proxy read-only.
7. `message_safe` acredita la guarda semántica existente sobre la propuesta persistida, no una autorización financiera ni un permiso de auto-send. Silencio conserva null, no un PASS artificial.

Las skills Supabase/Postgres guiaron la migración separada, checks transaccionales, ACL y prueba de locks; Next.js/env-vars guiaron la separación server-only y entorno canónico. No se modificó configuración global ni se extrajeron credenciales.
