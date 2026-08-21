# Fase 2A P3 — Administradora IA Shadow sintética

Estado inicial y final seguro: `SHADOW_AI_ENABLED=false`, `SHADOW_AI_ALLOW_REAL_MESSAGES=false`, `SHADOW_OUTBOUND_ENABLED=false`. P3 sólo acepta Supabase DEV `hjfwjnejbcpmknvfpdcq`, provider `synthetic` y escenario QA namespaced. No llama Respond, no envía WhatsApp y no escribe en tablas ERP.

## Proveedor y modelo

Se reutiliza la integración Anthropic server-side ya existente (`ANTHROPIC_API_KEY`) sin modificar `pages/api/analizar-solicitud.js`. Modelo fijado: `claude-haiku-4-5-20251001`, por baja latencia, español/multilingüe, tool use y Structured Outputs. Precio oficial auditado el 20/08/2026: USD 1 por millón de tokens de entrada y USD 5 por millón de salida; 200k de contexto y 64k máximo de salida. P3 limita la salida a 1,400 tokens, 3 rondas, 5 herramientas por ronda, 40 escenarios por lote y timeout de 20s.

OpenAI `gpt-5.6-luna` fue comparado (USD 0.20/1M entrada y USD 1.20/1M salida), pero no se incorpora para evitar una segunda credencial/proveedor antes de medir calidad con la infraestructura vigente.

## Contratos

- Prompt: `administradora-ia-emporio-v2`. El cambio de versión conserva separados los runs auditados bajo el contrato anterior.
- Salida: JSON Schema estricto con intención, urgencia, resumen, `entitiesMentioned`, `resolvedEntities`, estado de resolución, información faltante, herramientas estructuradas, evaluación contextual, acción/respuesta propuestas, confianza, escalamiento y safety flags.
- Tools: las diez capacidades `READ_ONLY_SHADOW_TOOLS`; argumentos cerrados, sin SQL libre, máximo 5 resultados y ejecución server-side con service role.
- Persistencia: sólo `shadow_ai_runs`, `shadow_ai_decisions` y auditoría Shadow. Nunca se guarda chain-of-thought.

## Dataset y evaluación

`SHADOW_AI_QA_DATASET` contiene 38 escenarios sintéticos con golden expectations para mantenimiento, rentas, servicios, propietarios, contratos, llaves, jurídico, ambigüedad y multintención. Las métricas separan exactitud de intención, resolución/escalamiento, herramientas innecesarias, alucinación y recomendaciones inseguras. La evaluación humana no contiene botón Aplicar.

## Tool loop v2

`proposedToolCalls` usa objetos `{tool, arguments, reason}`. Cada herramienta tiene schema propio y cerrado: referencias de inmueble para `find_properties`; IDs UUID nominales para inmueble, contrato, pago, servicio, ticket, llave, liquidación, expediente o unidad; y `contextKey` para Work Center. No se acepta `{query}`, argumentos adicionales ni IDs sin formato válido.

Los IDs dependientes deben provenir de metadata determinística o de una herramienta exitosa en una ronda anterior. Una dependencia ambigua, ausente o una tool inválida se registra sanitizada y no se ejecuta; Claude puede corregirla en la siguiente ronda. La tercera ronda es final y no ejecuta nuevas herramientas.

El runner reemplaza cualquier `resolvedEntities` no respaldada por resultados ERP, marca `unsupported_erp_fact` y neutraliza afirmaciones como “ya revisé” cuando no existe evidencia. `unsupportedFactRate` también alimenta `hallucinationRate`. El golden `p3-01` exige `find_properties` en ronda 1, mantenimiento por `propertyId` en ronda 2 y respuesta final sin nuevas tools en ronda 3.

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
