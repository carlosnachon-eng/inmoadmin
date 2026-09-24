# Variante local reducida de salida — certificación sin proveedor

Fecha: 2026-09-24. Rama: `codex/shadow-reduced-output-schema-local`.
Base productiva: `2c84d4f4379202bc3f504e2cf91777873621ab87`.

## Dictamen y alcance

GO para revisión del diseño/adaptador local. NO se acredita todavía que Anthropic
compile esta variante ni que elimine el HTTP 400: no hubo llamadas al proveedor.
Los 180.558 s observados son compatibles con la hipótesis de timeout, no una
demostración de su causa. No se reejecutó ningún caso productivo.

Se añaden únicamente:

- `lib/shadow/ai/reducedOutputSchema.js`: constructor de variante, adaptador y métricas puras.
- `tests/shadowReducedOutputSchema.test.mjs`: equivalencia y controles negativos sintéticos.
- Este informe.

Ningún import productivo conecta el adaptador. `schema.js`, `anthropic.js`, gateway,
ejecutores, prompts, tools, decisiones, privacidad, identidad, SQL y configuración
permanecen idénticos a la base. No se publicaron commits, PR ni deployments.

## Diseño elegido

Sólo cambia el formato de `proposedToolCalls[].arguments`: de objeto con 20
propiedades opcionales a una lista cuyos elementos tienen `key` y `value`
obligatorios. `key` es un enum de las mismas 20 claves; `value` es string.
Todos los argumentos de las 18 tools actuales son strings. No se necesita otro
discriminador de valor, coerción, uniones ni JSON embebido dentro del string.

Ejemplo sintético de fragmento de salida, no un payload real:

```json
{
  "tool": "get_service_period_status",
  "arguments": [
    {"key": "propertyId", "value": "ref_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_1"},
    {"key": "serviceType", "value": "agua"},
    {"key": "period", "value": "2026-09"}
  ],
  "reason": "Consultar estado"
}
```

La alternativa discriminada por tool conserva un objeto interno más parecido,
pero necesita ramas por tool y conserva opcionales de sus esquemas. La lista
uniforme evita esas ramas; se prefiere un único adaptador pequeño antes de
conectar con el contrato interno ya existente.

Secuencia del adaptador local:

1. Exigir lista y pares exactos; rechazar duplicados, claves desconocidas o de otra
   tool, valores no string, tools desconocidas y exceso de llamadas/pares.
2. Reconstruir los argumentos con sus nombres, sin descartar valores ni campos
   inesperados y sin alterar sus strings.
3. Ejecutar `validateShadowAiDecision` sin cambios.
4. Ejecutar `decodeModelDecisionReferences` con el resultado ORIGINAL vinculado al
   scope del gateway. Su verificador inspecciona la decisión reconstruida antes
   de resolver: IDs directos, tipos incorrectos y aliases ajenos siguen bloqueados.
5. Ejecutar `validateShadowToolArguments` para todas las llamadas. Conserva
   `required`, `oneOf`, `allowEmpty`, longitud, UUID y normalización existentes.
6. Sólo devolver la decisión interna completa si TODAS las llamadas son válidas.
   El adaptador no ejecuta tools, no llama al modelo y no persiste datos.

La lista vacía sólo es válida para las tools que ya admitían argumentos vacíos.
El orden de pares no afecta a `sourceType/sourceId` ni a otras dependencias.
Las referencias se resuelven exclusivamente server-side; jamás se expanden en
texto libre. La política P2 existente continúa bloqueando aliases en texto.
Si se añade en el futuro un argumento no string, el constructor falla cerrado
en lugar de cambiar implícitamente su tipo.

## Comparación objetiva

Medición sobre JSON compacto UTF-8; profundidad cuenta sólo objetos/arrays,
incluyendo el objeto raíz. No es la profundidad del árbol de palabras clave JSON.

| Métrica | Actual | Variante local |
| --- | ---: | ---: |
| Bytes del schema | 4,355 | 4,106 |
| Nodos de schema | 61 | 44 |
| Propiedades | 51 | 33 |
| Propiedades opcionales | 20 | 0 |
| Parámetros con unión | 5 | 5 |
| Alternativas de tipo en esas uniones | 11 | 11 |
| Ramas `anyOf/oneOf/allOf` | 0 | 0 |
| Objetos | 6 | 6 |
| Arrays | 9 | 10 |
| Valores de enum acumulados | 76 | 96 |
| Profundidad de contenedores | 4 | 5 |
| Combinaciones de presencia de opcionales (`2^n`) | 1,048,576 | 1 |

Bytes: −249 (−5.72%). Nodos: −17 (−27.87%). Opcionales: −100%.
Hay un tradeoff explícito: +1 nivel de array y +20 valores de enum. No todas las
métricas disminuyen. El beneficio buscado es eliminar la expansión combinatoria
por presencia/ausencia de los 20 argumentos, no reducir drásticamente los bytes.

`2^n` es exclusivamente un proxy de subconjuntos opcionales, NO un conteo de
estados del compilador. No cuenta longitudes/repeticiones de arrays, enums,
permutaciones ni optimizaciones internas. El número real de estados y la latencia
de compilación no son medibles con este paquete local.

