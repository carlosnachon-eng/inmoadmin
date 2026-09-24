# Blindaje: identificación de origen — incremento 1

Base remota verificada mediante clone, fetch y ls-remote: `9876bae968c4af5bb83ab5b9e1debbd5750bc75b`.
Rebase sobre main remoto actual sin conflictos; rama `codex/blindaje-origen-operacion-i1`.
Los PR #131 y #132 estaban abiertos, draft y sin merge al verificar. No se incorporaron ni modificaron.

## Alcance

Paso 0 compartido en solicitud-inquilino y registro-propietario. Emporio captura una referencia libre de asesor o NULL al elegir «No recuerdo»; B2C guarda referencia NULL. Es información declarada, nunca una identidad verificada ni autorización. No resuelve propiedades, asesores, expedientes o cierres.

Con el flag ON, `partner` + `operacion` sólo forman un candidato. Mientras responde `/api/partners/public-branding`, se muestra carga sin Paso 0. Sólo una respuesta exitosa con operación/agencia coincidentes y agencia activa omite Paso 0, persiste `partner` y permite link-submission. Una respuesta inválida, 404, 500 o error de red exige elegir Emporio/B2C y no enlaza Partner. Los parámetros incompletos siguen el flujo genérico. La validación se asocia al candidato exacto para descartar respuestas obsoletas. `participante`, branding y precarga se conservan para contextos válidos. Ambas APIs permanecen intactas.

`NEXT_PUBLIC_BLINDAJE_ORIGEN_OPERACION_ENABLED` se activa únicamente con el literal `true` durante build. Ausente o false conserva los formularios y omite las nuevas claves del payload. El Preview ON se prepara con `vercel deploy --target preview` y overrides `--env`/`--build-env` exclusivos del deployment para el flag y la URL DEV. No se modifican variables de proyecto, compartidas ni productivas. La URL final y el HEAD certificado se documentan en el reporte del PR. El flag OFF conserva el criterio legado de enlace por presencia de parámetros y omite los metadatos nuevos.

## Esquema real y migración

Se consultaron únicamente metadatos de las seis tablas requeridas en DEV `hjfwjnejbcpmknvfpdcq` y Producción `bnzrnizrmonjxlktbhlp`. Ambas capturas carecían de `origen_operacion` y `asesor_referencia`. DEV tiene metadatos de atribución de plaza y `origin_channel` en solicitudes, partner_operations y poliza_expedientes que no existen en Producción; no se reutilizan ni se cambia multi-plaza. Propietarios no tiene un equivalente de clasificación comercial.

`supabase/migrations/20260924184116_blindaje_origen_operacion_i1.sql` agrega dos columnas text nullable por captura y CHECK para emporio/b2c/partner; NULL sigue válido. Sin defaults, backfill, updates, RLS, grants ni policies. Fue aplicada solamente en DEV mediante Supabase MCP y se verificaron tipos, nulabilidad y ausencia de defaults.

Rollback explícito: `supabase/dev/rollback/blindaje_origen_operacion_i1.sql`. Primero apagar flag y reconstruir; el rollback elimina las cuatro columnas y sus valores nuevos. No se ejecutó rollback de esquema ni SQL de escritura productivo.

## Verificación

Resultado final: dirigidas 9/9 PASS; suite completa 1,216/1,216 PASS; navegador ON 20/20 y OFF 10/10 PASS; build ON y OFF PASS; git diff --check PASS. Revisión visual móvil 390×844 PASS. Sin errores de página en los 30 envíos finales.

- Pruebas dirigidas: `node --test tests/blindajeOrigen.test.mjs`.
- Suite: `node --test tests/*.test.mjs`.
- Build ON y OFF: `next build` con URL y clave ficticias, sin secretos.
- Navegador: `scripts/blindaje/verify-origen.mjs`, Playwright y Chrome. Intercepta todas las llamadas a datos; no envía solicitudes, documentos ni análisis reales. Verifica envíos completos, metadata, branding, precarga, link-submission/participante, copy B2C y ausencia de cobro nuevo. Ejecutar con `TEST_ORIGEN_ENABLED=false` contra build OFF para las regresiones.
- `PLAYWRIGHT_MODULE` admite una ruta a Playwright instalado; `TEST_CHROME_PATH` permite Chrome local; `TEST_BASE_URL` predetermina http://127.0.0.1:3181.
- SQL DEV reproducible en `supabase/dev/tests/blindaje_origen_operacion_i1.sql`: INSERT RETURNING con rol anon para los tres orígenes y NULL en ambas tablas dentro de BEGIN/ROLLBACK. Los datos sintéticos no permanecen. Una primera ejecución incompleta omitió campos obligatorios del propietario y abortó; la prueba corregida incluye nombre y dirección.
- Render real del modal jurídico: registro histórico con NULL produce el mismo HTML y conserva el control interno de investigación.
- `ModalSolicitud.js`, `pages/poliza/index.js` y `api/partners/link-submission.js` y `api/partners/public-branding.js` idénticos byte a byte al SHA base.

## Riesgos y límites

Persisten los riesgos de lectura preexistentes de #132. DEV mantiene RLS deshabilitado y grants de INSERT/SELECT para anon en las capturas. Guardar los metadatos no necesitó ampliar permisos. Este incremento no resuelve esos riesgos, no crea endpoints ni lecturas públicas y no incorpora SQL candidato de #132.

La clasificación Partner es informativa: valida la existencia de la operación mediante el endpoint público existente, pero no autentica a quien utiliza la liga ni acredita pertenencia a la agencia. El flag ON requiere la migración previamente aplicada al entorno destino. Los metadatos nuevos quedan bajo el mismo modelo de acceso de las capturas existentes.

Build emitió avisos de optimización de fuentes externas por falta de descarga. agent-browser no pudo instalarse por timeout; se utilizó Playwright/Chrome para la verificación visual e interactiva. No se actualizaron dependencias del producto.

Sin cambios en estados, aprobación/rechazo, expediente, dictamen, IA, documentos, contratos, firmas, caja, comisiones, pólizas, cobro interno de $1,000 o multi-plaza. Sin merge ni despliegue productivo. GO se limita a revisión de Preview, no a merge ni a Producción.

## Archivos cambiados

- `.env.example`
- `pages/solicitud-inquilino.js`
- `pages/registro-propietario.js`
- `components/poliza/PasoOrigen.js`
- `lib/blindajeOrigen.mjs`
- `tests/blindajeOrigen.test.mjs`
- `scripts/blindaje/verify-origen.mjs`
- `supabase/migrations/20260924184116_blindaje_origen_operacion_i1.sql`
- `supabase/dev/rollback/blindaje_origen_operacion_i1.sql`
- `supabase/dev/tests/blindaje_origen_operacion_i1.sql`
- `docs/blindaje-origen-operacion-i1.md`
