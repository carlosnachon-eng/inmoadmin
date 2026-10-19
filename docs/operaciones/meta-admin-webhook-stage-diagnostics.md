# Webhook Administración: diagnóstico por etapas (opt-in)

La captura de Meta al pulsar «Probar messages» usa IDs ficticios. El receptor de Administración compara el WABA y el phone_number_id con los IDs de producción **antes** de almacenar, por lo que un rechazo de alcance `403 scope_denied` es esperado para esa muestra. El aviso verde de la UI Meta no demuestra persistencia.

## Activación segura (requiere autorización separada)
Variable server-only: `META_ADMIN_WEBHOOK_DIAGNOSTICS_ENABLED=true` en el entorno que se quiera diagnosticar. OFF por defecto. Requiere nuevo deployment para surtir efecto en Vercel. **Este PR no agrega ni activa la variable.**

Marcadores fijos opcionales:
- `stage_signature_rejected` → 401
- `stage_content_type_rejected` → 415
- `stage_scope_rejected` → 403
- `stage_body_too_large` → 413
- `stage_payload_rejected` → 400
- `stage_persisted` → 200 tras RPC durable
- `stage_persistence_rejected` → 503; permanece el marcador existente `persistence_failed`

No registran texto, teléfonos, IDs de mensajes, tokens, secretos, payloads, cabeceras ni respuestas del proveedor. El registro solo ocurre si hay un POST hacia el endpoint. Ausencia de marcadores NO prueba por sí sola ausencia de entrega; revisar también request logs y filtrado.

## Procedimiento
1. Verificar DEV/Preview con fixtures firmadas sintéticas; no llamar Graph send ni ejecutar sender.
2. Tras revisión y autorización para activar el flag, realizar un **único** test `messages` desde Meta, sabiendo que utiliza un WABA/phone falso y debe producir `stage_scope_rejected` si POST tiene firma válida.
3. Comparar marca de tiempo de Meta y logs de función Vercel y contadores de DB (que deben seguir sin cambiar ante el scope rechazado). Si no aparece ningún marcador, investigar entrega del POST por Meta/infraestructura, no relajar la validación.
4. Desactivar el flag una vez identificado el comportamiento.
5. Diagnosticar aparte el estado `ON_PREMISE`, la coexistencia y los fallos históricos de envío 403, sin tocar el WhatsApp Business del iPhone.

Nunca deshabilitar la comprobación exacta de WABA/phone ID, HMAC, ni la persistencia durable para lograr una muestra sintética exitosa. La prueba de Meta no acredita que mensajes reales lleguen desde el número de Administración.