La documentación oficial consultada indica límites de 24 opcionales, 16
parámetros con unión y 20 tools estrictas por petición. La variante queda en
0/24, 5/16 y 0/20: las 18 tools de Shadow siguen siendo valores del enum de una
decisión, no definiciones nativas `strict:true`. Anthropic también documenta
límites internos y 180 s de compilación; estar por debajo de los límites explícitos
no garantiza aceptación. [Structured outputs — Anthropic](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#schema-complexity-limits).

## Evidencia local ejecutada

| Comprobación | Resultado |
| --- | --- |
| Pruebas nuevas | 68/68 PASS |
| Dirigidas ampliadas privacidad/gateway/3A/3B/Replay/identidad/diagnóstico | 502/502 PASS |
| Suite completa | 1,207/1,207 PASS; 0 omitidas |
| Build Next.js 14.1.0 | PASS; 75/75 páginas |
| `git diff --check` | PASS |

Las 18 tools se prueban exhaustivamente por subconjunto finito de claves:
132 combinaciones, 73 válidas y 59 inválidas. Cada clave admitida por cada tool
está cubierta al menos en una combinación válida. No es una enumeración de
todos los valores posibles de strings: se añaden pruebas negativas de valores,
longitudes, tipos, claves duplicadas y privacidad.

Resultados específicos:

- Todos los argumentos válidos se reconstruyen exactamente como en el contrato
  interno anterior, incluso invirtiendo el orden de pares.
- Fallan claves desconocidas, de otra tool, repetidas o de prototipo, valores
  null/número/objeto, ausencia de requeridos, `oneOf` contradictorio y exceso de
  límites. Una llamada posterior inválida impide devolver incluso la primera.
- Fallan UUID directo, ID corto no emitido, alias inventado, tipo equivocado y
  scope de otra ronda. Sin resultado vinculado a scope también falla.
- `contact_identity` y `client_identity` conservan su equivalencia estrecha;
  `respond_contact`, propiedades y demás tipos no se confunden.
- PII sintética y aliases en summary, contexto, acción, escalamiento y partes de
  respuesta continúan bloqueados. Nunca se reemplazan por IDs en texto libre.
- Gateway real + modelCall simulado devuelve pares; el adaptador entrega al código
  real de una tool read-only el ID interno correcto. DB completamente simulada y
  sin métodos de escritura; ninguna consulta externa.
- `serializeVerifiedAnthropicBody` real verifica objeto y string exacto con el
  schema reducido y aliases sintéticos: ambos PASS, sin UUID en la serialización.
  No se hace fetch en esa prueba. Añadir un ID después del gateway sigue bloqueado.
- Finalización, grounding, resolución y 3B coinciden antes/después. Se conserva
  tanto una respuesta sintética previamente elegible como su variante bloqueada.
  Dominios fuera de 3B conservan el rechazo de su validador: no se amplía el enum.
- Prueba arquitectónica: ningún módulo de producción importa esta variante.
  La suite existente de Historical Replay sigue pasando con su schema actual;
  eso NO significa haber ejecutado Replay con el schema nuevo.

En la primera ejecución de las pruebas nuevas, dos fixtures invocaban directamente
3B con dominios fuera de su enum. Se corrigió únicamente el test para acreditar
el mismo rechazo previo y posterior. No se modificó código funcional para obtener PASS.

Se reutilizaron dependencias ya instaladas mediante symlink temporal; sin cambios
de manifiesto ni lockfile. Tests/build se ejecutaron con entorno de proceso limpio.
El build usó URL loopback y claves ficticias, telemetría Next apagada y capacidades
OFF sólo en ese proceso. No se leyeron credenciales productivas. El warning de
Node sobre módulos sin `type` explícito permanece sin tocar `package.json`.

Comandos reproducibles (Node en PATH):

```sh
node --test tests/shadowReducedOutputSchema.test.mjs
node --test tests/shadowReducedOutputSchema.test.mjs tests/shadowProviderHttpDiagnostics.test.mjs tests/shadowModelPrivacyTelemetry.test.mjs tests/shadowFinalModelPrivacy.test.mjs tests/shadowPhase3AGateway.test.mjs tests/shadowAi*.test.mjs tests/shadowHistoricalReplay*.test.mjs tests/shadowConversationActions3B.test.mjs tests/condominiumCanonicalIdentity.test.mjs tests/preModelSanitizer.test.mjs
node --test tests/*.test.mjs
node node_modules/next/dist/bin/next build
git diff --check
```

## Compatibilidad y eventual integración (no implementada)

El wire format NO es intercambiable con el anterior sin adaptador: un consumidor
antiguo rechaza `arguments` como array. El contrato interno, valores, validaciones
y persistencia siguen siendo los mismos objetos de argumentos. No hace falta
migración ni backfill; no se debe persistir la representación wire con aliases.

Para conectarlo posteriormente sería necesario seleccionar explícitamente esta
variante en `anthropic.js` y centralizar en el gateway la elección del decodificador
para `runner.js`, `stateMachine.js` e `historicalReplay.js`, conservando el scope y
evitando doble desaliasado. `text_json_local`/resultados anteriores deben seguir
usando su contrato, sin fallback heurístico ni reintento del proveedor.
Las pruebas de esos puntos de integración también requerirían ampliación.
No se necesitan cambios en SQL, tools, identidad, políticas o decisiones.

Los ejemplos de argumentos del tool guide actual describen objetos y UUID. Se
mantienen intactos en esta entrega. La gramática nueva exige pares, pero sin una
evaluación del proveedor no está acreditado el efecto de esa diferencia sobre
la selección de tools, generación, tokens o calidad. Tampoco se modifica
`max_tokens`, modelo ni output mode. La lista agrega tokens por argumento aunque
el schema sea menor; no se atribuye mejora de latencia/costo sin medición.

Conservar el verificador exacto previo a fetch y el tipado de aliases es requisito
para cualquier conexión futura. Esta entrega termina en revisión local: sin
publicación, Anthropic, Replay productivo, SQL ni modificaciones de gates.
