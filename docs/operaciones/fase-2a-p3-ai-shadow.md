# Fase 2A P3 — Administradora IA Shadow sintética

Estado inicial y final seguro: `SHADOW_AI_ENABLED=false`, `SHADOW_AI_ALLOW_REAL_MESSAGES=false`, `SHADOW_AI_ALLOW_OPERATIONAL_EVENTS=false`, `SHADOW_AI_PRODUCTION_ENABLED=false`, `SHADOW_OUTBOUND_ENABLED=false`. QA sólo acepta Supabase DEV `hjfwjnejbcpmknvfpdcq`, provider `synthetic` y escenario namespaced. No llama Respond, no envía WhatsApp y no escribe en tablas ERP.

## Integración sobre main y Operational Events

P3 conserva dos entradas separadas. Un `shadow_message` es una entrada conversacional y puede producir una respuesta propuesta (nunca enviada). Un `shadow_operational_event` es una señal interna estructurada; no se convierte en mensaje y su salida es `operationalOutput` con interpretación, contexto, seguimiento recomendado, revisión humana, riesgo/prioridad y evidencia. Su `proposedResponse` se persiste como `NULL`.

El adaptador inicial admite únicamente `maintenance_ticket_created` y `maintenance_quote_approved`. Usa `shadow_operational_events.id` como identidad estable, acepta `propertyId=NULL` para `external_job`, conserva IDs e importes estructurados y alimenta directamente `resolvedOperationalContext`. Las herramientas siguen siendo exclusivamente read-only.

La migración productiva `202608210003_fase_2a_p3_shadow_ai_integration.sql` reconcilia los bootstraps P3 que sólo existen en DEV con el schema productivo creado por `202608190003`, y añade la identidad operativa. No se ha ejecutado. Debe aplicarse antes de desplegar código que consulte `input_kind` u `operational_event_id`; aborta ante instalación parcial y no debe reejecutarse tras aplicarse exitosamente.

Una futura activación productiva exige coincidencia exacta con `bnzrnizrmonjxlktbhlp` y doble autorización (`SHADOW_AI_ENABLED` + `SHADOW_AI_PRODUCTION_ENABLED`). Los mensajes reales además requieren `SHADOW_AI_ALLOW_REAL_MESSAGES=true` y el channel ID administrativo exacto; los eventos operativos requieren `SHADOW_AI_ALLOW_OPERATIONAL_EVENTS=true`. Preview/DEV no puede escribir en Supabase Production.

## Proveedor y modelo

Se reutiliza la integración Anthropic server-side ya existente (`ANTHROPIC_API_KEY`) sin modificar `pages/api/analizar-solicitud.js`. Modelo fijado: `claude-haiku-4-5-20251001`, por baja latencia, español/multilingüe, tool use y Structured Outputs. Precio oficial auditado el 20/08/2026: USD 1 por millón de tokens de entrada y USD 5 por millón de salida; 200k de contexto y 64k máximo de salida. P3 limita la salida a 1,400 tokens, 3 rondas, 5 herramientas por ronda y 40 escenarios por lote.

## Ejecución multi-request (state machine)

Desde P3 v8, un run no intenta completar varias rondas dentro de una sola Function. Cada request hace como máximo una llamada al proveedor y las consultas read-only derivadas de esa ronda. Si obtiene evidencia y necesita otra ronda, persiste `awaiting_model_round` y termina exitosamente; la siguiente ronda exige una llamada humana explícita a `POST /api/operaciones/shadow-ai-continue` con el `runId`.

Estados auditables: `created`, `model_round_running`, `awaiting_tool_execution`, `awaiting_model_round`, `completed`, `blocked`, `error` y `timeout`. El claim condicional `awaiting_model_round → model_round_running` permite un solo continuador. La identidad de tool por ronda, nombre y argumentos evita repetir una consulta ya persistida.

Se persisten exclusivamente output estructurado validado, llamadas propuestas, resultados sanitizados de tools, evidence ledger, grounding y telemetría por request/ronda. No se guarda chain-of-thought ni respuesta cruda de Anthropic. No se incorpora cron, queue, tool de escritura, outbound ni mensajes reales. El bootstrap `202608200004_fase_2a_p3_ai_state_machine.sql` es DEV-only: este PR lo versiona para revisión y no lo aplica.

## Timeouts y telemetría

