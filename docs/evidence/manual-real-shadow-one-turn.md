# Manual Real Shadow · certificación DEV de un turno

Base: `2da8cc3c21f07718c969350f2f1058b5bb16853c`.
Rama: `codex/manual-real-shadow-one-turn`. PR #157 abierto para revisión; sin merge ni Producción.
Destino exclusivo: `inmoadmin-dev / hjfwjnejbcpmknvfpdcq`.
Estado final: **`MANUAL_REAL_SHADOW_DEV_PASS`** sobre el HEAD funcional
`9f6a9c528a7ca008e499768cd7a0e891bfb4fb9c`. La recertificación del timeout está
cerrada; los intentos bloqueados que aparecen abajo son únicamente históricos.

## Flujo y aislamiento

```text
Mensaje ya capturado, seleccionado explícitamente por referencia opaca
  → admin activo (getUser + perfil actual DB) + same-origin loopback
  → autorización de 10 min, snapshot/fingerprint, UNIQUE turn_key
  → claim transaccional: consume autorización + crea exactamente un run
  → capacidad efímera DEV (no configurable por request)
  → guía/schema reducidos certificados → privacidad final + body exacto
  → hasta 2 rondas, sin repair ni retry automático
  → tools mediante cliente que rechaza mutaciones/RPC
  → decisión + operational_resolution (3A)
  → conversation_action (3B) vinculada al mismo run/turn
  → read-back de integridad → revisión humana, nunca envío
```

Reutiliza gateway, transporte, aliases, decoder reducido, políticas de tools,
grounding, máquina de estados y compositor 3B existentes. El flujo general
continúa usando el schema general. No cambia prompts, schema de decisiones,
identidad, captura, generación de candidatos ni políticas de negocio.

La ruta existente `/api/operaciones/shadow-ai-real-run?mode=manual_turn`
admite POST `authorize` con `messageRef`, POST `execute` con `authorizationRef`
y GET por una de esas referencias. No admite IDs raw, selección automática,
cron, barrido, retries ni una segunda ejecución de la autorización consumida.
GET permite recuperar la revisión tras recargar la UI sin mutación.

Límites fail-closed: localhost/127.0.0.1, Supabase DEV exacto, nunca Vercel,
canal 544519/respond_admin, inbound, turno asentado y último mensaje de su
conversación, sin respuesta humana posterior; máximo 200 mensajes y sin adjuntos
para esta fase. No se trunca una conversación para declararla suficiente.
Un cambio del snapshot entre autorización y ejecución invalida el claim.

## Gates efectivos del proceso local

Únicamente `SHADOW_MANUAL_TURN_DEV_ENABLED=true` y
`SHADOW_CONVERSATION_ACTIONS_ENABLED=true`; output mode
`anthropic_json_schema`. Ninguna variable productiva fue consultada o modificada.
La generación persistida de 3B **no** habilita envío.

Todos deben estar presentes con valor literal `false`:

- `SHADOW_ADMIN_OUTBOUND_ENABLED`, `SHADOW_OUTBOUND_ENABLED`.
- `SHADOW_ADMIN_WORK_R1_ENABLED`, `SHADOW_ADMIN_OUTBOUND_CANARY_ENABLED`.
- `SHADOW_CLIENT_RECONCILIATION_PREPARE_ENABLED`, `SHADOW_CLIENT_RECONCILIATION_WRITE_ENABLED`.
- `SHADOW_IDENTITY_CONFIRMATION_ENABLED`, `SHADOW_IDENTITY_LINK_REVIEW_WRITE_ENABLED`.
- `SHADOW_AI_AUTO_REAL_ENABLED`, `SHADOW_HISTORICAL_REPLAY_ANTHROPIC_ENABLED`.
- `SHADOW_AI_ENABLED`, `SHADOW_AI_PRODUCTION_ENABLED`, `SHADOW_AI_ALLOW_REAL_MESSAGES`.
- `SHADOW_AI_MANUAL_REAL_ENABLED`, `SHADOW_AI_BACKFILL_REAL_ENABLED`.
- `SHADOW_AI_ALLOW_OPERATIONAL_EVENTS`, `SHADOW_AI_EXPLICIT_RETRY_ENABLED`.

