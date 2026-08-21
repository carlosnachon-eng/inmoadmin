# Fase 2A P3 — Administradora IA Shadow sintética

Estado inicial y final seguro: `SHADOW_AI_ENABLED=false`, `SHADOW_AI_ALLOW_REAL_MESSAGES=false`, `SHADOW_OUTBOUND_ENABLED=false`. P3 sólo acepta Supabase DEV `hjfwjnejbcpmknvfpdcq`, provider `synthetic` y escenario QA namespaced. No llama Respond, no envía WhatsApp y no escribe en tablas ERP.

## Proveedor y modelo

Se reutiliza la integración Anthropic server-side ya existente (`ANTHROPIC_API_KEY`) sin modificar `pages/api/analizar-solicitud.js`. Modelo fijado: `claude-haiku-4-5-20251001`, por baja latencia, español/multilingüe, tool use y Structured Outputs. Precio oficial auditado el 20/08/2026: USD 1 por millón de tokens de entrada y USD 5 por millón de salida; 200k de contexto y 64k máximo de salida. P3 limita la salida a 1,400 tokens, 3 rondas, 5 herramientas por ronda y 40 escenarios por lote.

## Timeouts y telemetría

El timeout global anterior de 20 segundos se eliminó: ese `AbortController` único cortó el primer request de `administradora-ia-emporio-v2` a los 20,081 ms, antes de recibir output o tool calls. La latencia real posterior fue 44,921 ms en un caso completado y 50,080 ms en un timeout, por lo que P3 usa límites separados y finitos: 75 s por request Anthropic, 5 s por herramienta y 102 s por run completo. La API route conserva `maxDuration=120`, con 110 s de presupuesto de orquestación y ocho segundos reservados para persistencia y respuesta. La metadata accesible del proyecto confirma que `120` está desplegado, pero no demuestra de forma inequívoca una cota contratada superior; P3 no aumenta `maxDuration` por suposición.

Con este runtime una ronda lenta de 45–70 s es el máximo práctico. Una segunda ronda sólo empieza si restan al menos 55 s; con la latencia observada normalmente se detendrá como `insufficient_round_budget`. Dos rondas son posibles únicamente cuando la primera llamada y sus tools consumen menos de aproximadamente 47 s. Tres rondas lentas no caben de forma segura en 120 s y el runner no finge que las soporta.

La integración usa `fetch` directo, no el SDK de Anthropic: no existen retries automáticos ocultos. Cada ronda produce como máximo una llamada HTTP; un timeout no dispara otra. Structured Outputs puede añadir latencia en la primera solicitud de un schema mientras compila su grammar; Anthropic cachea ese grammar hasta 24 horas. No se hacen warmups artificiales.

`shadow_ai_runs.telemetry_json` registra por run: `request_number`, `round_number`, inicio y duración de cada request Anthropic, `anthropic_first_response_ms=null` porque P3 no usa streaming, duración de herramientas y rondas, duración total y `timeout_stage`. Los valores posibles de timeout incluyen `anthropic_request_timeout`, `tool_timeout`, `global_run_timeout` e `insufficient_round_budget`. No se guarda contenido adicional. El cambio de columna está en el bootstrap DEV `202608200003_fase_2a_p3_ai_run_telemetry.sql` y debe aplicarse y validarse en DEV antes de autorizar otro run; no pertenece a Producción.

OpenAI `gpt-5.6-luna` fue comparado (USD 0.20/1M entrada y USD 1.20/1M salida), pero no se incorpora para evitar una segunda credencial/proveedor antes de medir calidad con la infraestructura vigente.

## Contratos

- Prompt: `administradora-ia-emporio-v6`. El cambio de versión conserva separados los runs v5 auditados; `p3-16`, `p3-22`, `p3-25` y `p3-28` no se reejecutaron durante este tuning.
- Salida: JSON Schema estricto con intención, urgencia, resumen, `entitiesMentioned`, `resolvedEntities`, estado de resolución, información faltante, herramientas estructuradas, evaluación contextual, acción/respuesta propuestas, confianza, escalamiento y safety flags.
- Tools: las diez capacidades `READ_ONLY_SHADOW_TOOLS`; argumentos cerrados, sin SQL libre, máximo 5 resultados y ejecución server-side con service role.
- Persistencia: sólo `shadow_ai_runs`, `shadow_ai_decisions` y auditoría Shadow. Nunca se guarda chain-of-thought.

## Dataset y evaluación

`SHADOW_AI_QA_DATASET` contiene 38 escenarios sintéticos con golden expectations para mantenimiento, rentas, servicios, propietarios, contratos, llaves, jurídico, ambigüedad y multintención. Las métricas semánticas —intención, resolución, selección de tools, escalamiento, alucinación y seguridad— usan exclusivamente runs `completed` con decisión. Un timeout sólo afecta `timeoutErrorRate`; no se interpreta como intención o entidad incorrecta. La evaluación humana no contiene botón Aplicar.

## Tool loop v2

