# Fase 2B.1A — puente de recuperación multimedia (sin interpretación)

## Flujo

`Respond HMAC webhook` → gate `message.received / 544519 / whatsapp_business` → cifrado híbrido de la URL → `shadow_media_retrieval_queue` → claim atómico de una unidad → DNS A/AAAA + SSRF + TLS/SNI → descarga limitada → magic bytes/MIME/PDF → resultado técnico sanitizado → destrucción del localizador cifrado y buffer.

No existe llamada a Anthropic, escritura Respond, mutación ERP, backfill ni exposición al navegador.

## Frontera criptográfica

El webhook genera una DEK aleatoria AES-256-GCM por referencia y la envuelve con RSA-OAEP-SHA256. Sólo importa la clave pública. El bundle del worker importa la función de descifrado y requiere la clave privada. La UI, el coordinador Shadow y el worker operacional no importan esa función ni reciben campos cifrados. Las claves se configuran únicamente como secretos server-side del Preview; nunca se persisten en Supabase.

Para una frontera de infraestructura más fuerte, el worker puede desplegarse posteriormente como servicio separado con el mismo contrato RPC y la clave privada exclusiva. La implementación actual impone separación de componentes/bundles dentro del proyecto Vercel.

## Persistencia y estados

- TTL fijo: 30 minutos, no renovable.
- Estados: `pending`, `processing`, `completed`, `expired`, `rejected`, `failed`.
- Hasta 4 claims. Backoff nominal: 1, 3, 8 y último intento dentro del TTL.
- Lease de 2 minutos y `FOR UPDATE SKIP LOCKED`.
- Identidad: provider + external message ID + attachment index + hash de referencia.
- Al completar o terminar: se vuelven `NULL` ciphertext, wrapped key, nonce y tag.
- Resultado persistido: MIME/tamaño validados, SHA-256, páginas PDF, intentos, latencia y timestamps.

## Red y SSRF

La URL es opaca y no usa allowlist de hostname. Debe ser HTTPS absoluto, sin userinfo, fragmento ni puerto distinto de 443. Antes de cada conexión y cada una de hasta dos redirecciones se resuelven todos los A/AAAA; si cualquiera es privada, loopback, link-local, CGNAT, multicast, unspecified, ULA o reservada, se rechaza el destino. La conexión se fija a una IP validada manteniendo hostname TLS/SNI. No hay downgrade ni reenvío de credenciales.

## Límites

Sólo JPEG, PNG, WebP y PDF; 5 MB por streaming, PDF hasta 10 páginas, conexión 3 s y descarga total 10 s. Audio, video, Office, SVG, HTML y comprimidos se rechazan antes de descargar. `isPending` se encola y usa retry controlado.

## Rollout

La migración no contiene seed ni backfill. `SHADOW_MEDIA_RETRIEVAL_ENABLED` queda OFF por defecto en Producción. El cron procesa como máximo una unidad y responde fail-closed si la flag está OFF o outbound está ON.
