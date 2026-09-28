# Historical Replay — diagnóstico seguro de argumentos de referencia

## Alcance

Rama: `codex/historical-replay-tool-reference-diagnostics`.
Base: `6a287d7993cc1c60af6fbbf962015a84160f5125` (`origin/main` leído al iniciar).
Sólo implementación/certificación local. Sin publicación, proveedor real, Replay
productivo, intento 5, caso bancario, SQL, deployment ni cambios de gates.

El intento productivo anterior no permite recuperar retrospectivamente la tool
o key rechazada; no se reejecutó y no se atribuye una causa nueva a esa fila.

## Captura y proyección

- En `decodeReferences`, únicamente cuando falla la resolución de un argumento,
  se amplía el diagnóstico del mismo error con `call.tool`, `key` y el `type`
  ya obtenido de `modelReferenceType(key, call.arguments, call.tool)`.
- No se pasa `value` al registrador. No se consulta el mapa, tipo real ni ID
  resuelto. Se relanza el mismo error, con el mismo código, razón y etapa.
  `scope.resolve`, compatibilidad de tipos, aliasing y orden de guardas no cambian.
- El WeakMap existente recibe sólo la proyección segura. La tool debe pertenecer
  a `READ_ONLY_SHADOW_TOOLS`; la key debe ser propia de `properties` en
  `SHADOW_TOOL_ARGUMENT_SCHEMAS` de esa tool, no sólo de cualquier otra tool.
- El tipo esperado procede del resultado real de `modelReferenceType`; además
  se filtra con un vocabulario diagnóstico fijo. Tipos dinámicos `source:*`
  se omiten porque su sufijo puede contener texto del modelo. No se normalizan,
  sustituyen ni adivinan. En ese caso se conservan únicamente tool/key válidas.
- Los campos nuevos se permiten sólo en `output_reference_decode`, ubicación
  `tool_argument`, razones `unissued_or_raw_model_reference` o
  `model_reference_type_mismatch`. Otras ubicaciones/etapas no los reciben.
- Se reutiliza sin cambios el recorrido Replay → endpoint → `result_safe` →
  POST/GET. El endpoint ya reproyecta antes de persistir y devolver; la UI vuelve
  a aplicar la misma proyección antes de mostrar los tres campos opcionales.
- Filas legacy no adquieren estos campos. Valores, aliases, tipos internos,
  paths dinámicos, cuerpos y texto libre se descartan. Un UUID/alias inventado
  rechazado por el verificador previo conserva ese rechazo anterior: no se
  cambia el orden para fabricar metadatos del decoder.

Ejemplo **sintético**, no diagnóstico del intento productivo 4:

```json
{
  "outputStage": "output_reference_decode",
  "outputPrivacy": {
    "reason": "unissued_or_raw_model_reference",
    "location": "tool_argument",
    "tool": "find_active_contracts",
    "argument_key": "contractId",
    "expected_reference_type": "contract"
  },
  "diagnosticCode": "pre_model_sanitization_blocked",
  "truncatedFields": []
}
```

## Certificación local

37 pruebas nuevas; 29 combinaciones tool/key de referencia fija verificadas
contra `modelReferenceType`. Se cubren referencias vacías/no emitidas, mismatch,
UUID/raw y aliases inventados/de otra ronda rechazados antes del decode,
contaminación de campos y legacy. Se mantienen las regresiones de éxito y de
los demás bloqueos. El transporte y decoder reales reciben respuestas sintéticas;
Auth, almacenamiento y `fetch` son dobles locales, nunca acceso productivo.

En la prueba integrada: respuesta reducida sintética → fallo de decode → HTTP
422 → almacenamiento simulado → GET y JSX real renderizado con React/SWC.
Mismo `error_code`, receipts PASS y usage conservados, una sola llamada simulada,
cero tools ejecutadas y ninguna resolución 3B persistida. El resultado no
contiene valores, aliases, UUIDs ni texto del modelo. GET legacy no escribe nada.

Resultados:

- Focalizadas (diagnóstico + endpoint/GET/UI): **131/131 PASS**.
- Dirigidas de privacidad, 3A/3B, Replay, schema y regresiones: **719/719 PASS**.
- Suite completa: **1,515/1,515 PASS**, sin omitidas ni canceladas.
- Build Next.js: **PASS**, 76/76 páginas.
- `git diff --check`: **PASS**.

Node v24.19.0, entorno `env -i`. Build con URL loopback y claves ficticias;
sin credenciales productivas ni archivo `.env` local. Se reutilizaron dependencias
ya instaladas, sin cambiar manifiestos/lockfiles. El primer lanzamiento focalizado
no pudo cargar Supabase por un enlace local obsoleto; se corrigió exclusivamente
el enlace temporal y se ejecutaron después todas las certificaciones anteriores.

Comandos (Node del runtime local):

```sh
node --test tests/shadowOutputPrivacyDiagnostics.test.mjs tests/shadowHistoricalReplaySourceResult.test.mjs
node --test --test-reporter=tap tests/preModelSanitizer.test.mjs \
  tests/shadowLabeledIdentifierPrivacy.test.mjs tests/shadowOutputPrivacyDiagnostics.test.mjs \
  tests/shadowReducedOutputSchema.test.mjs tests/shadowProviderHttpDiagnostics.test.mjs \
  tests/shadowModelPrivacyTelemetry.test.mjs tests/shadowFinalModelPrivacy.test.mjs \
  tests/shadowPhase3AGateway.test.mjs tests/shadowAi*.test.mjs \
  tests/shadowHistoricalReplay*.test.mjs tests/shadowConversationActions3B.test.mjs \
  tests/condominiumCanonicalIdentity.test.mjs
node --test --test-reporter=tap tests/*.test.mjs
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-build-only \
  SUPABASE_SERVICE_ROLE_KEY=synthetic-build-only node node_modules/next/dist/bin/next build
git diff --check
```

Sin cambios en prompts, schemas, contrato de referencias, tools, políticas,
grounding, 3A/3B, identidad, SQL, transporte, gates ni Vercel.
