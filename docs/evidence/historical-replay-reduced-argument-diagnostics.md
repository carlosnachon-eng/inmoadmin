# Diagnóstico estructural seguro de argumentos de Replay reducido

Rama: `codex/historical-replay-reduced-argument-diagnostics`.
Base: `e3856abee674b798463cd828c238d94f4041993e` (`main`).
Certificación exclusivamente local con fixtures y transporte sintéticos.

## Alcance

Se conserva exactamente el rechazo
`invalid_structured_output:reduced_arguments_key_not_allowed_for_tool`
(en `error_code`: `invalid_structured_output_reduced_arguments_key_not_allowed_for_tool`).
La condición por tool, su orden, `argumentKeys()` y el schema wire no cambian.
La instrumentación del punto de rechazo recibe sólo `call.tool` y `pair.key`;
no recibe `pair.value` ni el objeto de argumentos. No se alteran aliases,
decodificación de referencias, guards, tools, 3A/3B, grounding ni prompts.

`structuredOutputDiagnostics.js` registra en un WeakMap una proyección segura
asociada a la excepción, sin añadir campos arbitrarios al error. Sólo admite:

- `outputStage=structured_validation` y el código exacto del rechazo;
- tool de `READ_ONLY_SHADOW_TOOLS`;
- key del vocabulario global de `SHADOW_TOOL_ARGUMENT_SCHEMAS`, que no pertenece
  a las propiedades de esa tool.

Ese vocabulario global sirve **sólo para diagnóstico**, nunca para aceptar
argumentos. La validación por tool original permanece intacta.
Una key desconocida/no string no produce tool/key adicionales. Un error de
tool desconocida conserva `reduced_arguments_tool` y no genera este diagnóstico.

El flujo es: rechazo existente → telemetría de Replay → `result_safe.outputDiagnostics`
existente → reproyección GET → reproyección independiente UI. No se añade SQL.
Las filas legacy no adquieren campos ni causas inferidas. Las proyecciones no
conservan valores, aliases, IDs, texto del modelo, mapas, paths o argumentos completos.

Ejemplo **sintético**, no diagnóstico atribuido al intento productivo histórico:

```json
{
  "outputStage": "structured_validation",
  "diagnosticCode": "reduced_arguments_key_not_allowed_for_tool",
  "structuredOutput": {
    "tool": "resolve_contact_identity",
    "argument_key": "propertyId"
  }
}
```

Con key desconocida se conserva sólo stage/código, sin `structuredOutput`.

## Evidencia local

- Todas las tools (18): cada key global conocida pero inválida para esa tool
  sigue fallando con el mismo error, ahora con los dos enums seguros.
- Keys desconocidas, objetos, null, números y nombres de prototipo no se reflejan.
- Valores sintéticos con alias/UUID/email/teléfono/cuenta/secret no sobreviven en
  error, diagnóstico, telemetría, persistencia simulada, POST, GET ni JSX renderizado.
- Error forjado sin registro del decoder no puede crear un receipt.
- Un argumento válido con referencia emitida sigue decodificándose al valor
  interno correcto; las regresiones previas mantienen rechazos raw/inventado/tipo/ronda.
- Cuatro recorridos integrados reales del código de endpoint/transporte/decoder,
  con Auth, DB y `fetch` simulados: key conocida/desconocida en ronda 1/ronda 2.
  Ambos verificadores del transporte PASS en cada ronda simulada. Misma
  contabilización de modelo/usage; cero tools de la ronda rechazada, cero 3B,
  sin fallback ni retry, snapshot intacto.
- GET y JSX real reproyectan también datos contaminados; no dependen únicamente
  de la sanitización durante captura. GET no modifica las filas legacy.
- Las pruebas JSX de attempts conservan separados original e intento hijo.

| Validación | Resultado |
| --- | --- |
| Focalizadas (diagnóstico, adaptador, endpoint/GET/UI, attempts) | 181/181 PASS |
| Dirigidas privacidad, Replay, 3A/3B, identidad | 818/818 PASS |
| Suite completa | 1,595/1,595 PASS |
| Build Next.js | PASS, 76/76 páginas |
| `git diff --check` | PASS |

40 pruebas nuevas. Node v24.19.0. Procesos con `env -i`; build con URL loopback
y claves ficticias. Dependencias locales previamente instaladas, sin cambios a
package.json ni instalación de paquetes. Sin Auth/DB/proveedores reales.

Comandos (Node en PATH; ejecutados en entorno limpio):

```sh
node --test --test-reporter=tap tests/shadowStructuredOutputDiagnostics.test.mjs tests/shadowReducedOutputSchema.test.mjs tests/shadowHistoricalReplaySourceResult.test.mjs tests/shadowHistoricalReplayAttempts.test.mjs
node --test --test-reporter=tap tests/preModelSanitizer.test.mjs tests/shadowLabeledIdentifierPrivacy.test.mjs tests/shadowStructuredOutputDiagnostics.test.mjs tests/shadowOutputPrivacyDiagnostics.test.mjs tests/shadowReducedOutputSchema.test.mjs tests/shadowProviderHttpDiagnostics.test.mjs tests/shadowModelPrivacyTelemetry.test.mjs tests/shadowFinalModelPrivacy.test.mjs tests/shadowPhase3AGateway.test.mjs tests/shadowRespondContactReference.test.mjs tests/shadowIdentityReadOnly.test.mjs tests/shadowIdentityBridge.test.mjs tests/shadowAi*.test.mjs tests/shadowHistoricalReplay*.test.mjs tests/shadowConversationActions3B.test.mjs tests/condominiumCanonicalIdentity.test.mjs
node --test --test-reporter=tap tests/*.test.mjs
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-build-only SUPABASE_SERVICE_ROLE_KEY=synthetic-build-only node node_modules/next/dist/bin/next build
git diff --check
```

Sin publicación, Anthropic real, Replay productivo, intento 3, otros casos,
SQL, cambios de gates, outbound, R1 ni canary. Esta evidencia no determina
retroactivamente la tool/key del error productivo anterior.
