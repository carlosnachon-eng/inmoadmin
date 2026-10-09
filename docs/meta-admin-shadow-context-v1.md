# Meta Admin Shadow Context v1 — núcleo shadow compartido, desconectado

Sin merge/deployment, modelo real ni cambios al runner/endpoints.
Certificación DEV alojada con fixtures: `docs/evidence/meta-admin-context-reuse-dev.json`.
9/9 escenarios y 119 SELECT reales; rollback por lote y 0 residuos en 12 fuentes.
Se certificó el acceso SQL y el comportamiento del código sin cambios; el snapshot
Meta es sintético controlado. No certifica PostgREST/RLS ni tráfico Meta real.
Los readers no son tools con SQL libre: tres capacidades server-side cerradas,
ligadas a un único input por una closure. No reciben IDs del modelo ni del texto.

## Reutilización implementada

- `lib/shadow/canonicalReadOnlyContext.js` concentra autorización y contexto, sin
  dependencia de Meta. Acepta una capacidad interna `readIdentity`, no argumentos
  del endpoint/modelo. `createRespondCanonicalContextReaders` usa el wrapper
  existente con `audit:false`; `identityBridge.js` queda intacto. Este entry nuevo
  no sustituye automáticamente ningún caller Respond desplegado.
- El adaptador Meta sólo refresca snapshot, comprueba gates/matched y entrega
  el ID canónico + fingerprint. No consulta Respond ni tablas de negocio.
- Se reutilizan `resolveApprovedCondominiumIdentity`, `find_properties`,
  `find_active_contracts`, `get_payment_summary`, `buildResolvedOperationalContext`
  y `buildShadowOperationalResolution`. La resolución operativa se usa para el
  diagnóstico de pagos, no como permiso de acceso ni grant de ejecución.
- Opciones internas de contrato: `effectiveOn`, `propertyId`, `includeRent`.
  Opciones internas de pagos: `period` YYYY-MM. No se agregan a los schemas de
  tools del modelo. Llamadas antiguas conservan columnas, límite 5 y semántica.
- El reader paralelo Meta fue sustituido por el adaptador; las validaciones
  condominiales reutilizan el verificador existente, sin inferir otra identidad.

## Fuentes y campos

| Reader | Fuentes exactas | Salida permitida |
|---|---|---|
| `readRelationships()` | Snapshot Meta existente; `client_identities(id,status,revoked_at,phone_digest)`; `client_identity_roles(client_identity_id,role_kind,status,revoked_at)`; `client_source_links(client_identity_id,source_type,source_id,role_kind,link_status,revoked_at,condominium_id,source_version)`; `properties(id,status,owner_client_id)`; `contracts(id,property_id,tenant_client_id,status,start_date,end_date)`; unidades/condominios abajo | Estado, razón allowlisted, roles acreditados, referencia opaca propiedad/unidad y contrato, sin nombres/contactos/digests/UUID canónico |
| `readAgreement()` | Relaciones anteriores + `find_active_contracts`: `contracts(id,property_id,status,start_date,end_date,monthly_rent)` por contrato/propiedad autorizados | Vigencia y renta mensual registrada. Importe decimal, MXN conforme UI existente, fuente explícita. Cuota: `insufficient_context` |
| `readCharges()` | Relaciones anteriores + `get_payment_summary`: `payments(id,contract_id,due_date,amount,status)` | Hasta 50 cargos del mes actual Puebla: periodo/vencimiento, importe y estado registrado, diagnóstico operativo/status/requires_human. Sin recibos, notas, cuentas, pagador o contraparte. Vacío => `insufficient_context`, nunca saldo cero/pagado |

El núcleo reutiliza `find_properties(id,name)`, pero descarta nombre/href en su
proyección final. Para condominio, el verificador existente consulta únicamente
`unidades_condominio(id,condominio_id,activo,propietario_telefono,identity_owner_version)`
y `condominios(id,activo)`, además de identidad/roles/source links.

### Cuotas: discrepancia de fuentes conservada explícitamente

