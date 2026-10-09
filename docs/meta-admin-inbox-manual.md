# Inbox Admin — bloque 2 local: respuesta manual y pausa durable

Base `694c12cad4b304ab2aa19eca35151d7c7ff3572a`. Sin merge, DEV, Producción,
modelos ni mensajes reales. El bloque read-only conserva API/reader/SQL; el
detalle suma un endpoint manual separado y una consulta de pausa en el snapshot.

## Capacidades y protocolo

1. Auth existente: Supabase `getUser` + perfil activo `admin/coord_operaciones`;
   POST exige mismo origen. Body exacto `{input_id,action_id,text}`. Nunca recipient,
   teléfono, actor, propiedad, contrato, token ni clave escogidos por navegador.
2. RPC fija verifica sujeto nativo, scope Admin, actor, ausencia de edit/revoke y
   ventana 24h del inbound elegido. Reutiliza evidencia nativa y veto staff.
   `unmatched` con sujeto Meta acreditado puede recibir respuesta humana; no recibe
   por ello contexto privado. `unknown` de identidad externa no convierte en staff;
   falta de evidencia **nativa** o error de lectura bloquea.
3. Destinatario cifrado se descifra sólo server-side, validando AAD, HMAC y digest
   canónico con el helper existente, ahora compartido sin importar política de IA.
4. Reserva inserta acción inmutable + pausa en UNA transacción. Cada UUID global
   de acción tiene un token exclusivo. Duplicado (también con texto distinto) no
   gana otra reserva. No reset/reclaim/delete/retry. La pausa es de conversación
   completa WABA/phone/subject/key_tag, sin inferir un episodio ni ofrecer resume.
5. `start` revalida actor, sujeto/scope y ventana; consume un marcador de dispatch
   una sola vez. Sólo el ganador puede hacer HTTP. El transporte Meta compartido
   conserva timeout, redirect:error, texto sin preview y una sola llamada.
6. `accepted` requiere un wamid válido. Error 4xx acreditado = failed; timeout,
   5xx, respuesta inválida o fallo de finalización = uncertain. Nunca repetir.
   Reserva o dispatch interrumpidos permanecen consumidos y pausados. Un marcador
   sin resultado se muestra uncertain: no se afirma que hubo envío.
7. Delivery se proyecta de recibos durables Meta existentes por **wamid + scope**,
   sin otro caller/trigger del webhook. Sent/delivered/read/failed y sus tiempos
   no se inventan desde HTTP. Estados fuera de orden no degradan read; conflicto
   failed + delivered/read se muestra uncertain/contradictory.

## Journal, ACL y RPCs

Migración local `20261009150550_meta_admin_inbox_manual.sql` (generada con CLI):

SHA-256: `dd319309f38a0cd404eb52f7a20bd5d038837a137a9579f201c21f1e75083b3c`.

- `meta_admin_private.manual_actions`: input/scope/sujeto/key_tag, actor,
  sender_source `inmoadmin_authenticated_operator`, texto sanitizado, token y hora.
- `manual_events`: append-only dispatch + outcome; wamid sólo en accepted.
- `manual_attention`: append-only, paused=true, human_manual_reply, actor/hora/acción.
- RLS y revocación de acceso directo para PUBLIC/anon/authenticated/service_role.
- Triggers rechazan UPDATE/DELETE de esos tres journals. Sin cambios a defaults.
- Sólo service_role ejecuta seis RPCs fijas:
  `meta_admin_manual_load_v1`, `meta_admin_manual_reserve_v1`,
  `meta_admin_manual_start_v1`, `meta_admin_manual_finish_v1`,
  `meta_admin_manual_status_v1`, `meta_admin_manual_attention_v1`.

No RPC genérica ni SQL arbitrario. Load cifrado nunca se devuelve al navegador.
`human_confirmed` en UI identifica autoría de la acción autenticada; el estado
separado NO afirma entrega. App echo sigue unattributed, nunca acredita humano.

## Interlock con IA (no con Respond)

Los snapshots Supabase/Postgres leen la pausa. Falta de RPC/evidencia = fallo cerrado.
Shadow/controlled gate bloquea; el post-gate invalida una propuesta en curso.
Triggers mínimos de inicio de modelo Admin/media y dispatch AI comparten advisory
lock de sujeto con la reserva manual. Si humano gana, no puede iniciar la IA.
Si IA ya cruzó dispatch y sigue incierta/en curso, manual bloquea antes de reservar.
No se cancela ni reintenta un efecto remoto previo. Modelo ya iniciado puede acabar,
pero su propuesta se invalida. #168 y Respond no se modifican. Auto-outbound OFF.

## UI y flag

`/administracion/inbox`: composer hasta 2,000 caracteres; doble clic bloqueado con
ref síncrono + botón disabled; acción retenida tras respuesta/pérdida de red.
Indicador «IA pausada por atención humana», lista de mensajes manuales/estados y
consulta de estado sin reenvío. Sólo tras accepted ofrece redactar **otro** mensaje.
No resume. Un UUID diferente es otra acción explícita, no dedupe por texto o tiempo.

Endpoint `/api/operaciones/meta-admin-inbox-manual`: GET de estado y POST manual.
`META_ADMIN_MANUAL_REPLY_ENABLED` debe ser literalmente `true`; por defecto OFF.
Reutiliza `META_ADMIN_OUTBOUND_ACCESS_TOKEN` y claves de captura server-side.
No se ha configurado ninguna variable. Instalar migración antes de cualquier
eventual runtime nuevo: si falta la RPC de pausa, el snapshot falla cerrado.

## Verificación y límites

Resultado final focalizado: **105/105 JS**, **95 comprobaciones PostgreSQL local**
y **UI Chromium PASS** (página JSX real; Layout/sesión/APIs simulados). Cleanup del
cluster desechable = 0. Sends reales = 0, modelos reales = 0, writes de negocio = 0.
No es certificación del Layout global ni build completo de Next.

UI verificada: doble clic produce un POST; reserva aceptada muestra pausa; consulta
de estado no reenvía; uncertain bloquea composer. Captura sintética local guardada
fuera del repo. La API/readers del bloque 1 no se editaron; sólo su fixture de
snapshot incluye ahora la lectura adicional de pausa.

- Focalizadas JS: journal/sender interceptado, auth, recipient manipulado,
  unmatched, incertidumbre, pausa/post-gate y paridad del transporte controlado.
- PostgreSQL local efímero: ACL/RLS, append-only, doble claim/start con dos sesiones,
  reserva/pausa atómicas, delivery exacto fuera de orden, uncertain sin retry,
  interlock humano/IA en ambos órdenes con transacciones realmente superpuestas.
- Fuentes de identidad/procedencia del test PostgreSQL son fixtures/stub explícitos;
  NO se presenta esto como certificación DEV alojada ni prueba de fuentes reales.
- Un test antiguo de `metaAdminShadowContext.test.mjs` falla también en un checkout
  temporal del HEAD base: su fixture rechaza RPCs de memoria ya usadas por #185.
  La corrida amplia de ese archivo encontró 14 fallos de integración; el control
  basal reprodujo el caso matched. No se modificó esa suite para ocultarlo. Las
  20 pruebas de transporte/política afectadas sí se ejecutan separadas y pasan.
- Sin unión automática entre claves rotadas ni recuperación histórica de adjuntos.
- No certificación alojada, build completo o autorización de rollout por este diff.