El timeout global anterior de 20 segundos se eliminó: ese `AbortController` único cortó el primer request de `administradora-ia-emporio-v2` a los 20,081 ms, antes de recibir output o tool calls. Después, p3-07 v8 agotó el límite de 75 s sin output. Para QA DEV el presupuesto queda finito en 90 s por request Anthropic, 5 s por herramienta y 110 s por run completo. La API route conserva `maxDuration=120`; el orquestador usa una ventana de 118 s y reserva ocho segundos, por lo que entrega como máximo 110 s al runner y conserva aproximadamente diez segundos del límite Vercel para autorización, cierre, persistencia y respuesta. Estos valores no habilitan mensajes reales ni cambian Producción.

Con este runtime una ronda lenta de hasta 90 s es el máximo práctico. Una segunda ronda sólo empieza si restan al menos 55 s; por ello una primera respuesta a 80 s puede aceptarse y ejecutar su tool, pero no puede iniciar otra ronda y termina fail-closed como `insufficient_round_budget`, sin respuesta candidata. Dos rondas sólo son posibles cuando la primera llamada más sus tools consumen como máximo unos 55 s; la segunda queda limitada por el tiempo global restante. Tres rondas lentas no caben de forma segura en 120 s y el runner no finge que las soporta.

La integración usa `fetch` directo, no el SDK de Anthropic: no existen retries automáticos ocultos. Cada ronda produce como máximo una llamada HTTP; un timeout no dispara otra. Structured Outputs puede añadir latencia en la primera solicitud de un schema mientras compila su grammar; Anthropic cachea ese grammar hasta 24 horas. No se hacen warmups artificiales.

`shadow_ai_runs.telemetry_json` registra por run: `schema_version`, `prompt_version`, `request_number`, `round_number`, inicio y duración de cada request Anthropic, `anthropic_first_response_ms=null` porque P3 no usa streaming, `output_state=complete|none`, duración de herramientas y rondas, duración total y `timeout_stage`. El transporte actual no usa streaming, de modo que no presenta output parcial: una respuesta se recibe completa o se registra `none`. Los valores posibles de timeout incluyen `anthropic_request_timeout`, `tool_timeout`, `global_run_timeout` e `insufficient_round_budget`. No se guarda contenido adicional. La columna JSON existente no requiere otra migración.

OpenAI `gpt-5.6-luna` fue comparado (USD 0.20/1M entrada y USD 1.20/1M salida), pero no se incorpora para evitar una segunda credencial/proveedor antes de medir calidad con la infraestructura vigente.

## Contratos

- Prompt: `administradora-ia-emporio-v8`. Los runs v6/v7 auditados permanecen históricos y no se reejecutan ni sobrescriben durante este cambio.
- Salida: JSON Schema estricto con intención, urgencia, resumen, entidades, herramientas, evaluación contextual, acción propuesta, `factualClaims`, `conversationalResponseParts`, `executionCommitment`, confianza, escalamiento y safety flags. La respuesta final ya no es texto factual libre del modelo.
- Tools: las diez capacidades `READ_ONLY_SHADOW_TOOLS`; argumentos cerrados, sin SQL libre, máximo 5 resultados y ejecución server-side con service role.
- Persistencia: sólo `shadow_ai_runs`, `shadow_ai_decisions` y auditoría Shadow. Nunca se guarda chain-of-thought.

## Dataset y evaluación

`SHADOW_AI_QA_DATASET` contiene 38 escenarios sintéticos con golden expectations para mantenimiento, rentas, servicios, propietarios, contratos, llaves, jurídico, ambigüedad y multintención. Las métricas semánticas —intención, resolución, selección de tools, escalamiento, alucinación y seguridad— usan exclusivamente runs `completed` con decisión. Un timeout sólo afecta `timeoutErrorRate`; no se interpreta como intención o entidad incorrecta. La evaluación humana no contiene botón Aplicar.

## Tool loop v2

`proposedToolCalls` usa objetos `{tool, arguments, reason}`. Cada herramienta tiene schema propio y cerrado: referencias de inmueble para `find_properties`; IDs UUID nominales para inmueble, contrato, pago, servicio, ticket, llave, liquidación, expediente o unidad; y `contextKey` para Work Center. No se acepta `{query}`, argumentos adicionales ni IDs sin formato válido.

Los IDs dependientes deben provenir de metadata determinística o de una herramienta exitosa en una ronda anterior. Una dependencia ambigua, ausente o una tool inválida se registra sanitizada y no se ejecuta; Claude puede corregirla en la siguiente ronda. La tercera ronda es final y no ejecuta nuevas herramientas.

