# Fase 2A P1 — 360dialog Coexistence / Shadow

Estado: preparación técnica. No autoriza contratar, registrar, vincular ni migrar el número.

## Estado confirmado del teléfono

- iPhone con WhatsApp Business 2.26.31.74.
- `Cuenta → Plataforma para empresas` ofrece conectar y conservar la app.
- Backup confirmado el 19 de agosto de 2026.
- Cero dispositivos vinculados.
- Sin listas de difusión.
- No se inició onboarding ni se solicitó código.

## Documentación vigente verificada

- Coexistence: https://docs.360dialog.com/docs/resources/phone-numbers/coexistence
- Onboarding: https://docs.360dialog.com/docs/hub/embedded-signup/coexistence-onboarding
- Eventos Coexistence: https://docs.360dialog.com/docs/hub/embedded-signup/whatsapp-coexistence/coexistence-webhooks
- Webhooks: https://docs.360dialog.com/docs/messaging/webhook
- Pricing: https://docs.360dialog.com/docs/pricing
- Migración: https://docs.360dialog.com/partner/waba-management/migrating-phone-numbers

Hallazgos al 19 de agosto de 2026:

- La app debe llevar al menos siete días activa y mantenerse actualizada.
- El Portfolio debe pertenecer a la empresa y tener información legal, domicilio, web y teléfono.
- `smb_message_echoes`, en `entry[].changes[].value.message_echoes`, representa mensajes humanos enviados desde la app.
- La referencia vigente exige HTTP 200 en menos de cinco segundos y recomienda procesamiento asíncrono; los fallos se reintentan con backoff (la duración publicada varía entre referencias, por lo que debe confirmarse antes del onboarding).
- 360dialog permite configurar headers personalizados en el webhook. No se documenta una firma HMAC nativa para el webhook de mensajes; P1 usa un secreto aleatorio en `x-shadow-webhook-secret`.
- Los mensajes de la app siguen gratuitos; Cloud API se cobra según Meta.
- Plan Regular publicado: USD 59 por número/mes, más cargos Meta.
- Un número Coexistence no puede migrarse entre WABAs con el flujo ordinario.
- Desconexión: `WhatsApp Business → Ajustes → Cuenta → Plataforma para empresas → Desconectar`, sólo con soporte y autorización previa.
- La app debe abrirse al menos una vez cada 13 días para conservar activa la conexión.

## Arquitectura P1

`360dialog → POST /api/shadow/providers/360dialog → adapter → envelope P0 → sanitización/deduplicación → contexto read-only → Shadow`

El endpoint no contiene cliente de envío, no descarga media, no llama modelos y no muta tablas ERP.

## Variables futuras DEV

| Variable | Uso |
|---|---|
| `SHADOW_360DIALOG_CAPTURE_ENABLED` | Kill switch; default `false` |
| `SHADOW_360DIALOG_WEBHOOK_SECRET` | Secreto aleatorio enviado por 360dialog como header personalizado |
| `SHADOW_360DIALOG_CHANNEL_ID` | Identificador opaco del canal; no se expone al frontend |
| `SHADOW_360DIALOG_MAX_EVENT_AGE_SECONDS` | Ventana temporal; default 172800 |
| `SHADOW_360DIALOG_PROCESSING_TIMEOUT_MS` | Límite interno; default 1200, máximo 2000 |
| `SHADOW_OUTBOUND_ENABLED` | Debe permanecer `false` |

No se requiere `D360-API-KEY` para recibir el webhook. Esa llave autentica llamadas salientes/configuración y no se incorporará mientras P1 sea inbound-only.

## Onboarding futuro — requiere autorización separada

1. Confirmar nuevamente backup, versión, cero dispositivos y ausencia de listas de difusión.
2. Crear/contratar cuenta 360dialog y confirmar por escrito USD 59/mes más Meta antes de pagar.
3. Identificar el Business Portfolio correcto; no crear otro por conveniencia.
4. Confirmar que el número lleva más de siete días activo y es elegible.
5. Seleccionar `WhatsApp Business App existente` / Coexistence, nunca migración exclusiva a Cloud API.
6. Verificar el número enmascarado y WABA antes de continuar.
7. No compartir historial inicialmente.
8. Carlos debe estar presente para código, QR y confirmación en la app.
9. Conectar y verificar inmediatamente que la app y los chats 1:1 siguen operativos.
10. Configurar el webhook DEV con HTTPS y el header secreto.
11. Mantener `SHADOW_OUTBOUND_ENABLED=false`; habilitar únicamente captura DEV.
12. Enviar un mensaje controlado inbound y confirmar una sola fila Shadow.
13. Responder manualmente desde la app y confirmar un solo echo marcado como humano.
14. Confirmar cero respuestas API, cero descargas y cero mutaciones ERP.
15. Monitorear reintentos, errores y duplicados durante la ventana acordada.

## Stop / desconexión

Ante pérdida de app, mensajes faltantes, WABA inesperada o partner incorrecto:

1. No borrar WABA, número ni app.
2. Desactivar `SHADOW_360DIALOG_CAPTURE_ENABLED`.
3. Conservar evidencia técnica sin PII.
4. Consultar soporte 360dialog antes de desconectar.
5. Sólo con autorización: desconectar desde `Cuenta → Plataforma para empresas`.
6. Verificar chats y operación humana; revincular dispositivos compatibles si existieran.

## Criterio pendiente antes de conectar

Faltan la auditoría autenticada del Portfolio/WABA, la elegibilidad real del número, confirmar que no existe línea de crédito/BSP histórico incompatible y una autorización explícita para contratar e iniciar Embedded Signup.
