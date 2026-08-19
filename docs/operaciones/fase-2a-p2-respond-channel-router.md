# Fase 2A P2 — router Respond por mensaje

## Estado seguro

La implementación queda apagada por defecto. No existen URLs reales de Workflow
en el repositorio y este cambio no crea ni modifica objetos en Respond. Shadow y
outbound siguen siendo forks independientes y permanecen apagados.

## Arquitectura

```text
Respond New Incoming Message
  -> /api/webhooks/respond
     -> HMAC válido
     -> insert idempotente en gv_respond_webhook_events
     -> router determinístico por channelId del mensaje
        -> 544519: Incoming Webhook Workflow Administración/humano
        -> 497382,497385,498219,515318: Incoming Webhook Workflow Ivonne v2
        -> desconocido/faltante: no IA
     -> fork Shadow independiente (apagado)
```

El router no inspecciona texto, historial, Lifecycle, etiquetas ni assignee. El
payload saliente contiene únicamente `contactId`, `eventId`, `messageId`,
`channelId` y `routingDecision`.

## Workflows por crear posteriormente

### P2 — Route Administración — v1

- Trigger: Incoming Webhook.
- Contact identifier: Contact ID mediante `$.contactId`.
- `Trigger once per contact`: OFF; el routing debe poder repetirse por mensaje.
- Variables opcionales: `$.eventId`, `$.messageId`, `$.channelId` y
  `$.routingDecision`.
- Único paso: Assign To a un usuario del equipo `Administracion` (`42781`).
- Sin mensajes, AI Agent, Lifecycle, tags ni cierre.

### P2 — Route Comercial a Ivonne — v1

- Trigger: Incoming Webhook.
- Contact identifier: Contact ID mediante `$.contactId`.
- `Trigger once per contact`: OFF; el routing debe poder repetirse por mensaje.
- Mismas variables de auditoría.
- Único paso: Assign To `Ivonne — Recepción — v2`.
- Sin mensajes ni cambios adicionales.

Respond documenta que Incoming Webhook genera una URL única, admite Contact ID
y permite que el Workflow ejecute Assign To. La asignación mediante Workflow es
la elegida para que Respond registre el Assignment Event antes de la respuesta
del AI Agent. En contraste, Respond documenta que una asignación de AI Agent
mediante Developer API u otra herramienta externa no provoca una respuesta
inmediata y espera el siguiente mensaje del contacto.

Referencias oficiales consultadas el 19/08/2026:

- https://respond.io/help/workflows/workflow-triggers
- https://respond.io/help/workflows/step-assign-to
- https://respond.io/help/ai-agents/ai-agents-known-limitations-and-workarounds

## Configuración

```dotenv
RESPOND_CHANNEL_ROUTER_ENABLED=false
RESPOND_CHANNEL_ROUTER_ADMIN_CHANNEL_ID=544519
RESPOND_CHANNEL_ROUTER_COMMERCIAL_CHANNEL_IDS=["497382","497385","498219","515318"]
RESPOND_CHANNEL_ROUTER_ADMIN_WORKFLOW_URL=
RESPOND_CHANNEL_ROUTER_COMMERCIAL_WORKFLOW_URL=
```

Las URLs se validan como HTTPS bajo `webhook.respond.io`, deben ser distintas y
nunca se exponen al frontend. El router se niega a iniciar si las allowlists se
solapan o están mal formadas.

## Idempotencia y auditoría

`gv_respond_webhook_events.event_id` se inserta antes del router. El conflicto
`23505` retorna como duplicado sin invocar ningún Workflow, por lo que un retry
produce como máximo una decisión. Tras cada intento habilitado, `payload_meta`
se actualiza con un objeto `routing` que sólo contiene:

- `message_id`;
- `channel_id`;
- `routing_decision`;
- `target`;
- `routed_at`;
- `result`.

Un fallo HTTP o timeout queda aislado, se audita como `isolated_error` y no
revierte ni pierde el evento ya encolado. Nunca deriva un canal desconocido a
Ivonne.

## Cutover propuesto

1. Crear ambos Workflows como borradores, sin publicar.
2. Verificar Contact ID `$.contactId` y que cada uno tenga sólo su Assign To.
3. Obtener las dos URLs sin publicarlas en código ni documentación.
4. Configurar variables server-side con `RESPOND_CHANNEL_ROUTER_ENABLED=false`.
5. Validar fixtures y llamadas controladas contra los borradores/test de Respond.
6. Publicar ambos Workflows.
7. Abrir una ventana atendida y pausar mensajes de prueba hasta terminar los dos
   cambios siguientes.
8. Retirar `Ivonne / All Contacts` como default global.
9. Inmediatamente habilitar el router y completar el redeploy productivo ya
   preparado.
10. Verificar los cinco canales y el desconocido.
11. Ejecutar el caso multicanal `498219 -> 544519 -> 498219` sobre el contacto
    controlado, sin cerrar la conversación.

Este orden prioriza que Administración nunca quede expuesta a Ivonne. Puede
existir un intervalo corto en el que los mensajes comerciales queden para
atención humana/unassigned mientras termina el redeploy, pero evita el periodo
de doble asignación que existiría si se habilitara el router antes de retirar el
default global. El equipo humano debe vigilar la bandeja durante toda la ventana.

## Rollback

1. `RESPOND_CHANNEL_ROUTER_ENABLED=false`.
2. Restaurar `Ivonne — Recepción — v2 / All Contacts` si ya fue retirado.
3. Detener los dos Workflows P2.
4. Confirmar que Ventas y los canales sociales vuelven al flujo anterior.
5. No borrar auditoría, canales ni contactos.