## Persistencia y permisos

Migración aditiva aplicada **sólo en DEV**:
`supabase/dev/migrations/202609280001_manual_shadow_one_turn_dev.sql`.
SHA-256: `b4a8450edb94d0cc7fb403414fb73a0ab326149572cb4423366a2634ec8a8a95`.
Archivo idéntico al SQL aplicado; no reejecutado ni editado tras instalación.
El artefacto se trasladó byte-for-byte fuera de `supabase/migrations`, al carril
DEV-only ya existente. No es una migración productiva pendiente. Una futura
migración productiva deberá ser un artefacto separado, revisado y autorizado
específicamente; este traslado no autoriza su aplicación en ningún entorno.

Reutiliza `shadow_ai_manual_authorizations`: 3 columnas, constraint y unique
parcial por turno. Añade vista de lookup de referencia y dos RPC service-only
con autorización DB, lock transaccional y consumo/creación atómicos. RLS existente
se conserva; anon/authenticated no ejecutan los RPC ni leen la vista.

Un trigger adicional impide promover propuestas manuales a
`approved_for_future_auto`/`sent`, incluso a través del sender existente.
Se conserva el valor real `auto_send_eligible` de 3B: elegibilidad medida y
autorización de envío son conceptos separados. Revisión humana siempre pendiente.

Escrituras permitidas por la ruta, exclusivamente para el turno autorizado:

1. INSERT autorización; UPDATE de su consumo/run asociado.
2. INSERT de un run y UPDATE de sus estados, recibos y resultado.
3. INSERT de una decisión con `operational_resolution`.
4. INSERT de una `conversation_action` en estado de propuesta.

Escrituras prohibidas: mensajes/captura, identidad/candidatos/links/auditoría de
identidad, R1, tickets/trabajos/pagos/contratos/propiedades, outbound/canary,
mutaciones desde tools y RPC desde tools. `resolve_contact_identity` conserva
`audit:false`. La ruta no escribe evaluaciones humanas automáticamente.

La preparación/limpieza de actores Auth, sesiones, perfiles y mensajes sintéticos
es actividad exclusiva del certificado DEV, no de la ruta manual. Nunca invita
usuarios, envía correo/SMS ni reutiliza personas reales.

`completed` no basta: GET exige decisión + 3A + acción 3B vinculadas y read-back
verificado. Fallo de 3B conserva 3A, termina en error observable y no permite retry.
Un resultado incierto de persistencia no restaura la autorización consumida.

## Evidencia y estado de certificación

- PostgreSQL local separado: 12/12, incluida conexión B bloqueada por A y un solo
  run al liberar A; no se presenta como ejecución Supabase DEV.
- Supabase DEV: identidad del proyecto comprobada antes del DDL; instalación y
  catálogo PASS (3 columnas, unique, vista, trigger, RLS y grants).
- Primera integración: Auth real DEV PASS, sin colisiones. El arnés comprobó
  el formulario antes de esperar a su render visible y detuvo la prueba antes de
  cualquier autorización/modelo/tool. No acredita UI PASS.
- Limpieza de esa ejecución: 0 mensajes, conversaciones, runs, autorizaciones,
  perfiles, usuarios Auth y sesiones propios. Clave descartada de memoria.
- Integración corregida contra Supabase DEV real: **52 checks PASS**, diez
  escenarios. 10 runs, 6 decisiones y 5 acciones 3B: cinco recorridos completos,
  cuatro errores esperados y un timeout esperado. UI/GET, admin/asesor, origen,
  doble clic concurrente/un solo run, rechazo de retry y snapshots intactos PASS.
- Tool `resolve_contact_identity`: lectura real DEV, `audit:false`, resultado
  seguro sin identidad; SQL acotado a los contactos sintéticos comprobó **0 filas
  de respond_identity_audit**. Las únicas mutaciones HTTP observadas pertenecen
  a autorizaciones, runs, decisiones y propuestas. Ninguna mutación de tools.
