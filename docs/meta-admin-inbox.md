# Meta Admin Inbox — diseño mínimo y bloque read-only local

El segundo bloque local (manual + pausa) se documenta en `meta-admin-inbox-manual.md`.
El estado read-only de este documento corresponde a su certificación original.

Base: `694c12cad4b304ab2aa19eca35151d7c7ff3572a` (#185). Sin cambios remotos.

## Arquitectura y límites

La Inbox es una superficie de operador, no un agente ni una autorización de envío.
`/administracion/inbox` llama una API autenticada (`admin`/`coord_operaciones`, perfil activo),
que usa RPCs service-role-only para lectura y el núcleo canónico server-side para contexto.
Conversación = WABA + phone_number_id + subject_ref + key_tag exactos. No teléfono,
matching temporal, Respond ni unificación automática después de rotación de claves.
Se usa el input más reciente como identificador opaco de navegación; no identifica un cliente.

## Reutilización

- `authorizeShadowAdministrator`: sesión verificada por Supabase + perfil activo.
- `meta_observer_events`, `inbound_inputs`, `native_subject_evidence`: historial durable.
- `resolve_meta_admin_identity_v1`, `meta_admin_memory_evidence_v1`: identidad y veto staff.
- `canonicalReadOnlyContext`: roles y entidad única derivados server-side; sin IDs del navegador.
- `meta_admin_memory_read_v1`: revisiones existentes; filtrar por fingerprint y scope actuales.
- `shadowOnceGate`: diagnóstico de disponibilidad shadow, no permiso para enviar.
- `decryptAccreditedRecipient` y el transporte HTTP del controlled outbound: extracción futura
  a módulo compartido, sin copiar reglas de negocio del outbound automático.
- Recibos `message.sent/delivered/read/failed`: única prueba de entrega, por wamid exacto.

El nombre no se infiere del teléfono ni del texto: el modelo canónico actual no tiene un
display_name acreditado genérico. V1 muestra identidad acreditada/no identificada y referencias
opacas; un nombre requerirá una fuente canónica explícita. App echoes actuales no conservan
texto: mostrar «Salida observada; contenido no disponible», no reconstruirlo.

## Rutas/archivos

- `pages/administracion/inbox.js`: lista, detalle cronológico, contexto y estados.
- `pages/api/operaciones/meta-admin-inbox.js`: GET exclusivamente, autenticación existente.
- `lib/messaging/metaAdminInbox/read.js`: DTO allowlisted/contexto canónico read-only.
- `scripts/sql/meta-admin-inbox-read.sql`: propuesta de dos RPCs privadas en privilegios.
- Futuro bloque manual: `manual.js`, `manualStore.js`, endpoint POST separado y transporte
  Meta compartido; no cron, webhook caller, modelo ni acción de negocio.

## Migraciones estrictamente necesarias

1. Lectura: dos RPCs fijas con search_path cerrado y EXECUTE sólo service_role. No tablas
   nuevas para Inbox, mensajes, identidades, contratos o memoria. SQL queda como borrador
   local: aún no es migración timestamped, ni ha sido aplicado en DEV/Producción.
2. Manual/pausa: journal privado `manual_actions` (action UUID único, input, sujeto/key tag,
   actor autenticado, cuerpo restringido, estado de dispatch, wamid aceptado) y eventos
   append-only `manual_action_events` (reserva/dispatch/resultado/pausa). No guardar teléfono,
   URL firmada, media ID o token. RLS cerrado; sólo RPCs de operaciones concretas.
   No nueva tabla de delivery: leer los recibos Meta existentes por wamid + scope exactos.
   La pausa puede derivarse de eventos de reserva sin tabla paralela de estado.

## Protocolo manual propuesto (NO implementado/activado en bloque read-only)

1. Validar sesión activa, rol autorizado, mismo origen, texto y action UUID estable del cliente.
2. Resolver input/sujeto exacto, destinatario cifrado, scope y ventana de servicio; veto staff.
   Unmatched puede enviar texto manual sin contexto privado, pero no autoriza datos canónicos.
3. RPC reserva atómica: action UUID + hash de texto + actor + input inmutables. Misma clave
   con diferente contenido => conflicto. Misma clave consumida => devolver journal, jamás enviar.
   Registrar toma humana/pausa ANTES del dispatch (también si posteriormente falla).
4. Un único token CAS marca dispatch_started y autoriza una llamada al transporte existente.
   Revalidar actor/scope/ventana inmediatamente antes. Fallo de persistencia => cero HTTP.
5. HTTP aceptado => accepted, NO sent. Timeout/respuesta inválida/crash => uncertain,
   jamás retry/reclaim. 4xx acreditado => failed. No reenviar automáticamente al recargar UI.
6. Sent/delivered/read se acreditan con recibos firmados del mismo wamid. Conservar tiempos
   individuales; no regresión por estados fuera de orden. Unknown no equivale a failed.
7. Acción autenticada acredita intervención/toma humana, no entrega. `human_confirmed`
   como mensaje enviado exige además resultado/recibo exacto; app echo solo sigue unattributed.

## Pausa: dependencia real, no reutilización ficticia

`lib/agentsV2/humanAttention.js` y #168 son Respond-specific. NO se llama con subject Meta,
ni se altera #168. Meta tiene gates de ecos, no Human Attention nativo completo instalado.
Reutilizar el patrón: reserva durable, token/CAS, fail-closed y post-gate. Añadir consulta
de pausa Meta al snapshot de Shadow y al controlled outbound, incluidos starts durables;
post-gate invalida propuesta si apareció toma humana durante modelo. Sin resume ni cierre
inferido en v1. Pausa de conversación completa (más conservadora que por asunto).
Un dispatch remoto ya iniciado no se puede cancelar retrospectivamente. Auto-outbound OFF
es prerrequisito; antes de habilitarlo debe certificarse arbitraje entre dispatch automático
y toma humana bajo concurrencia. No atribuir ausencia de duplicados a una lectura aislada.

## Bloques de implementación

1. Read-only local: lista/detalle, auth, sujeto exacto, contexto mínimo, adjuntos no abiertos.
2. PostgreSQL local: RPCs de lectura, RLS/ACL y paginación, aislamiento/staff/ambigüedad.
3. Journal manual + pausa + transporte compartido, pruebas concurrentes y fallos en cada límite.
4. Composer con confirmación explícita, action UUID persistente, botón bloqueado ante incertidumbre.
5. DEV con transporte interceptado. Revisión independiente antes de rollout; cero sends reales.

## Riesgos concretos / no prometer MVP operativo todavía

- Historial sólo desde captura Meta; ecos sin contenido y adjuntos históricos no recuperables.
- Rotación de key_tag separa conversaciones; no inventar equivalencias.
- Ventana 24h exige timestamp inbound nativo válido; fuera de ventana sin plantillas en v1.
- Diferentes clics/action UUID pueden ser dos mensajes legítimos: idempotencia no es dedupe textual.
- Caída tras dispatch => incertidumbre visible, sin botón de reenvío automático.
- Permisos iniciales conservadores admin/coord_operaciones; no ampliar roles silenciosamente.
- Sin contexto canónico único no mostrar importes ni contratos ajenos.
- La Inbox read-only no ejecuta/actualiza memoria ni modelo, ni certifica que IA esté habilitada.

El seguimiento post-#185 permanece independiente y activo. No se despliega este bloque.

## Estado del diff local

Implementado sólo bloque 1: página, API GET autenticada, reader/DTO y borrador de RPCs.
15/15 JS focalizadas PASS. PostgreSQL efímero local PASS para sintaxis, aislamiento por sujeto
y key_tag, veto staff, ejecución service_role sin SELECT directo. En esta prueba SQL identidad
y procedencia son stubs sintéticos; no equivale a certificación DEV completa.
Lista inicial hasta 30 conversaciones; detalle hasta 100 registros con aviso de truncamiento.
No preview visual/build Next ejecutado todavía. El composer está deliberadamente deshabilitado.
Sin migración aplicada, el endpoint falla cerrado; no es una Inbox productiva operativa todavía.
Pendientes bloques 2 ampliado (fuentes completas), 3 y 4 antes de poder declarar MVP manual usable.
Modelos reales=0, sends=0, escrituras remotas/de negocio=0. Pruebas SQL locales usan fixtures
y eliminan su base efímera; no instalan nada en DEV/Producción.
