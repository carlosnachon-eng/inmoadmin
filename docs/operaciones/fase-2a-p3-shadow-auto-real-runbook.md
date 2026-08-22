# P3 Shadow automático — Administración, sin outbound

## Alcance

El carril automático consume exclusivamente mensajes ya capturados en `shadow_messages`: `respond_admin`, canal `544519`, dirección `inbound`, sanitizados y no QA. Capture Admin no depende de Claude. Operational Events continúan en su carril y `SHADOW_AI_ALLOW_OPERATIONAL_EVENTS=false` los excluye del análisis.

## Unidad conversacional

El turn builder agrupa inbound consecutivos de una conversación. Cierra el turno ante respuesta humana, cambio de dirección, una separación mayor a cinco minutos o dos minutos de silencio. La respuesta humana posterior se guarda sólo como identificador comparativo; nunca forma parte del envelope enviado al modelo.

La identidad es SHA-256 de `conversationId + messageIds` y se usa en la idempotencia del run. El último inbound es el `message_id` de anclaje. Un run previo completed para cualquier mensaje del turno lo excluye del backfill; running se bloquea y error/timeout se reporta sin retry.

## Kill switches

- `SHADOW_AI_AUTO_REAL_ENABLED=false`: detiene inmediatamente nuevas ejecuciones automáticas sin detener Capture Admin.
- `SHADOW_AI_BACKFILL_REAL_ENABLED=false`: segundo gate exclusivo del backfill histórico.
- `SHADOW_AI_ENABLED=false`, `SHADOW_AI_PRODUCTION_ENABLED=false` y `SHADOW_AI_ALLOW_REAL_MESSAGES=false`: permanecen apagadas; el worker crea un runtime interno limitado sólo después de pasar las guardas del turno.
- `SHADOW_OUTBOUND_ENABLED=false` y `SHADOW_AI_ALLOW_OPERATIONAL_EVENTS=false`: obligatorias y fail-closed.

El cron `/api/cron/shadow-ai-real-auto` requiere `CRON_SECRET`, corre cada cinco minutos y procesa como máximo un turno o una continuación por ejecución. Con el kill switch OFF devuelve `disabled` y no llama Anthropic.

## Backfill

`GET /api/operaciones/shadow-ai-real-backfill?lookbackDays=5` entrega volumen y costo estimado sin ejecutar Claude. `POST` requiere usuario administrativo autenticado y ambos switches (`AUTO_REAL` + `BACKFILL_REAL`); procesa sólo un turno/step por request.

Cobertura auditada el 21/08/2026: un día efectivo, cinco conversaciones, 15 inbound, 22 outbound_human, 10 turns; un turn ya completed y nueve pendientes. Estimación conservadora para nueve pendientes: ~12.15 rondas, ~60,750 tokens input, ~6,075 output y ~USD 0.0911. A una unidad cada cinco minutos, el backfill requiere aproximadamente 45–90 minutos según continuaciones.

## Rollout preparado, no ejecutado

1. Aplicar `202608220001_fase_2a_shadow_ai_manual_authorizations.sql` y ejecutar checks read-only.
2. Merge/deploy con `SHADOW_AI_AUTO_REAL_ENABLED=false` y `SHADOW_AI_BACKFILL_REAL_ENABLED=false`.
3. Confirmar cron autenticado vacío/disabled, Capture Admin ON, outbound OFF y Operational Events sin Claude.
4. Ejecutar GET de planificación y confirmar volumen esperado.
5. Habilitar ambos switches durante ventana de backfill controlada; observar un turno por invocación y detener ante anomalía.
6. Apagar `SHADOW_AI_BACKFILL_REAL_ENABLED` al terminar histórico.
7. Autorizar por separado `SHADOW_AI_AUTO_REAL_ENABLED=true` para nuevos turns; mantener outbound y Operational Events AI apagados.

No se importan históricos desde Respond, no se generan mensajes, emails, workflows, reasignaciones ni mutaciones ERP.
