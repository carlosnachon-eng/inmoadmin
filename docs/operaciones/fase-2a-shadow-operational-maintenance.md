# Fase 2A — Shadow Operational Events: mantenimiento

Estado: implementación DEV-only. Producción no autorizada.

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

## Rollout Production futuro (no ejecutar)

1. Auditar nuevamente schema y filas legacy; no backfill automático.
2. Preparar migración productiva explícita equivalente, separada de `supabase/dev/`.
3. Desplegar primero schema/outbox con consumidor apagado.
4. Desplegar código de escritura transaccional y validar un ticket controlado no financiero.
5. Activar worker para un único evento, verificar idempotencia y `processed_at`.
6. Aprobar una cotización de prueba controlada y verificar correlación.
7. Mantener `SHADOW_AI_ENABLED=false`, real messages AI=false y outbound=false.

Rollback: detener worker; conservar outbox; revertir código. El DDL sólo se retira si las tablas están vacías o después de respaldo y revisión explícita. No usar automáticamente el rollback DEV.
