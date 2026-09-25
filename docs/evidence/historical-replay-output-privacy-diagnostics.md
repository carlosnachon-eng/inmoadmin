# Historical Replay — diagnóstico sanitizado de fallos de salida

## Alcance y base

Rama local: `codex/historical-replay-output-privacy-diagnostics`.
Base: `5b45dd1689d2093221a8b64e1d49a83115e783ca` (`origin/main` al iniciar).
El cambio ajeno de Blindaje de esa base se conserva sin editarlo.

Implementación de diagnóstico exclusivamente. No se ejecutaron casos reales,
Anthropic, el caso bancario, SQL, deployments ni cambios de gates. No se publica
la rama ni se abre PR en esta entrega. La causa del fallo productivo anterior
sigue sin poder recuperarse; no se atribuye retrospectivamente una razón.

## Captura y proyección

- `finalModelPrivacy.js` captura la razón del rechazo ya existente y una
  ubicación fija. No modifica regex, tipos/compatibilidad, emisión/resolución
  de aliases, orden de validación, ni el criterio de aceptación.
- `output_privacy_validation`: rechazo del verificador recursivo de la decisión
  o de la comprobación final de aliases residuales en texto/campos restantes.
- `output_reference_decode`: scope ausente, referencia no emitida/raw al resolver,
  tipo incompatible o alias en argumento que no admite referencias.
- `outputPrivacyDiagnostics.js` proyecta 27 razones, 9 ubicaciones y 2 etapas
  mediante enums fijos. Un WeakMap vincula sólo el diagnóstico ya proyectado al
  error del boundary; no contiene payload, mapa de aliases, paths ni valores.
- Si existen varias reglas activas, se conserva la misma primera razón ordenada
  que ya seleccionaba el verificador. Se registra la ubicación coarse-grained
  de su primera aparición, no todas las coincidencias ni sus conteos.
- Replay propaga sólo esos enums. Para estos fallos, `diagnosticCode` y
  `error_code` son la constante `pre_model_sanitization_blocked`; no se utiliza
  el mensaje libre del error. `truncatedFields` queda vacío para no añadir paths.
- El endpoint vuelve a proyectar antes de persistir, devolver POST y servir GET.
  La UI vuelve a proyectar antes de renderizar. Razones/ubicaciones desconocidas
  se omiten; campos extra se descartan. Las filas legacy no adquieren una causa.
- Se conserva el modelo/usage ya reportado y los receipts del transporte, sin
  convertir su PASS en aprobación de la salida ni de 3B.

Ejemplo exclusivamente sintético en `result_safe.outputDiagnostics`:

```json
{
  "outputStage": "output_privacy_validation",
  "outputPrivacy": {
    "reason": "model_alias_in_free_text",
    "location": "summary"
  },
  "diagnosticCode": "pre_model_sanitization_blocked",
  "truncatedFields": []
}
```

## Pruebas locales

Datos completamente sintéticos. Auth/Supabase/provider de las pruebas de
integración son dobles en memoria; no representan una certificación productiva.
Se reutiliza el transporte real con `fetchImpl` simulado, el decoder reducido
real, el endpoint real con almacenamiento simulado y JSX real renderizado con
React/SWC. No hay llamadas reales a proveedores.

Cobertura añadida:

- Todas las razones allowlisted y las 9 ubicaciones fijas.
- Summary, contexto, acción propuesta, acknowledgement, clarification,
  escalation, proposed_message, etiquetas de entidades y campos futuros.
- Argumentos mal ubicados, tipos incompatibles, evidencia factual,
  verifiedFactReferences, aliases inventados/de otro scope y scope ausente.
- UUID, teléfono, email, cuenta y secret sintéticos: no aparecen en diagnóstico.
- Claves desconocidas/JSON anidado nunca se convierten en paths persistidos.
- Contaminación de `error.message`, `reasons`, `path`, `value` y metadata extra:
  no sobrevive a persistencia/POST/GET ni al render UI.
- Respuesta sintética de formato reducido → fallo → HTTP 422: una llamada
  simulada, cero tools propuestas ejecutadas, ninguna resolución 3B persistida,
  receipts PASS y usage/modelo conservados sin alterar su significado.
- Aliases válidos siguen desaliasándose al identificador correcto en servidor;
  regresiones existentes de privacidad, 3A/3B y Replay intactas.

Ejecución con Node v24.19.0, `env -i`, sin credenciales del entorno. El build usa
una URL loopback no operativa y claves sintéticas; no se instala dependencia.

```sh
node --test tests/shadowOutputPrivacyDiagnostics.test.mjs \
  tests/shadowReducedOutputSchema.test.mjs tests/shadowProviderHttpDiagnostics.test.mjs \
  tests/shadowModelPrivacyTelemetry.test.mjs tests/shadowFinalModelPrivacy.test.mjs \
  tests/shadowPhase3AGateway.test.mjs tests/shadowAi*.test.mjs \
  tests/shadowHistoricalReplay*.test.mjs tests/shadowConversationActions3B.test.mjs \
  tests/condominiumCanonicalIdentity.test.mjs tests/preModelSanitizer.test.mjs
node --test tests/*.test.mjs
node node_modules/next/dist/bin/next build
git diff --check
```

Resultados: dirigidas **592/592 PASS**; suite **1,306/1,306 PASS**; build **PASS**,
75/75 páginas; `git diff --check` **PASS**. Cero tests fallidos, omitidos o
cancelados. El enlace temporal a dependencias existentes se elimina al cerrar.

Sin modificaciones en schema reducido/general, prompts, gateway/transporte,
tools, identidad, grounding, decisiones 3A/3B, SQL, Vercel o gates. La lectura
del catálogo y la ejecución productiva no forman parte de esta certificación.
