# I2B — revisión humana del anticipo externo

Base: `4e921a13056afecc1b948a57bcfc1a214af5faf6`. Sólo DEV; rollout productivo pendiente de revisión.

## Contrato

`NEXT_PUBLIC_BLINDAJE_EXTERNAL_REVIEW_I2B_ENABLED=false` por defecto. ON habilita la cola y APIs internas; OFF conserva I2A. El gate del análisis externo inicial no depende del flag: sesión interna activa, permiso de edición, caso y pago validados y ledger asociado a un ingreso real de $1,000. Emporio, origen NULL y reanálisis mantienen su flujo.

La autenticación usa `auth.getUser`, profile, rol no externo y `permisos_modulo(poliza)`. Admin evita únicamente la consulta del módulo. No se utilizan claims editables para autorizar. Lectura requiere `puede_ver`; revisión/análisis, `puede_editar`.

- GET `/api/blindaje/internal/investigation-payments`: proyección operativa explícita, sin rutas ni credenciales.
- POST `/api/blindaje/internal/payment-proof-url`: sólo `payment_id`; ruta verificada en servidor y firma de 60 segundos.
- POST `/api/blindaje/internal/review-investigation-payment`: `payment_id`, `action`, y motivo público de 3–300 caracteres para rechazo. Actor derivado de la sesión.

## Atomicidad y concurrencia

Migración `20260926165731_blindaje_external_review_i2b.sql`: auditoría de rechazo, constraints de revisión y ledger privado con PK payment_id y UNIQUE poliza_caja_id. RLS activo, cero policies, service_role exactamente SELECT/INSERT; anon/authenticated/PUBLIC sin acceso.

RPC INVOKER, search_path vacío, EXECUTE sólo service_role. Revisión, recepción y recuperación bloquean pago antes del caso existente. Claim/operación serializan la creación inicial. Las lecturas de solicitudes en bootstrap dejan de tomar locks compartidos que podrían interbloquear con la sincronización de cobro.

Validar crea ingreso y ledger en la misma transacción, registra auditoría y sincroniza únicamente los cuatro campos de cobro. Repetir validación devuelve el estado existente; inconsistencia contable falla cerrada. Rechazar no crea Caja. Reemplazar un rechazo usa el CAS existente, limpia auditoría y borra el objeto anterior sólo después del commit. Un pago validado no permite reemplazo ni rechazo.

Los dos órdenes Partner reutilizan caso/pago/folio. La llegada posterior del inquilino a un caso validado sincroniza su cobro. B2C conserva casos independientes.

Las fechas contables usan America/Mexico_City. Las ligas públicas siguen vigentes y sólo añaden `rejection_reason` al estado rejected; no exponen auditoría, IDs, pagador ni almacenamiento.

## Certificación DEV

Proyecto `hjfwjnejbcpmknvfpdcq`. Producción `bnzrnizrmonjxlktbhlp` sólo fue consultada durante precheck.

- Tests: `node --test tests/*.test.mjs` y pruebas dirigidas Blindaje.
- Builds: I2A ON / I2B ON, I2A ON / I2B OFF; adicionalmente todos los flags OFF.
- SQL: `scripts/blindaje/sql/postcheck-external-review-i2b.sql`, `certify-external-review-i2b.sql`, `certify-external-review-partner-i2b.sql`. Las certificaciones transaccionales terminan en rollback y conservan fixtures.
- Auth real DEV: cinco identidades temporales I2B-QA (admin/editor/reader/inactive/external), login real GoTrue y llamadas al Preview. Sin sesión/inválida 401, externo/inactivo 403, lectura sí y mutación no, editor/admin sí. Se eliminan perfiles, sesiones, identidades, usuarios y roles QA al cierre.
- Navegador real: cola 390/1440, confirmación obligatoria, rechazo, motivo público, reemplazo Edge, validación y ausencia de upload después de validar.
- El análisis real del caso sintético validado llegó al motor existente y devolvió revisión manual por ausencia de documentos. No se certifica una decisión documental de IA con documentos reales. El pago y Caja permanecen validados; la UI permite reintentar. Tests de endpoint comprueban Emporio/NULL sin nueva exigencia de sesión y bloqueo externo previo a cualquier auditoría/análisis.

Se conservan los tres casos I2A-QA: BL-2026-000005 rejected, BL-2026-000006 pending, BL-2026-000007 validated. Un ingreso de prueba asociado al último y dos comprobantes privados (uno rechazado, uno validado). Sin PII real. Las pruebas de ambos órdenes Partner usan filas temporales con rollback.

## Rollback

`scripts/blindaje/sql/rollback-external-review-i2b.sql` restaura literalmente las dos RPC de I2A, retira RPC de revisión, ledger, constraints y columnas de rechazo. No borra casos, pagos, comprobantes ni ingresos. Revertir también aplicación/Edge y deshabilitar review durante un rollback coordinado. No ejecutar sobre Producción sin autorización específica.

## Límites

No se cambian policies legacy, contratos, expedientes, dictamen, comisiones, precio de póliza ni #131/#132. Los avisos preexistentes del advisor sobre RLS legacy quedan fuera de alcance; no se abren permisos para resolverlos. La nueva tabla pasa los postchecks exactos.
