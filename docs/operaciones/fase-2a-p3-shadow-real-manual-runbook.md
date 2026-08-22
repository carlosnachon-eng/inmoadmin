# P3 Shadow real — ejecución manual selectiva

Estado inicial y final obligatorio: IA real apagada, outbound apagado y procesamiento automático inexistente. Esta vía sólo analiza un `shadow_message` administrativo persistido y sanitizado que un usuario autorizado selecciona expresamente.

## Arquitectura

- `POST /api/operaciones/shadow-ai-real-authorize` acepta exclusivamente `messageId` y crea una autorización server-side de un solo uso.
- `POST /api/operaciones/shadow-ai-real-run` acepta exclusivamente `messageId` + `authorizationId`.
- `POST /api/operaciones/shadow-ai-real-revoke` revoca una autorización activa antes de su consumo.
- El servidor reconstruye el input desde `shadow_messages` y `shadow_conversations`.
- `shadow_conversations.channel` debe ser exactamente `544519`; `provider=respond_admin` y `direction=inbound` son obligatorios.
- El prompt `administradora-ia-emporio-real-shadow-v1` usa el state machine, policy engine, tools read-only, evidence ledger, grounding y renderer existentes.
- `POST /api/operaciones/shadow-ai-real-continue` continúa exclusivamente el mismo run real en `awaiting_model_round`; no permite cambiar mensaje, modelo, prompt o campaña.
- La respuesta humana posterior sólo se consulta para comparación después del run. Nunca se entrega al modelo.

La migración `202608220001_fase_2a_shadow_ai_manual_authorizations.sql` crea únicamente la tabla de autorizaciones y sus RPC server-side. No contiene mensajes, PII, seed ni activación de IA. Sus checks son read-only y su rollback se niega a borrar una tabla con auditoría.

## Guardas simultáneas para una ventana piloto

1. Confirmar deployment y Supabase Production `bnzrnizrmonjxlktbhlp`.
2. Confirmar usuario activo con rol `admin` o `coord_operaciones`.
3. Mantener `SHADOW_OUTBOUND_ENABLED=false`, `SHADOW_AI_ALLOW_OPERATIONAL_EVENTS=false`, `SHADOW_AI_ENABLED=false`, `SHADOW_AI_PRODUCTION_ENABLED=false` y `SHADOW_AI_ALLOW_REAL_MESSAGES=false`.
4. Habilitar únicamente el kill switch `SHADOW_AI_MANUAL_REAL_ENABLED=true`. Esta flag no ejecuta IA ni autoriza mensajes por sí sola.
5. Un administrador autoriza un `messageId` elegible desde la UI. La autorización dura 10 minutos, no contiene texto ni PII, puede revocarse antes de consumirse y se consume atómicamente al crear el run.
6. Sólo el mensaje con autorización activa muestra `Analizar en Shadow`. La continuación pertenece al mismo run y no requiere una segunda autorización.
7. Seleccionar exactamente un inbound elegible en la UI y ejecutar “Analizar en Shadow”.
8. Si queda `awaiting_model_round`, usar “Continuar análisis” sobre ese mismo run.
9. Verificar evidencia, grounding y que la propuesta no fue enviada ni aplicada.
10. Mantener apagadas las flags globales; para cerrar la superficie manual, apagar `SHADOW_AI_MANUAL_REAL_ENABLED`.

No existe cron, webhook ni worker que invoque estos endpoints. Un error o timeout queda auditado y no es reintentable por esta vía. Ventas, echoes `outbound_human`, fixtures QA, adjuntos inseguros y mensajes que no estén sanitizados fallan cerrado.

## Rollback de código

La respuesta operativa inmediata ante anomalías es apagar `SHADOW_AI_MANUAL_REAL_ENABLED`; las autorizaciones no consumidas dejan de ser utilizables aunque su TTL no haya vencido. Revertir el deployment elimina la superficie manual sin borrar autorizaciones, runs ni decisions. El rollback de schema se niega si existe cualquier autorización, para preservar auditoría. Outbound permanece apagado.
