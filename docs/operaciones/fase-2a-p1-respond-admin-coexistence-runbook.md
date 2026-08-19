# Fase 2A P1 — Respond/Admin Shadow y onboarding futuro

Estado: preparación técnica. **No ejecutar sin autorización específica.**

## Arquitectura aprobada

Respond.io Advanced se usa sólo como transporte. El webhook nativo conserva el flujo comercial existente y, después de autenticar y encolar el evento, ejecuta un fork aislado:

```text
Respond webhook firmado
  -> cola/worker Ventas existente (sin cambios semánticos)
  -> filtro exacto channelId Administración
       -> adapter respond_admin
       -> envelope neutral P0 sanitizado
       -> processShadowEnvelope()
            -> ingesta/deduplicación/clasificación
            -> contexto ERP read-only sólo para inbound
            -> matches + query audit
```

La captura requiere simultáneamente `SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED=true`, un `SHADOW_RESPOND_ADMIN_CHANNEL_ID` no vacío y coincidencia exacta. Sin `channelId`, el evento se descarta. `SHADOW_OUTBOUND_ENABLED=false` documenta que P1 no envía respuestas.

Los errores y timeouts del fork Shadow se absorben después de que Ventas quedó encolado. No se usan nombre del canal, assignee, tags, equipo, contenido ni IA para decidir el canal.

Una respuesta `outbound_human` se persiste como contexto conversacional y se detiene antes de `resolveShadowContext()`: no es una solicitud, no consulta el ERP y no crea acciones ni casos.

## Estado previo confirmado del teléfono

- iPhone.
- WhatsApp Business 2.26.31.74.
- Backup reciente.
- Cero dispositivos vinculados.
- Sin listas de difusión.
- Opción “Plataforma para empresas” disponible.

## Gate pendiente

Respond documenta que los mensajes enviados desde WhatsApp Business App aparecen como echoes, pero falta probar end-to-end que Coexistence emita el evento nativo `New Outgoing Message` con `channelId` y forma compatible. Hasta comprobarlo, el adapter marca `echoGatePending`; una salida humana es contexto conversacional, no se clasifica como solicitud y no genera acciones.

## Ruta segura para el piloto real

El webhook Respond existente vive en Producción y P1 mantiene deliberadamente el bloqueo cuando `VERCEL_ENV=production` o `SUPABASE_ENVIRONMENT=production`. No se debe iniciar el onboarding hasta elegir una ruta explícita:

1. Endpoint temporal Preview/DEV: técnicamente posible, pero enviaría mensajes reales de clientes a DEV y agregaría otro webhook operativo.
2. Rollout separado del schema Shadow en Producción: desplegar únicamente tablas/RPC/policies Shadow read-only, validar seguridad y después habilitar de forma controlada el `channelId` administrativo.

**Recomendación:** opción 2. Los mensajes reales deben permanecer en Producción; el rollout Shadow productivo debe ser una etapa separada, revisable y reversible. Este PR no lo implementa ni elimina la guarda productiva.

## Onboarding controlado futuro

1. Confirmar visualmente que Administración aún no está conectada.
2. Abrir Add Channel > WhatsApp.
3. Elegir Coexistence / WhatsApp Business App existente.
4. Verificar el mismo número sin mostrarlo en evidencias.
5. No compartir historial inicialmente si el flujo lo permite.
6. Ejecutar con Carlos presente y completar verificación.
7. Obtener el `channelId` administrativo desde metadata del canal/evento.
8. Configurar la allowlist únicamente en Preview/DEV.
9. Confirmar `SHADOW_OUTBOUND_ENABLED=false`.
10. Habilitar captura Shadow únicamente en DEV.
11. Enviar un mensaje inbound controlado y confirmar una sola copia.
12. Responder manualmente desde el iPhone.
13. Confirmar `New Outgoing Message`, `channelId` exacto y `outbound_human`.
14. Confirmar cero respuestas API, cero IA y cero mutaciones ERP.
15. Confirmar que el canal de Ventas continúa sin cambios.
16. Medir el incremento MAC.

## Criterios de aborto

- El número o WABA no es inequívoco.
- La app deja de estar disponible o Meta solicita una migración destructiva.
- El evento no contiene `channelId` estable.
- El echo se duplica, no llega o no puede distinguirse de una salida automática.
- Preview apunta a Producción.
- Aparece cualquier envío API o mutación ERP.

## Privacidad

Antes de persistir se eliminan teléfono, email, URL, cuentas e identificadores personales del texto; el contacto externo se pseudonimiza. No se guarda payload crudo, token, teléfono completo, URL privada ni attachment. En P1 los attachments conservan únicamente el tipo de mensaje confirmado y nunca se descargan.

## SQL DEV pendiente de revisión

`supabase/dev/bootstrap/202608190002_fase_2a_p1_respond_admin_provider.sql` habilita exclusivamente `provider=respond_admin` y `direction=outbound_human` sobre el bootstrap P0 marcado. No se ha ejecutado. Tiene checks estáticos y rollback DEV que se niega a borrar datos.