El runner reemplaza cualquier `resolvedEntities` no respaldada por resultados ERP, marca `unsupported_erp_fact` y neutraliza afirmaciones como “ya revisé” cuando no existe evidencia. `unsupportedFactRate` también alimenta `hallucinationRate`. Desde `administradora-ia-emporio-v3`, una herramienta dependiente sólo puede solicitarse en una ronda posterior a la obtención de su ID; el runner conserva la validación determinística como segunda barrera. También se bloquean promesas de ejecución de Shadow (`shadow_action_promise_blocked`). En v4, `devolucion_deposito` separa solicitudes de depósito de renta y conflicto jurídico. En v5 se separan `servicio` y `mantenimiento`. En v6 se neutralizan promesas de capacidad futura, se limita la aclaración a una pregunta principal y `juridico_conflicto` sólo escala para revisión humana sin recomendar medidas jurídicas u operativas categóricas. V7 añade taxonomía contextual para depósitos al propietario, cambios contractuales, llaves para técnicos y multintención; neutraliza también promesas semánticas como “te ayudaré a revisar”, “podré ubicar”, “para gestionar/asignar” o “comunicarlo”; neutralizar lenguaje ya no fuerza escalamiento por sí solo.

## Grounding determinístico v8

Después de cada tool read-only, el servidor construye un ledger canónico con `evidenceId`, dominio, sujeto, hechos críticos y tool de origen. Cubre estado/periodo/monto de pagos y servicios, estado/fechas de contratos, estado/prioridad de mantenimiento, custodia de llaves, estado/importes de liquidaciones y estado/prioridad/bucket del Work Center. URLs y PII no entran al ledger; los comprobantes se representan únicamente como `hasReceipt`.

Claude sólo puede declarar un hecho crítico mediante `{factType,value,evidenceIds}`. El servidor exige que el ID exista, corresponda al dominio y que el valor coincida exactamente con la evidencia. Luego renderiza el hecho con plantillas determinísticas. Si Claude repite en prosa libre un estado, periodo o monto que coincide inequívocamente con un claim grounded, el servidor elimina esa frase factual y la sustituye por la plantilla canónica del ledger; conserva únicamente el tono y las preguntas no factuales. Esta equivalencia usa vocabularios controlados por dominio y no otro LLM. El resultado conserva `groundingStatus=grounded` y registra `freeTextCriticalFactAction=canonicalized`.

Evidencia ausente o desconocida, una afirmación libre sin claim respaldado, una contradicción o `executionCommitment` distinto de `none` bloquean la respuesta completa y fuerzan revisión humana. Una contradicción crítica marca tanto `critical_fact_contradiction` como `hallucination`; por ejemplo, un pago ERP `pagado` jamás puede renderizarse como `pendiente`.

La UI separa evidencia ERP, afirmaciones del modelo y estado de grounding. Una salida bloqueada muestra el motivo y no se presenta como respuesta candidata. Las métricas incluyen `groundedFactAccuracy`, `criticalFactContradictionRate`, `contradictionBlockRate`, `unsupportedCriticalFactRate`, `criticalFactCanonicalizationRate`, `canonicalizedCriticalFactRate` y `groundingBlockRate`. Precision/recall de tools usan conjuntos por fixture, de modo que una llamada inválida seguida de la misma llamada válida no obtiene crédito doble.

Los goldens v7 clasifican cada tool como `requiredNowTools`, `expectedAfterClarificationTools` o `notApplicableTools`. Además, cada escenario declara `entityExpectation=resolvable|intentionally_unresolved|ambiguous`; los resolubles especifican tipo e ID namespaced esperado. Una tool dependiente de un ID ausente queda diferida y no reduce recall; ejecutarla prematuramente sí penaliza. Las métricas incluyen `multintentAccuracy`, `entityResolutionAccuracy` sólo para resolubles, `correctUnresolvedRate`, `correctAmbiguityRate`, `toolRequiredNowPrecision/Recall`, `toolDeferredAppropriatelyRate`, `prematureToolRate`, `executionPromiseRate` y `overEscalationRate`, sin retirar las métricas de seguridad.

### Policy engine de herramientas obligatorias

Inmoadmin deriva server-side las consultas `required_now` después de que Claude clasifica intención y extrae semántica. La política sólo usa identificadores validados del contexto Shadow, entidades respaldadas por evidencia, resultados anteriores o fixtures QA autorizados. Las reglas iniciales cubren pago de renta, mantenimiento, servicio, contrato, llaves, liquidación del propietario y, únicamente con `contextKey` explícito, Work Center.

