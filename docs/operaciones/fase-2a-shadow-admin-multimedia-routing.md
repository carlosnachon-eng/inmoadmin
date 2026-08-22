# Fase 2A — Shadow Admin: multimedia y routing observable

## Alcance

Esta etapa conserva hacia adelante la existencia de adjuntos recibidos por el canal administrativo nativo `544519` y amplía la metadata sanitizada de routing. No descarga ni interpreta archivos, no amplía la captura a canales comerciales y no habilita outbound.

Los 17 rechazos históricos por texto vacío permanecen intactos. No hay backfill.

## Representación multimedia

Los tipos estructurados conocidos se representan en `shadow_messages.sanitized_text` como `[IMAGEN]`, `[DOCUMENTO]`, `[AUDIO]`, `[VIDEO]`, `[STICKER]`, `[UBICACION]`, `[CONTACTO]` o `[ARCHIVO]`. Cuando existe texto o caption sanitizado se conserva antes del marcador.

`attachment_metadata` admite únicamente tipo, MIME normalizado, tamaño, filename sanitizado, caption sanitizado y hash de una referencia opaca. No admite URL, headers, tokens, binario, base64, coordenadas ni datos del contacto.

Los rechazos futuros distinguen `empty_text_no_supported_media`, `unsupported_media` y `sanitization_failure`. Un adjunto soportado sin texto se acepta como `supported_media_without_text`.

## IA Shadow

El turn builder propaga sólo tipos/MIME y marca `attachmentContext.interpreted=false`. El prompt/runtime `administradora-ia-emporio-real-shadow-v4` prohíbe inferir el contenido. Sin evidencia ERP independiente, cualquier afirmación sobre el adjunto se neutraliza y el caso queda con contexto insuficiente o revisión humana.

## Routing observable

El log previo a Shadow conserva, sólo si Respond los entrega, `source_channel_id`, `assignee_id`, `team_id`, `team_inbox_id`, `workflow_id`, `lifecycle_id`, `routing_reason`, `routing_event_type` y `routed_at`. Estos campos son evidencia de observabilidad; no modifican la allowlist de captura ni autorizan `497382`, `497385`, `498219` o `515318`.

## Rollout productivo propuesto

1. Revisar que las columnas JSONB y `shadow_ingestion_events.error_code` existentes sigan disponibles; no se requiere DDL nuevo.
2. Desplegar el código con `SHADOW_OUTBOUND_ENABLED=false` y Operational AI sin cambios.
3. Confirmar que Capture Admin continúa limitado a `544519`.
4. Observar el primer multimedia natural sin descargarlo: marcador, metadata allowlisted, cero raw payload y cero URL.
5. Confirmar que Auto-Real sólo recibe el marcador y `interpreted=false`.
6. Auditar routing metadata por separado; no ampliar canales en este rollout.
