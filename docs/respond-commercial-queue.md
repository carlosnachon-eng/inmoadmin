# Acuse durable de Respond — propuesta sin rollout

Base: `e53c4fb7950a67cf558f789ae8ea8cf145f5fcc8` (#168). No incluye #169 ni asignación protegida #167.

## Arquitectura exacta

1. El receptor conserva el parser, límite de body y HMAC multiclave existentes. Para `message.received` en los cuatro canales comerciales prepara un envelope sanitizado: texto acotado, presencia de adjunto, atribución explícita y referencias públicas de catálogo (no URLs ni adjuntos crudos).
2. `enqueue_respond_commercial_v1` confirma **una transacción**: transporte en `gv_respond_webhook_events`, receipt mediante el trigger existente de #165 y fila en `respond_commercial_jobs`. Una excepción revierte las tres partes. Colisión de identidad falla cerrada.
3. Sólo la prueba `durable=true` permite HTTP 200. Error, respuesta malformada o timeout de la RPC producen 503. El cliente aborta la espera a los 3500 ms; una confirmación cuyo resultado se perdió se resuelve mediante la misma clave en la siguiente entrega. Esto no es un SLA de cold start/red de Vercel.
4. `/api/cron/respond-commercial-worker`, cada minuto, usa el `CRON_SECRET` existente. Máximo 20 capturas por invocación y presupuesto de bucle de 40 s, función de 60 s. Claim `SKIP LOCKED`, FIFO por contacto/canal, token y lease de 120 s. Un lease vencido vuelve a ser reclamable.
5. El worker reconstruye exclusivamente el envelope y llama a la captura Social existente. #165 sigue creando ruta + input especializado + receipt terminal atómicamente, conservando CAS y tratamiento de tardíos. Los crons existentes de Sales/Owner/Legal consumen los inputs y ejecutan modelos/envíos **fuera del request de recepción**. No se los invoca por HTTP ni se usa `waitUntil` como cola.
6. `finish_respond_commercial_v1` exige el token vigente y deriva el estado terminal del receipt; no confía en que el cliente declare éxito. Si falta confirmación, backoff de 30–150 s; tras cinco fallos finalizados, revisión. Caída antes del finish: lease recuperable. Caída después de capture: la recuperación reutiliza el receipt/ruta/input existente, sin segunda captura especializada.

`complete` significa **captura comercial durable**, no generación ni entrega efectiva. El journal del agente sigue siendo la evidencia de ejecución; `message.sent` es necesario para acreditar entrega real en una futura vigilancia.

## Límites y compatibilidad

- Claves: event ID y `(canal, contacto, message ID)`. Duplicados conservan el primer envelope y estado terminal, aun si el proveedor cambia el delivery ID.
- No backfill, barrido histórico, reseteo de inputs ni replay masivo. Un transporte preexistente sin job y sin captura terminal queda en revisión al repetir el mismo evento; no se crea un dispatch histórico.
- Social OFF: recepción durable y trabajo retenido. **Ya no permite fallback comercial legacy** en esos cuatro canales. No se cambia el valor de ningún flag.
- Recepción no comercial, snapshots y eventos humanos siguen su camino previo. #168 y sus ACL/funciones/trigger no se modifican. Autoría `sender_source=user`, pausa y retorno explícito se preservan.
- Ningún cambio al selector comercial de #169, prompts, asignaciones, workflows, Recovery/SLA o handoff URL.
- Los estados de agente ya consumidos, `dispatch_started`, `sent` o inciertos no se resetean: revisión, nunca retry ciego. Recuperar captura pendiente no equivale a autorizar repetir un efecto remoto incierto.
- Cambia la latencia comercial: depende de dos turnos de cron. Sin backlog puede añadir hasta aproximadamente dos minutos, más modelo; bajo carga los consumidores existentes (un input por ejecución) limitan el caudal. Vigilar antigüedad de ambas colas. No se promete respuesta comercial en menos de 5 s: ese objetivo es del **acuse**.
- Falta de identificadores estables o fallo de persistencia responde no-200 y no autoriza agentes. Supervisar esos errores para evitar otra desactivación del webhook; no reactivarlo automáticamente.

## Seguridad de DB

Una tabla nueva con RLS, tres funciones internas `SECURITY DEFINER` con `search_path=''`, dos índices de cola. Revocación explícita de privilegios heredados sobre esos objetos; service_role sólo SELECT directo y EXECUTE en estas RPC. PUBLIC/anon/authenticated sin acceso. No modifica defaults globales ni ACL de #168. El control por roles y los grants se prueban con defaults equivalentes a Producción.

## Certificación

- 274 pruebas focalizadas Node (269 Social/HMAC/pausa + 5 nuevas de envelope, timeout y autenticación del cron).
- 77 regresiones PostgreSQL de Social/#165 PASS: reservas de handoff/ACK/citas, alias del proveedor, concurrencia, P0001/CAS, empates y eventos tardíos.
- PostgreSQL efímero real: 28 escenarios de cola + 17 escenarios #168, incluyendo concurrencia independiente, rollback de la transacción por fallo de INSERT, recuperación de lease, crash posterior a capture, 12 combinaciones agente/canal, duplicados, P0001 y tardíos. 19 llamadas de modelo y 16 envíos interceptados en los escenarios de cola; cero llamadas externas. Cluster eliminado, residuos 0.
- HTTP real en loopback con parser/HMAC/handler y DB real: 200 en **8.01 ms**; otra petición mientras el modelo tarda deliberadamente 5.5 s, **1.46 ms**. Timeout de persistencia no produce ACK falso (3501 ms, rechazado). No son mediciones de Vercel.
- DEV real `hjfwjnejbcpmknvfpdcq`: seis escenarios (Sales/Owner/Legal: enqueue/receipt/duplicado y recuperación/route/input/pausa). RPC/DB reales mediante relay SQL. Inputs en cuarentena para crons y pausa humana sintética previa; cero modelos y mensajes reales. Envíos no pausados se certifican localmente, no se exponen a senders DEV. Cleanup de fixtures 0.
- Migración DEV ledger `20261006034011`; archivo `20261006033141_respond_commercial_queue.sql`. SHA-256 repo = ledger: `40f3b60836cd1f563ae98b1992c4da170b235a5580f1720122d8fbe25a4e0f98`. RLS/ACL y las tres RPC PASS; cola DEV vacía al terminar.
- Build Next 14 PASS con URL/clave sintéticas de loopback, sin credenciales. Advertencias de optimización de fuentes por red restringida. El primer build sin configuración pública falló en la prerenderización de una página existente (`supabaseUrl is required`); no fue un fallo de compilación del parche.

Evidencia sanitizada local: `/private/tmp/respond-durable-ack-cert.zXy59a/` (`local-postgres.json`, `dev-result.json`, `dev-postcheck.json`, `dev-cleanup.json`). No equivale a envío Respond real ni a cobertura natural productiva.

## Rollout mínimo, NO ejecutado

1. Revisar HEAD/diff, confirmar salud/flags actuales y preflight de #168. Verificar que el scheduler y `CRON_SECRET` existentes estén disponibles. Acreditar drenaje de workers incompatibles antes del cambio.
2. Con autorización nueva, aplicar exactamente esta migración en Producción y ejecutar `supabase/checks/respond_commercial_queue.sql`. Comparar hash; no aplicar migraciones ajenas.
3. Merge autorizado y un deployment; comprobar READY/SHA/aliases. Sin cambios Respond ni configuración de negocio. Esta rama tiene preview automático deshabilitado.
4. Seguir un inbound natural nuevo: HTTP/TTFB <5000 ms, transporte + job/receipt, captura, input, run y outbound + `message.sent` o pausa justificada. Comprobar Active en Webhook 8 y ausencia de duplicados/backlog persistente. No Send Test/replay.
5. Si hay regresión atribuible, rollback de código al deployment previo compatible con #168, sin borrar cola/receipts/auditoría/ACL. El código viejo vuelve al acuse síncrono y no drena la nueva cola: conservar pendientes, reportarlos y requerir una corrección compatible autorizada; no repetir efectos ni vaciar tablas para aparentar recuperación.
