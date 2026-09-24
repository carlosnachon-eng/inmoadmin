# Schema reducido: integración exclusiva de Historical Replay

Fecha: 2026-09-24.
Rama local: `codex/historical-replay-reduced-schema`.
Base: `9876bae968c4af5bb83ab5b9e1debbd5750bc75b`.

## Resultado y límites

GO para revisión del cambio local. Dirigidas **527/527**, suite completa
**1,232/1,232**, build **PASS** (75/75 páginas) y `git diff --check` **PASS**.
Se agregan 25 pruebas; siguen pasando las 68 pruebas del adaptador certificado,
que cubren las 18 tools y 132 combinaciones de argumentos.

No se publicaron commits ni se ejecutaron deployments, Historical Replay
productivo, SQL o llamadas reales a Anthropic/Respond. No se consultaron secretos
ni se modificaron gates. Las claves de pruebas/build son cadenas sintéticas;
el build usa una URL de Supabase de loopback no operativa. Las pruebas usan
respuestas sintéticas de `fetch` y bases en memoria: no certifican Auth, Supabase
ni aceptación/compilación real de Anthropic. El HTTP 400/timeout **no se declara
resuelto** sin una futura prueba expresamente autorizada.

## Selección e aislamiento

1. El handler existente `shadow-historical-replay`, exclusivamente en
   `execute_one`, establece `{ useReducedOutputSchema: true }` en el servidor.
   No lo lee del body del cliente, metadata, query string ni variable global.
   Preview, prepare, GET, review, autorización y persistencia no cambian.
2. `executeHistoricalReplayCase` mantiene sus gates de aislamiento y validación
   de caso. La opción sólo admite booleanos; por defecto queda `false` para
   conservar el contrato de llamadas internas anteriores. La ruta reducida
   exige `anthropic_json_schema`; no cambia el output mode ni hace fallback a
   `text_json_local`.
3. El ejecutor abre una capacidad opaca en memoria, registrada en un `WeakSet`.
   Se revoca en `finally`, tanto en éxito como en error. Un objeto suministrado
   por HTTP, clonado o expirado no satisface la comprobación.
4. La entrada dedicada `invokeHistoricalReplayReducedPhase3A` exige esa
   capacidad y un caso Historical Replay válido. Reutiliza el mismo cuerpo
   privado del gateway: sanitizador, contexto allowlisted, resolver canónico,
   aliases por ronda y verificación completa no cambian.
5. El transporte reducido queda ligado al array exacto de mensajes verificados
   de esa ronda y es de un solo uso. El transporte general llama siempre a la
   implementación compartida con la variante desactivada. Opciones o metadata
   que intenten seleccionar la variante desde el gateway normal se ignoran.
6. Una prueba arquitectónica limita los importadores/emisores de la capacidad,
   transporte dedicado y decoder. Runner y state machine no tienen esa ruta.
   Esto protege los flujos existentes y futuras regresiones de código; no es
   una frontera de seguridad frente a alguien que pueda modificar el servidor
   y eliminar sus controles/pruebas.

No se añade un segundo transporte HTTP: ambas rutas comparten un único `fetch`.
`system`, `messages`, modelo, headers y `max_tokens` conservan su construcción.
Sólo en Replay reducido se usa `buildReducedAnthropicDecisionSchema()` en
`output_config.format.schema`. El cuerpo completo y la serialización exacta
siguen pasando por `serializeVerifiedAnthropicBody` antes de cada `fetch`.

## Decodificación y compatibilidad

Después del parsing y la normalización ya existentes, sólo Replay reducido usa
`decodeReducedShadowAiDecision`. Reconstruye el objeto interno de argumentos,
valida la decisión, resuelve aliases server-side y valida todas las tools antes
de devolver la decisión. No se decodifican referencias dos veces.

El decoder certificado no cambia funcionalmente. Un objeto de argumentos del
formato anterior falla con `invalid_structured_output:reduced_arguments_shape`,
sin tool, repair, fallback de schema ni reintento. Una decisión final con
`proposedToolCalls: []` es válida en ambos formatos: no contiene argumentos cuya
representación se pueda distinguir.

Los aliases desconocidos, de otra ronda/tipo, UUID directos y aliases en texto
libre siguen bloqueados. La validación ocurre antes de filtrar/ejecutar tools.
El bucle máximo de dos rondas, deduplicación, read-only, grounding, finalización,
guardas, resultados 3B y métricas no cambian.

## Evidencia local específica

