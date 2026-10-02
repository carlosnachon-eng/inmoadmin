# Shadow Auto texto → OpenAI: implementación y certificación

Fecha: 2026-10-02. Base: `1c15c590fa4836d22d44ee70325d9dd3ed6fa448`.
Rama: `codex/shadow-auto-openai-text`. Dictamen: **GO para revisión de PR;
no autoriza merge, deployment ni ejecución productiva**.

## Alcance y arquitectura

Sólo la inferencia de texto de `/api/cron/shadow-ai-real-auto` y sus rondas
`auto_real_shadow` cambian de proveedor. Se conserva la state machine, el prompt
de negocio, las tools, las guardas de referencias/grounding y la construcción
de resolución 3A / acción 3B. El contrato reducido y su guía de referencias son
los certificados para Replay (sólo se neutraliza el encabezado de la guía).

```text
Cron autenticado → turno capturado / historial de TODOS los proveedores
  → reserva permanente por turno + claim CAS
  → contexto local / aliases nuevos → verificar objeto + string exacta
  → sesión OpenAI nueva, sin tools nativas ni entorno ejecutable
  → decoder compartido → tools server-side read-only
  → hasta 3 rondas / 5 tools planificadas por ronda (límites existentes)
  → grounding + 3A → 3B → persistencia y read-back → revisión, sin envío
```

No SDK, CRM ni orquestador adicional. Se reutiliza el protocolo Agents API de
Sales/Owner/Legal/Admin V2 y `agentUsage.estimateAgentCostUsd`. El adaptador de
transporte está en `lib/agentsV2/openaiSessionTransport.js`; la state machine
existente conserva el control exclusivo de las tools. No se ejecuta el runner
autónomo de otro agente porque se perderían el aliasing y las guardas Shadow.

El modelo se toma explícitamente de `OPENAI_ADMIN_AGENT_MODEL`; no hay modelo
ni proveedor alternativo por defecto. Usa `OPENAI_API_KEY`, no
`ANTHROPIC_API_KEY`, en este carril. `SHADOW_AI_OUTPUT_MODE` continúa disponible
para los carriles antiguos; el nuevo transporte fija `openai_json_schema`.