`proposedToolCalls` usa objetos `{tool, arguments, reason}`. Cada herramienta tiene schema propio y cerrado: referencias de inmueble para `find_properties`; IDs UUID nominales para inmueble, contrato, pago, servicio, ticket, llave, liquidación, expediente o unidad; y `contextKey` para Work Center. No se acepta `{query}`, argumentos adicionales ni IDs sin formato válido.

Los IDs dependientes deben provenir de metadata determinística o de una herramienta exitosa en una ronda anterior. Una dependencia ambigua, ausente o una tool inválida se registra sanitizada y no se ejecuta; Claude puede corregirla en la siguiente ronda. La tercera ronda es final y no ejecuta nuevas herramientas.

El runner reemplaza cualquier `resolvedEntities` no respaldada por resultados ERP, marca `unsupported_erp_fact` y neutraliza afirmaciones como “ya revisé” cuando no existe evidencia. `unsupportedFactRate` también alimenta `hallucinationRate`. Desde `administradora-ia-emporio-v3`, una herramienta dependiente sólo puede solicitarse en una ronda posterior a la obtención de su ID; el runner conserva la validación determinística como segunda barrera. También se bloquean promesas de ejecución de Shadow (`shadow_action_promise_blocked`). En `administradora-ia-emporio-v4`, `devolucion_deposito` separa solicitudes de depósito de renta y conflicto jurídico. En v5 se separan `servicio` y `mantenimiento`. En v6 se neutralizan promesas de capacidad futura, se limita la aclaración a una pregunta principal y `juridico_conflicto` sólo escala para revisión humana sin recomendar medidas jurídicas u operativas categóricas.

Los goldens v6 clasifican cada tool como `requiredNowTools`, `expectedAfterClarificationTools` o `notApplicableTools`. Una tool dependiente de un ID ausente queda diferida y no reduce recall; ejecutarla prematuramente sí penaliza. Las métricas finales añaden `toolRequiredNowPrecision`, `toolRequiredNowRecall`, `toolDeferredAppropriatelyRate`, `prematureToolRate`, `executionPromiseRate` y `overEscalationRate` sin retirar las métricas de seguridad existentes.

Auditoría de los 38 goldens para v4: `p3-36` cambia de `juridico_conflicto` a `devolucion_deposito`, porque solicita una devolución sin amenaza o disputa jurídica. `p3-29` cambia de `juridico_conflicto` a `contrato`, porque solicita un contrato y datos privados de un tercero sin una señal jurídica; conserva revisión humana por privacidad. Los otros 36 goldens mantienen su intención por corresponder a su semántica operativa original.

## Orquestación QA DEV-only

`/api/operaciones/shadow-ai-qa` acepta exactamente un ID `p3-*` explícito por request. Antes de ejecutarlo consulta el último run del modelo/prompt vigente: omite `completed`, bloquea `running` y reporta `error`/`timeout` sin reintentarlos. Un fixture diferido no crea run. La operación GET calcula pendientes y métricas agregadas desde los runs y decisiones persistidos de los 38 goldens; no depende del resultado de la última request. La UI ofrece “Ejecutar fixture seleccionado” y no contiene ejecución masiva.

El resultado `p3-07` se conserva sin reejecución: intención `pago_renta` correcta, sin alucinación y prudente al solicitar identificación antes de consultar. La frase “Con eso podré consultar” queda registrada como posible mejora de tono por expectativa implícita, no como promesa de mutación ni blocker de seguridad.

## Activación DEV controlada

1. Aplicar sólo en DEV `supabase/dev/bootstrap/202608200001_fase_2a_p3_ai_shadow.sql` y sus checks.
2. Verificar Preview aislado en `hjfwjnejbcpmknvfpdcq`.
3. Mantener `SHADOW_AI_ALLOW_REAL_MESSAGES=false` y outbound false.
4. Habilitar temporalmente `SHADOW_AI_ENABLED=true`; ejecutar un escenario antes del lote.
5. Revisar costo/telemetría y apagar inmediatamente ante anomalía.

Este artefacto no es una migración productiva.

## Diagnóstico del primer HTTP 400

El primer intento real descartó el body de error y guardó sólo `model_http_400`; por ello su `error.type`, mensaje, campo y `request_id` originales no son recuperables. El payload auditado sí confirma endpoint Messages, modelo `claude-haiku-4-5-20251001`, versión `2023-06-01`, `max_tokens=1400`, un mensaje `user` y la forma vigente `output_config.format.schema`. P3 no habilita tools nativas del proveedor: exige tool calls estructuradas dentro de la salida validada y ejecuta consultas read-only localmente.

La diferencia reproducible frente al contrato oficial era el envío directo de restricciones JSON Schema no soportadas que los SDK oficiales eliminan antes de llamar a la API (`minimum`, `maximum`, `minLength`, `maxLength`; el esquema también llevaba límites de arrays). El adapter ahora envía una variante compatible sin esos constraints y conserva todos los límites como validación local posterior. Un error futuro conserva status, tipo, código/campo, request ID y mensaje truncado/sanitizado, además de latencia, sin persistir el body crudo.

No debe ejecutarse otro smoke hasta una autorización separada. Estado seguro final: IA, mensajes reales y outbound apagados.
