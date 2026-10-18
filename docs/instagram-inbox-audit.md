# Instagram DM + comentarios: auditoría y frontera local

Fecha: 2026-10-11. Base: `03cb180ff725c990ae7d16b42cfb9d8584e960ca`.
Estado: implementación **parcial y desconectada**, no integración operativa.
Sin endpoint, DB, migración, OAuth, suscripción, modelo, sender ni cambios Respond.

## Evidencia del repositorio

| Pieza | Hallazgo / reutilización |
|---|---|
| `lib/social/routing.js` | Canal Respond `497382` identificado como Instagram. No acredita el ID de cuenta profesional Meta ni permisos actuales. No modificar routing ni reactivar el backlog. |
| `lib/messaging/provider.js`, `events.js`, `registry.js` | Contrato neutral existente. Registry permite Respond y mantiene Meta desconectado. No ampliar silenciosamente el significado del provider Meta WhatsApp. |
| `pages/api/webhooks/meta.js`, `metaObserver/receiver.js`, `config.js` | Receptor actual exclusivo WABA/phone Administration. Reutilizar patrón raw-body HMAC + persistencia durable antes del ACK, no su scope ni RPC. No conectar Instagram aquí sin adapter explícito. |
| `metaAdminInbox/read.js` | List/detail y gates atados al scope Admin. Reutilizar presentación/patrón de proyección, no consultar las RPC WhatsApp con IDs Instagram. |
| `metaAdminInbox/manual.js` | Reserva/pausa antes de dispatch y un intento. Reutilizar invariantes; el transporte phone/wamid no es un sender Instagram. |
| `metaAdminCapture/conversationMemoryReader.js` | Reader exige evidencia nativa WhatsApp. Necesita adapter Instagram con scope de hilo, no simplemente otro subject. |
| `metaAdminCapture/conversationMemory.js` | Motor de episodios/patrón CAS reutilizable; taxonomía Admin no equivale a clasificación comercial Instagram. |
| `lib/shadow/canonicalReadOnlyContext.js` | Núcleo canónico por client_identity_id reutilizable sólo tras bridge exacto acreditado. Username/IGSID no son identidad interna. |

## Capacidades y permisos a acreditar

Existen dos familias de autenticación. No mezclar permisos, tokens ni hosts. La sesión/token efectivo de esta cuenta **no ha sido auditado en esta entrega**.

| Operación | Instagram Login | Facebook Login | Recepción / salida propuesta |
|---|---|---|---|
| Comentarios propios y respuestas | `instagram_business_basic` + `instagram_business_manage_comments` | `instagram_basic` + `instagram_manage_comments` + `pages_read_engagement` | `comments`; lectura de comentario/media y `/{comment-id}/replies` para respuesta pública, sujeto a documentación/versionado vigente |
| DMs recibir/enviar | `instagram_business_basic` + `instagram_business_manage_messages` | `instagram_basic` + `instagram_manage_messages`; verificar `pages_manage_metadata` para suscripción y permisos de Page de la ruta elegida | `messages`, `messaging_postbacks`, `messaging_seen` según capacidades efectivas. No suponer receipts WhatsApp. |
| Identificar media origen | Misma cuenta profesional autorizada | Cuenta profesional + Page vinculada | Guardar ID nativo exacto de media y root/parent del comentario; resolver permalink/tipo mediante lectura autorizada, no URL aportada por cliente |
| Reels | Moderación de media propio; verificar payload y acceso efectivo | Igual | Tratar Reel como media origen; no inventar webhook `reels_comments` |
| Menciones | **Pendiente confirmar cobertura exacta de esta modalidad** | Mentions disponible en API Facebook Login; verificar campo `mentions`, permisos y restricciones vigentes | Distinguir @mention en caption/comentario, story mention en mensajería y tag. Nunca interpretar todos como DM ni dar permiso de respuesta por una mención |
| Ocultar/eliminar | Permiso de comentarios no basta como autorización del operador | Igual | Capacidad OFF; cada acción requiere autorización explícita, scope de media propio y journal independiente |
| Comentario → DM | Private Replies, no DM libre | Private Replies, no DM libre | Verificar ventana/regla oficial vigente antes de habilitar. Un comentario no abre automáticamente ventana estándar de DM. |