Fuentes oficiales contrastadas para el wire contract:
[sesiones](https://developers.openai.com/api/docs/guides/agents-api/sessions),
[creación](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/create),
[turns](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/turns/methods/list).
Se usa el mismo endpoint `/v1/agents/sessions` y header `OpenAI-Beta: agents=v1`
que los agentes V2 existentes. No se inventa un parámetro de límite de tokens.

## Idempotencia, sesiones y fallos

- La selección consulta historial por mensajes y `turn_key`, sin filtrar por
  proveedor/modelo/prompt. La ventana global de 1,000 runs es presentación,
  no frontera de idempotencia; los turnos seleccionados tienen búsqueda propia.
  Un resultado saturado o error de consulta bloquea, no se asume historial vacío.
- La reserva usa una UUID determinista de `turn_key` como PK existente. No
  depende de proveedor/modelo. La PK permanece tras error/timeout, a diferencia
  del índice parcial antiguo por `idempotency_key` para running/completed.
  No requiere migración ni backfill. Históricos Claude no se modifican.
- Un run antiguo awaiting/running no se retoma con otro proveedor. Los nuevos
  runs rechazan explicit retry; cambiar modelo tampoco autoriza una repetición.
- Cada ronda reconstruye contexto desde snapshot/tools/evidence locales. Crea
  un scope de aliases y una sesión nuevos. No continúa la sesión remota anterior,
  no almacena mapas inversos y no expone IDs internos al proveedor.
- Se valida el objeto completo y el JSON parseado de la **misma string** que
  recibe fetch. La string no se reconstruye. También se valida el POST de cancelación.
- Timeout: AbortController + límite independiente de que fetch respete abort;
  cancelación una vez si se conoce la sesión. POST incierto sin ID queda
  `cancellation=uncertain`; nunca se repite ni se abre otra sesión como retry.
  Polls GET observan la misma sesión, no son nuevas inferencias/retries.
- Las tools y la precarga usan el wrapper DB read-only (sin mutaciones ni RPC).
  `resolve_contact_identity` conserva `{audit:false}`. R1 no se invoca.
- Fallo de 3B o read-back: run error, `persistence.verified=false`; una decisión
  3A parcial no se presenta como certificación completa. Se conservan los artefactos
  parciales para auditoría; no hay compensación destructiva ni retry.

## Telemetría y compatibilidad

Se reutilizan `shadow_ai_runs`, `shadow_ai_decisions`,
`shadow_conversation_actions` y sus JSON existentes. No hay columnas nuevas.
Históricos `anthropic_requests` se mantienen; el nuevo carril escribe
`model_requests`, `model_duration_ms`, `failure`, `persistence` y
`conversation_result`. Receipts por ronda conservan verificación de objeto,
serialización exacta, `provider_invoked` y output mode. Tools incluyen
nombre/source/succeeded/duración/cantidad de filas, sin mapas de aliases.

La columna heredada `shadow_ai_runs.model` sigue representando la configuración
solicitada, **no acreditación de respuesta**. Para acreditar proveedor/modelo se
usan `model_requests[].model` y `model_provenance`: requieren un turn completed
vinculado al agent devuelto por la sesión. Si faltan, son null. No se infiere
acreditación desde env. La UI histórica genérica no se rediseña en este PR.

Input/output provienen de usage del turn. Desconocido es null, no cero.
Cached tokens son subconjunto de input, reasoning de output; no se suman dos
veces. Totales incompletos y costos desconocidos quedan null. El costo es una
**estimación del tarifario V2 existente**, no una factura ni una tarifa nueva.
`message_safe` tiene procedencia `conversationAction.semanticConversationGuard`;
no significa autorización financiera, elegibilidad de envío ni permiso outbound.

## Certificación

Evidencia durable sanitizada: `shadow-auto-openai-text-dev.json`.

| Capa | Resultado |
| --- | --- |
| Focalizadas nuevas | 30/30 PASS |
| Dirigidas Shadow | 1,187/1,189; 2 excepciones heredadas |
| Suite completa | 1,811/1,814; 3 excepciones heredadas |
| PostgreSQL local, runtime y constraints originales | 34/34 PASS |
| PostgreSQL local, expired/superseded/check2 y carrera real de locks | 15/15 PASS |
| Supabase DEV real, proveedor sintético | 36/36 PASS |
| Build / diff-check | PASS |

Los tres fallos se reprodujeron en un archivo limpio del **mismo HEAD base**:
182/185 de los tres archivos afectados. Se mantienen fuera del alcance:

1. `respondWebhookMultiHmac.test.mjs`: harness data-URL no resuelve import relativo.
2. `shadowAiP3.test.mjs`: expectativa antigua de 18 tools; base contiene 19.
3. `shadowReducedOutputSchema.test.mjs`: expectativa antigua de 4,355 bytes;
   base contiene 4,383. No se modifica el schema para satisfacer esa cifra.

La prueba de imports del contrato reducido sí se actualizó para permitir
explícitamente el nuevo adaptador de texto OpenAI, manteniendo el cierre para
los demás consumidores. No se ocultan ni se declaran PASS los fallos heredados.

DEV fue exclusivamente `hjfwjnejbcpmknvfpdcq`. Ejecutó los procesadores reales
de la rama contra PostgreSQL real mediante un adaptador SQL/MCP acotado a los
IDs de fixtures, con `SET LOCAL ROLE service_role`. **No fue una prueba de un
endpoint desplegado/Auth/PostgREST ni de un proveedor real**. Las pruebas locales
incluyen además el handler cron HTTP 200 completed/idle y rechazo 401.

La precarga y las tools reales consultaron identidad DEV; ninguna pudo mutar DB.
Los modelos y HTTP OpenAI fueron sintéticos; global fetch bloqueó cualquier otra
red. La reconciliación de origen Respond se interceptó sin cambiar su código.
Las lecturas de medios del harness se restringieron a mensajes del fixture.

En el harness DEV, únicamente en memoria, se usaron deadline global de 600s y
tool timeout de 60s para compensar consultas MCP de varios segundos; el model
timeout siguió en 40s. Los límites alojados no cambiaron. Localmente se certifican
también timeouts de 15/20ms, tool timeout de 5ms y una precarga que no resuelve.

La ejecución final creó 12 conversaciones/mensajes sintéticos; verificó los
históricos Claude completed/error/timeout byte-for-byte, errores HTTP, salida
inválida, privacidad, timeout, POST incierto, fallo de 3B y concurrencia (23505
esperado para la segunda reserva). Cron terminó completed y luego idle.
Cleanup: cero fixtures y cero auditorías de identidad asociadas. Los cuatro
fixtures de ejecuciones previas del harness también fueron retirados y verificados.
Esas ejecuciones previas no se contaron como PASS: límite de línea PTY, reloj de
tool incompatible con latencia MCP y proyección/alcance de consultas de medios.

No migraciones, grants, backfill, variables alojadas, llamadas reales a
OpenAI/Anthropic/Respond, cambios productivos ni cambios a #161.

## Reproducción local

```sh
node --test tests/shadowOpenAiText.test.mjs
node --test tests/shadow*.test.mjs
node --test tests/*.test.mjs
SHADOW_ACTION_LOCAL_PG_RUNTIME=<runtime-local> node scripts/test-shadow-openai-text-postgres.mjs
SHADOW_ACTION_LOCAL_PG_RUNTIME=<runtime-local> node scripts/test-shadow-action-transitions-postgres.mjs
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL=https://build.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-build-no-access node node_modules/next/dist/bin/next build
git diff --check
```

El puente DEV `test-shadow-openai-text-dev-bridge.mjs` no carga credenciales ni
conecta por sí mismo a ninguna DB. Exige el ref DEV exacto y supervisión MCP;
no debe ejecutarse contra Producción. Sus fixtures se limpian por IDs explícitos.

## Dependencias y condiciones PRE-GO de Producción (no ejecutadas)

1. Revisar y aceptar el diff y las excepciones heredadas. Preview excluido sólo
   para esta rama; no cambian crons ni otras reglas.
2. Mantener Social OFF, Recovery OFF, URL handoff legacy retirada, SLA OFF,
   Approved Materials OFF. Este trabajo no inspeccionó ni cambió esas variables.
3. Antes de desplegar una versión que cambia el proveedor: apagar/drenar el cron
   de texto con autorización separada y acreditar cero workers antiguos en vuelo.
   La reserva actual protege históricos y carreras entre workers nuevos, **no
   demuestra exclusión contra un binario antiguo simultáneo con otra clave**.
4. Verificar configuración OpenAI, acceso al modelo, contrato real y tarifas con
   una prueba DEV explícitamente autorizada. Esta certificación usa proveedor
   sintético; no demuestra calidad lingüística ni aceptación remota del schema.
5. Agents API aquí usa sesiones sin tools nativas, máximo 3 POST de creación,
   timeout global/model/tool y tope de 64 KiB de salida. No se acredita un límite
   remoto de 1,400 tokens equivalente a `max_tokens` de Anthropic: revisar ese
   presupuesto antes de habilitar tráfico real; no se añadió un parámetro no documentado.
6. Mantener outbound/global/Admin/canary/R1/reconciliación/identity write y eventos
   operativos OFF. GET completed por sí solo no certifica: comprobar decisión,
   resolución, acción, receipt/usage y `persistence.verified` por read-back.
7. Observar cron completed/idle y fallos sin reejecutar turnos, con autorización
   posterior. No se ejecutó este paso ni se escogió un mensaje productivo.

**Rollback seguro:** apagar el cron de texto y conservar runs/decisiones/evidencia.
No fallback automático. No reactivar un binario Anthropic antiguo con su selector
por modelo: podría desconocer runs OpenAI y reprocesarlos. No reactivar Social,
Recovery, handoff, SLA ni outbound como parte del rollback.

**Anthropic no está eliminado de todo Admin**: `shadow-media-retrieval`,
interpretación multimedia, Replay, manual/backfill y otros carriles históricos
quedan fuera de este PR. Sus claves/columnas/implementaciones no se borran.
