# P3 Shadow real — ejecución manual selectiva

Estado inicial y final obligatorio: IA real apagada, outbound apagado y procesamiento automático inexistente. Esta vía sólo analiza un `shadow_message` administrativo persistido y sanitizado que un usuario autorizado selecciona expresamente.

## Arquitectura

- `POST /api/operaciones/shadow-ai-real-run` acepta exclusivamente `messageId`.
- El servidor reconstruye el input desde `shadow_messages` y `shadow_conversations`.
- `shadow_conversations.channel` debe ser exactamente `544519`; `provider=respond_admin` y `direction=inbound` son obligatorios.
- El prompt `administradora-ia-emporio-real-shadow-v1` usa el state machine, policy engine, tools read-only, evidence ledger, grounding y renderer existentes.
- `POST /api/operaciones/shadow-ai-real-continue` continúa exclusivamente el mismo run real en `awaiting_model_round`; no permite cambiar mensaje, modelo, prompt o campaña.
- La respuesta humana posterior sólo se consulta para comparación después del run. Nunca se entrega al modelo.

No hay migración de esquema para esta entrega: el schema productivo reconciliado por `202608210003_fase_2a_p3_shadow_ai_integration.sql` ya soporta la identidad conversacional y la auditoría requeridas. El archivo `202608210004_fase_2a_p3_real_shadow_manual_checks.sql` es únicamente read-only y no debe confundirse con una migración.

## Guardas simultáneas para una ventana piloto

1. Confirmar deployment y Supabase Production `bnzrnizrmonjxlktbhlp`.
2. Confirmar usuario activo con rol `admin` o `coord_operaciones`.
3. Mantener `SHADOW_OUTBOUND_ENABLED=false` y `SHADOW_AI_ALLOW_OPERATIONAL_EVENTS=false`.
4. Activar temporalmente `SHADOW_AI_ENABLED=true`, `SHADOW_AI_PRODUCTION_ENABLED=true` y `SHADOW_AI_ALLOW_REAL_MESSAGES=true`.
5. Seleccionar exactamente un inbound elegible en la UI y ejecutar “Analizar en Shadow”.
6. Si queda `awaiting_model_round`, usar “Continuar análisis” sobre ese mismo run.
7. Verificar evidencia, grounding y que la propuesta no fue enviada ni aplicada.
8. Apagar inmediatamente las tres flags de IA real.

No existe cron, webhook ni worker que invoque estos endpoints. Un error o timeout queda auditado y no es reintentable por esta vía. Ventas, echoes `outbound_human`, fixtures QA, adjuntos inseguros y mensajes que no estén sanitizados fallan cerrado.

## Rollback de código

Revertir el deployment elimina la superficie manual sin borrar runs ni decisions. No requiere SQL ni elimina auditoría. La respuesta operativa inmediata ante anomalías es apagar `SHADOW_AI_ENABLED`, `SHADOW_AI_PRODUCTION_ENABLED` y `SHADOW_AI_ALLOW_REAL_MESSAGES`; outbound permanece apagado.
