# Historical Replay — comprobantes sanitizados de privacidad

Fecha: 2026-09-23. Rama: `codex/historical-replay-privacy-telemetry`.
Base: `61c5dec9eb3fa654164b5ba7699d99e1215a4eca` (main / PR #137).
Alcance: código y certificación local; sin publicación, deployment ni Replay productivo.

## Procedencia y significado

- El serializador emite eventos constantes inmediatamente después de las dos
  verificaciones ya existentes, sin cambiar `verifyFinalModelPayload`, sus
  reglas, el aliasing ni el objeto/string que se transmite.
- El transporte registra un comprobante en memoria asociado a su resultado o
  error mediante WeakMap. `bindModelResult` conserva esa asociación al copiar
  el resultado. Los campos de la respuesta del proveedor y las propiedades
  de un `modelCall` simulado no pueden fabricar este comprobante.
- Replay copia sólo booleanos/enums de una allowlist a
  `result_safe.privacy_checks`, al resultado de `execute_one` y al GET. La UI
  muestra cada intento por separado: PASS de una ronda no oculta FAIL posterior.
- `provider_invoked` indica invocación del transporte `fetch`, no aceptación
  del proveedor ni finalización de 3A/3B. Un error HTTP o de parseo posterior
  conserva los comprobantes PASS, pero el caso sigue siendo error.
- Un fallo anterior al proveedor conserva sólo etapa, código fijo y
  `provider_invoked=false`. No se copian errores crudos a los nuevos comprobantes
  ni a los códigos de fallo de privacidad guardados por Replay.
- Filas antiguas y callbacks simulados sin transporte tienen `privacy_checks=[]`:
  «Sin comprobante registrado; no equivale a PASS». No se reconstruye evidencia
  a partir de tokens, timestamps, contenido, estado del caso o configuración.
- No se registran payloads, fragmentos, body, nombres, teléfonos, IDs, aliases,
  mapas inversos, secretos, hashes de contenido ni conteos derivados de PII.
  Las columnas/campos de negocio preexistentes de Replay no se reinterpretan.

Ejemplo sintético de éxito de un intento:

```json
{
  "privacy_checks": [{
    "final_payload_verified": true,
    "serialized_body_verified": true,
    "output_mode": "anthropic_json_schema",
    "privacy_stage": "final_model_privacy",
    "provider_invoked": true
  }]
}
```

Ejemplo sintético de rechazo antes del proveedor:

```json
{
  "privacy_checks": [{
    "privacy_stage": "final_model_privacy",
    "privacy_failure_code": "serialized_body_rejected",
    "provider_invoked": false
  }]
}
```

Códigos fijos: `final_payload_rejected`, `body_serialization_failed`,
`serialized_body_rejected`, `pre_transport_privacy_blocked`, `pre_provider_failed`.
El último identifica fallos del transporte anteriores a la verificación (por
ejemplo modo inválido); no significa que el verificador haya rechazado el texto.
Un rechazo del gateway anterior al transporte tampoco inventa un resultado
del verificador del body.

## Archivos del cambio

1. `lib/shadow/ai/modelPrivacyTelemetry.js`: almacenamiento efímero y proyección segura.
2. `lib/shadow/ai/finalModelPrivacy.js`: eventos después de checks y propagación del comprobante.
3. `lib/shadow/ai/anthropic.js`: comprobantes desde el transporte real, éxito/error.
4. `lib/shadow/ai/historicalReplay.js`: recopilación por intento sin alterar decisiones/tools.
5. `pages/api/operaciones/shadow-historical-replay.js`: result_safe, POST y GET sanitizados.
6. `pages/coordinador-ia-sombra.js`: lectura de comprobantes y ausencia explícita para legacy.
7. `tests/shadowModelPrivacyTelemetry.test.mjs`: nuevas pruebas de transporte/telemetría.
8. `tests/shadowHistoricalReplaySourceResult.test.mjs`: recorrido API, persistencia y UI.
9. Este informe.

## Certificación local ejecutada

| Validación | Resultado |
| --- | --- |
| Dirigidas privacidad/gateway/3A/3B/Replay/identidad/sanitizador | 411/411 PASS |
| Suite completa | 1,110/1,110 PASS; cero omitidas |
| Next.js build | PASS; 75/75 páginas |
| `git diff --check` | PASS |

Se ejecutaron 15 pruebas nuevas, además de ampliar el render JSX existente.
Incluyen ambos output modes, rechazo de UUID/PII del objeto final, rechazo de
la string serializada, excepción de serialización, cero fetch/tools tras FAIL,
ausencia de PII/aliases en comprobantes, PASS seguido de FAIL en otra ronda,
rechazo de evidencia falsa inyectada y lectura/persistencia/render sanitizados.
La alteración de JSON.stringify para probar fallos de serialización ocurre
únicamente en fixtures locales, se restaura con finally y no cambia el producto.

Comandos:

```sh
node --test tests/shadowModelPrivacyTelemetry.test.mjs tests/shadowFinalModelPrivacy.test.mjs tests/shadowPhase3AGateway.test.mjs tests/shadowAi*.test.mjs tests/shadowHistoricalReplay*.test.mjs tests/shadowConversationActions3B.test.mjs tests/condominiumCanonicalIdentity.test.mjs tests/preModelSanitizer.test.mjs
node --test tests/*.test.mjs
node node_modules/next/dist/bin/next build
git diff --check
```

Build con URL/keys ficticias y gates OFF sólo en ese proceso. Dependencias
existentes reutilizadas mediante symlink local temporal, sin instalar paquetes
ni modificar lockfiles. Advertencias no bloqueantes: no se descargaron las
hojas de Google Fonts y se omitió su optimización. No se arrancó servidor DEV.

Auth/DB/fetch de las pruebas son simulados: esto no acredita Auth real,
persistencia Supabase ni una transmisión productiva. Gateway, serializador,
verificador, handler, decisiones y render JSX son el código real bajo prueba.

Prompts, schema de decisión, sanitizador, aliasing, identidad, tools, 3A/3B de
negocio, políticas, SQL, configuración Vercel y gates permanecen sin cambios.
No se incorporó AI SDK ni otro transporte; se conservan las interfaces y
autorización existentes. GO para revisión local; no publicado ni desplegado.
Anthropic productivo permanece en el estado OFF acreditado por el usuario;
esta tarea no consultó ni modificó variables remotas.
