# Acuse durable de Respond — revisión de PR #170

Base: `e53c4fb7950a67cf558f789ae8ea8cf145f5fcc8` (#168). Sin #169/#171 ni asignación #167. **Sin merge ni Producción.**

## Dictamen y alcance de la evidencia

**PASS técnico local de los escenarios obligatorios**, incluido fallo confirmado de modelo → recuperación de ejecución. **Cierre global: NO PASS todavía**, por certificación E2E alojada pendiente. No es certificación de entrega real Respond ni de latencia/capacidad productiva.

- 312 pruebas focalizadas Node; build Next 14 (código de aplicación sin cambios desde el build certificado).
- PostgreSQL efímero real: 48 escenarios de cola/recuperación + 17 de #168; 77 regresiones separadas de #165. Modelos y transporte interceptados, cero llamadas externas.
- DEV alojado: seis escenarios de procesadores reales bloqueados antes del modelo por #168; 30 escenarios adicionales de transiciones de las RPC reales (10 por lane), RLS/ACL/hash y cleanup 0.
- El relay de integración DEV tuvo un error de nombre de tabla en el harness, corregido; una repetición sufrió timeout de aprobación del conector y terminó fail-closed en revisión. Ambos cleanups dieron 0. **No se presenta esa repetición como PASS ni como ejecución completa de retry/envío en DEV alojado.** Por ello, las transiciones RPC DEV se certificaron en una transacción corta; el flujo completo con segundo modelo y envío interceptado se certificó localmente con PostgreSQL real.
- Evidencia: `/private/tmp/respond-durable-ack-cert.Sh4PUM/`. Conserva también los intentos fallidos del harness; `dev-rpc-certification.json` es la certificación RPC final.

### Reintento acotado del cierre DEV — 2026-10-06

La recuperación de aplicación sigue exactamente en `fb5f214a3ad57ecee0c7eee2fd24e57b007a0e48`: no cambian funciones, migración, leases ni permisos. La repetición local volvió a dar 48 escenarios de cola/recuperación + 17 de pausa PASS.

El arnés admite `QUEUE_DEV_FULL_RECOVERY=true`: usa las implementaciones de los tres procesadores y del sender Sales, modelos/HTTP interceptados, y un reloj de aplicación de prueba desplazado siete días. El reloj de DB y su lease de 180 s no se sustituyen. El debounce futuro protege los inputs frente a los pollers y los runs quedan obsoletos para la ventana de edad del sender de fondo; la prueba focalizada comprueba ese descarte con la configuración por defecto. No se modifican flags de ningún despliegue. El transporte interceptado admite exclusivamente refs sintéticas propias.

El relay PTY debe arrancar con `stty -icanon -echo min 1 time 0`; se observó saturación de entrada (BEL) en el modo canónico. Una ejecución anterior fue interrumpida por el coordinador tras interpretar incorrectamente progreso todavía bufferizado; no constituye fallo de aplicación ni de permisos. Su auditoría se conserva en `/private/tmp/respond-durable-ack-cert.96zzLQ9d/`. Otra ejecución documentó expiración del segundo lease antes de verify: claim 12:53:55.480353Z, verify 12:58:17.251174Z, terminal review_required/execution_uncertain, un run, cero outbound; evidencia `/private/tmp/respond-durable-ack-cert.IIHgzC5c/`.

La última ejecución con entrada corregida terminó **FAIL de certificación**: esperaba `complete` y recibió `review_required`. Se completaron 53 consultas del relay sin error SQL, con 479134 ms acumulados dentro de las llamadas al conector y máximo 34174 ms por llamada (no es duración SQL del servidor). Cleanup automático e independiente: 0. Evidencia `/private/tmp/respond-durable-ack-cert.PiP4PSZ9/{dev-result,dev-cleanup,relay-metrics}.json`. No acredita retry→envío completo alojado para ninguna de las tres lanes; el arnés se detuvo al primer caso fallido. Los anteriores 30 casos RPC DEV y los E2E PostgreSQL locales siguen siendo evidencia válida, pero no reemplazan ese cierre.

No se amplía el lease ni se omite una comprobación para acomodar el conector. Para cerrar ese pendiente hace falta una vía de ejecución DEV de baja latencia, con acceso autorizado y la misma intercepción/aislamiento, antes de repetir; no más ciclos por este relay ni acceso a Producción.

## Arquitectura del acuse y del worker

1. HMAC, parser y límite de body sin cambios. En los cuatro canales comerciales, el webhook normaliza un envelope sanitizado y llama a `enqueue_respond_commercial_v1`.
2. Una transacción confirma evento + receipt de #165 + job. Sólo `durable=true` autoriza HTTP 200. Error/malformed/timeout (3500 ms) → 503, nunca ACK falso; el retry del proveedor resuelve la misma clave durable.
3. El worker autenticado por `CRON_SECRET` corre cada minuto. Claim de captura con SKIP LOCKED, FIFO por contacto/canal, token y lease de 120 s. Captura reutiliza #165, CAS y tardíos. Finish deriva el terminal del receipt.
4. Sólo una captura nueva con input especializado llama a los procesadores existentes de Sales/Owner/Legal en ese mismo worker. No hay modelo en el webhook ni segunda espera obligatoria de cron de lane. Preserva debounce, prioridades y #168.
5. El presupuesto sigue siendo 180 s: hasta 40 s de capturas y **un intento de lane por invocación**. Antes de capturar, el worker puede tomar una recuperación elegible del journal nuevo. No inicia un segundo modelo en esa invocación.
6. Captura y ejecución son estados distintos. `respond_commercial_jobs.complete` no prueba respuesta ni entrega. Una caída antes del claim de lane deja el input capturado para el mecanismo existente.

## Recuperación de ejecución acotada

`respond_commercial_executions` pertenece al inbound/ruta/evento exactos, no al contacto de forma indefinida.

- Sólo jobs nuevos tras esta migración son elegibles. La nueva columna recibe false para los jobs existentes; el default true afecta únicamente inserts futuros. Sin backfill ni adopción de inbounds processing/failed sin journal.
- Todos los entrypoints de las tres lanes usan la misma RPC de claim. Lock, token exclusivo y lease de **180 s**; máximo **dos intentos totales**. Ningún reset a captured. La función/trigger `guard_social_inbound_v1` permanece idéntica y sigue rechazando `social_reexecution_requires_review`.
- Fase `claimed`: aún no se autorizó el modelo. Un fallo de contexto previo o crash/lease vencido puede permitir el segundo intento.
- Fase `model`: checkpoint durable inmediatamente antes de crear sesión. Sólo un estado terminal **failed explícito del proveedor**, con sessionRef hasheada y sin herramientas/efectos/runs previos, permite retry. Espera mínima de 30 s, retomada por el siguiente ciclo.
- Antes de cualquier herramienta, publicación de run o efecto se cruza la fase irreversible `effects`. Cualquier run/outbound/handoff existente también impide otra generación. Timeout, respuesta perdida, crash en model/effects o efecto reservado → revisión, **nunca retry ciego**.
- Nuevo token tras recuperación invalida al trabajador anterior. Se vuelve a verificar token, lease, ruta vigente y #168 antes del modelo/efectos, y antes del envío. Las guardas finales existentes de #168 no se sustituyen.
- Agotamiento → `review_required/attempts_exhausted`, con los intentos y motivos retenidos. La pantalla y API read-only de Social muestran la revisión sólo a admin activo, sin tokens, texto ni sesiones crudas. No hay botón de replay/retry.
- Una pausa entre intentos termina esa ejecución como paused; una devolución explícita #168 sólo habilita turnos futuros, no reabre ese inbound.

| Regresión requerida | Resultado local con DB real y IO interceptado |
|---|---|
| Sales falla modelo antes de sender | Dos modelos (uno fallido, uno exitoso), un run y un outbound |
| Owner igual | PASS |
| Legal igual | PASS |
| Crash/concurrencia | Un segundo intento; token anterior rechazado |
| dispatch_started / sent / incierto / reserva | Cero retry; evidencia outbound inmutable |
| #168 entre intentos | Cero segundo modelo/envío |
| Duplicado webhook | Una ruta/input/ejecución; no crea intento adicional |
| Agotamiento | Revisión visible tras dos fallos; no loop |

La prueba DEV RPC cubre esas transiciones para las tres lanes, pero no sustituye el E2E de agentes local ni demuestra concurrencia entre conexiones remotas. La concurrencia usa conexiones PostgreSQL locales independientes.

## Latencia medida (no SLA productivo)

HTTP real loopback con HMAC, handler y DB reales: **7.48 ms**; otro ACK durante modelo lento de 5.5 s: **3.56 ms**. Recepción → outbound interceptado: **9.54 s**, incluyendo debounce real de 4 s. Añadir una fase de cron simulada de 60 s da **69.54 s**; segunda espera de cron = 0.

Sin evidencia aún de cold start, red, permisos de despliegue, throughput o backlog sostenido en Vercel. El límite de un intento de lane por invocación debe considerarse al evaluar capacidad; no se afirma ausencia de backlog bajo carga.

## Migraciones y permisos DEV

- Cola original intacta: archivo `20261006033141_respond_commercial_queue.sql`; ledger DEV `20261006034011`; SHA-256 `40f3b60836cd1f563ae98b1992c4da170b235a5580f1720122d8fbe25a4e0f98`.
- Journal nuevo: archivo `20261006045043_respond_commercial_execution.sql`; ledger DEV **20261006045856**; SHA-256 repo/aplicado **72ac522ebde58fed42db7e9b7fba1c6d851884567bc568f99dbb4bb82afc76cb**.
- Tabla con RLS; service_role sólo SELECT directo. Tres RPC operativas sólo service_role; helper interno sin EXECUTE de service_role. PUBLIC/anon/authenticated sin EXECUTE ni acceso directo. Sin default privileges globales.
- Postcheck: `supabase/checks/respond_commercial_execution.sql`. Hashes de las cuatro funciones #168 y de la guarda #165 antes/después idénticos.
- Advisor INFO [RLS Enabled No Policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy): esperado para esta tabla exclusivamente interna; no se añade política pública para silenciarlo.
- Fixtures DEV finales: cola, ejecuciones, transporte y rutas = 0. Las pruebas RPC crean y eliminan fixtures en una misma transacción, invisibles para workers externos.

## Rollout mínimo, NO ejecutado

1. Revisión/autorización nueva del HEAD y de ambas migraciones exactas. Confirmar salud/configuración vigente y drenaje de workers incompatibles; #168, Social ON, Recovery/SLA OFF y handoff URL ausente.
2. Aplicar sólo esas migraciones en orden, verificando hashes/ACL/postchecks. Nada de migraciones masivas ni defaults globales.
3. Merge autorizado y un deployment automático; READY/SHA/aliases. Preview de esta rama deshabilitado. Sin cambios Respond, flags ni asignación.
4. Seguir un inbound natural nuevo: HTTP/TTFB <5000 ms → evento/receipt/job → ruta/input → run → outbound + message.sent, o pausa debidamente probada. Vigilar Active de Webhook 8, backlog y revisiones. No Send Test ni replay.
5. Rollback de código sólo ante regresión atribuible y con autorización correspondiente. Conservar jobs, receipts, journal y auditoría/ACL; no resetear estados. El código anterior no drena esta cola y vuelve al acuse síncrono: documentar pendientes sin reenviarlos.
