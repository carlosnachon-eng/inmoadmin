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

La captura requiere simultáneamente `SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED=true`, un `SHADOW_RESPOND_ADMIN_CHANNEL_ID` no vacío y coincidencia exacta. Sin `channelId`, el evento se descarta. `SHADOW_OUTBOUND_ENABLED=false` documenta que P1 no envía respuestas y, si se activara por error, la propia captura se bloquea.

Los errores y timeouts del fork Shadow se absorben después de que Ventas quedó encolado. No se usan nombre del canal, assignee, tags, equipo, contenido ni IA para decidir el canal.

Una respuesta `outbound_human` se persiste como contexto conversacional y se detiene antes de `resolveShadowContext()`: no es una solicitud, no consulta el ERP y no crea acciones ni casos.

## Frontera semántica de P1

P1 captura y clasifica el transporte de forma segura, pero no extrae entidades desde texto libre. Si el envelope trae identificadores determinísticos confiables (`propertyId`, `contractId`, `paymentId`, `ticketId` u otros admitidos), la pipeline compartida intenta resolverlos y audita las consultas. Si un inbound administrativo sólo contiene lenguaje humano, se conserva con `contextStatus=unresolved` y `semanticContextNeeded=true`; la UI lo presenta como **Contexto por identificar**. Esto no es un error de transporte ni implica ejecutar IA. La resolución semántica pertenece a P2/P3.

No se usan regex de propiedades, direcciones, fuzzy matching indiscriminado ni búsquedas ERP por palabras. `outbound_human` permanece con `contextStatus=not_applicable`, no consulta ERP y nunca marca `semanticContextNeeded`.

## Estado previo confirmado del teléfono

- iPhone.
- WhatsApp Business 2.26.31.74.
- Backup reciente.
- Cero dispositivos vinculados.
- Sin listas de difusión.
- Opción “Plataforma para empresas” disponible.

## Gate pendiente

Respond documenta que los mensajes enviados desde WhatsApp Business App aparecen como echoes, pero falta probar end-to-end que Coexistence emita el evento nativo `New Outgoing Message` con `channelId` y forma compatible. Hasta comprobarlo, el adapter marca `echoGatePending`; una salida humana es contexto conversacional, no se clasifica como solicitud y no genera acciones.

## Production readiness P1.1

El schema final Shadow de Producción quedó aplicado manualmente el 19/08/2026. El artefacto versionado `supabase/migrations/202608190003_fase_2a_shadow_production_schema.sql` corresponde al DDL ejecutado; incorporarlo al repositorio no autoriza ni requiere volver a ejecutarlo.

La autorización de captura valida el entorno completo y falla cerrada:

- Preview/Development sólo puede escribir en `hjfwjnejbcpmknvfpdcq`, con `SUPABASE_ENVIRONMENT=dev`.
- Production sólo puede escribir en `bnzrnizrmonjxlktbhlp`, con `VERCEL_ENV=production` y `SUPABASE_ENVIRONMENT=production` coincidentes.
- Production exige además `SHADOW_RESPOND_ADMIN_PRODUCTION_ENABLED=true`.
- Cualquier mezcla entre deployment y proyecto Supabase bloquea la captura.
- `SHADOW_OUTBOUND_ENABLED=true` bloquea la captura; P1.1 no incorpora cliente outbound.

Estado seguro obligatorio antes del onboarding real:

- schema Shadow productivo existente;
- `SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED=false` o ausente;
- `SHADOW_RESPOND_ADMIN_PRODUCTION_ENABLED=false` o ausente;
- `SHADOW_OUTBOUND_ENABLED=false` o ausente;
- `SHADOW_RESPOND_ADMIN_CHANNEL_ID` vacío o ausente.

## Ruta segura para el piloto real

El webhook Respond existente vive en Producción. P1.1 permite una futura captura productiva sólo mediante doble autorización y correspondencia exacta del proyecto Supabase. La preparación actual permanece apagada.

Los mensajes reales deben permanecer en Producción. Preview/DEV sólo se usa con fixtures o datos sintéticos y sus credenciales DEV.

## Onboarding controlado futuro

1. Confirmar visualmente que Administración aún no está conectada.
2. Abrir Add Channel > WhatsApp.
3. Elegir Coexistence / WhatsApp Business App existente.
4. Verificar el mismo número sin mostrarlo en evidencias.
5. No compartir historial inicialmente si el flujo lo permite.
6. Ejecutar con Carlos presente y completar verificación.
7. Obtener el `channelId` administrativo desde metadata del canal/evento y configurarlo manteniendo captura apagada.
8. Verificar inequívocamente la separación Ventas/Administración.
9. Confirmar `SHADOW_OUTBOUND_ENABLED=false`.
10. Habilitar `SHADOW_RESPOND_ADMIN_PRODUCTION_ENABLED=true` durante la ventana autorizada.
11. Habilitar `SHADOW_RESPOND_ADMIN_CAPTURE_ENABLED=true` sólo durante esa ventana.
12. Enviar un único mensaje inbound controlado y confirmar una sola fila Shadow.
13. Responder manualmente desde el iPhone.
14. Confirmar `New Outgoing Message`, `channelId` exacto y `outbound_human`.
15. Confirmar cero respuestas API, cero IA y cero mutaciones ERP.
16. Apagar captura inmediatamente ante cualquier anomalía.
17. Confirmar que el canal de Ventas continúa sin cambios y medir el incremento MAC.

## Criterios de aborto

- El número o WABA no es inequívoco.
- La app deja de estar disponible o Meta solicita una migración destructiva.
- El evento no contiene `channelId` estable.
- El echo se duplica, no llega o no puede distinguirse de una salida automática.
- Preview apunta a Producción.
- Aparece cualquier envío API o mutación ERP.

## Privacidad

Antes de persistir se eliminan teléfono, email, URL, cuentas e identificadores personales del texto; el contacto externo se pseudonimiza. No se guarda payload crudo, token, teléfono completo, URL privada ni attachment. En P1 los attachments conservan únicamente el tipo de mensaje confirmado y nunca se descargan.

## SQL DEV versionado

`supabase/dev/bootstrap/202608190002_fase_2a_p1_respond_admin_provider.sql` habilita exclusivamente `provider=respond_admin` y `direction=outbound_human` sobre el bootstrap P0 marcado. Fue aplicado y validado sólo en DEV durante P1. Tiene checks estáticos y rollback DEV que se niega a borrar datos; no debe ejecutarse en Producción.
