# Frontera final de privacidad de 3A — certificación local

Rama: `codex/shadow-final-model-privacy`.
Base: `256dd2641496ca8d360dec059f49f096114815ec`.
Fecha: 2026-09-23. Sólo fixtures y proveedores simulados, sin datos productivos.

## Corrección

1. El sanitizador certificado de texto permanece idéntico. El gateway conserva
   su allowlist de contexto y transforma las referencias estructuradas en aliases
   aleatorios, tipados y exclusivos de la invocación/ronda. `propertyReference`
   también se trata como referencia, no como nombre libre enviado al proveedor.
2. La correspondencia bidireccional se conserva exclusivamente en memoria del
   servidor, mediante closures y WeakMaps. No se pasa al `modelCall`, a sus
   opciones, al body, a telemetry ni al estado durable. La creación del mapa
   falla en un runtime de navegador. No hay tabla ni caché compartida de aliases.
3. Un verificador independiente recorre claves y valores del contexto completo,
   incluido JSON contenido en strings. Comprueba referencias sin alias, UUID de
   cualquier versión, IDs opacos/digests reconocibles, teléfonos, emails,
   cuentas/tarjetas, tokens/keys, URLs y las reglas certificadas de nombres y
   domicilios. Inspecciona también campos futuros, metadata, historial,
   argumentos/resultados de tools y evidence ledger. Rechaza getters, `toJSON`,
   ciclos, valores no JSON y estructuras excesivas.
4. Los mensajes verificados entregados al callback están congelados. El
   transporte construye el body completo, lo verifica, serializa, verifica el
   JSON resultante y entrega **esa misma string** a `fetchImpl`. No se añade
   contexto entre la comprobación y el POST.
5. Las únicas excepciones textuales son estáticas y específicas de ruta:
   prompts/contrato JSON exactamente iguales a los checked-in, y el identificador
   del modelo actual en `body.model`. No eximen mensajes ni contexto dinámico.
   El header de autenticación del proveedor no forma parte del contenido del
   modelo. No se introduce ninguna URL dinámica permitida.
6. Runner, state machine y Historical Replay traducen los aliases de la decisión
   antes del planner, las validaciones existentes de argumentos/dependencias y
   cualquier tool. UUID directo, alias inventado, de otro tipo o de otra ronda
   rechaza toda la decisión. Las referencias de hechos se restauran para usar
   el evidence ledger original sin alterar su validación.
7. Repair conserva el mapa de esa invocación en memoria, inspecciona su entrada
   antes de reenviarla y nunca reinserta el inbound. El transporte real del
   repair aplica la misma frontera. Una falla de privacidad no se clasifica
   como error de conexión reintentable.

Falla: `pre_model_sanitization_blocked`, con códigos de motivo sin valores
sensibles. En una entrada rechazada: cero proveedor y cero tools de esa ronda.
Una referencia inválida devuelta por el modelo bloquea todas las tools antes
de ejecutarlas; no puede deshacer llamadas válidas de rondas anteriores.

No se modifican prompts, schema de decisión, sanitizador certificado, resolver
canónico, implementación de tools, lógica de 3B, políticas/thresholds, SQL ni gates.
En los tres ejecutores sólo cambia el wiring de decodificación antes del planner.

## Ejemplo sintético de entrada verificada

Contenido completo generado por el gateway para un fixture mínimo, que ocupa
`messages[0].content` en el body del transporte (el namespace cambia
criptográficamente en cada invocación):

```json
{
  "inputKind": "conversational_message",
  "message": "¿Cómo va el mantenimiento?",
  "metadata": {"propertyId": "ref_fckisbwwlquxgerrmxvuenoemoemghbo_1"},
  "deterministic": {
    "intent": "mantenimiento",
    "interactionDirection": "inbound_customer_action",
    "requiresHuman": true,
    "reasonCodes": []
  },
  "tools": [],
  "evidenceLedger": [],
  "round": 1,
  "remainingRounds": 2
}
```