- Veto DEV probado bajo `service_role`: promover una propuesta manual sintética
  a `approved_for_future_auto` o `sent` falló con
  `manual_turn_outbound_forbidden`; transacción de prueba revertida.
- Limpieza del lote integrado: datos propios en cero mediante SQL acotado;
  actores eliminados mediante Admin API y perfiles propios en cero. No se
  reconstruyó ni vació el entorno.

### Historial: timeout inicial y recertificación bloqueada, anteriores al cierre

La primera prueba DEV de timeout terminó fail-closed, pero perdió el receipt al
ganar el deadline externo la carrera de cancelación. **No se infiere ese receipt.**
Se corrigió únicamente la observabilidad manual: el transporte comunica su
receipt seguro inmediatamente después de invocar fetch con el body ya verificado.
En timeout, no se inventan modelo ni usage; permanecen `null`.

La corrección pasó localmente. El primer intento de recertificación DEV puntual **no ejecutó el
endpoint**: `local_server_timeout` tras 120 segundos sin READY. Se limpiaron el
único mensaje/conversación y los dos actores de ese intento. El arnés quedó
preparado para certificar sólo timeout sin inicializar de nuevo la UI Next.
No se abrió otra captura en bucle. En ese intento bloqueado no se declaró PASS;
no representa el estado final, acreditado en la sección de cierre al final.

Un SELECT agregado adicional de Auth/perfiles/sesiones al final no pudo responder
por fallo de transporte del conector MCP. No invalida los recibos de eliminación
API/SQL anteriores, pero esa comprobación adicional de aquel intento quedó no
acreditada. La ejecución final posterior sí confirmó su propia limpieza completa.

### Certificación local final

| Comprobación | Resultado |
| --- | --- |
| Focalizadas de ruta manual | 50/50 PASS |
| Dirigidas Shadow/Replay/privacidad/identidad | 1,168/1,168 PASS |
| Suite completa | 1,645/1,645 PASS |
| PostgreSQL local, separado de DEV | 12/12 PASS |
| Build Next | PASS |
| `git diff --check` | PASS |

Build con un worker/threads y caché aislada en opciones del proceso, sin editar
`next.config.js`. El intento inicial de build encontró `EAGAIN`; no se confundió
con un defecto del producto ni se tocaron procesos ajenos.

Evidencia durable:

- `manual-real-shadow-dev-results.json`: evidencia histórica del lote DEV; incluye
  explícitamente la limitación del timeout anterior a la corrección y no es el
  estado final de su recertificación.
- `manual-real-shadow-dev-ui.png`: UI real; proveedor/modelo sintéticos.
- `manual-real-shadow-timeout-recert-pending.json`: evidencia histórica intacta
  del fallo de arranque y su limpieza; **no** resultado del modelo ni estado final.
- `manual-real-shadow-timeout-recert-pass.json`: cierre final sanitizado del
  timeout real DEV, receipts, integridad y limpieza, sin IDs de fixtures.
- `manual-real-shadow-manifest.json`: estado final PASS, clasificación de los
  artefactos históricos y hashes actualizados del paquete.

La recertificación cerrada utilizó `MANUAL_CERT_FOCUS=timeout node
scripts/certify-manual-shadow-dev.mjs`, con captura segura de la clave API DEV.
Se limpió exclusivamente su inventario de fixtures y después sus usuarios Auth.
No queda reanudación pendiente ni se deben repetir migración u otros escenarios
para actualizar o publicar estos artefactos.

El certificado usa UI Next real, Auth/perfiles y operaciones Supabase DEV reales.
El servidor local monta la misma factoría del endpoint; la lista del dashboard
se limita mediante un adaptador a los fixtures propios. Sólo el HTTP del modelo
es sintético, atravesando constructor, verificadores, serializer, parser y decoder
reales. No es una prueba del proveedor Anthropic ni de despliegue serverless.
No se relee Respond ni se llama a proveedores externos.

Receipts/modelo/usage del certificado proceden de respuestas **sintéticas**:
no acreditan usage ni aceptación real de Anthropic. Se guardan sólo categorías,
booleans, nombre/origen de tool, éxito, duración, conteo e identidad resuelta sí/no.
GET/UI reproyectan; la vista general no expone internals de los nuevos runs manuales.