| Prueba | Resultado observado |
| --- | --- |
| Replay reducido, dos rondas nativas con `fetch` sintético | Schema reducido en ambas; 2 receipts PASS; usage sintético 10/4 |
| Tool real `get_maintenance_ticket_summary` contra base en memoria | SELECT `maintenance_tickets`; recibe ID desaliasado; 1 resultado |
| Evidencia del ticket en ronda 2 | Ledger con estado/priority y referencias opacas de la ronda actual; grounding válido |
| Comparación de Replay original/reducido con mismas respuestas equivalentes | Resultado completo profundamente idéntico, incluyendo tools, evidencia, resolución, 3B, mensaje y guards |
| Runner y state machine con transporte nativo y `fetch` sintético | Body usa exactamente `anthropicShadowAiDecisionJsonSchema`; acepta argumento objeto original y ejecuta tool con ID interno correcto |
| Opción reducida inyectada en gateway normal/metadata/env | No activa variante; schema original |
| Capacidad falsa/clonada/expirada; reutilización de transporte/array diferente | Rechazo sin llamadas adicionales |
| Claves desconocidas/de otra tool/duplicadas, UUID directo, alias inventado/de otro tipo/en texto libre | Una respuesta sintética; cero tools; sin fallback/reintento |
| Alias de ronda 1 reutilizado en ronda 2 | Rechazo; no ejecuta segunda tool |
| Fallo de payload completo o serialización exacta en ronda 1 o 2 | Cero `fetch` de la ronda afectada; conserva PASS previo y receipt FAIL correspondiente |
| Handler real → Replay → transporte/decoder → resultado/GET (DB y proveedor simulados) | Opción server-owned pese a body contrario; 2 receipts PASS; writes sólo en tabla histórica de casos |
| Mismo handler con respuesta de argumentos antigua | HTTP 422; caso error; 1 receipt PASS; cero tools; sin alias/ID en respuesta/result_safe |

Los tests históricos de telemetría del contrato original conservan explícitamente
ese modo mediante su inyector de pruebas. Los nuevos tests ejercitan por separado
la selección real del handler y el transporte reducido, sin sustituir el
`modelCall`/decoder. La inyección `fetchImpl` en el ejecutor es sólo un punto de
prueba; no se recibe de solicitudes HTTP.

## Archivos e invariantes

- `lib/shadow/ai/anthropic.js`: selección privada de schema y transporte reducido acotado.
- `lib/shadow/ai/historicalReplaySchemaContext.js`: capacidad efímera sin I/O.
- `lib/shadow/ai/phase3AGateway.js`: entrada dedicada; gateway general sin selección de variante.
- `lib/shadow/ai/historicalReplay.js`: opción interna, lifetime y decoder correspondiente.
- `lib/shadow/ai/reducedOutputSchema.js`: únicamente comentario de alcance actualizado.
- `pages/api/operaciones/shadow-historical-replay.js`: una opción fija en `execute_one`.
- `tests/shadowHistoricalReplayReducedSchema.test.mjs`: 21 regresiones nuevas.
- `tests/shadowAiP3.test.mjs`: 2 regresiones nativas de flujo general.
- `tests/shadowHistoricalReplaySourceResult.test.mjs`: 2 regresiones de endpoint y separación del contrato original.
- `tests/shadowReducedOutputSchema.test.mjs`: allowlist arquitectónica actualizada.
- Este informe.

Diff vacío contra la base en `schema.js`, `prompt.js`, `realPrompt.js`,
`runner.js`, `stateMachine.js`, `finalModelPrivacy.js`, `preModelSanitizer.js`,
`context.js`, `grounding.js`, `conversationAction.js`, identidad, migraciones y
`vercel.json`. Sin nueva flag, cambio de configuración, dependencia o migración.

## Comandos de certificación

Node existente, dependencias ya instaladas reutilizadas mediante symlink temporal
eliminado al finalizar. Ejecución con `env -i` y PATH explícito, sin secretos del
entorno. Dirigidas:

```sh
node --test tests/shadowReducedOutputSchema.test.mjs \
  tests/shadowProviderHttpDiagnostics.test.mjs tests/shadowModelPrivacyTelemetry.test.mjs \
  tests/shadowFinalModelPrivacy.test.mjs tests/shadowPhase3AGateway.test.mjs \
  tests/shadowAi*.test.mjs tests/shadowHistoricalReplay*.test.mjs \
  tests/shadowConversationActions3B.test.mjs tests/condominiumCanonicalIdentity.test.mjs \
  tests/preModelSanitizer.test.mjs
node --test tests/*.test.mjs
node node_modules/next/dist/bin/next build
git diff --check
```

Resultados: 527/527 dirigidas; 1,232/1,232 completas; cero fallos, skipped o
cancelled; build exit 0, compilación y prerender 75/75. No aceptación del schema
por el proveedor inferida de estos resultados locales.
