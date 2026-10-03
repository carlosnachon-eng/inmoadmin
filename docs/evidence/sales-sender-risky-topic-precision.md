# Sales sender: precisión de `risky_topic`

Base: `1c15c590fa4836d22d44ee70325d9dd3ed6fa448`.
Rama local: `codex/sales-sender-risky-topic-precision`.

## Alcance

Primer cambio funcional: el matcher `RISKY` de `salesAutoOutbound.js` exige
inicio de palabra Unicode. Una raíz sensible no puede coincidir dentro de
`confirmar`, `confirmación`, `afirmar`, `acredito` o `reescritura`.
No se aplica ninguna exención a la frase completa: `confirmar la firma del
contrato` continúa bloqueado. Se conservan raíces y sufijos conservadores;
`subcontrato` y `renegociar` permanecen sensibles explícitamente.

Se revisaron las 22 alternativas únicas de la regla anterior:

| Grupo | Raíces revisadas | Tratamiento |
| --- | --- | --- |
| Firma | `firma` | No coincide dentro de confirmar/afirmación; firma, firmas, firmar, firmarlo, firmando y firmado siguen bloqueados |
| Crédito/escritura | `cr[eé]dito`, `escritura` | No coincide dentro de acredito/desacredito/reescritura; crédito(s), escritura(s), escriturar siguen bloqueados |
| Contrato/negociación | `contrato`, `negoci` | Inicio de palabra, incluyendo subcontrato y renegociación; no se redefine la política conservadora sobre negocio/negociación |
| Resto | `apartad`, `dep[oó]sito`, `p[oó]liza`, `jur[ií]dic`, `demanda`, `profeco`, `descuento`, `rebaja`, `contraoferta`, `hipoteca`, `promesa`, `garant[ií]a`, `penaliz`, `cancelaci[oó]n`, `rescisi[oó]n`, `abogado` | Mismo límite inicial; mantienen las inflexiones existentes y cobertura positiva en input/output |

Se eliminó únicamente la alternativa duplicada `demanda`. No se cambiaron
`REQUIREMENTS_SENSITIVE`, la guarda de solicitudes de cita, la guarda Social,
el orden de evaluación ni las allowlists de casos/canales.

Segundo cambio, autorizado expresamente después de identificar otra coincidencia:
la guarda de compromiso de cita permite las frases informativas completas
`te confirmo disponibilidad` y `te confirmo la disponibilidad`. La excepción
requiere fin de texto o puntuación inmediatamente después de disponibilidad,
y ausencia de señales de agenda en todo el output (cita/visita, horario/fecha,
referencias temporales, dígitos, encuentro/recorrido, etc.). Un `te confirmo`
ambiguo o una segunda confirmación no informativa mantiene revisión. Se conserva
la expresión previa de compromisos y se evalúa después de retirar exclusivamente
esa mención informativa de una copia local. **El texto enviado no se modifica.**

Es una excepción léxica conservadora, no una prueba general de comprensión de
lenguaje natural ni evidencia nueva de disponibilidad de inventario.

## Regresiones y límite explícito

| Frase sintética | Resultado |
| --- | --- |
| Puedo confirmar disponibilidad. | Clasificador permitido; llega al sender real con Social ON en harness local |
| Confirmación de disponibilidad. | Permitido por clasificador |
| quiero confirmar una visita | No es `risky_topic`; en input permanece `appointment_requires_validation`; en output pasa el clasificador aislado, pero la guarda Social independiente mantiene revisión de citas |
| te confirmo disponibilidad | Permitido por clasificador; llega al sender real en harness con Social ON y con Social OFF |
| Te confirmo disponibilidad. Nos vemos mañana. | Sigue en revisión; no llega al transporte ni siquiera sin la guarda Social |
| Te confirmo disponibilidad. A las diez. | Sigue en revisión; no llega al transporte |
| Te confirmo disponibilidad. Firma el contrato. | `risky_topic`; no hay exención de toda la frase |
| firma el contrato | `risky_topic` |
| quiero firmar hoy | `risky_topic` |

`te confirmo disponibilidad` queda acreditado de extremo a extremo **localmente**
con DB en memoria y transporte interceptado. No es una certificación productiva.
Una solicitud de visita aún requiere la validación de citas preexistente; que
`confirmar` deje de producir `risky_topic` no autoriza confirmar una cita.

## Certificación local

- Focalizadas: **194/194 PASS**.
- Dirigidas sender/Social/webhook/rutas/continuidad: **347/347 PASS**.
- Suite completa: **1975/1978 PASS**, tres fallos heredados; no se declara suite verde.
  - `respondWebhookMultiHmac.test.mjs`: resolución de import relativo en harness data-URL.
  - `shadowAiP3.test.mjs`: 19 tools vs expectativa 18.
  - `shadowReducedOutputSchema.test.mjs`: 4383 bytes vs expectativa 4355.
  - Coinciden con la evidencia versionada del fix de terminal eligibility en la base; estos archivos no cambiaron.
- Build Next: **PASS**, configuración sintética y URL Supabase loopback; sin cargar `.env` alojados.
- `git diff --check`: **PASS**.

El test de sender ejecuta `processSalesAutoOutboundRun` sin sustituir su lógica.
DB en memoria; `fetch` completamente interceptado con un receipt sintético.
Una sola llamada simulada al sender por fixture (Social ON / OFF); repetición
devuelve `already_handled`; una sola fila outbound simulada por fixture. Ruta y
responsable permanecen intactos; cero handoffs. Firma/contrato no llegan al
transporte. La disponibilidad seguida de compromisos de cita/horario tampoco
llega al transporte con Social OFF, por lo que el bloqueo no depende de la
guarda Social adicional.

No se enviaron mensajes reales ni se llamaron modelos/Respond/Supabase reales.
No hubo cambios de gates, routing, Recovery, SLA, handoff, #161 o #163.
Sin publicación, despliegue, migración ni cambios productivos. Social productivo
no se modificó; su valor no se vuelve a certificar mediante esta prueba local.

Logs locales generados: `/private/tmp/sales-sender-risky-topic.vNm3if/`.
