# Acuse durable de Respond — propuesta sin rollout

Base: `e53c4fb7950a67cf558f789ae8ea8cf145f5fcc8` (#168). No incluye #169 ni asignación protegida #167.

**Corte de revisión: NO APTO PARA MERGE.** La mejora de mismo-ciclo está implementada, pero el nuevo escenario obligatorio 5 (fallo dentro del modelo → recuperación automática por lane) queda **BLOQUEADO** por un límite preexistente. Los crons sólo seleccionan `captured`; Sales/Legal quedan `processing` y Owner `failed`. La guarda Social rechaza `processing/failed → captured` con `social_reexecution_requires_review`. No se ha relajado esa guarda, reseteado estados ni añadido otra política de reintentos. Recuperación de captura y recuperación de ejecución no son equivalentes.

## Arquitectura exacta

1. El receptor conserva el parser, límite de body y HMAC multiclave existentes. Para `message.received` en los cuatro canales comerciales prepara un envelope sanitizado: texto acotado, presencia de adjunto, atribución explícita y referencias públicas de catálogo (no URLs ni adjuntos crudos).
2. `enqueue_respond_commercial_v1` confirma **una transacción**: transporte en `gv_respond_webhook_events`, receipt mediante el trigger existente de #165 y fila en `respond_commercial_jobs`. Una excepción revierte las tres partes. Colisión de identidad falla cerrada.
3. Sólo la prueba `durable=true` permite HTTP 200. Error, respuesta malformada o timeout de la RPC producen 503. El cliente aborta la espera a los 3500 ms; una confirmación cuyo resultado se perdió se resuelve mediante la misma clave en la siguiente entrega. Esto no es un SLA de cold start/red de Vercel.
4. `/api/cron/respond-commercial-worker`, cada minuto, usa el `CRON_SECRET` existente. Hasta 20 capturas rápidas dentro de 40 s y **como máximo un intento de lane** por invocación. Función de 180 s: presupuesto de captura + los 120 s de los procesadores existentes + margen; no inicia otro agente después. Claim `SKIP LOCKED`, FIFO de captura por contacto/canal, token y lease de 120 s. Sólo un job no terminal con lease vencido vuelve a ser reclamable.
5. El worker reconstruye exclusivamente el envelope y llama a la captura Social existente. #165 sigue creando ruta + input especializado + receipt terminal atómicamente, conservando CAS y tardíos. **Después de confirmar `finish` con el token vigente**, sólo si esa captura creó un inbound SALES/OWNER/LEGAL nuevo, llama a `processSocialRouteImmediate` con los procesadores existentes. Conserva debounce/coalescencia, claim atómico de la lane, reglas y #168; ejecuta modelo/envío en **ese mismo worker**, nunca en el request de recepción. Los imports de procesadores sólo están en el cron. No se invocan crons por HTTP ni se usa `waitUntil` como cola.
6. `finish_respond_commercial_v1` exige el token vigente y deriva el estado terminal del receipt; no confía en que el cliente declare éxito. Si falta confirmación, backoff de 30–150 s; tras cinco fallos finalizados, revisión. Caída antes del finish: lease recuperable. Caída después de capture: la recuperación reutiliza el receipt/ruta/input existente, sin segunda captura especializada.

`complete` significa **captura comercial durable**, no generación ni entrega efectiva. El journal del agente sigue siendo la evidencia de ejecución; `message.sent` es necesario para acreditar entrega real en una futura vigilancia.

La cola queda terminal antes del modelo: caída entre finish y claim de lane deja un input `captured` que el cron existente sí retoma; caída o excepción tras consumir el claim conserva exactamente el estado de la lane. Una captura recuperada con `created=false`, un token perdido o un finish incierto nunca vuelve a llamar al modelo desde la cola. El resultado heredado `fallback_to_existing_lane` **no acredita recuperación**: hay que inspeccionar el estado persistido. No existe recuperación automática certificada del fallo de modelo consumido (bloqueo indicado arriba).

## Límites y compatibilidad

- Claves: event ID y `(canal, contacto, message ID)`. Duplicados conservan el primer envelope y estado terminal, aun si el proveedor cambia el delivery ID.
- No backfill, barrido histórico, reseteo de inputs ni replay masivo. Un transporte preexistente sin job y sin captura terminal queda en revisión al repetir el mismo evento; no se crea un dispatch histórico.
- Social OFF: recepción durable y trabajo retenido. **Ya no permite fallback comercial legacy** en esos cuatro canales. No se cambia el valor de ningún flag.
- Recepción no comercial, snapshots y eventos humanos siguen su camino previo. #168 y sus ACL/funciones/trigger no se modifican. Autoría `sender_source=user`, pausa y retorno explícito se preservan.
- Ningún cambio al selector comercial de #169, prompts, asignaciones, workflows, Recovery/SLA o handoff URL.
- Los estados de agente ya consumidos, `dispatch_started`, `sent` o inciertos no se resetean: revisión, nunca retry ciego. Recuperar captura pendiente no equivale a autorizar repetir un efecto remoto incierto.
- Camino nuevo sin backlog: un turno de cron + debounce existente (hasta 4 s) + modelo/DB/transporte; se elimina la segunda espera de cron para una captura nueva válida. Si `SALES_AGENT_V2_IMMEDIATE_ENABLED=false` o `SALES_AGENT_V2_AUTO_SHADOW_ENABLED` no es `true`, se conserva el gate existente: Sales queda para su lane, sin alterar flags. Bajo carga no se promete ausencia de backlog; cada invocación inicia como máximo un agente. Vigilar antigüedad de ambas colas. El objetivo de menos de 5 s corresponde al **acuse**, no a la respuesta comercial.
- Falta de identificadores estables o fallo de persistencia responde no-200 y no autoriza agentes. Supervisar esos errores para evitar otra desactivación del webhook; no reactivarlo automáticamente.

## Seguridad de DB

Una tabla nueva con RLS, tres funciones internas `SECURITY DEFINER` con `search_path=''`, dos índices de cola. Revocación explícita de privilegios heredados sobre esos objetos; service_role sólo SELECT directo y EXECUTE en estas RPC. PUBLIC/anon/authenticated sin acceso. No modifica defaults globales ni ACL de #168. El control por roles y los grants se prueban con defaults equivalentes a Producción.

## Certificación

### Recertificación mismo-ciclo (sin merge ni deployment)

- 305 pruebas focalizadas Node PASS. Build Next 14 PASS con configuración sintética de loopback; advertencias de fuentes remotas, sin credenciales.
- 33 comprobaciones de cola en PostgreSQL efímero: mismo-ciclo Sales/Owner/Legal en los cuatro canales, duplicados, lease/token, crash tras ACK/capture, transacción fallida, pausa antes del modelo y antes del envío, P0001/tardíos, cero handoff/citas. Incluye **tres controles que reproducen el bloqueo del escenario 5**, no tres éxitos de recuperación. El comando de certificación sale no-cero por ese bloqueo.
- 17 regresiones #168 y 77 regresiones Social/#165 PASS, sin cambiar sus funciones, triggers ni ACL.
- ACK loopback: 7,96 ms inicial y **5,29 ms con modelo concurrente de 5500 ms**. Recepción→outbound interceptado: **9532,37 ms** con debounce real. Sumando una fase de cron simulada de 60000 ms: **69532,37 ms**; segunda espera de cron = 0. No es latencia medida en Vercel/DEV ni un SLA productivo.
- 26 llamadas de modelo y 20 intentos de transporte interceptados; uno se fuerza a resultado incierto y no se reintenta. Cero tráfico externo. Cluster eliminado y residuos 0.
- DEV real: seis escenarios PASS de enqueue/receipt/duplicado y lease/route/input/**procesador mismo-ciclo** para Sales/Owner/Legal. #168 bloqueó los tres antes de modelo/envío. RPC/DB reales por relay SQL; fixtures en cuarentena, cero llamadas externas, cleanup 0. Esto es un PASS del subconjunto DEV, **no PASS global** ni entrega Respond real. Los caminos no pausados y la latencia se certificaron localmente con IO interceptado.
- Migración DEV `20261006034011` sin reaplicar ni cambiar bytes: SHA repo/aplicado `40f3b60836cd1f563ae98b1992c4da170b235a5580f1720122d8fbe25a4e0f98`. Postcheck real RLS/ACL/3 RPC PASS; sin DDL ni defaults globales modificados.
- Para cerrar el escenario 5 hace falta acordar aparte una recuperación durable y cercada de **ejecución**, con evidencia de ausencia de efectos/resultado incierto. No basta resetear el inbound ni reutilizar el lease de captura; eso violaría las guardas que deben permanecer intactas.

Evidencia de esta revisión: `/private/tmp/respond-durable-ack-cert.kPTOUE/`.

### Certificación previa del acuse durable (antes de la mejora de latencia)

- 274 pruebas focalizadas Node (269 Social/HMAC/pausa + 5 nuevas de envelope, timeout y autenticación del cron).
- 77 regresiones PostgreSQL de Social/#165 PASS: reservas de handoff/ACK/citas, alias del proveedor, concurrencia, P0001/CAS, empates y eventos tardíos.
- PostgreSQL efímero real: 28 escenarios de cola + 17 escenarios #168, incluyendo concurrencia independiente, rollback de la transacción por fallo de INSERT, recuperación de lease, crash posterior a capture, 12 combinaciones agente/canal, duplicados, P0001 y tardíos. 19 llamadas de modelo y 16 envíos interceptados en los escenarios de cola; cero llamadas externas. Cluster eliminado, residuos 0.
- HTTP real en loopback con parser/HMAC/handler y DB real: 200 en **8.01 ms**; otra petición mientras el modelo tarda deliberadamente 5.5 s, **1.46 ms**. Timeout de persistencia no produce ACK falso (3501 ms, rechazado). No son mediciones de Vercel.
- DEV real `hjfwjnejbcpmknvfpdcq`: seis escenarios (Sales/Owner/Legal: enqueue/receipt/duplicado y recuperación/route/input/pausa). RPC/DB reales mediante relay SQL. Inputs en cuarentena para crons y pausa humana sintética previa; cero modelos y mensajes reales. Envíos no pausados se certifican localmente, no se exponen a senders DEV. Cleanup de fixtures 0.
- Migración DEV ledger `20261006034011`; archivo `20261006033141_respond_commercial_queue.sql`. SHA-256 repo = ledger: `40f3b60836cd1f563ae98b1992c4da170b235a5580f1720122d8fbe25a4e0f98`. RLS/ACL y las tres RPC PASS; cola DEV vacía al terminar.
- Build Next 14 PASS con URL/clave sintéticas de loopback, sin credenciales. Advertencias de optimización de fuentes por red restringida. El primer build sin configuración pública falló en la prerenderización de una página existente (`supabaseUrl is required`); no fue un fallo de compilación del parche.

Evidencia sanitizada local: `/private/tmp/respond-durable-ack-cert.zXy59a/` (`local-postgres.json`, `dev-result.json`, `dev-postcheck.json`, `dev-cleanup.json`). No equivale a envío Respond real ni a cobertura natural productiva.

## Rollout mínimo, NO ejecutado

No iniciar este plan mientras el escenario 5 siga bloqueado y no exista nueva revisión/autorización. La mejora de latencia por sí sola no cierra los requisitos de recuperación solicitados.

1. Revisar HEAD/diff, confirmar salud/flags actuales y preflight de #168. Verificar que el scheduler y `CRON_SECRET` existentes estén disponibles. Acreditar drenaje de workers incompatibles antes del cambio.
2. Con autorización nueva, aplicar exactamente esta migración en Producción y ejecutar `supabase/checks/respond_commercial_queue.sql`. Comparar hash; no aplicar migraciones ajenas.
3. Merge autorizado y un deployment; comprobar READY/SHA/aliases. Sin cambios Respond ni configuración de negocio. Esta rama tiene preview automático deshabilitado.
4. Seguir un inbound natural nuevo: HTTP/TTFB <5000 ms, transporte + job/receipt, captura, input, run y outbound + `message.sent` o pausa justificada. Comprobar Active en Webhook 8 y ausencia de duplicados/backlog persistente. No Send Test/replay.
5. Si hay regresión atribuible, rollback de código al deployment previo compatible con #168, sin borrar cola/receipts/auditoría/ACL. El código viejo vuelve al acuse síncrono y no drena la nueva cola: conservar pendientes, reportarlos y requerir una corrección compatible autorizada; no repetir efectos ni vaciar tablas para aparentar recuperación.