## Checklist futuro 1/1 productivo — NO autorizado ni habilitado

- Revisión independiente del diff, permisos, trigger y equivalencia de contratos.
- Autorizar expresamente un diseño de habilitación productiva: hoy el código
  rechaza Producción/Preview por construcción, no basta cambiar un gate.
- Diseñar, revisar y autorizar una migración productiva separada y sus checks/locks;
  el SQL DEV-only de este PR no entra en el carril productivo.
- Acreditar main/deployment exactos y todos los gates peligrosos OFF.
- Seleccionar un único turno existente, revisar snapshot/adjuntos/contexto,
  identidad, sensibilidad, finalidad y autorización de transmisión sanitizada.
- Exigir los dos receipts por ronda; máximo 2 transmisiones internas, cero retry.
- Acreditar cero mutaciones operativas/identidad y cero outbound; inventario de
  las cuatro clases de escrituras permitidas y linkage del mismo run.
- Exigir decisión + 3A + 3B + read-back íntegros; fallo parcial no es PASS.
- Revisar manualmente propuesta, grounding, `message_safe`, `requires_human` y
  `auto_send_eligible`; esa revisión no concede permiso de envío.
- Cerrar la capacidad manual y verificar runtime fail-closed. Conservar evidencia;
  no borrar ni reejecutar un run productivo fallido.

## Cierre final — MANUAL_REAL_SHADOW_DEV_PASS

Recertificación puntual ya ejecutada en **Supabase DEV real**, con Auth y endpoint
reales y proveedor/modelo sintéticos: **14/14 comprobaciones PASS**, más lecturas
acotadas de integridad y limpieza. No se reejecutó nada para este cierre documental.
Artefacto final: [manual-real-shadow-timeout-recert-pass.json](manual-real-shadow-timeout-recert-pass.json).

| Comprobación | Resultado persistido u observado |
| --- | --- |
| Timeout efectivo | 1,501 ms, una ronda |
| Estado final | `status=timeout`, `execution_state=timeout`, `certified=false` |
| Diagnóstico | `outputStage=timeout`, `error_code=manual_turn_timeout` |
| Receipt | Persistido tras timeout y visible mediante GET |
| Privacidad | `final_payload_verified=true`, `serialized_body_verified=true` |
| Proveedor | `provider_invoked=true`, exclusivamente `synthetic_fetch`, una llamada |
| Output mode | `anthropic_json_schema` |
| Modelo / tokens input / tokens output | `null` / `null` / `null`; no respuesta con usage acreditable |
| Autorización / run | Una autorización consumida y vinculada a exactamente un run |
| Reejecución | Duplicada rechazada; ningún segundo run ni nueva llamada sintética |
| Integridad | Resultado GET intacto tras recarga; mensajes capturados sin cambios |
| Decisión / 3A / 3B | Ninguna persistida; sin resultado parcial presentado como completo |
| Tools / identidad / outbound | Cero tools, cero mutaciones de identidad, cero outbound |
| Limpieza | Cero autorizaciones, runs, mensajes, conversaciones, usuarios Auth, perfiles y sesiones propios |

No se persistió un `diagnosticCode` adicional; no se infiere. `certified=false`
es el cierre seguro esperado del run con timeout, no un fallo de la certificación.
El log estructural de la ruta mostró únicamente authorize/claim y dos PATCH del
run; las lecturas acotadas comprobaron cero auditorías de identidad del fixture.
Eliminados sólo los registros sintéticos propios y sus dos actores; credenciales
descartadas. Cero llamadas externas al proveedor, sin Producción ni cambios de gates.

El lote DEV anterior conserva la evidencia UI y de los otros escenarios. Este
cierre acredita exclusivamente el timeout con la factoría real del endpoint,
sin reiniciar la UI completa ni repetir suite/build, migración o escenarios.
La actualización P1 sólo versiona evidencia y cambia la ubicación del SQL y su
referencia en el script local: contenido SQL y código funcional intactos.