El body completo incluye además los campos existentes `model`, `system`,
`max_tokens` y `output_config` en modo `anthropic_json_schema`; el system prompt
y el schema no fueron editados. No contiene el mapa inverso.

## Evidencia ejecutada

| Verificación local | Resultado |
| --- | --- |
| Dirigidas privacidad/gateway/3A/3B/Replay/identidad/sanitizador | 361/361 PASS |
| Suite completa | 1,060/1,060 PASS, cero omitidas |
| Build Next.js | PASS, 75 páginas |
| `git diff --check` | PASS |

Comandos (Node disponible en PATH):

```sh
node --test tests/shadowFinalModelPrivacy.test.mjs tests/shadowPhase3AGateway.test.mjs \
  tests/shadowAi*.test.mjs tests/shadowHistoricalReplay*.test.mjs \
  tests/shadowConversationActions3B.test.mjs tests/condominiumCanonicalIdentity.test.mjs \
  tests/preModelSanitizer.test.mjs
node --test tests/*.test.mjs
npm run build
git diff --check
```

Build realizado sin archivos `.env` ni credenciales reales; URL/keys ficticias,
proveedor y capacidades deshabilitados. Advertencia no bloqueante: Google Fonts
no descargable en el entorno restringido; la optimización de fuentes se omite.

Las pruebas de transporte invocan `createAnthropicShadowResponse` real, capturan
`options.body` en un **fetch simulado**, en ambos modos de salida. Comprueban que
UUIDs, Respond ID, nombre/email sintéticos y key de prueba no aparecen en el body;
tool result y evidence comparten alias de sujeto y conservan status/period/amount.
También comprueban cero fetch ante PII tardía o intento de saltarse el gateway.
Esto NO es una transmisión ni certificación productiva de Anthropic.

Las pruebas de tool chaining devuelven los aliases efectivamente recibidos por
el modelo simulado. El servidor obtiene el ID original y la tool real construye
la consulta con ese ID, contra un doble local de base de datos. Respond ID y
evidence IDs también retornan correctamente sólo en servidor. Runner, state
machine y Replay prueban el rechazo antes de tools; state machine conserva usage
si el rechazo ocurre después de recibir una respuesta del proveedor simulado.

Las expectativas antiguas que exigían UUIDs en el callback se sustituyeron por
aliases. Se conserva la prueba de resolución de las siete identidades de Rentas
y del contexto condominal. La prueba antigua de UUID inventado pasa ahora a
rechazo anterior a tools; su guardia de negocio/grounding sigue probándose
directamente sin modificar su implementación. Se conservan las regresiones
financieras, legales, humanas y de elegibilidad de 3B de la suite existente.

## Límites del dictamen

- GO para revisión del cambio local. No publicado, mergeado ni desplegado.
- Cero llamadas reales a Anthropic/Respond/Supabase, cohortes productivas,
  escrituras remotas, envíos, SQL o cambios de configuración durante esta tarea.
- Los detectores determinísticos de nombres/domicilios conservan el alcance de
  las reglas certificadas; fixtures sin fuga no prueban reconocimiento universal
  de todo nombre posible ni todas las codificaciones adversariales.
- Las colisiones entre una referencia y un enum/facto cierran la entrada;
  no se sustituyen hechos financieros, fechas, importes, roles ni decisiones
  por aliases para obtener PASS. Pueden requerir revisión como falsos positivos.
- Los prompts y schema siguen intactos: las guías textuales heredadas mencionan
  UUID, pero el transporte sólo proporciona aliases. Una respuesta que fabrique
  un UUID se bloquea. La calidad del modelo real usando aliases no se ha medido
  en esta tarea y requiere una evaluación posterior expresamente autorizada.
- Interpretación visual y otros transportes ajenos a 3A no se modifican ni se
  certifican aquí. El cierre manual de Anthropic en Producción comunicado por
  el usuario se mantiene; no se consultaron ni modificaron gates.
