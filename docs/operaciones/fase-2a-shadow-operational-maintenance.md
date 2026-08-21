# Fase 2A — Shadow Operational Events: mantenimiento

Estado: implementación validada en DEV. Artefactos Production preparados para revisión; no aplicados.

## Arquitectura anterior

- `pages/mantenimiento.js` insertaba tickets directamente desde el navegador y enviaba email después del insert.
- La creación de cotización insertaba `maintenance_quotes` y actualizaba el ticket en operaciones separadas.
- `pages/cotizacion/[id].js` aprobaba cotización y ticket mediante dos `UPDATE` independientes; el email era best-effort.
- No existían trigger, outbox, webhook, Realtime publication ni evento de negocio durable para estas transiciones.
- Shadow sólo ingería mensajes conversacionales; `gv_respond_webhook_events` es específico de Respond y no es una cola ERP genérica.

Fallos históricos posibles: ticket confirmado con email fallido; cotización actualizada sin ticket sincronizado; estado intermedio sin auditoría; reintento sin clave idempotente.

## Modelo final DEV

`maintenance_scope` distingue explícitamente:

- `managed_property`: exige `property_id` y no admite referencia externa.
- `external_job`: exige `property_id IS NULL` y `external_job_reference` segura, sin PII.

Las filas legacy conservan `maintenance_scope=NULL`; no se reclasifican por intuición. El evento real auditado del 21/08/2026 puede representarse como `external_job`, pero no se generó evento retroactivo.

## Atomicidad y outbox

Las funciones `create_maintenance_ticket_with_event(jsonb)` y `approve_maintenance_quote_with_event(uuid)` confirman cambio ERP + outbox en la misma transacción. La aprobación pública usa una API server-side y conserva la semántica histórica de enlace como capacidad; endurecer el token de aprobación es un riesgo conocido y queda fuera de esta etapa.

`inmoadmin_operational_events` conserva eventos pendientes, intentos y `processed_at`. `process_operational_event(uuid)` ingresa idempotentemente en `shadow_operational_events` y marca la outbox procesada sólo después del éxito. Una falla deja `processed_at=NULL`.

Operational events no se convierten en mensajes: `source=inmoadmin`, `kind=operational_event`. La correlación usa `ticket_id`, `quote_id` y `property_id` cuando aplica.

## Seguridad

- RLS en outbox y Shadow operacional.
- `anon` sin acceso.
- `authenticated` sólo lectura de Shadow para `admin`/`coord_operaciones`.
- escrituras y worker sólo `service_role` server-side.
- payload allowlisted, sin texto descriptivo, teléfonos, emails, URLs, adjuntos ni raw request.
- ningún trigger o write tool hacia el ERP desde Shadow.
- IA y outbound deben permanecer apagados.

## Artefactos Production (no ejecutar desde este PR)

- Migración: `supabase/migrations/202608210002_fase_2a_shadow_operational_maintenance.sql`.
- Checks read-only: `supabase/production/tests/202608210002_fase_2a_shadow_operational_maintenance_checks.sql`.
- Rollback conservador: `supabase/production/rollback/202608210002_fase_2a_shadow_operational_maintenance_rollback.sql`.

La migración no contiene seed, fixtures ni backfill. Las filas históricas mantienen `maintenance_scope=NULL`. El rollback verifica marcadores de ownership y se niega si encuentra outbox, eventos Shadow, ingestión `provider=inmoadmin` o tickets estructurados.

## Worker y smoke manual

`/api/cron/shadow-operational-events` no está registrado en `vercel.json`; por tanto el merge no habilita procesamiento automático. Conserva el lote máximo de 10 para una futura decisión explícita. Para el rollout controlado, una llamada autenticada con `CRON_SECRET` y un `eventId` UUID exacto procesa únicamente ese evento. Si Shadow falla, la RPC no marca `processed_at` y el evento queda pendiente.

## Compatibilidad con Shadow conversacional

Operational Events es un carril independiente. La migración no altera `shadow_messages`, `shadow_conversations`, webhooks Respond, channel `544519`, router P2, WhatsApp ni Ivonne. Tampoco crea `shadow_ai_runs` o `shadow_ai_decisions`. Durante todo el rollout deben permanecer `SHADOW_AI_ENABLED=false`, `SHADOW_AI_ALLOW_REAL_MESSAGES=false` y `SHADOW_OUTBOUND_ENABLED=false`.

## Plan exacto de rollout Production (pendiente de autorización)

A. Aplicar únicamente la migración Production `202608210002` como transacción.
B. Ejecutar los checks SQL read-only y confirmar schema vacío, RLS/grants y filas legacy con scope NULL.
C. Hacer merge/deploy Production del código validado.
D. Confirmar que el worker automático continúa OFF.
E. Crear un único ticket real/controlado, no financiero.
F. Comprobar su outbox pendiente y capturar el `event_id` exacto.
G. Procesar manualmente sólo ese `event_id` mediante el endpoint autenticado.
H. Comprobar un único `shadow_operational_event`, correlación e idempotencia.
I. Aprobar una única cotización controlada asociada.
J. Repetir la comprobación manual y validar ticket/quote/property o `external_job` sin propiedad.
K. Decidir en una autorización posterior si se habilita procesamiento automático.

Rollback: detener el worker y conservar auditoría. El artefacto Production sólo permite retirar DDL si no existe ningún evento ni ticket estructurado; cualquier otro caso exige respaldo y procedimiento explícito separado.
