# Contrato de referencias para Historical Replay reducido

Fecha: 2026-09-26. Rama: `codex/historical-replay-reference-contract`.
Base: `d2747e984af8bfaf9ed1e73b24901861f616d48d`.

## Alcance

La guía original describe los argumentos internos como UUID/string y objetos.
El transporte reducido recibe aliases efímeros y devuelve `arguments: [{key,value}]`.
Se añade un contrato estático que explica esa diferencia, sin cambiar el decoder,
la resolución de referencias, tipos, schema, tools, grounding ni decisiones 3A/3B.
No se afirma que el modelo vaya a obedecer siempre: los rechazos existentes siguen
siendo obligatorios. La certificación es local y sintética, no otro intento real.

## Selección y privacidad

- `historicalReplayToolGuide.js` conserva la guía original íntegra y añade el
  texto exacto exportado como `REDUCED_REPLAY_REFERENCE_CONTRACT`.
- Sólo `invokeHistoricalReplayReducedPhase3A` selecciona esa guía, después de
  validar la capacidad efímera existente y el caso de Replay. No hay nueva flag,
  opción HTTP ni selección desde metadata. Una guía suministrada por el caller
  no reemplaza este contrato fijo en la ruta reducida.
- El gateway normal, runner y state machine conservan sus guías originales.
  Las pruebas arquitectónicas restringen dónde puede utilizarse el contrato.
- `finalModelPrivacy.js` únicamente importa la nueva constante y registra la
  combinación estática exacta de system prompt + guía en `STATIC_SYSTEMS`.
  No cambia ningún algoritmo de verificación, aliasing o decodificación.
  Prompts modificados y datos con UUID, teléfono, email o secret siguen rechazados.
- Ambos verificadores previos a cada fetch, máximo de rondas, herramientas
  read-only y rechazo de referencias no emitidas permanecen intactos.

## Evidencia local

| Comprobación | Resultado |
| --- | --- |
| Archivo dirigido de Replay reducido | 32/32 PASS; 11 pruebas nuevas |
| Dirigidas ampliadas | 637/637 PASS, cero omitidas |
| Suite completa | 1,374/1,374 PASS, cero omitidas |
| Build | PASS, exit 0, 75/75 páginas |
| `git diff --check` | PASS |
| Contrato visible | Replay reducido recibe guía específica; general conserva `SHADOW_AI_TOOL_GUIDE` |
| Referencia válida copiada literalmente | Alias de metadata → decoder existente → ID interno correcto → SELECT de tool real sobre base en memoria |
| Dos rondas con evidencia | Aliases renovados; receipts PASS por ronda; resultado completo igual al contrato anterior |
| UUID/ID directo, alias inventado, tipo incorrecto o de otra ronda | Rechazo; sin tool adicional, fallback ni retry |
| Referencia vacía/null/descriptiva | Rechazo; no se sustituye por una identidad inventada |
| Sin referencia disponible | `proposedToolCalls: []` completa; resultado sintético 3A/3B idéntico |
| Literales | `domain`, `status`, `sourceType`, `serviceType`, `period` conservan valores; `sourceId` sigue tipado |
| Verificación final de privacidad | Prompt estático exacto aceptado; adiciones sensibles siguen bloqueadas |

Las respuestas de fetch/modelo y datos son sintéticos. La tool y el decoder
ejercitados son los existentes; la base es en memoria. Ninguna llamada a
Anthropic, Respond, Supabase ni Historical Replay productivo. No intento 3,
caso bancario, SQL, gates, cambios de configuración, publicación o deployment.

Node v24.19.0; entorno de pruebas `env -i`. Dependencias existentes reutilizadas
mediante enlaces locales temporales, sin cambios a package.json/lockfile. Una
primera tanda dirigida no pudo importar Supabase por enlaces locales rotos;
tras corregir únicamente los enlaces temporales se obtuvieron los PASS indicados.
El primer arranque de Next no produjo salida y se detuvo. Otro build compiló,
pero falló en prerender por cargar React y ReactDOM desde instalaciones diferentes
(`useContext`/`useState` sobre dispatcher nulo). Se unificaron los enlaces de las
dependencias existentes en una sola instalación: Next 14.1.0, React/ReactDOM
18.3.1, Supabase JS 2.116.0. Se repitieron dirigidas, suite y build con ese mismo
entorno, con los resultados finales de la tabla. Ningún ajuste al código de
producto, configuración de Next o manifiesto de dependencias para resolverlo.
El build final conserva avisos de descarga de Google Fonts no disponible en este
entorno; omite esa optimización y termina correctamente. Los enlaces temporales
de dependencias se retiran al finalizar; no forman parte del diff.

## Comandos

```sh
node --test tests/shadowHistoricalReplayReducedSchema.test.mjs
node --test tests/shadowOutputPrivacyDiagnostics.test.mjs \
  tests/shadowReducedOutputSchema.test.mjs tests/shadowProviderHttpDiagnostics.test.mjs \
  tests/shadowModelPrivacyTelemetry.test.mjs tests/shadowFinalModelPrivacy.test.mjs \
  tests/shadowPhase3AGateway.test.mjs tests/shadowAi*.test.mjs \
  tests/shadowHistoricalReplay*.test.mjs tests/shadowConversationActions3B.test.mjs \
  tests/condominiumCanonicalIdentity.test.mjs tests/preModelSanitizer.test.mjs
node --test tests/*.test.mjs
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-build-only \
  SUPABASE_SERVICE_ROLE_KEY=synthetic-build-only node node_modules/next/dist/bin/next build
git diff --check
```

## Archivos

1. `lib/shadow/ai/historicalReplayToolGuide.js`: contrato estático exclusivo.
2. `lib/shadow/ai/phase3AGateway.js`: selección en entrada reducida existente.
3. `lib/shadow/ai/finalModelPrivacy.js`: registro exacto del nuevo texto estático.
4. `tests/shadowHistoricalReplayReducedSchema.test.mjs`: regresiones de contrato.
5. Este informe.

Sin cambios en `prompt.js`, `realPrompt.js`, schemas, decoders, tools, 3B,
identidad, SQL, outbound/R1/canary, variables ni `vercel.json`.
