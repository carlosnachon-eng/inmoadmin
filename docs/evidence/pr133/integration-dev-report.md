# Integración local real contra Supabase DEV — cerrada

Resultado: **INTEGRATION_DEV_PASS**. No repetir esta certificación ni `DATABASE_CERTIFICATION_PASS`.

Candidato probado: `41b74c9abf919968791f6944d75c295261f0f2a0`.
Proyecto: `inmoadmin-dev / hjfwjnejbcpmknvfpdcq`.
Ventana UTC: `2026-09-21T14:47:18.696Z` a `2026-09-21T14:49:04.349Z`.
Los cambios posteriores de este cierre son sólo documentos/evidencia; no cambian el árbol funcional probado.

## Alcance real, sin sustituciones de autorización

| Etapa | Evidencia |
| --- | --- |
| UI local, login Supabase Auth de admin sintético | HTTP 200, autenticación real DEV |
| Endpoint administrativo, autorización y operación DEV | Reales; consulta HTTP 200; prepare HTTP 200 `requires_review` |
| Resolver antes de aprobar | Sin resolución; el candidato no equivale a confirmed |
| Revisión explícita desde UI | Una petición confirm; RPC instalada real HTTP 200, `confirmed` |
| Resolver/gateway previo a 3A | Función real existente, consultas reales DEV; identidad confirmed/owner, unidad y condominio correctos |
| Observabilidad endpoint + UI | HTTP 200; fuente condominal, unidad/relación resueltas, no propiedad de Rentas, no cohorte 7/7 |
| Usuario no administrador | Login real de `asesor`, HTTP 200; acción ausente en UI; endpoint rechaza HTTP 403 `admin_required`, sin side effects |

**Simulados expresamente:** dos GET de un contacto Respond sintético y un callback determinístico del modelo 3A. No transmisión a Anthropic. **No simulados:** UI, Auth, autorización server-side, endpoint, RPC/datos Supabase DEV, resolver/gateway y observabilidad.

Después de la aprobación por UI se invocó localmente `invokeShadowPhase3A` real con lecturas DEV y modelo simulado. No se certifica ingestión automática ni tráfico natural. Para la vista se creó un único run sintético con evidencia realmente devuelta por el resolver; referencia `7dbf7f46c43c`. `action3B`, `requiresHuman` y `autoSendEligible` son nulos en ese fixture: no son métricas aprobadas de calidad de decisiones ni de autoenvío.

## Captura y conexión

Una captura agrupada de tres campos ocultos: claves API pública/administrativa DEV y contraseña PostgreSQL. Ruta oficial reutilizada por campos; sin pedir cadena, sin marcador ni conversión URL de la contraseña. CA oficial reutilizada, TLS estricto y hostname verificado.

31/31 pruebas sintéticas del diagnóstico/configuración pasaron antes de conectar, incluyendo caracteres especiales. Conexión real: destino DEV, `current_user=postgres`, `current_database()=postgres`, TLS cliente cifrado/autorizado/hostname verificado. `pg_stat_ssl=false` del backend se preserva como observación separada del TLS cliente al Session pooler. No se atribuye a este valor el fallo anterior cuyos resultados individuales no se conservaron.

La clave administrativa no apareció en los 13 artefactos cliente inspeccionados. No se conservan credenciales, tokens, cookies, objetos de sesión ni contraseñas. El paquete archivado contiene código de captura, no datos capturados.

## Limpieza

**PASS, sin residuos:** eliminados 2 actores y 2 sesiones sintéticos. Inventario final de las 22 tablas verificadas: 0 filas propias en cada una, incluyendo Auth/perfiles, auditoría, candidatos, fuentes, links/identidad, unidad/condominio y run/message/conversation. Sin borrados generales, CASCADE ni desactivación de protecciones.

Aplicación local loopback apagada, navegador de pruebas cerrado, enlace temporal de dependencias retirado y credenciales descartadas al terminar. Sin correos, SMS, invitaciones, mensajes ni personas reales. Gates de prueba limitados al proceso local ya apagado; Producción intacta.

## Evidencia duradera

- [Proyección sanitizada del reporte original](integration-dev-evidence.json), con SHA256 del original para trazabilidad. Sin sesiones ni secretos; conserva métricas de limpieza.
- [Paquete temporal realmente utilizado](integration-dev-certified-package.tar.gz). Es evidencia histórica, **no ejecutar de nuevo**. Conserva rutas históricas de la estación local, sin credenciales.
- [Manifiesto del paquete](integration-package-integrity.sha256). Verificar hashes no ejecuta pruebas ni SQL.
- [Manifiesto de toda la evidencia](evidence-integrity.sha256).

SQL DEV previo: 8/8 archivos, 72 assertions, concurrencia, idempotencia y limpieza, no-admin `asesor`. Esa evidencia sigue separada, cerrada y sin repetirse. Migración/checks tampoco se repitieron.

La revisión de instalación productiva y sus pendientes están en [rollout-review.md](rollout-review.md). PASS de integración no equivale a autorización de rollout ni elimina la necesidad de verificar el catálogo productivo.
