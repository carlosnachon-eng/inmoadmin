# Disponibilidad de referencia Respond antes de 3A

Rama: `codex/shadow-respond-contact-reference`.
Base: `9b7a0dae5d90449843c89149536f86e4455f9776` (`origin/main`).
Certificación exclusivamente local, con datos sintéticos.

## Cambio funcional mínimo

Se añade solamente `respondContactId` a `METADATA_REFERENCE_KEYS` en
`phase3AGateway.js`. El recorrido existente llama a
`scope.reference(metadata.respondContactId, modelReferenceType(...))`, con tipo
`respond_contact`. No cambia el formato aleatorio de aliases, su mapa en memoria,
el decoder, resolución/compatibilidad de tipos, guards ni verificador.

El contexto y la serialización exacta del transporte contienen únicamente el
alias. Ejemplo **inventado**, no alias capturado ni reutilizable:

```json
{
  "message": "¿Cómo va el mantenimiento?",
  "metadata": {
    "respondContactId": "ref_abcdefghijklmnopqrstuvwxyzabcdef_1"
  }
}
```

Replay reducido puede copiar ese valor en el par `{key,value}` existente. El
decoder lo reconstruye al valor original únicamente server-side antes de la
tool. General Shadow recibe también la referencia, pero conserva su schema,
guía y decoder originales. No se cambia ninguna decisión 3A/3B.

Sin contacto (ausente/null/vacío) no se emite alias ni se fuerza una tool.
IDs directos, UUID, aliases inventados, de otro tipo o de otra ronda siguen
rechazados. La pre-carga condominal sigue recibiendo el contacto original:
no cambia su resultado, no duplica filas y reutiliza el mismo alias en metadata
y argumentos de la pre-carga dentro de cada ronda; una ronda nueva emite otro.

## Reproducción y pruebas

Antes de modificar el allowlist, la nueva batería de 20 pruebas obtuvo
11 PASS / 9 FAIL: metadata no contenía la referencia y el recorrido reducido
no podía copiarla. Después: 20/20 PASS. Se añadieron otras dos regresiones
integradas de endpoint/resultados/GET/JSX para éxito y rechazo de referencia raw.

Cobertura:

- IDs sintéticos numéricos, UUID y opacos → alias tipado, nunca valor raw.
- Captura del body real construido para `fetch` **simulado**: ambos receipts
  PASS, schemas/guías de Replay y Shadow sin cambios, cero ID de contacto.
- Decoder real y ejecución sintética de la tool reciben el ID correcto en
  servidor; segunda ronda conserva las mismas guardas y cambia el alias.
- Rechazos raw/UUID, alias inventado, tipo erróneo y ronda ajena en ambos flujos.
- Éxito y error → endpoint real con Auth/DB simulados → `result_safe`/POST/GET
  → sección JSX real renderizada con React/SWC. No se filtra el ID ni el alias
  en resultados nuevos, escrituras simuladas de resultado, telemetría, error o UI.
- El snapshot server-side preexistente conserva byte-for-byte su metadata; no
  se rediseña ni se afirma haber eliminado IDs de snapshots históricos en GET.
- Pre-carga condominal real contra tablas en memoria: identidad/unidad/roles
  iguales, sin datos sensibles duplicados en el contexto del modelo.

Resultados finales:

| Comprobación | Resultado |
| --- | --- |
| Focalizadas (referencia + endpoint/GET/UI) | 59/59 PASS |
| Dirigidas privacidad, Replay, 3A/3B, identidad | 741/741 PASS |
| Suite completa | 1,537/1,537 PASS |
| Build Next.js | PASS, 76/76 páginas |
| `git diff --check` | PASS |

Node v24.19.0. Pruebas y build con `env -i`, dependencias previamente instaladas,
URL Supabase loopback y claves ficticias para build. No servidor DEV ni acceso
a Supabase, Respond o Anthropic reales. No cambios en dependencias/lockfiles.

Comandos reproducibles:

```sh
node --test --test-reporter=tap tests/shadowRespondContactReference.test.mjs tests/shadowHistoricalReplaySourceResult.test.mjs
node --test --test-reporter=tap tests/preModelSanitizer.test.mjs tests/shadowLabeledIdentifierPrivacy.test.mjs tests/shadowOutputPrivacyDiagnostics.test.mjs tests/shadowReducedOutputSchema.test.mjs tests/shadowProviderHttpDiagnostics.test.mjs tests/shadowModelPrivacyTelemetry.test.mjs tests/shadowFinalModelPrivacy.test.mjs tests/shadowPhase3AGateway.test.mjs tests/shadowRespondContactReference.test.mjs tests/shadowAi*.test.mjs tests/shadowHistoricalReplay*.test.mjs tests/shadowConversationActions3B.test.mjs tests/condominiumCanonicalIdentity.test.mjs
node --test --test-reporter=tap tests/*.test.mjs
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-build-only SUPABASE_SERVICE_ROLE_KEY=synthetic-build-only node node_modules/next/dist/bin/next build
git diff --check
```

## Límite preexistente observado, sin corregir fuera de alcance

`shadowContextTools.resolve_contact_identity` en `lib/shadow/context.js` llama
a `resolveConfirmedContactIdentity(db, respondContactId)` sin `{audit:false}`.
En `lib/shadow/identityBridge.js` ese resolver tiene `audit=true` por defecto y
sus rutas no condominales pueden insertar en `respond_identity_audit`.
Historical Replay usa por defecto `executeShadowReadOnlyTool`, que conserva
ese recorrido. El nombre/read-only allowlist de la tool no demuestra ausencia
de escrituras de auditoría. No se cambió ese comportamiento ni se ejecutó contra
una base real. El encadenamiento probado utiliza un callback de tool sintético;
esta certificación no acredita que una ejecución real de esa tool sea read-only.

Sin publicación, PR, deployment, Replay productivo, intento 6, caso bancario,
llamadas reales al modelo, SQL ni cambios de gates.
