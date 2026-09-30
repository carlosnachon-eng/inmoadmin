# Administradora IA V2 — spike Agents API

Fecha de inicio: 2026-09-30.
Rama: `feat/admin-agent-v2`.
Estado: spike aislado; **sin Producción y sin outbound**.

## Objetivo

Validar si OpenAI Agents API puede sustituir la orquestación genérica que hoy mantiene Shadow
(sesión, rondas, contexto y recuperación) sin reemplazar los controles de negocio de InmoAdmin.

El spike reutiliza exclusivamente tools read-only ya existentes y mantiene InmoAdmin/Supabase
como fuente de verdad.

## Alcance inicial

Tools expuestas:

- `resolve_contact_identity`
- `find_properties`
- `find_active_contracts`
- `get_payment_summary`
- `get_service_period_status`
- `get_maintenance_ticket_summary`

No se exponen tools de mutación, RPC administrativas, outbound, aprobaciones, escritura de
mantenimiento, confirmación de pagos ni cambios de contrato.

El entorno falla cerrado si:

- `ADMIN_AGENT_V2_ENABLED !== "true"`
- Vercel o Supabase indican Producción
- cualquier flag outbound de Shadow está habilitado
- falta `OPENAI_API_KEY`
- falta un `OPENAI_ADMIN_AGENT_MODEL` explícito

## Integración Agents API

El adaptador crea `POST /v1/agents/sessions` con `environment.type = "none"` y registra
las funciones read-only en `agent.tools`. Si la sesión devuelve `required_actions`, el
adaptador ejecuta cada llamada mediante `executeShadowReadOnlyTool` y devuelve
`agent.session.input.tool_result` al endpoint de eventos.

No se persiste todavía `session_id` en InmoAdmin. Tampoco se conecta Respond. El siguiente
paso, después de validar transporte real y tests, será asociar de forma aislada una conversación
histórica a una sesión V2 y comparar V2 vs Shadow sobre el mismo turno.

## Criterios para continuar

1. 0 inferencias de identidad.
2. 0 confirmaciones falsas de pagos.
3. 0 mutaciones operativas.
4. 0 outbound.
5. Tool calls válidas con los mismos argumentos y resultados que Shadow.
6. Costo y usage medibles por conversación.
7. Resultado recuperable por `session_id`.

No se autoriza migración productiva con este spike.