La tool shadow `get_condominium_fee_summary` consulta `condominium_fees`.
El flujo administrativo `administrativeWorkCenter.js` usa `cuotas_condominio`;
el prototipo eliminado consultaba además `condominios.cuota_mensual`.
No se ha acreditado equivalencia ni vigencia entre esas fuentes. Este refactor
no consulta ninguna de ellas para importes de condominio: devuelve
`insufficient_context / condominium_fee_source_unverified`. Relaciones de unidad
sí pueden validarse; renta/pagos de contratos siguen funcionando.

Semántica basada en fuentes locales: `lib/shadow/exactPhoneReadOnlyEvaluator.js`,
`lib/shadow/condominiumIdentity.js`, `pages/api/operaciones/work-center.js`,
`pages/contratos.js`, `202608260002_fase_3a_canonical_client_model.sql`,
`202609180001_condominium_owner_canonical_identity.sql`,
`202608270002_condominium_owner_portal.sql`. No inspección de Producción.

## Frontera de autorización

1. Snapshot fresco <=5 s y todos los gates de Shadow Once; exclusivamente
   `matched / exact_existing_canonical_phone / candidate_count=1`.
   `authorizes_business=false` no se cambia: sólo se habilita lectura restringida.
2. Identidad activa no revocada; roles activos y enlaces confirmados no revocados.
3. Inquilino: enlace `active_contract_tenant`, contrato con
   `tenant_client_id` igual al canónico, propiedad por FK exacta.
4. Propietario: enlace `managed_property_owner`, `owner_client_id` exacto;
   contratos sólo por esa propiedad. Se excluyen nombres/identidad del inquilino.
5. Condómino: en el esquema actual es rol `owner` con enlace
   `condominium_unit_owner`, no un rol inventado. Deben coincidir unidad,
   condominio, versión de propietario y hash del teléfono canónico del origen.
   El teléfono de origen sólo se usa dentro del verificador; jamás sale del reader.
6. No selección automática entre más de una propiedad/unidad ni varios contratos
   vigentes. Esta v1 no permite que el modelo resuelva la ambigüedad enviando IDs.

## Estados conservadores

- `ambiguous`: múltiples ámbitos/contratos, rol/fuente en conflicto.
  Sin importes/cargos; pedir qué inmueble/unidad y no elegir por texto.
- `insufficient_context`: unmatched, identidad/enlace revocado, fuente incompleta,
  contrato fuera de vigencia, ausencia de importe, periodo/estado no acreditado,
  error de lectura, >50 cargos o >20 vínculos, evidencia cambiada durante lectura.
- `blocked`: gates de pausa/echo/edit/revoke/frescura no pasan.
- `ready`: información mínima acreditada, nunca autorización de envío o acción.

Vigencia: contrato `active/activo`, fechas completas válidas e inclusivas respecto
al día Puebla. No se calcula incremento contractual, comisión o adeudo neto.
No se infiere cuota ni se transforma ausencia de cargos en deuda cero.
No se consultan cargos previos/futuros al mes actual ni historiales de otro dueño.

## Cero mutaciones y conexión futura

Sólo selects de columnas y filtros fijos; no `.rpc`, SQL arbitrario, writes,
auditoría con INSERT, modelos, senders ni workflows. El camino Meta no lee Respond.
El entry Respond opcional lee su vínculo confirmado, sin escrituras. Tests con cliente
estricto que rechaza toda mutación/RPC, registra filtros y simula RLS ausente.
El modelo sólo podrá recibir el DTO whitelist, nunca el cliente DB ni los IDs.

Cada reader vuelve a validar identidad/relaciones después de leer y refresca el
snapshot final. No presume una transacción snapshot entre requests REST: cambios
observados bloquean; la ausencia de cambio observado no garantiza atomicidad.
Antes de habilitar datos reales debe revisarse esta limitación y certificar
permisos read-only/aislamiento en DEV. No se amplía service_role ni ninguna ACL.

El ensamblador local `prepareAdminShadowContext` recibe secciones explícitas
(`agreement`/`charges`) del operador/política, no SQL ni IDs del modelo; comprueba
gates y vuelve a refrescar snapshot al terminar. No llama al modelo ni hace claim.
Integración de ejecución queda deliberadamente desconectada hasta revisión:
se invocaría dentro del intento autorizado existente, conservando claim/start y
post-gate, OpenAI y propuesta interceptada. No se reutiliza el input ya consumido.