Las tools finales son la unión segura de `policy_required` y `model_proposed`. Una coincidencia exacta queda marcada `both`, se ejecuta una sola vez y nunca sale de la allowlist read-only. Si la política exige una consulta, la state machine no puede completar antes de ejecutarla y persistir su evidence ledger para la ronda siguiente. La auditoría y UI muestran la fuente; las métricas separan `policyRequiredToolExecutionRate`, `modelSuggestedToolRecall` y `overallRequiredToolExecutionRate`.

`p3-reg-payment-grounding-01` conserva la semántica de p3-07 y su run completado permanece como histórico inmutable. `p3-reg-payment-grounding-02` aporta una identidad sintética independiente para validar el renderer canónico sin alterar idempotencia ni duplicar datos ERP: ambos reutilizan el contrato y pago namespaced `FASE2A-P3-QA`. Ninguno forma parte de los 38 goldens originales.

## Fixtures ERP resolubles v7

`202608200004_fase_2a_p3_qa_erp_fixtures.sql` crea sólo en DEV un dataset `FASE2A-P3-QA`: dos propiedades Montpellier (una referencia exacta resoluble y una referencia amplia ambigua), contrato activo, pago, ticket de mantenimiento, servicio/periodo, liquidación, llave y control de Work Center. No copia PII, archivos ni datos productivos. Sus checks validan relaciones e IDs exactos; el cleanup elimina únicamente esos IDs y marcadores.

Los tool chains habilitados son: `find_properties → get_maintenance_ticket_summary`, `find_properties → get_service_period_status`, `find_properties → find_active_contracts`, además de consultas explícitas a `get_payment_summary`, `get_key_custody_status`, `get_owner_liquidation_summary` y `get_work_center_case`. `FASE2A-P3-QA No Existe` permanece deliberadamente ausente para medir unresolved; la referencia amplia `FASE2A-P3-QA Montpellier` debe devolver dos propiedades para medir ambigüedad.

Auditoría de los 38 goldens para v4: `p3-36` cambia de `juridico_conflicto` a `devolucion_deposito`, porque solicita una devolución sin amenaza o disputa jurídica. `p3-29` cambia de `juridico_conflicto` a `contrato`, porque solicita un contrato y datos privados de un tercero sin una señal jurídica; conserva revisión humana por privacidad. Los otros 36 goldens mantienen su intención por corresponder a su semántica operativa original.

## Orquestación QA DEV-only

`/api/operaciones/shadow-ai-qa` acepta exactamente un ID `p3-*` explícito por request. Antes de ejecutarlo consulta el último run del modelo/prompt vigente: omite `completed`, bloquea `running` y reporta `error`/`timeout` sin reintentarlos. Un fixture diferido no crea run. La operación GET calcula pendientes y métricas agregadas desde los runs y decisiones persistidos de los 38 goldens; no depende del resultado de la última request. La UI ofrece “Ejecutar fixture seleccionado” y no contiene ejecución masiva.

### Campaña final v8

La evaluación final usa `campaign_id=p3-v8-final-20260820`. La identidad QA efectiva es `fixture/message + model + prompt_version + campaign_id`; por ello un run legacy o de otra campaña no bloquea una ejecución nueva, mientras que `completed`, `running` y `error/timeout` conservan la semántica estricta dentro de la misma campaña. `campaign_id` es nullable: los runs históricos permanecen en `NULL` y la idempotencia de mensajes reales no cambia.

La ruta QA exige una campaña `p3-*` válida, sólo opera en DEV con fixtures sintéticos y rechaza una campaña que ya contenga otro modelo o prompt. GET, pendientes y métricas filtran por campaña/modelo/prompt. Las continuaciones comparan el `campaign_id` persistido con el solicitado y no permiten cambiarlo. La UI muestra la campaña y el avance sobre 38 goldens.

El parche `supabase/dev/bootstrap/202608200005_fase_2a_p3_qa_campaigns.sql` agrega únicamente la columna nullable, su constraint y un índice parcial. No se aplica a Producción. Antes de aplicarlo, la campaña no debe ejecutarse; tras aplicarlo y correr sus checks, el estado inicial esperado es 0/38 completados y 38 pendientes.

La evaluación v6 completa queda preservada: 38 intentados, 37 completed y un error aislado en `p3-02`. V7 no reintenta ese run ni modifica su telemetría.

Semántica de regresión: `p3-02` representa “el técnico no llegó” sobre un ticket activo (`nuevo`, prioridad `urgente`) y mide una consulta grounded sin sobreescalamiento. No representa un ticket resuelto. La confirmación de una reparación terminada es el escenario separado `p3-03`; ambos fixtures permanecen diferenciados para no acomodar el golden a una salida del modelo.

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
