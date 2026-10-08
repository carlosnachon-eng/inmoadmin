# Meta directo: observador de Administración

Estado: implementación local para revisión. Sin deployment, suscripción Meta,
credenciales nuevas, migración remota ni tráfico real de prueba. Respond sigue
siendo el único proveedor comercial activo.

Base: `1859e06f3d80f0d998be5c956ae3fd296bbecdf5` (main, merge de #172).
Rama: `codex/meta-admin-observer`. El alcance se limita a recibir observaciones
del futuro par WABA/phone_number_id acreditado para Administración, canal Respond
`544519`. Ese canal es una etiqueta de alcance, **no un puente de identidad**.

## Flujo y límites

`POST Meta → HMAC sobre bytes originales → normalización y allowlist → RPC transaccional → journal → HTTP 200`.

- `GET`: verifica `hub.mode=subscribe`, token y challenge; devuelve el challenge
  como texto. No consulta ni escribe DB. Un GET exitoso no certifica persistencia.
- `POST`: valida `X-Hub-Signature-256` con el App Secret antes de interpretar JSON.
  Máximo 256 KiB y 100 observaciones por lote. Se rechaza íntegro un lote mixto
  que incluya otro WABA o número.
- La aplicación y la DB exigen el mismo par exacto WABA/phone_number_id. No hay
  listas abiertas, comodines ni fallback al número principal de Ventas.
- HTTP 200 sólo tras confirmación durable de la RPC. Persistencia fallida o
  respuesta incompleta de DB: 503. Duplicado: reutiliza la observación existente.
- No hay consumer, trigger comercial, inputs especializados, modelos, sender,
  workflow, assignment, descarga de media ni modificación de la pausa humana.
- El registry y el provider Meta comercial de #172 no cambian. El adaptador
  observador es independiente; `sendText` y `sendMedia` siempre rechazan.

HTTP: 404 deshabilitado; 503 configuración/DB no disponible; 401 firma inválida;
403 token GET o alcance POST rechazado; 400 payload inválido; 413 tamaño excesivo;
415 formato no JSON; 405 método no permitido. No se registran cuerpos, cabeceras,
tokens ni errores libres del proveedor/DB.

## Eventos e identidad

Se normalizan `messages.messages[]` entrantes, `messages.statuses[]` con estados
`sent`, `delivered`, `read`, `failed`, y `smb_message_echoes.message_echoes[]`.
Edición/revocación conservan el ID nativo de la observación y `original_message_id`;
no se convierten en un nuevo turno entrante. Estados no soportados se cuentan como
ignorados, no se traducen a éxito.

La referencia oficial de [smb_message_echoes](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_message_echoes)
acredita origen WhatsApp Business App/dispositivo vinculado, no la identidad de un
operador. Por eso los ecos quedan con `author.kind=unknown` y evidencia
`smb_message_echoes_app_origin`. No se fabrica `sender_source=user`, no se infiere
humanidad por asignación o por ausencia de journal y no se escribe en #168.

El evento interno reutiliza el contrato neutral de #172, pero conserva
`providerContactId`, `partyId` y `episodeId` sin resolver. No cruza teléfono,
`wa_id`, nombre o texto con contactos Respond. No trata el campo Meta
`conversation.id` como episodio comercial.

El journal minimiza datos: IDs nativos, tipo/estado, timestamps, códigos numéricos
de error, evidencia de origen y hash del cuerpo recibido. **No almacena texto,
teléfonos, nombres, URLs de media, tokens ni payload completo**. No constituye
material para replay comercial.

Deduplicación definitiva: `(WABA, phone_number_id, event_type, native_message_id)`.
El `event_key` combina sólo tipo e ID nativo. Cada etapa de status es distinta;
timestamp, teléfono, contenido y hash no definen identidad. La primera observación
es inmutable, incluso si un retry cambia el cuerpo. No se audita cada reentrega
por separado. Estados tardíos no sobrescriben etapas anteriores.

En coexistencia, Respond y Meta pueden observar el mismo mensaje. Se mantienen
journals separados; no se declara deduplicación entre proveedores sin un puente
acreditado. Meta no puede crear segundos efectos comerciales porque no alimenta
ningún procesador. Conectar agentes requeriría otra revisión y autorización.

## Archivos del diff

Todos son aditivos; no se modifica ningún archivo existente.

| Archivo | Propósito |
| --- | --- |
| `pages/api/webhooks/meta.js` | Endpoint Next, raw body, cliente DB server-only existente |
| `lib/messaging/providers/metaObserver.js` | Adaptador receive-only y validación HMAC |
| `lib/messaging/metaObserver/config.js` | Guardas y allowlist exacta |
| `lib/messaging/metaObserver/normalize.js` | Eventos neutrales minimizados, sin identidad inferida |
| `lib/messaging/metaObserver/receiver.js` | GET/POST, validación y persistencia durable |
| `supabase/migrations/20261008162624_meta_admin_observer.sql` | Dos tablas nuevas y una RPC aislada |
| `tests/fixtures/metaObserver.mjs` | Fixtures sintéticos en formatos oficiales |
| `tests/metaObserver.test.mjs` | 57 pruebas locales/interceptadas |
| `tests/metaObserverPostgres.mjs` | Certificación SQL/RPC/ACL real en PostgreSQL local efímero |
| `docs/meta-admin-observer.md` | Alcance, configuración, pruebas y rollback |

Sin cambios en Respond, senders, registry comercial, routing, agentes, #165, #168,
#170, #171, #169, workflows, asignaciones, dependencias o lockfiles.

## Migración y permisos

SHA-256 de `20261008162624_meta_admin_observer.sql`:
`cb24e2402bbdc71b2f63326b92b83ccc480af0bf853c9eea306128aece187e97`.

- `meta_observer_admin_scope`: singleton inicialmente **vacío**, `enabled=false`
  por defecto. Fija el futuro par acreditado de Administración. El servicio no
  puede crear ni cambiar esa vinculación.
- `meta_observer_events`: append-only, `state=observed`, `observer_only=true`,
  unique key nativa, índice temporal, FK sólo a la tabla nueva de alcance.
- `observe_meta_admin_events_v1(text,text,text,jsonb)`: `SECURITY INVOKER`,
  `search_path=''`, validación de alcance y lote atómico. Inserts en orden estable
  y `ON CONFLICT DO NOTHING` para concurrencia/retries.
- RLS en ambas tablas. Revokes explícitos únicamente sobre objetos nuevos.
  Sin modificación de default privileges ni objetos ajenos.

| Objeto | service_role | anon / authenticated / PUBLIC |
| --- | --- | --- |
| Alcance | SELECT | Ningún acceso directo |
| Journal | SELECT, INSERT | Ningún acceso directo |
| RPC | EXECUTE | Sin EXECUTE |

No UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER para service_role en estas tablas.
Los propietarios de DB conservan las facultades administrativas inherentes.
No hay trigger de aplicación ni worker. La migración no configura un WABA real
ni habilita el endpoint.

## Configuración futura: no aplicada

Endpoint exacto a registrar **después de revisión y autorización**:
`https://app.emporioinmobiliario.com.mx/api/webhooks/meta`.

| Variable privada server-side | Valor requerido |
| --- | --- |
| `META_ADMIN_OBSERVER_ENABLED` | Sólo `true` habilita; ausente/otro valor = OFF |
| `META_ADMIN_WABA_ID` | WABA real acreditado de Administración |
| `META_ADMIN_PHONE_NUMBER_ID` | phone_number_id real acreditado de Administración |
| `META_OBSERVER_APP_SECRET` | App Secret vigente de la app Meta propietaria del webhook |
| `META_OBSERVER_VERIFY_TOKEN` | Secreto aleatorio independiente, idéntico al introducido en Meta |

**No se ha generado ni configurado el verify token.** El valor esperado por GET es
exactamente `META_OBSERVER_VERIFY_TOKEN`; admite 32–256 caracteres URL-safe.
Para la futura configuración segura se recomienda generar 32 bytes aleatorios
codificados en hex (64 caracteres). No usar los valores de fixtures, no reutilizar
el App Secret o la firma Respond y no guardar secretos en Git, chat o capturas.

Se reutiliza exclusivamente el cliente Supabase server-only ya existente y sus
guardas de entorno. No se necesita access token Meta, clave OpenAI o token Respond
para este receptor. No se crean credenciales ni se llama a Graph API.

Faltan acreditar los IDs Meta reales y su relación administrativa con `544519`.
La suscripción no está probada. Antes de conectar: verificar propiedad de la app,
WABA, número y permisos Coexistence, además de que el alta no reemplace ni altere
la integración existente de Respond. No sobrescribir callbacks ni subscribed apps
a ciegas. Revisar los campos `messages` y `smb_message_echoes` por separado.

La futura activación requiere una vinculación DB aprobada y variables coincidentes.
El handshake GET por sí solo no demuestra que esa vinculación exista. Nada de esto
se ejecuta como parte del parche local.

## Fixtures y certificación local

Los fixtures son **sintéticos**, con IDs, teléfonos y contenido ficticios siguiendo
las estructuras oficiales; no son capturas reales sanitizadas ni evidencia de
entrega de Meta. Fuentes consultadas el 2026-10-08:

- [Verificación GET y firma POST](https://developers.facebook.com/docs/graph-api/webhooks/getting-started).
- [Mensajes entrantes](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages).
- [Estados de mensajes](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status).
- [Ecos de WhatsApp Business App, ediciones y revocaciones](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_message_echoes).

Resultado: **206/206 PASS** — 57 nuevas y 149 existentes de paridad/regresión
Respond, normalización, HMAC, Social, pausa humana y cola durable. Ejecución
combinada ~3.769 s; sin build o suites ajenas al alcance.

```sh
node --test --test-reporter=dot \
  tests/metaObserver.test.mjs \
  tests/messagingNormalization.test.mjs \
  tests/messagingProviderParity.test.mjs \
  tests/messagingReceiverParity.test.mjs \
  tests/respondWebhookMultiHmac.test.mjs \
  tests/socialWebhookIntegration.test.mjs \
  tests/humanAttention.test.mjs \
  tests/respondCommercialQueue.test.mjs
```

PostgreSQL local real, cluster efímero con defaults amplios equivalentes a
Supabase: **8/8 escenarios PASS**, 1,249 ms desde inicialización a comprobación
final. Dependencias de prueba externas al proyecto: `embedded-postgres` y `pg`.
El runner sólo acepta una ruta de dependencias locales; no admite URL/credenciales
de una DB remota. Bloquea `fetch` y usa conexiones exclusivamente a loopback.

```sh
META_OBSERVER_TEST_DEPS=/ruta/absoluta/a/node_modules \
  node tests/metaObserverPostgres.mjs
```

| Escenario PostgreSQL | Resultado |
| --- | --- |
| Migración con scope vacío no habilita persistencia | PASS |
| ACL/RLS, PUBLIC EXECUTE, defaults y objeto ajeno intactos | PASS |
| RPC real: inbound/media/status/echo/edit/revoke | PASS |
| Seis consumidores concurrentes: 1 insert y 5 duplicados | PASS |
| Retry tras ACK perdido: observación inmutable, sin nuevo trabajo | PASS |
| Lote inválido revierte todos sus inserts, sin 200 falso | PASS |
| Binding DB distinto o deshabilitado bloquea | PASS |
| Ausencia de objetos comerciales, consumers y triggers de aplicación | PASS |

Cleanup: **0 filas** en journal/scope tras pruebas; cluster detenido y efímero.
**0 modelos, 0 envíos, 0 fixtures remotos, 0 conexiones DB remotas**.

Limitaciones: no certificación alojada ni entrega natural Meta, no medición HTTP
productiva, no atribución individual de ecos, no puente de identidad y no
deduplicación comercial cross-provider. PASS local no equivale a alta productiva.

## Rollback futuro

Si se autoriza una conexión posterior y aparece una anomalía: deshabilitar sólo
`META_ADMIN_OBSERVER_ENABLED` y aplicar el deployment de configuración necesario,
o revertir únicamente el release del observador. Si se requiere retirar la nueva
suscripción, hacerlo sólo tras comprobar que pertenece al observador y no afecta
Respond. No tocar suscripciones compartidas sin esa comprobación.

Conservar ambas tablas, observaciones y ACL restrictivas. No borrar datos ni
deshacer migraciones antiguas. No cambiar flags comerciales, pausa #168, cola
#170, workflows, asignación ni el número principal. El journal no tiene mecanismos
de replay, por lo que no hay backlog comercial que despachar al reactivar.

En esta fase no se ha desplegado ni conectado nada; no hay rollback productivo
que ejecutar. Siguiente corte: revisión del diff y de la estrategia de vinculación,
sin autorización implícita para publicar, suscribir o activar.