No solicitar scopes de publicación de contenido para este alcance. Standard/Advanced Access y roles de app/cuenta se verifican en la app real antes de conectar; tener un scope no prueba autorización operativa.

Fuentes primarias consultadas:
- Colección oficial Meta: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-ab559ffb-8e2c-4b0a-b43a-5737b6d2f672
- Mensajería oficial Meta: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-3a63181c-e5c6-4890-96dd-e4d425bef5e0
- Conversations oficial Meta: https://www.postman.com/meta/messenger-platform-api/folder/22794852-255610cd-47f5-4f4d-b3fa-71aec360be9a
- Referencias pendientes de lectura completa (429/no accesibles durante consulta): https://developers.facebook.com/docs/instagram-platform/webhooks/ y https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/comment-moderation/ y https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/private-replies

La tabla es checklist de implementación; NO certificación de permisos actuales. No activar menciones/moderación/private replies basándose sólo en esta tabla.

## Frontera de hilos implementada localmente

- `instagram_dm`: cuenta profesional + IGSID exacto, privacidad private.
- `instagram_comment`: cuenta + media + root comment exactos, privacidad public. Las respuestas deben tener relación parent/root acreditada; si falta, no unir por tiempo/autor/texto.
- La memoria usa el threadRef, nunca sólo el subjectRef. Varios autores pueden participar en un hilo público; conservar autor por mensaje. No incorporar contexto privado de ninguno en una respuesta pública, incluso con identidad matched.
- Referencia comentario→DM explícita y exacta, sin fusionar memorias, sin conceder datos, sin reanudar IA y sin conceder envío. Username coincidente no acredita igualdad de sujetos entre superficies.
- `deliveryRef` y `sourceRef` son claves proyectadas: aún no existe UNIQUE/claim durable. No confundir pruebas de estabilidad con certificación de idempotencia transaccional.
- `human_confirmed` exige journal de operador autenticado; echo solo queda `business_outbound_unattributed`. El futuro adapter debe comprobar la existencia/relación del journal, no confiar en un ID recibido por HTTP.
- Todas las acciones retornan disconnected. No existe bypass vía flags ni una función sender.

## Integración restante (sin cambios remotos)

1. Auditoría read-only de cuenta IG/Page/app, modalidad de login, permisos/nivel efectivo, suscripciones y control de conversación con Respond. No desconectar ni modificar routing de Respond. Si ambos pueden responder, Inmoadmin permanece observer-only.
2. Adapter firmado y journal privado Instagram aditivo: evento/revisión nativa, cuenta, sujeto, media/root/parent, dirección, evidencia de autor, contenido sanitizado restringido. No payloads crudos ni URLs/token en logs. Sin ID estable/revisión acreditada: conservar observación incierta, sin efectos.
3. Lectura Inbox con filtros DM/comentarios, enlace al post, etiquetas público/privado. Proyección pública sin contrato/renta/pagos. Identidad y fuentes privadas se autorizan por contexto canónico en DM únicamente.
4. Adapter de memoria + clasificación + attention separado por hilo. Reserva manual debe pausar durablemente antes del dispatch; desconocido/conflicto bloquea IA. No reanudación automática. No usar las filas WhatsApp ni alterar #168.
5. Journal de acciones público/DM/private-reply/moderación separados; claim atómico por acción, un intento, uncertain sin retry. ACK/accepted no equivale a entrega. Status sólo por evidencia nativa disponible.
6. Pruebas DEV de HMAC, ACL, aislamiento, concurrencia, revisión de contenido, pausa y control de Respond; posteriormente revisión/activación explícita. No responder, ocultar ni eliminar durante auditoría.

## Pruebas de esta entrega

`node --test tests/instagramThreadBoundary.test.mjs` (Node v24.19.0): **18/18 PASS**.
Fixtures sintéticos, sin red. Separación de cuentas/sujetos/superficies/root, relación exacta de replies, entrega repetida, atribución, ausencia de identidad inferida y handoff sin grants.
No se afirma PASS DEV, UI integrada, persistencia, recepción real ni permisos productivos.
