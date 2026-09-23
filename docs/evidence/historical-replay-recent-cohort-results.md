# Historical Replay — recencia, contexto y resultado real de 3B

Certificación exclusivamente local. Rama: `codex/historical-replay-recent-cohort-results`.
Base de main: `6b092a263d00316570767b74ee0bbf009dee5c42` (PR #135 cerrado).

## Alcance

- Se modifica la carga/selección reciente y la conservación/publicación de cuatro campos de 3B.
- No se modifica `executeHistoricalReplayCase`, `domainFor`, los gates de aislamiento,
  el constructor de turnos, la elegibilidad QA, prompts, gateway, identidad, tools,
  decisiones 3A/3B, guardas, thresholds, outbound, R1 ni canary.
- Cero migraciones, cambios de configuración, llamadas reales a proveedores,
  cohortes productivas, SQL, escrituras remotas o envíos. No push/deployment.
- Supabase/Auth/almacenamiento y proveedor del modelo son dobles sintéticos en
  las pruebas nuevas. Se ejecutan las funciones reales de selección, endpoint,
  gateway/3B y el JSX de la sección. Esto no constituye una ejecución productiva.

## Carga acotada con contexto

1. Seleccionar las 24 conversaciones más recientes de `respond_admin` / `544519`
   con actividad en los últimos 14 días, hasta el instante del preview.
2. Leer su historial cronológico anterior completo hasta ese instante, con orden
   estable `occurred_at, id`, páginas de 250 y tope de 2,000 mensajes por conversación.
   No se aplica el cutoff reciente al historial de contexto.
3. Leer las interpretaciones completadas pertinentes a sus adjuntos, por lotes
   de hasta 100 referencias y con tope de 500 interpretaciones por conversación.
4. Construir los turnos con las funciones existentes sin alterarlas; seleccionar
   sólo turnos de la ventana reciente, por recencia y luego los topes existentes
   de 10 por dominio / 30 total.

Una conversación que exceda el tope de mensajes o interpretaciones se excluye
completa con `context_read_limit` / `media_context_read_limit`, visible en UI.
No se evalúa con historial recortado. Por tanto es una muestra acotada, no un
censo; conversaciones individuales con más de 2,000 mensajes quedan excluidas.
También se muestra si se alcanzó el tope de conversaciones recientes.

Lectura máxima de filas: 25 conversaciones (incluye sonda) +
24 × (2,001 mensajes + 501 interpretaciones) = 60,073 filas, sin escanear el
historial global desde el cliente. Son máximos de filas retornadas, no una
medición del trabajo interno del motor de base de datos. Los límites/paginación
se basan en el contrato de rangos inclusivos y orden estable de Supabase.

Preview entrega `sourceSnapshot` (instante + SHA-256 del universo/contexto).
Prepare reconstruye ese mismo universo y reloj, comprueba el hash y sólo después
filtra las claves seleccionadas. Validez: 15 minutos. Contexto, adjuntos, contacto
o universo cambiados producen 409 antes de crear una cohorte; faltan preview o
selección fuera del universo → 400. No se almacena un snapshot adicional.

## Resultado de 3B

`result.conversationAction` → copia directa de `requires_human`,
`auto_send_eligible`, `blocked_reason`, `conversation_action` →
`result_safe.conversationAction` → respuesta de ejecución / GET / UI.

No se recalculan las decisiones. La valoración `human_auto_send_eligible`
permanece separada. `autoSendEligible` y el alias compatible
`firstOutboundCandidates` cuentan exclusivamente `auto_send_eligible === true`
persistido dentro de `result_safe`. Legacy sin booleanos conserva la acción
histórica pero devuelve booleanos/blocker null y la UI dice «no registrado»;
no se infiere elegibilidad de ask/request ni de la valoración humana.
La API no declara completed si no se pudo guardar el resultado.

## Evidencia ejecutada

| Comprobación | Resultado local |
| --- | --- |
| Tests dirigidos Replay + 3B + gateway | 92/92 PASS |
| Suite completa `node --test tests/*.test.mjs` | 1,031/1,031 PASS; cero omitidos |
| `next build` | PASS; 75 páginas generadas |
| `git diff --check` | PASS |
| Igualdad de código de decisiones/guardas fuera del alcance con main base | PASS |

Dirigidas:

```sh
node --test tests/shadowHistoricalReplay3BEval.test.mjs \
  tests/shadowHistoricalReplaySourceResult.test.mjs \
  tests/shadowConversationActions3B.test.mjs \
  tests/shadowPhase3AGateway.test.mjs
```

- Fixture con 2,501 mensajes de agosto y 260 mensajes previos en una conversación
  reciente: el endpoint preview devuelve turnos de **2026-09-22T12:00:20Z** y
  **2026-09-21T12:00:00Z**, uno de mantenimiento y uno administrativo.
- Preserva los ocho mensajes previos que consume el builder, incluidos los
  anteriores a la ventana reciente; une los dos inbounds del turno y recupera
  su interpretación aunque existan más de 500 interpretaciones no relacionadas.
- La respuesta humana posterior queda como referencia de evaluación, nunca
  dentro del envelope. Se comparan los casos completos con el builder existente.
- QA/Ventas excluidos, cierre y clasificación intactos, 10/10/10 por dominio,
  recencia global conservada. Se prueba paginación con límite de servidor menor
  al solicitado, conversación en el límite y exclusión por exceso.
- Preview/prepare: contexto idéntico; modificaciones del contexto/adjunto/contacto
  y referencias fuera del universo se rechazan sin escrituras del mock.
- Se ejecuta 3B real con respuesta sintética de proveedor y se comprueba igualdad
  de sus cuatro campos con persistencia, respuesta de ejecución y GET. Además,
  3B real produce ejemplos elegible, financiero bloqueado y legal bloqueado que
  conservan exactamente sus valores por todo ese recorrido.
- JSX real: muestra true/false/legacy, distingue revisión humana y transmite el
  fingerprint al preparar. Fallo de persistencia no anuncia completed.

Build sólo con URL/keys ficticias locales, sin credenciales de Producción y con
gates de capacidades OFF. Advertencias no bloqueantes: descarga/optimización de
Google Fonts no disponible bajo la restricción de red. No se cambiaron dependencias.

## Dictamen y límite de evidencia

**GO para revisar la corrección local; no se ejecutó la cohorte.**
La prueba del 21–22 de septiembre es sintética y reproducible, no una consulta
productiva ni prueba de que el bundle desplegado ya cambió. El preview real con
esta versión queda pendiente de publicación/deployment y autorización posterior.
No se propone ningún comportamiento como canary seguro con estos fixtures.
