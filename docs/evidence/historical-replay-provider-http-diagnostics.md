# Historical Replay — diagnóstico HTTP sanitizado del proveedor

Fecha: 2026-09-23. Rama: `codex/historical-replay-provider-http-diagnostics`.
Base: `d6ed04353f851572df795d50368135cc18f05a0d`.
Alcance: implementación y certificación **local**, no publicada ni desplegada.

## Qué cambia

- `providerHttpDiagnostics.js` proyecta `error.providerError` con allowlists
  cerradas de tipos, códigos, parámetros y categorías. No copia el mensaje libre.
  Valores desconocidos quedan `null`; mensaje sin categoría reconocida se omite.
- Sólo admite HTTP entero 400–599. Los caminos de parámetros se normalizan sin
  conservar índices ni nombres arbitrarios de propiedades del JSON Schema.
- El request ID sólo es aceptado con forma `req_` seguida de 16–80 caracteres
  alfanuméricos. Se conserva SHA-256 con namespace `anthropic-request:`; no se
  almacena el ID original ni se calcula un hash del payload o del mensaje.
- El catch de Replay clasifica el error como `provider_http`, conserva la
  proyección en `result_safe.providerHttp` y añade la referencia segura a
  `providerRequestRefs`, incluso cuando no hubo respuesta exitosa del modelo.
- POST/GET exponen el diagnóstico proyectado; GET reaplica la allowlist. La UI
  muestra status, tipo, código, parámetro, categoría y referencia opaca.
- El transporte añade únicamente `reportedModel`, separado del fallback legacy
  `model`. Replay no acredita un modelo desde configuración. El contrato legacy
  para otros consumidores no cambia, ni el body, fetch, schema o decisión.

