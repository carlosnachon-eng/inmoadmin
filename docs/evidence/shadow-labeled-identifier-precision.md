# Identificadores etiquetados: corrección acotada del falso positivo

## Alcance

- Rama: `codex/shadow-labeled-identifier-precision`.
- Base local: `4e921a13056afecc1b948a57bcfc1a214af5faf6` (main acreditado).
- Un único archivo funcional: `lib/shadow/ai/preModelSanitizer.js`.
- Sin cambios en aliases, decoder, schema reducido/general, prompts, contrato de
  tools, 3A/3B, grounding, políticas financieras, SQL ni gates.
- Sin publicación, proveedor real, Replay productivo, intento 4 ni caso bancario.

El diagnóstico productivo cerrado identifica `output_privacy_validation /
residual_labeled_identifier / proposed_action`, pero no conserva el valor
infractor. No se recuperó ni se infirió ese texto. Esta reproducción demuestra
el defecto con frases sintéticas y no afirma conocer la salida productiva exacta.

## Reproducción antes del cambio

Las cuatro frases indicadas fallan con `residual_labeled_identifier` tanto en
`verifyPreModelPayload` como al decodificar `proposedAction` mediante la frontera
existente. El sanitizador inicial modifica indebidamente las primeras tres;
la cuarta queda bloqueada, con payload nulo.

| Frase sintética | Antes: residual/salida | Después: entrada/residual/salida |
|---|---|---|
| solicitar referencia para identificar el caso | FAIL | PASS, texto intacto |
| pedir referencia antes de continuar | FAIL | PASS, texto intacto |
| requiere autorización para devolución | FAIL | PASS, texto intacto |
| la cuenta como antecedente administrativo | FAIL | PASS, texto intacto |

La versión inicial de las regresiones nuevas, antes del parche funcional, dio
22 PASS / 12 FAIL (34 tests). Incluía los falsos positivos y diferencias previas
entre redacción/verificación de las variantes `número`/`núm.`. La versión final
añade también `no` seguido de dígitos y el recorrido Replay sintético: 36/36 PASS.

## Causa y regex exactas

La combinación de separador opcional y flag `i` acepta palabras comunes de cuatro
o más caracteres como identificadores: `para`, `antes`, `como`. No exige ninguna
señal positiva de ID.

Antes, redacción `folio`:

```js
/\b(?:folio|referencia|operaci[oó]n|autorizaci[oó]n|rastreo|ticket)\s*(?:n[uú]m(?:ero)?\.?|no\.?|#|:)?\s*[A-Z0-9][A-Z0-9._/-]{3,}\b/giu
```

Antes, verificación `labeled_identifier`:

```js
/\b(?:folio|referencia|operaci[oó]n|autorizaci[oó]n|rastreo|cuenta|clabe|tarjeta|token|api\s*key)\s*(?:no\.?|#|:)?\s*[A-Z0-9][A-Z0-9._/-]{3,}\b/iu
```

Ahora, ambas comparten exactamente el sufijo detector:

```js
const LABELED_IDENTIFIER_VALUE = String.raw`(?:\s*(?:n[uú]m(?:ero)?\b\.?|no\.|#|:)\s*(?:[:#]\s*)?[A-Z0-9][A-Z0-9._/-]{3,}|\s*(?:no\b\s*)?(?=[A-Z0-9._/-]*\d)[A-Z0-9][A-Z0-9._/-]{3,})\b`;
const labeledIdentifier = (labels, flags) => new RegExp(String.raw`\b(?:${labels})${LABELED_IDENTIFIER_VALUE}`, flags);
```

Cada regla mantiene sus etiquetas y flags anteriores. La primera alternativa
exige `:`, `#`, `no.`, `número`/`numero`/`núm.`/`num.`; admite además combinaciones
como `número: ABCD`. La segunda exige un dígito dentro del mismo token (no en una
palabra posterior), conservando `folio no 928374`, sin confundirlo con `referencia
no disponible`. Se conserva el mínimo previo de cuatro caracteres por token y
la protección de IDs pegados a la etiqueta (`folio928374`).

No se tocan las otras reglas de cuenta, CLABE, tarjeta, teléfono, UUID, secrets,
nombres o domicilios, ni las sustituciones de texto ya existentes. Los datos que
no se redactan siguen fallando cerrados en el verificador residual. La frontera
final reutiliza `verifyPreModelPayload` sin alterar su decoder ni sus diagnósticos.

## Regresiones y seguridad

- Ocho frases normales permanecen intactas en entrada, residual y decoder reducido.
- Veinticinco identificadores etiquetados sintéticos permanecen bloqueados en
  salida; la entrada los elimina o falla cerrada. Incluyen `referencia: AB1234`,
  `folio 928374`, `operación #A12993`, `autorización 873421`, `cuenta 1234567890`,
  CLABE/tarjeta sintéticas, separadores alfabéticos, mayúsculas y formatos mixtos.
- Las múltiples coincidencias y llamadas repetidas no comparten estado regex.
- CLABE/tarjeta sin etiqueta, teléfono, email, UUID, secret y alias no emitido
  siguen bloqueados por sus guardas independientes.
- Replay reducido local con transporte/fetch sintético: las cuatro frases llegan
  al resultado final. Mismo resultado 3B que el control `Escalar`,
  `requires_human=true`, `auto_send_eligible=false`; cero tools solicitadas.
- Un ID verdadero en `proposedAction` sigue produciendo el mismo diagnóstico
  sanitizado y bloquea antes de tools/3B, sin una segunda ronda/reintento.
- La suite existente cubre aliases tipados, rondas, tools, privacidad, contrato
  reducido/general y decisiones 3A/3B; todos PASS.

## Certificación local

| Comprobación | Resultado |
|---|---|
| Regresiones nuevas | 36/36 PASS |
| Dirigidas amplias | 673/673 PASS |
| Suite completa del main base + corrección | 1,438/1,438 PASS |
| Build | PASS, 76/76 páginas estáticas |
| `git diff --check` | PASS |

Node v24.19.0. Se usó `env -i`, sin credenciales del entorno. Para el build:
URL loopback y claves de prueba ficticias. Se reutilizaron temporalmente las
dependencias ya instaladas (Next 14.1.0, React/ReactDOM 18.3.1) mediante un enlace
local, retirado al terminar. No se modificaron manifiestos ni dependencias.
Google Fonts no pudo descargarse; Next omitió esa optimización y completó el build.
El refresh remoto de Git no resolvió DNS; se utilizó el main ya disponible y
acreditado, sin integrar ni publicar cambios externos.

```sh
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

No validación productiva ni promesa de que una futura respuesta del proveedor
pase todas las demás guardas. No se creó un nuevo intento para comprobarlo.
