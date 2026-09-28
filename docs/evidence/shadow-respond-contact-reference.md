# Disponibilidad de referencia Respond antes de 3A

Rama: `codex/shadow-respond-contact-reference`.
Base: `9b7a0dae5d90449843c89149536f86e4455f9776` (`origin/main`).
Certificación exclusivamente local, con datos sintéticos.

## Cambio funcional mínimo

Se añade `respondContactId` a `METADATA_REFERENCE_KEYS` en
`phase3AGateway.js`. El recorrido existente llama a
`scope.reference(metadata.respondContactId, modelReferenceType(...))`, con tipo
`respond_contact`. No cambia el formato aleatorio de aliases, su mapa en memoria,
el decoder, resolución/compatibilidad de tipos, guards ni verificador.

El ajuste P1 posterior se limita a pasar `{ audit: false }` desde
`shadowContextTools.resolve_contact_identity` al resolver existente. Se conserva
el default global `{ audit = true }` y no se modifica el resolver condominal.

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
- Decoder, executor de tools y resolver reales reciben el ID correcto en
  servidor; segunda ronda conserva las mismas guardas y cambia el alias. La
  base y la respuesta del proveedor siguen siendo sintéticas. El test integrado
  de Replay ya no inyecta un callback `executeTool`.
- Rechazos raw/UUID, alias inventado, tipo erróneo y ronda ajena en ambos flujos.
- Éxito y error → endpoint real con Auth/DB simulados → `result_safe`/POST/GET
  → sección JSX real renderizada con React/SWC. No se filtra el ID ni el alias
  en resultados nuevos, escrituras simuladas de resultado, telemetría, error o UI.
- El snapshot server-side preexistente conserva byte-for-byte su metadata; no
  se rediseña ni se afirma haber eliminado IDs de snapshots históricos en GET.
- Pre-carga condominal real contra tablas en memoria: identidad/unidad/roles
  iguales, sin datos sensibles duplicados en el contexto del modelo.

Resultados finales tras el ajuste P1:

| Comprobación | Resultado |
| --- | --- |
| Focalizadas (read-only, referencia, identidad, endpoint/GET/UI) | 119/119 PASS |
| Dirigidas privacidad, Replay, 3A/3B, identidad | 778/778 PASS |
| Suite completa | 1,555/1,555 PASS |
| Build Next.js | PASS, 76/76 páginas |
| `git diff --check` | PASS |

Node v24.19.0. Pruebas y build con `env -i`, dependencias previamente instaladas,
URL Supabase loopback y claves ficticias para build. No servidor DEV ni acceso
a Supabase, Respond o Anthropic reales. No cambios en dependencias/lockfiles.

Comandos reproducibles:

```sh
node --test --test-reporter=tap tests/shadowIdentityReadOnly.test.mjs tests/shadowRespondContactReference.test.mjs tests/shadowIdentityBridge.test.mjs tests/condominiumCanonicalIdentity.test.mjs tests/shadowHistoricalReplaySourceResult.test.mjs
node --test --test-reporter=tap tests/preModelSanitizer.test.mjs tests/shadowLabeledIdentifierPrivacy.test.mjs tests/shadowOutputPrivacyDiagnostics.test.mjs tests/shadowReducedOutputSchema.test.mjs tests/shadowProviderHttpDiagnostics.test.mjs tests/shadowModelPrivacyTelemetry.test.mjs tests/shadowFinalModelPrivacy.test.mjs tests/shadowPhase3AGateway.test.mjs tests/shadowRespondContactReference.test.mjs tests/shadowIdentityReadOnly.test.mjs tests/shadowIdentityBridge.test.mjs tests/shadowAi*.test.mjs tests/shadowHistoricalReplay*.test.mjs tests/shadowConversationActions3B.test.mjs tests/condominiumCanonicalIdentity.test.mjs
node --test --test-reporter=tap tests/*.test.mjs
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-build-only SUPABASE_SERVICE_ROLE_KEY=synthetic-build-only node node_modules/next/dist/bin/next build
git diff --check
```

## P1: cero escrituras durante la tool Shadow

Reproducción antes del cambio del wrapper: las 38 pruebas de identidad read-only
y referencia Respond dieron **32 PASS / 6 FAIL**. Cinco fallos detectaron
`unexpected_mutation:respond_identity_audit:insert` (confirmed, absent, candidate,
revoked, conflict). En el Replay sintético la auditoría hizo fallar la tool y no
hubo fila de identidad para la segunda ronda. No se modificaron las expectativas
para obtener PASS.

Corrección funcional de una línea:

```js
resolveConfirmedContactIdentity(db, respondContactId, { audit: false })
```

La instrumentación local registra cada intento de `insert`, `upsert`, `update`,
`delete` o `rpc` antes de lanzar una excepción, incluso tras encadenar `select`.
El test de la instrumentación demuestra que las seis vías son detectadas. Las
aserciones sobre el registro vacío impiden que un error capturado por Replay
oculte una escritura intentada. No se llama a ningún RPC, ni mutante ni de lectura.

| Ruta real sobre cliente sintético instrumentado | Resultado | Mutaciones intentadas |
| --- | --- | --- |
| Tool Shadow: identidad confirmada con contrato y propiedad | Filas esperadas idénticas, tenant/owner | 0 |
| Tool Shadow: ausente/candidate/revoked | Mismo `insufficient_identity_context` | 0 en cada caso |
| Tool Shadow: vínculos confirmed contradictorios | Mismo `identity_conflict` | 0 |
| Delegación condominal: propietario confirmado y múltiples unidades | Identidad/roles/unidades/ambigüedad iguales | 0 en cada caso |
| Delegación condominal: identidad/unidad/condominio inactivos, vínculo revocado, teléfono cambiado | Mismos reasons fail-closed | 0 en cada caso |
| Pre-carga condominal antes de 3A, general y Replay, dos rondas | Mismo contexto/aliases sin duplicación | 0 |
| Replay reducido → alias → executor por defecto → resolver → segunda ronda/3B | Tool `ok=true`, receipts PASS, auto-send false | 0 |

El resultado completo de `resolveConfirmedContactIdentity(..., {audit:false})`
se compara con el de la llamada sin opciones. Son iguales. Las cinco rutas no
condominales sin opciones conservan **exactamente una inserción de auditoría**
simulada por llamada (`resolved` o `unresolved`); ese comportamiento no-Shadow
no cambió. La delegación condominal ya era exclusivamente SELECT y continúa sin
escrituras tanto con opciones como sin ellas.

Se añadieron 18 pruebas y se reforzaron las pruebas de referencia/pre-carga/Replay
existentes. Raw ID/UUID, alias inventado, tipo incorrecto y ronda ajena siguen
fallando cerrado. `identityBridge.js`, `condominiumIdentity.js`, decoder, aliasing,
schemas, tools disponibles, 3A/3B, grounding y gates no se modificaron por este P1.

Esta evidencia ejecuta el código real de resolución sobre un cliente en memoria;
no constituye una ejecución contra Supabase DEV o Producción. Los resultados
de Replay no se persistieron en ninguna base real y no hubo proveedor real.

Sin publicación, PR, deployment, Replay productivo, intento 6, caso bancario,
llamadas reales al modelo, SQL ni cambios de gates.