Los tipos admitidos se contrastaron con la
[documentación oficial de errores de Anthropic](https://platform.claude.com/docs/en/api/errors).
Esto **no** identifica retrospectivamente la causa específica del HTTP 400 del
caso `ebce55649f917ad1`: aquella respuesta detallada no fue persistida y el caso
no se consultó ni se reejecutó durante este trabajo.

## Uso desconocido y compatibilidad sin SQL

La migración existente `202608280001_fase_3b_eval_historical_replay.sql` define
`input_tokens`, `output_tokens` y `estimated_cost_usd` como NOT NULL con default
0. No se modifica ni se añade ninguna migración.

La evidencia autoritativa nueva es `result_safe.providerUsage`:

- usage ausente o inválido → tokens/costo `null`, `usage_status=unknown`;
- usage explícito 0/0 → cero real, `usage_status=reported`;
- fallo HTTP en segunda ronda → total desconocido, no el subtotal de la primera;
- modelo no recibido → `providerModels=[]`, `providerModelStatus=unaccredited`;
- primera ronda con modelo y siguiente HTTP error → modelo observado conservado,
  pero `providerModelStatus=partial`, sin acreditar el modelo de la ronda fallida.

En persistencia se omiten las columnas numéricas cuando son desconocidas; sus
defaults legacy pueden seguir siendo 0 en SQL, **no son evidencia de uso cero**.
GET sobrepone los valores acreditados de `result_safe` y la UI muestra
«desconocido». Los HTTP errors legacy sin evidencia se exponen como desconocidos,
sin UPDATE ni backfill. Consumidores directos de SQL deben leer `providerUsage`,
no interpretar las columnas legacy como una medición acreditada.

## Ejemplo exclusivamente sintético

```json
{
  "outputDiagnostics": {
    "outputStage": "provider_http",
    "diagnosticCode": "model_http_400",
    "truncatedFields": []
  },
  "providerHttp": {
    "provider_http_status": 400,
    "provider_error_type": "invalid_request_error",
    "provider_error_code": "invalid_json_schema",
    "provider_error_param": "output_config.format.schema",
    "provider_request_ref": "f73452fff0f983db737a69df7891aa932fb3d858eb001c4a1d06c62f6f89cf92",
    "provider_error_message_safe": "invalid_json_schema"
  },
  "providerRequestRefs": ["f73452fff0f983db737a69df7891aa932fb3d858eb001c4a1d06c62f6f89cf92"],
  "providerModels": [],
  "providerModelStatus": "unaccredited",
  "providerUsage": {
    "input_tokens": null,
    "output_tokens": null,
    "usage_status": "unknown",
    "estimated_cost_usd": null
  },
  "privacy_checks": [{
    "final_payload_verified": true,
    "serialized_body_verified": true,
    "output_mode": "anthropic_json_schema",
    "privacy_stage": "final_model_privacy",
    "provider_invoked": true
  }]
}
```

El ejemplo no es el receipt productivo del caso de referencia. Las categorías
son etiquetas diagnósticas conservadoras, no texto del proveedor ni una promesa
de reconocer todos los futuros errores. Códigos/parámetros desconocidos no se
publican por conveniencia. No se guardan headers completos, bodies, payloads,
aliases, PII ni secrets en estos nuevos diagnósticos.

## Pruebas y límites de la evidencia

| Validación local | Resultado |
| --- | --- |
| Dirigidas privacidad/gateway/3A/3B/Replay/identidad/sanitizador/diagnóstico HTTP | 422/422 PASS |
| Suite completa | 1,121/1,121 PASS; cero omitidas |
| Next.js build | PASS; 75/75 páginas |
| `git diff --check` | PASS |

11 pruebas nuevas y ampliación del render JSX existente:

- HTTP 400 sintético con UUID, alias, teléfono, email, CLABE, secret, nombre y
  domicilio en el mensaje: sólo sobrevive la proyección allowlisted.
- Contaminación de todos los campos: ningún texto no allowlisted sobrevive.
- Request ID del body/header: referencia opaca conservada, original ausente.
- Respuestas HTTP 401/403/429/500/503/529 y body no JSON: `provider_http`;
  sin parsing de decisión, tools, segunda ronda ni retry tras ese error.
- Segundo round fallido: recibos de ambas rondas conservados, total desconocido.
- Usage ausente y cero explícito diferenciados; modelo ausente nunca inferido.
- Flujo real de código gateway/transporte/catch/handler, persistencia simulada,
  GET y render JSX. Sólo escrituras del Replay ya existente en el mock.
- Regresiones completas de privacidad/aliasing/3A/3B: sin cambios funcionales.

Comandos:

```sh
node --test tests/shadowProviderHttpDiagnostics.test.mjs tests/shadowModelPrivacyTelemetry.test.mjs tests/shadowFinalModelPrivacy.test.mjs tests/shadowPhase3AGateway.test.mjs tests/shadowAi*.test.mjs tests/shadowHistoricalReplay*.test.mjs tests/shadowConversationActions3B.test.mjs tests/condominiumCanonicalIdentity.test.mjs tests/preModelSanitizer.test.mjs
node --test tests/*.test.mjs
node node_modules/next/dist/bin/next build
git diff --check
```

Auth, DB y fetch de estas pruebas son **simulados**. No se usaron Supabase DEV
ni Producción ni credenciales reales. Build con entorno aislado, claves/URL
ficticias, gates OFF sólo en ese proceso y dependencias locales reutilizadas,
sin instalar paquetes ni cambiar lockfiles. No se levantó servidor ni monitor.

Sin publicación, merge, deployment, SQL, Replay productivo, invocación real de
Anthropic, cambios de flags o envíos. Prompts, schema, aliasing, decisiones,
tools, identidad y políticas permanecen intactos.

## Archivos

1. `lib/shadow/ai/providerHttpDiagnostics.js`
2. `lib/shadow/ai/anthropic.js`
3. `lib/shadow/ai/historicalReplay.js`
4. `pages/api/operaciones/shadow-historical-replay.js`
5. `pages/coordinador-ia-sombra.js`
6. `tests/shadowProviderHttpDiagnostics.test.mjs`
7. `tests/shadowHistoricalReplaySourceResult.test.mjs`
8. Este informe.
