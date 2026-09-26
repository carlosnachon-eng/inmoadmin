# I2A — anticipo externo (DEV, no producción)

Base final recertificada: `d2747e984af8bfaf9ed1e73b24901861f616d48d` (#149 incluido).
Flag: `NEXT_PUBLIC_BLINDAJE_EXTERNAL_PAYMENT_I2A_ENABLED`, OFF por defecto.
DEV exclusivo: `hjfwjnejbcpmknvfpdcq`. No activar ni desplegar en Producción sin un rollout posterior autorizado.

## Autorización y estados

- B2C: antes del INSERT se emite un secreto aleatorio de 32 bytes (43 caracteres base64url), con vigencia de dos horas. Sólo SHA-256 se guarda en la tabla privada y en la nueva columna del formulario. El hash es único por tabla e inmutable para anon/authenticated después del INSERT. El bootstrap acepta `{token, role}` y **rechaza record_id**; el servidor encuentra el registro por claim y exige origen B2C.
- La primera transacción consume el claim; un reintento válido y no expirado sólo puede recuperar el caso ya creado por ese mismo claim. No vuelve a crear un caso con un claim usado. Cada recuperación emite una nueva credencial de pago; nunca otro pago. No se emparejan registros B2C de roles distintos.
- Partner: consume la invitación I2A.0 después del enlace exitoso existente. La transacción valida expiración/revocación, agencia activa, operación en un estado no terminal (`recibida`, `en_revision`, `faltan_documentos`, `aprobada`, `contrato_en_proceso`, `lista_para_firma`, `activa`), rol, registro enlazado y origen Partner. Cada rol se agrega sólo mediante su propia invitación enlazada. La operación es la identidad canónica única.
- Tokens de pago: 256 bits, SHA-256 únicamente en DB, vigencia de 30 días, revocación soportada. Liga `/blindaje/anticipo#pay=...`, nunca query string. Varias ligas apuntan al mismo pago único de $1,000 MXN.
- Folio: secuencia server-side `BL-<año>-000001`. Los rollbacks pueden dejar huecos normales en la secuencia.
- Estados implementados: caso `awaiting_payment → proof_received`; pago `pending → proof_received`. El reemplazo conserva `proof_received`. No hay validación/rechazo de dinero ni contabilidad.
- Con I2A ON se exige clasificación de origen (I1), aunque su flag se hubiera configurado OFF accidentalmente. Con I2A OFF el comportamiento previo permanece.
- Emporio conserva su análisis inicial. B2C, Partner seguro y Partner legacy salen antes de llamar `/api/analizar-solicitud`. Legacy conserva recepción/enlace y muestra el aviso para solicitar una liga actualizada.
- Después de un formulario recibido no se elimina ni se pide reenviarlo. Una respuesta de INSERT perdida puede recuperarse por claim. Si los documentos fueron interrumpidos no se reinicia automáticamente el formulario; no se habilita investigación.

## Superficie nueva

POST `/api/blindaje/b2c-submission-token` → `{token, claim_hash, expires_at}`.
POST `/api/blindaje/external-payment/bootstrap-b2c` → `{folio, payment_token}`.
POST `/api/blindaje/external-payment/bootstrap-partner` → `{folio, payment_token}`.
POST `/api/blindaje/external-payment/payment-public` → proyección exacta:

```json
{
  "folio": "BL-2026-000001",
  "amount": 1000,
  "currency": "MXN",
  "status": "pending",
  "bank": { "banco": "…", "titular": "…", "clabe": "…" }
}
```

`status` puede ser `proof_received`. No contiene UUIDs, nombres de las partes, teléfonos, correos, datos del pagador ni rutas Storage. Banco exclusivamente de una fila `cuentas_bancarias(activa=true, uso='ventas')`; cero o varias filas fallan cerrado.

## Comprobante: Edge Function autorizada

`POST https://<SUPABASE_URL>/functions/v1/blindaje-payment-proof`.
Archivo binario en el cuerpo; credencial de pago en `Authorization: Bearer`, tipo MIME en `Content-Type`; `X-Payer-Role`, `X-Payer-Name` y `X-File-Name` (los nombres se codifican con `encodeURIComponent`). Respuesta exclusiva `{ "status": "proof_received" }`.

Vercel no recibe el archivo: su límite de petición de 4.5 MB es inferior al requisito de 5 MB. El usuario autorizó Edge para mantener 5 MB. La función usa autenticación propia mediante la credencial limitada, por eso se despliega con `verify_jwt=false`; no es acceso sin autorización. CORS permite compartir la liga; no concede acceso a tablas/bucket. `service_role` sólo se usa en servidor.

- Bucket `blindaje-payment-proofs`, privado, 5 × 1024 × 1024 bytes, PDF/JPEG/PNG, cero policies nuevas.
- Tamaño real acotado durante lectura del stream; MIME permitido y firma binaria concordante. Extensión derivada del tipo verificado; nombre original sólo metadata.
- Ruta `cases/{case_id}/investigation/{payment_id}/{random}.{ext}` sin PII.
- Subida con nombre aleatorio y sin upsert; RPC revalida credencial y realiza compare-and-swap del path esperado. Un conflicto elimina sólo la nueva carga no referenciada. Después del commit se elimina la evidencia anterior.
- Si se pierde la respuesta del RPC se consulta el path actual antes de borrar. Un fallo de Storage durante limpieza conserva el comprobante vigente y registra un evento genérico sin identificadores; puede requerir limpieza operativa del objeto no vigente. No hay historial de evidencias.

## Permisos / despliegue

Las cuatro tablas nuevas tienen RLS y cero policies; grants efectivos exactos `SELECT, INSERT, UPDATE` para service_role y ninguno para PUBLIC/anon/authenticated. Se revocan explícitamente todos los defaults antes de conceder el mínimo. Secuencia: sólo USAGE service_role. RPCs: SECURITY INVOKER, search_path vacío y EXECUTE sólo service_role. El trigger de claim afecta exclusivamente a esa columna, sin endurecer otras columnas o resolver #132.

Migración: `supabase/migrations/20260926140107_blindaje_external_payment_i2a.sql`.
Postcheck, certificación con rollback y rollback del módulo: `scripts/blindaje/sql/`.
El rollback requiere borrar antes los objetos DEV mediante Storage API; rehúsa borrar un bucket no vacío.
Edge: `supabase/functions/blindaje-payment-proof/` (SDK fijado). Desplegar únicamente en DEV en este incremento. El flag de la aplicación impide emitir nuevas credenciales cuando está OFF; credenciales de pago ya emitidas continúan siendo válidas en Edge hasta expirar o revocarse. Para una retirada completa, revocar esas credenciales y detener la función.

No se modifican APIs/tabla/RPC I2A.0, participantes adicionales, #131/#132, pagos internos, caja, investigación ni contratos. No hay cambios de variables globales ni productivas.

## Verificación reproducible

- `node --test tests/blindajeExternalPayment.test.mjs tests/partnerInvitations.test.mjs tests/blindajeOrigen.test.mjs`
- `node --test tests/*.test.mjs`
- Builds Next con I2A ON y OFF y configuración Supabase sintética local.
- `scripts/blindaje/verify-external-payment.mjs`: 390/1440, ON/OFF, formularios sintéticos, cero análisis externo, recuperación, errores, doble clic, UI anticipo, copia y reemplazo Edge.
- SQL DEV: `postcheck-external-payment-i2a.sql`, `certify-external-payment-i2a.sql`.
- No nuevas advertencias de seguridad del advisor, salvo INFO esperado de tablas privadas con RLS sin policies. Las advertencias preexistentes quedan fuera del alcance.

## Certificación DEV del 26-09-2026

- Suite: **1,352 PASS**. Pruebas nuevas de endpoints/Edge: **23 PASS**.
- Builds ON/OFF: PASS (avisos de fuentes remotas preexistentes en build local).
- Navegador sintético: **30 ON + 18 OFF**, anchos 390/1440; regresión **40 I1 + 32 I2A.0** con I2A OFF.
- Navegador real Preview: **2 PASS**, 390/1440, sesión de protección de Vercel, lectura de datos DEV sin tráfico a Producción.
- DEV real: emisión B2C, INSERT con publishable key, duplicado rechazado 409, bootstrap y retry por ambos roles; casos independientes. Partner: enlace real mediante API I2A.0 y ambos roles al mismo folio `BL-2026-000007` y mismo pago.
- Edge real: PDF de 5,242,880 bytes → 200; 5,242,881 bytes → 400. MIME falso y magic bytes falsos → 400. PDF → PNG → JPG reemplazados; **1 objeto vigente, 0 huérfanos**.
- Banco DEV: una cuenta → 200; cero y dos → 503 uniforme. Se retiró la fila temporal duplicada y se restauró una cuenta sintética activa.
- Tokens inventados/expirados/revocados: respuesta pública uniforme 404, sin datos.
- SQL: grants/RLS/RPC PASS; claims inmutables anon/authenticated; ambos órdenes Partner; reintento, pago único, CAS, reemplazo y revocación PASS. Fixtures de esa prueba revertidos.
- Se conservan exclusivamente para revisión DEV **3 casos/pagos sintéticos**: B2C inquilino `BL-2026-000005`, B2C propietario `BL-2026-000006`, Partner `BL-2026-000007`. Una agencia/operación `I2A-QA`, dos registros B2C y dos Partner, dos invitaciones de QA y una cuenta de banco ficticia. Ningún usuario Auth creado. Las credenciales de prueba se mantienen fuera del repositorio.
- Sin pago validado, sin inserts en poliza_caja ni cambios en cobro_investigacion. Formularios y documentos de terceros no se utilizaron.

El rechazo temprano de un cuerpo grande sin consumirlo podía dejar la respuesta pendiente en el gateway Edge. La implementación final drena el stream descartando cualquier contenido excedente y nunca conserva más de 5 MB de archivo en memoria. Se certificó el 400 real después de este ajuste.

## Gate final: recuperación tras refresh

El éxito de cualquier bootstrap navega inmediatamente mediante `location.replace` a `/blindaje/anticipo#pay=...`. La credencial queda en el fragment y la página vuelve a consultar instrucciones al refrescar. `ExternalPaymentReceipt` queda sólo para estados sin credencial (legacy o fallo posterior a recepción).

B2C guarda antes del INSERT exclusivamente `{token, claim_hash, expires_at, role}` en `sessionStorage`, bajo `blindaje:b2c:submission:<rol>`. No usa localStorage, PII ni record_id. Se conserva hasta expirar (dos horas) para recuperar una respuesta perdida; no se elimina al navegar al anticipo. Al volver al formulario genérico se mantiene Paso 0: elegir B2C dispara recuperación antes de montar/habilitar el formulario. Elegir Emporio no consulta ni consume ese claim.

La recuperación B2C usa el mismo bootstrap y claim: éxito redirige; 404 permite continuar con el mismo claim; expirado se elimina; errores temporales o sessionStorage inaccesible bloquean el formulario y ofrecen reintento. No se emite un claim nuevo por un 5xx. El bloqueo inicial también aplica al render previo al efecto y al handler de submit.

Partner seguro valida primero la invitación y después consulta bootstrap con el token original de `#invite`. Sin enlace, 404 permite capturar; con enlace, recupera el mismo folio y pago y navega al anticipo sin INSERT. La precarga del propietario se reaplica al montaje posterior a esta comprobación. Legacy y flag OFF no ejecutan esta recuperación.

La garantía es de la sesión/credencial vigente, no un emparejamiento por identidad personal: una sesión nueva o claim expirado sigue el flujo normal solicitado.

Pruebas de este gate:
- 60 dirigidas PASS; suite sobre main actual: 1,391 PASS.
- Navegador ON: 42 escenarios a 390/1440, incluyendo ambos roles B2C/Partner, refresh del anticipo y regreso al formulario, cero segundo INSERT, claim previo sin registro reutilizado tras 404, expiración, 503 bloqueado y reintento.
- `verify-external-payment-recovery-preview.mjs` comprueba los casos DEV existentes, prohíbe INSERTs/claims nuevos/análisis y verifica folio igual y refresh de pago para ambos roles y anchos. La comparación SQL antes/después comprueba que no se crean casos ni pagos.
- SQL DEV postcheck y certificación transaccional PASS; sin cambio de esquema, RPCs, APIs ni Edge en este gate.
