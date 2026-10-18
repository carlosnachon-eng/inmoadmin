# Facebook Messenger en el Inbox comercial

## Alcance de la primera entrega

Base inspeccionada: `origin/main` en `1cdddb2` (18 octubre 2026). Esta etapa 1A agrega transporte de texto y journal Messenger aislados, con pruebas locales. No constituye todavía una conexión certificada con Meta ni un Inbox omnicanal operativo. No modifica la UI existente, Instagram, Respond, WhatsApp o IA. No aplica migraciones remotas, provisiona secretos, suscribe una Página ni habilita outbound.

La configuración rechaza Producción incluso si se activa el flag. Sin configuración, las nuevas rutas responden 404. La activación DEV y cualquier sender real requieren validación y autorización posterior.

## Diagnóstico del main actual

| Pieza | Reutilización y límite |
| --- | --- |
| `pages/administracion/inbox.js` | Única ruta comercial. Monta directamente `InstagramBusinessInbox`; conservarla. |
| `components/InstagramBusinessInbox.js` | Layout, lista/chat, propiedades, citas y asignación ya operativos. Su helper `request`, media, selección y resultados están ligados a `/api/operaciones/instagram-business`; requieren adaptador por canal antes de incluir Facebook. |
| `components/InstagramCommentsPanel.js` | Drawer existente y supervisión. Acoplado a comentarios Instagram; no pasarle `feed` de Facebook como si fuera el mismo contrato. |
| `lib/shadow/ai/apiAuth.js` | `authorizeInboxStaff` verifica sesión mediante `getUser` y perfil activo; reutilizable sin invocar IA. La autorización por hilo debe verificarse además en SQL. |
| `lib/messaging/instagram/business/api.js` | Asignaciones, enlaces CRM y citas llaman RPC `ig_business_*`. No son automáticamente compatibles con una conexión Facebook. |
| `lib/messaging/instagram/business/crypto.js`, `manual.js`, `store.js` | Reutilizar el diseño: cifrado autenticado, referencias HMAC, reserve/start/finish, un intento y estado incierto sin retry. No compartir namespace, ciphertext, claves ni token lifecycle. |
| `pages/api/webhooks/instagram-business.js` | Mantener intacto. Messenger recibe por un callback diferente y objeto `page`. |
| `lib/messaging/metaAdminInbox/` | Su lectura depende de `metaAdminCapture`, `ADMIN_SCOPE` y contexto administrativo. No es el transporte comercial de Facebook y no se conecta a este nuevo journal. |

Los principales riesgos para Instagram son ampliar sus RPC sin conservar reglas de plaza/asignación, unir usuarios por coincidencia de IDs, y reutilizar un secret/token incompatible. Esta entrega sólo añade archivos; no cambia esos caminos certificados.

## Contrato oficial de Meta

Documentación oficial consultada el 18 octubre 2026:

- [Overview Messenger](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview): Page access token, PSID específico de Página y permisos. Enumera `pages_messaging`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, `business_management`; la última aparece como dependencia. No se solicitan permisos en este PR.
- [Send API de Meta](https://www.postman.com/meta/messenger-platform-api/folder/vilwbh4/send-api): envío con Page token y tarea de mensajería. Transporte propuesto `POST https://graph.facebook.com/v26.0/{PAGE_ID}/messages`, `messaging_type: RESPONSE`, recipient PSID obtenido del inbound. Token sólo en header server-side.
- [Webhooks Messenger](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks): objeto `page`, campos `messages` y `message_echoes` para esta etapa. `message_deliveries` y `message_reads` se agregarán cuando exista procesamiento probado de sus estados. HMAC SHA-256 con App Secret de la app Facebook, sobre bytes originales. La firma se recibe en `X-Hub-Signature-256`. ACK tras persistencia durable, con objetivo menor de cinco segundos.
- [Rate limiting](https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview/rate-limiting): cuota general 200 × usuarios involucrados por 24 horas; Conversations 2 llamadas/segundo/Página; Send texto/enlaces hasta 300 llamadas/segundo/Página, audio/video 10. Hay límites por conversación y umbrales de alto volumen que afectan Inbox. No se usa esta cuota como autorización para envíos masivos. Un 429 es terminal para la acción, no dispara retry automático.
- [Pages Webhooks](https://developers.facebook.com/documentation/pages-api/webhooks-for-pages): instalación mediante `/{PAGE_ID}/subscribed_apps`, Page token y permisos correspondientes. Comentarios y cambios públicos usan `feed`, no `comments` de Instagram. Suscripción app-level y del activo deben pertenecer a la misma app; no reemplazar suscripciones existentes.

Para la primera etapa se aplica una ventana conservadora de 23 horas desde el inbound, dentro de las 24 horas ordinarias documentadas. No se implementan excepciones de anuncios, tags, marketing, Human Agent, ni Private Replies. `accepted` significa respuesta válida de Send API, no entrega ni lectura. Un echo observado no se atribuye a nuestra acción sin concordancia del message ID mediante HMAC.

### App Review y configuración pendiente

La documentación actual no permite afirmar automáticamente que Standard Access basta para todos los clientes: Overview exceptúa App Review para la propia Página, mientras Webhooks requiere Advanced Access para notificaciones de personas sin rol. Antes de activar hay que verificar el caso de uso, nivel efectivo de `pages_messaging`, dependencias y Business Verification en la app seleccionada. No declarar cuentas de terceros para superar un formulario.

No se ha inspeccionado ni modificado el nivel actual de permisos de una app Messenger durante este PR. La elección entre una app Messenger separada y la app existente queda como gate de conexión; no asumir que la app Instagram Login o el flujo administrativo ya proporcionan el Page token adecuado. Verificar app emisora, Página exacta, scopes efectivos, tareas del autorizante, validez/expiración y suscripciones mediante endpoints oficiales antes de guardar una credencial.

## Implementación de transporte

- `lib/messaging/facebook/messenger/`: configuración, cifrado, normalizador, sender, store y handlers.
- `/api/webhooks/facebook-messenger`: body parser apagado, límite 256 KiB, challenge, autenticación raw HMAC y transacción de captura. No llamadas Graph desde el receiver ni logging del evento.
- `/api/operaciones/facebook-messenger`: POST manual autenticado y same-origin; sólo acepta `{action,input,text}`. No endpoint de envío por PSID arbitrario. No está conectado todavía a la UI.
- Provider `facebook_messenger`; canal `facebook_dm`. Referencias HMAC y AAD incluyen app, Página, conexión, propósito y evento. PSID/message ID y contenido se cifran; no llegan a UI/logs.
- Texto soportado. Adjuntos se reconocen como `unsupported`, con tipos normalizados, sin descargar URLs ni afirmar que se visualizaron. Feed y otros eventos no implementados se cuentan como ignorados; no suscribirlos en esta etapa.
- Echo se guarda separado y nunca abre una ventana de respuesta. Una marca de eliminación recibida bloquea un reply al mismo message ID; no implica certificación real de UNSENT Messenger.
- `reserve → start → fetch único → finish`: restricciones únicas por acción y por inbound. Dos actions distintos para el mismo inbound tampoco duplican envío. SQL consulta kill-switch, perfil, grant exacto y freshness antes de claim y antes de iniciar dispatch.
- `dispatch_count=1` registra autorización de un intento de red, no prueba entrega. Si el proceso muere tras start queda `dispatching` sin reclaim; si falla la red o no hay respuesta inequívoca queda `uncertain`. No se vuelve a enviar. El cierre del gate impide nuevos starts, no cancela una petición ya iniciada.
- El resultado persiste ID de salida cifrado y su HMAC. Sólo HTTP/code/subcode numéricos salen del error Meta; nunca `error.message`, tokens, firma, payload o IDs nativos.
- `human_paused=true` es una garantía local del journal Messenger. No se invoca ningún modelo ni se modifica la pausa/IA de Instagram.

## Datos y ACL

Migración aditiva `supabase/migrations/20261018165210_facebook_messenger_foundation.sql`, no aplicada remotamente.

| Tabla privada | Contenido y controles |
| --- | --- |
| `connections` | App/Página/conexión explícitas; `enabled=false`, `sender_enabled=false` iniciales. |
| `credentials` | Page token cifrado, generación, scopes, verificación y `valid_until`. Sin tokens DEV/Instagram heredados. |
| `events` | Referencias opacas, timestamp, contenido y recipient cifrados. Dedup por conexión/evento y conexión/kind/message. Colisión de binding rechazada. |
| `thread_grants` | Perfil + conexión + hilo exacto + expiración + capacidad de reply. Sin bypass implícito para admin. |
| `actions` | Claim durable, actor, lease, input, texto cifrado, intento, resultado y referencia de salida. No reset/reclaim. |

RLS habilitada sin políticas de acceso directo. `anon`, `authenticated` y `service_role` no tienen acceso directo al schema/tablas. Sólo el backend service-role ejecuta seis RPC públicas limitadas con `search_path=pg_catalog`; cada operación humana verifica perfil activo y grant exacto. Ninguna RPC ni tabla de Instagram cambia. No existen rutas de creación de grants ni carga de credenciales en esta primera entrega.

El token store exige `PAGE`, scope `pages_messaging`, verificación menor de 24 horas y vigencia suficiente. `valid_until` es una lease conservadora; para tokens que Meta reporte sin expiración debe definirse y mantenerse mediante health check, no inventar un vencimiento del proveedor. El provisioning, introspección y mantenimiento de esa lease forman parte de la siguiente etapa, no están certificados aquí.

## Configuración futura exclusivamente DEV

Variables nuevas, sin valores en el repositorio:

- `FACEBOOK_MESSENGER_ENABLED` (ausente/false por defecto).
- `FACEBOOK_MESSENGER_MANUAL_SEND_ENABLED` (ausente/false por defecto).
- `FACEBOOK_MESSENGER_CONNECTION_ID`, `FACEBOOK_MESSENGER_APP_ID`, `FACEBOOK_MESSENGER_PAGE_ID`.
- `FACEBOOK_MESSENGER_APP_SECRET`, `FACEBOOK_MESSENGER_VERIFY_TOKEN`.
- `FACEBOOK_MESSENGER_INDEX_KEY`, `FACEBOOK_MESSENGER_DATA_KEY`, `FACEBOOK_MESSENGER_TOKEN_KEY`: tres claves hex de 32 bytes, distintas entre sí y exclusivas del canal/entorno.

No hay fallback a variables Instagram/legacy. La versión de Graph queda fijada en v26.0. Sólo se acepta `APP_ENV=test/development/preview`, proyecto Supabase DEV y nunca `VERCEL_ENV=production`.

## Inbox único y migración por etapas

1. **Este PR, etapa 1A:** transporte/journal de texto cerrados, fixtures locales y contrato de aislamiento. Revisar antes de cualquier conexión real.
2. **Etapa 1B:** decidir app/Page, verificar permisos efectivos, implementar provisioning y health de Page token, aplicar migración DEV tras aprobación, conectar callback DEV y certificar texto/echo con activos controlados. No alterar callback Instagram ni routing de Respond. No tocar Producción.
3. **Etapa 2:** adaptar la misma `/administracion/inbox`, no crear otra ruta ni otra bandeja. Extraer un contrato de canal para list/history/reply/media y mostrar `Todos / Instagram / Facebook / Comentarios`. La clave de selección será `{provider,connection,thread_ref}`. `Todos` combina únicamente resultados autorizados por backend; nunca fusiona personas por nombre/PSID coincidente. Cada fila muestra origen.
4. **CRM y permisos:** conservar `profiles`, clientes, propiedades y citas. Generalizar los enlaces hilo-cliente y asignaciones con provider/conexión explícitos, validando plaza/equipo/asesor mediante la misma política comercial vigente. Mantener adaptador Instagram y sus RPC durante transición. No habilitar una operación Facebook de propiedades/citas hasta superar equivalencia de permisos. Los grants de esta fase son más restrictivos, no una política general sustituta.
5. **Multimedia y estados:** imagen primero; después audio/video con MIME real, tamaño, URL validada, almacenamiento/entrega segura y pruebas. Agregar deliveries/reads con semántica propia de Messenger, sin inferirlos de HTTP 200. Certificar refresh, concurrencia y ausencia de reenvío en UI.
6. **Comentarios Facebook Shadow:** receiver `feed` separado de `facebook_dm`, journal de comentarios independiente y supervisión Dirección/Gerencia. Adaptar clasificador determinístico con fixtures Facebook: sólo consultas comerciales simples como candidatos; sensible, ambiguo o mixto a revisión. Sin llamadas Send API, respuestas públicas ni Private Replies desde Shadow. Validar permisos para lectura adicional de contenido de usuarios (`pages_read_user_content`) y administración pública (`pages_manage_engagement`) según endpoints realmente usados; no solicitarlos preventivamente para DMs. Investigar contrato vigente de Private Replies antes de una propuesta posterior, sin habilitarlo.
7. **Producción:** revisión de PR, validación DEV real y autorización expresa. Gate de código actual impide activación productiva; requiere cambio revisado, secretos/credencial exclusivos y canary posterior. No merge/deployment automático por este trabajo.

No backfill de histórico ni reinterpretación de ciphertext. Deshabilitar Messenger no altera Instagram. Conservar journal ante rollback; no borrar evidencia para repetir acciones.

## Evidencia local y pruebas restantes

Comandos:

```sh
node --test tests/facebookMessenger.test.mjs
IG_PG_DEPS=/ruta/de/dependencias IG_PG_BIN=/ruta/de/postgres/bin node tests/facebookMessengerPostgres.mjs
node --test tests/instagramOAuthCommentsScope.test.mjs tests/instagramCommentShadowSafety.test.mjs tests/instagramBusinessWebhookDiagnostic.test.mjs
npm run build
```

Resultados: 19 tests Messenger JS PASS; 51 verificaciones PostgreSQL PASS, incluidas ACL negativas, RLS, sender OFF, grant/actor inválidos, token stale, tombstone, concurrencia con dos conexiones y adapter real contra RPC SQL con HTTP simulado. 33 tests seleccionados de Instagram PASS (52 JS combinados). Build Next PASS, con advertencias de descarga de fuentes bajo red restringida. Todas las fixtures son sintéticas exclusivamente locales; cero llamadas reales Meta y cero migraciones remotas.

Baseline previo a cambios: `instagramBusinessReplyResult.test.mjs` falla en main en reconciliación de journal/fixture y una aserción de UI antigua. No se corrigió ni se presenta la suite completa de Instagram como PASS. Ningún archivo existente se modifica en esta etapa.

Antes de certificar Messenger real faltan: permisos efectivos/app elegida, token provenance/lease, migración y provisioning DEV, challenge/HMAC real, inbound de usuario controlado, reply autorizado, echo exacto y pruebas visuales del Inbox unificado. No hay `FACEBOOK_MESSENGER_PRODUCTION_PASS` ni autorización outbound derivada de estos tests locales.
# Fase 1B — provisioning DEV (2026-10-18)

Inspección real de Meta: Emporio Social `29650489627887372`, activa, producto Messenger presente. Messenger API Settings muestra callback vacío y ninguna Página conectada. `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list`, `business_management`: Standard Access. Esto NO acredita scopes de un token. Página `119960324707764` confirmada en el selector como EMPORIO INMOBILIARIO; identidad mediante `/me` con token de Página aún pendiente.

El botón Conectar del panel inicia OAuth con `pages_messaging,pages_utility_messaging`. No se confirmó ni se otorgó ese acceso adicional. Se preparó el consentimiento mínimo `pages_messaging,pages_manage_metadata,pages_show_list` sólo para Emporio; detenido antes de «Listo», pendiente de autorización del usuario. No se tocó Instagram ni sus suscripciones.

## Provisioning y salud

- `/operaciones/facebook-messenger-setup`: herramientas Admin DEV, NO otra bandeja.
- POST `/api/operaciones/facebook-messenger-setup`, cuerpo sólo `{operation:"provision"}` o `{operation:"health"}`. Sesión validada server-side + perfil activo admin + mismo origen.
- Token inicial exclusivamente desde `FACEBOOK_MESSENGER_PROVISIONING_PAGE_TOKEN` (secreto DEV server-side, nunca desde UI). Eliminar ese secreto transitorio tras verificar almacenamiento; no eliminar credenciales existentes ajenas.
- GET oficial `v26.0/debug_token` con App token, validación de app/profile, scopes, expiración y target granular; GET `/me?fields=id` con Page token; GET `/{PAGE_ID}/subscribed_apps` read-only. No suscribe ni solicita permisos automáticamente.
- Scopes mínimos exigidos por provisioning: `pages_messaging`, `pages_manage_metadata`. `pages_show_list` para seleccionar Página durante autorización; dependencias efectivas deben verificarse en Meta, no inferirse del panel.
- Guarda sólo token cifrado AES-GCM ligado a app/Page/conexión/generación/lease, scopes y metadata sanitizada. CAS por generación. No sustituye activos ni tokens de Instagram.
- Health descifra exclusivamente en servidor y vuelve a consultar Meta; no renueva/rota el token Meta. Nueva lease local <=24h y nunca posterior a expiración o data-access expiry. Un resultado fallido NO acredita health PASS. No hay mantenimiento automático aún.
- Provisioning requiere sender OFF en env y DB, no abre grants y jamás habilita sender. La API no acepta token, PSID, Page ID ni controles outbound en el request.

## Receptor DEV público

Los proyectos Vercel inspeccionados tienen Deployment Protection. No se desactivó. Receptor aditivo en el proyecto Supabase DEV existente:

`https://hjfwjnejbcpmknvfpdcq.supabase.co/functions/v1/facebook-messenger-dev`

Usa el MISMO `captureMessenger`/cifrado que el handler Next; autenticación por raw HMAC, JWT de Supabase no exigido a Meta. Entry point `supabase/functions/facebook-messenger-dev/index.ts`. No incluye sender ni APIs de administración. Debe recibir sólo configuración `FACEBOOK_MESSENGER_*` exclusiva DEV; identidad Supabase exacta fijada en código. Sin `ENABLED=true` devuelve 404. No usar como callback hasta provisionar claves/secret y certificar challenge real.

Aplicadas sólo en `inmoadmin-dev` (`hjfwjnejbcpmknvfpdcq`): foundation y provisioning. 5 tablas RLS; 7 RPC sólo service_role; anon/authenticated sin EXECUTE ni lectura. Advisor señala RLS sin políticas: intencional deny-all en schema privado; acceso exclusivamente RPC service-only con comprobación del actor. No abrir políticas para eliminar ese aviso.

## Pendiente real

1. Autorizar Messenger para la Página exacta sin permisos utility innecesarios; acreditar Page Access Token y app emisora. No hay token real validado aún.
2. Provisionar App Secret general de esta app y claves nuevas DEV (no Instagram App Secret); cargar token transitorio sólo como secreto server-side. Nada de copiar credenciales por chat.
3. Guardar configuración del mismo Messenger tanto en Preview como en receptor DEV. Certificar health y challenge; suscribir `messages` y `message_echoes` preservando las demás integraciones.
4. Un inbound controlado real de usuario con rol de app, comprobar HMAC/persistencia/deduplicación. Todavía NO ejecutado.
5. Outbound real sólo después de autorización explícita del usuario. Sender permanece OFF; no grants.
6. Inbox omnicanal posterior reutiliza `/administracion/inbox`; este cambio no agrega una bandeja ni modifica UI Instagram.

Fuente introspección: https://developers.facebook.com/docs/graph-api/reference/debug_token/ (v26.0, inspeccionada en navegador). App Review/Advanced Access para usuarios no-role continúa pendiente; no interpretar Standard como permiso general para clientes.
# Inbox único DEV — lectura y composer manual

`/administracion/inbox` monta `CommercialInbox` sólo cuando Messenger está habilitado fuera de Production. Los filtros Todos/Instagram/Facebook/Comentarios comparten un listado con clave `canal:thread_ref`. El detalle de Instagram sigue siendo el componente existente mediante props opcionales; la ruta productiva mantiene su comportamiento anterior.

Facebook usa `fb_messenger_inbox_v1`, exclusivo de service_role, con identidad obtenida por `authorizeInboxStaff`. Mantiene grants exactos, vigentes, incluso para administradores. No hereda asignaciones ni identificadores Instagram. La respuesta HTTP excluye ciphertext, recipient, token y IDs nativos; el contenido se descifra server-side. Una anulación oculta contenido y una acción terminal impide volver a ofrecer respuesta sobre ese inbound.

El composer envía texto al sender durable ya certificado. Bloquea doble click y conserva bloqueo tras resultado incierto; refrescar sólo hace GET. El kill-switch y claim siguen siendo definitivos en DB. No se habilitó sender ni se hicieron envíos reales en esta etapa.

Validación: 37 tests JS, 70 checks PostgreSQL efímero, prueba JSX real con APIs sintéticas en desktop y móvil 390px (1 POST por doble click, 0 por refresh), build Next completo con configuración sintética. La migración adicional se aplica únicamente en DEV. Carlos recibe sólo lectura del único hilo controlado existente por 24 horas, sin `can_reply`.

Pendiente: autorización expresa para grant de respuesta y sender temporal en prueba real; verificar health/freshness antes del envío. Multimedia Messenger, gestión de asignación desde UI, propiedades y citas Facebook aún requieren adaptadores propios; no se invocan APIs de Instagram con refs Facebook. No se presentan esas funcionalidades como certificadas.

## Certificación manual real y preparación cerrada — 18 octubre 2026

Esta sección actualiza los pendientes históricos anteriores; no acredita activación productiva.

Único envío autorizado al inbound controlado `FBDEV-DIAG-20261018-02`: validación de credencial vigente, ventana y binding antes del claim. Reply `FBDEV-REPLY-20261018-01`, recibido visiblemente en Messenger a las 13:04:32 México. Meta HTTP 200 accepted; 1 claim, 1 dispatch, 1 echo correlacionado exactamente por outbound_ref, 0 retries. Nueva lectura del Inbox no produjo otro envío. Kill-switch DB OFF, grant temporal can_reply retirado y variable Preview manual-send false. Redeploy cerrado READY `dpl_3DoiEfbK7KTGZp8sGLFjUScT9Pcm` sobre b745a96. La autorización de un envío está consumida.

Código preparado para Production sólo con opt-in explícito `FACEBOOK_MESSENGER_ROLLOUT=closed_manual`, APP_ENV production, VERCEL_ENV production y URL exacta de Supabase Production. ENABLED y MANUAL_SEND siguen siendo gates independientes y OFF por defecto; la misma comprobación restringe setup e Inbox. No se provisionó ni desplegó Production. La ruta única sigue siendo `/administracion/inbox`.

### Requisitos pendientes antes de activar clientes reales

1. Acreditar Advanced Access de pages_messaging/App Review. La inspección previa de permisos mostró Standard; el panel Messenger actual aún indica solicitar pages_messaging y revisión para usuarios sin rol. El PASS de la cuenta controlada no acredita ese acceso. No se solicitó ni cambió ningún permiso.
2. Tras aprobación explícita, aplicar las tres migraciones Messenger en Production, verificar ACL/RLS service-only y tests negativos. No copiar grants ni ciphertext DEV.
3. Provisionar claves nuevas de cifrado/índice/token y conexión productiva independiente; Page token validado server-side contra app, Página, permisos y expiraciones. Health tiene lease máxima de 24 horas: requiere comprobación operativa antes de vencer; no hay renovación automática ni garantía de disponibilidad indefinida.
4. Preparar callback público `/api/webhooks/facebook-messenger`, challenge/HMAC y suscripción Page messages/message_echoes. La misma app tiene callback Page DEV: planificar corte explícito sólo del objeto Page; no modificar callback Instagram, Respond ni routing. Nunca desproteger Inmoadmin para resolverlo.
5. Con sender OFF, certificar inbound productivo y grants exactos de operador/hilo. Sin grant no hay lectura ni respuesta, incluso para admin. No existe todavía gestión avanzada de asignaciones Facebook desde UI.
6. Sólo con nueva autorización, habilitar una respuesta canary manual y comprobar 1 claim/dispatch/echo, recepción y cierre inmediato. Resultado incierto es terminal, sin retry. Reversión: DB sender OFF primero, env false después; cerrar grants temporales sin borrar journal.

No se necesita implementar propiedades, citas ni automatizaciones para este canary básico. IA, private replies y envíos automáticos permanecen fuera del alcance. PR #201 abierto: sin merge ni despliegue productivo.

