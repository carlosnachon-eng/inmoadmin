# WhatsApp Administración — diagnóstico de reconexión (2026-10-19)

## Alcance
**Sólo lectura y preparación.** No registrar ni desconectar el número, cambiar subscriptions, webhook, secretos, sender flags, Respond, ni crear otra app o Tech Provider sin una decisión y consentimiento posterior. La WhatsApp Business App en iPhone sigue operativa.

## Evidencia confirmada
- WABA de Administración: `1297760461811288`. ID de número: `1198305790026665`. Meta Graph v26 GET confirma nombre Administración y número +52 1 56 1206 8426.
- Graph GET `/{WABA}/subscribed_apps` devuelve app Emporio Inmoadmin `1728488815945294`. El webhook configurado en esa app es `https://app.emporioinmobiliario.com.mx/api/webhooks/meta`; subscriptions `messages` y `smb_message_echoes` se ven activas en panel Meta.
- El GET de verificación con token deliberadamente inválido devolvió `verification_denied`: receptor habilitado y validación GET operativa; **no** certifica POST o delivery.
- Graph GET `/{PHONE}?fields=id,platform_type,is_on_biz_app,code_verification_status` devolvió `ON_PREMISE`, `true`, `NOT_VERIFIED` con token personal **y** con nuevo token de system user.
- El system user `Emporio Inmoadmin wapp` tiene activos visibles en Meta. Nuevo token con `whatsapp_business_management` y `whatsapp_business_messaging` pudo realizar GET de WABA y /phone_numbers. **Eso sólo confirma autorización de lectura**.
- Producción Supabase, verificado 2026-10-19: `meta_observer_events` 710 registros y `meta_admin_private.inbound_inputs` 303; ambos con último `occurred_at=2026-10-11 18:29:39+00`. Una prueba de entrada llegó a Business App el 19 oct pero no produjo nuevos registros observables.
- Producción Supabase `meta_admin_private.manual_events`: **4** fases `dispatch_started`, **4** outcomes `failed`. El registro del 10 oct conserva HTTP **403**, OAuthException code **200**, texto: `You do not have the necessary permissions to send messages on behalf of this WhatsApp Business Account`. Los otros errores no tienen el mismo detalle acreditado.
- Código actual: `lib/messaging/metaAdminInbox/manual.js` exige `META_ADMIN_MANUAL_REPLY_ENABLED=true` y `META_ADMIN_OUTBOUND_ACCESS_TOKEN`. `metaTextTransport.js` hace una sola llamada POST a Graph v26, sin retry. `metaObserver/receiver.js` verifica HMAC y confirma persistencia antes de HTTP 200.

## Distinción de problemas (no confundir)
A. **Entrada**: la WABA contiene la suscripción y el receptor GET funciona, pero no hay nuevos POST durables. Causas aún posibles: estado/registro de la phone-number platform, no entrega Meta a esa app, rechazo de firma/configuración, o fallo 503 de DB. Logs consultados no bastaron para acreditar ausencia de llamadas.
B. **Salida**: los cuatro intentos históricos fallaron; uno acredita el 403 por autorización. Un token nuevo con permisos declarados no demuestra POST habilitado; y `ON_PREMISE` puede bloquear Cloud API aun con permisos correctos.
C. **Coexistencia**: `is_on_biz_app=true` y `platform_type=ON_PREMISE` son estado actual acreditado. No asumir que registrar el número por la ruta convencional es seguro para el iPhone. Elegibilidad y flujo de Embedded Signup/Tech Provider siguen sin certificar.
D. **Vercel env**: la enumeración disponible de envs devolvió los primeros 100 registros y no permite afirmar ausencia de las variables META_ADMIN; el GET inválido sí demuestra que el receptor está habilitado en el runtime que respondió.

## Camino seguro siguiente
1. **No rotar la credencial productiva aún** ni utilizar el token visible parcialmente en capturas como token definitivo. Evitar capturas o outputs con secretos.
2. Obtener evidencia de **entrega POST** del intento controlado mediante logs del endpoint específico en una ventana temporal acotada y/o diagnóstico de entrega de webhooks en Meta; correlacionar sin almacenar teléfonos ni mensajes reales.
3. Confirmar estado y **requisitos oficiales de incorporación del número existente** de WhatsApp Business App a Cloud API/coexistencia para la propia WABA. No proponer crear otra aplicación como solución demostrada. Una app nueva no corrige `ON_PREMISE` por sí sola.
4. Sólo si se acredita la ruta y el usuario la autoriza: onboarding de coexistencia con plan de rollback, sin desinstalar WhatsApp Business ni liberar/borrar el número.
5. Después de entrada nueva confirmada en journal, probar **una** respuesta manual autorizada con un inbound nuevo y destinatario de prueba, journal y no-retry; validar respuesta HTTP, wamid y recibos independientes. No reutilizar históricos (reserva consumida).
6. Finalmente incorporar Administración al Inbox omnicanal mediante la lectura autorizada existente, antes de IA y automatizaciones.

## Criterios de salida
- Número conserva funcionamiento en iPhone.
- Estado coexistencia/Cloud API confirmado por Meta sin suposiciones.
- Mensaje de prueba entrante aparece una sola vez en persistencia.
- Respuesta de prueba manual aceptada y recepción verificada en dispositivo; no confundir HTTP 200 con entrega.
- Ningún cambio colateral en ventas/Respond/FB/IG.

_Este documento es un diagnóstico de evidencias, no una autorización de activación._
