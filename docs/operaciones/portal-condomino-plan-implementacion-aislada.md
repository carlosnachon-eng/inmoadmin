# Portal Condómino — Plan / implementación aislada

Fecha: 27 de agosto de 2026
Rama: `codex/genova-owner-portal`
Base final validada: `origin/main` `6fa9d2fdb05779bda77f8c94df19bdfcc8a0f3d7` (rama creada originalmente desde `03908aa55ba3d385c952b42342a127429617c354` y rebasada sin conflictos)
Estado: implementado en rama aislada y validado en `inmoadmin-dev`; no aplicado en Producción; no contiene PII ni usuarios reales.

## Alcance

La implementación resuelve únicamente:

- separación visual y de datos entre histórico heredado y cobranza corriente;
- acceso de un correo autorizado a una o varias unidades;
- cotitulares y residentes autorizados mediante relación muchos-a-muchos;
- gastos ocultos cuando el condominio no permite movimientos de dinero;
- comprobantes y recibos en almacenamiento privado;
- documentos publicados expresamente para propietarios;
- autenticación sin creación automática de usuarios.
- exclusión de incidencias de mantenimiento, porque no pertenecen al alcance básico y podrían contener información de otras unidades.

No incluye pagos en línea, app móvil, reservaciones, amenidades, QR, chat o cambios al módulo interno de gastos.

## Migración aditiva

`supabase/migrations/202608270002_condominium_owner_portal.sql`

Crea:

1. `condominium_unit_portal_access`: relación normalizada correo–unidad con roles `OWNER`, `COOWNER` y `AUTHORIZED_RESIDENT`.
2. `condominium_owner_documents`: documentos visibles sólo cuando un administrador los publica expresamente.
3. Bucket privado `condominium-owner-private`, limitado a PDF/JPEG/PNG/WebP y 10 MB.
4. Columnas privadas de ruta en `cuotas_condominio`; las URLs públicas legacy no se exponen en el portal nuevo.
5. RPCs de unidades autorizadas, snapshot por unidad, asociación de comprobante y resolución de rutas privadas.

La función existente `condominium_owner_has_unit` conserva compatibilidad con Tecaxco y accesos legacy por email, y añade la tabla muchos-a-muchos. Los condominios sin fila de control mantienen su comportamiento actual.

La migración aborta si faltan los objetos del hardening condominal que ya existen en DEV y Producción. No crea usuarios, correos, membresías, cuotas ni datos de Génova.

## RLS y aislamiento

- `anon` no tiene grants sobre las tablas nuevas ni ejecución de los RPCs.
- Sólo administración interna puede leer o modificar la tabla de accesos; un propietario no puede conocer correos de cotitulares.
- Cada RPC deriva el correo del JWT y exige `owner_portal_enabled=true`.
- El snapshot exige autorización sobre la unidad solicitada.
- Históricos omiten hash de fuente, evidencia, notas internas y referencias privadas.
- Una controversia de una unidad no altera otras cuentas.
- La escritura directa de rutas en cuotas queda bloqueada; el comprobante sólo se asocia mediante el RPC autorizado.
- Las pruebas negativas requeridas son: otra unidad del mismo condominio, otro condominio, usuario sin relación, `anon`, portal apagado y documento no publicado.

## Multiunidad y correos

Proceso futuro, fuera del repositorio:

1. Dirección entrega archivo privado unidad–correo–tipo de acceso.
2. Validar formato y normalizar a minúsculas.
3. Detectar correo duplicado en la misma unidad, correo compartido entre unidades, propietario multiunidad, cotitulares y unidades sin correo.
4. Confirmar manualmente las relaciones ambiguas.
5. Insertar únicamente relaciones confirmadas en `condominium_unit_portal_access` mediante operación administrada.
6. Ejecutar pruebas de acceso con identidades sintéticas en DEV antes de usuarios reales.

Un correo compartido entre varias unidades es válido: el portal muestra un selector. Un correo duplicado en la misma unidad es rechazado por constraint. Una unidad puede tener varios titulares mediante filas independientes.

No guardar el padrón en Git, logs, screenshots o artefactos de CI.

## Histórico y corriente

El RPC entrega dos colecciones independientes:

- `historical` y `historicalPayments`: fuente, fecha de corte, importes reportados/validados y estado de revisión.
- `currentFees`: cuotas generadas por la administración corriente.

La interfaz usa las etiquetas:

- “Saldo administrativo histórico — Antive”.
- “Administración Emporio”.

El histórico nunca se suma al KPI corriente. No se muestran intereses, moratorios, recargos o sanciones.

## Gastos

Si `money_movements_enabled=false`, el RPC devuelve `expensesVisible=false`, una colección vacía y la interfaz elimina la pestaña. Esto evita atribuir a Emporio gastos ejecutados por Antive. No se reconstruye el módulo de gastos.

## Comprobantes y documentos

- El navegador nunca recibe `service_role`.
- El endpoint valida primero sesión y alcance RLS; sólo después crea el cliente privilegiado.
- Para carga genera un token firmado de corta duración y una ruta sin PII.
- La asociación final se hace mediante RPC con validación tenant/unidad/cuota/ruta.
- Para descarga, el RPC autoriza la ruta y el servidor devuelve URL firmada por 60 segundos.
- No se usa `getPublicUrl` ni se listan objetos del bucket.
- Sólo documentos con `visible_to_owners=true` y `published_at` pueden aparecer.

## Autenticación futura

1. Mantener `owner_portal_enabled=false` durante padrón y QA.
2. Crear cada cuenta server-side con `auth.admin.createUser({email,email_confirm:true})`; no usar `inviteUserByEmail`.
3. No enviar invitaciones desde la carga.
4. Cuando Dirección autorice el portal, el propietario ingresa su correo y solicita un enlace OTP.
5. El correo de OTP es una comunicación de autenticación iniciada por el propietario; debe explicarse antes de habilitar el portal.
6. `shouldCreateUser:false` impide altas espontáneas.

## Archivos de aplicación

- `pages/condomino.js`: selector multiunidad y presentación separada.
- `pages/api/condomino/private-file.js`: URLs firmadas y carga privada.
- `lib/condominios/ownerPortalServer.mjs`: autorización y utilidades server-side.

## Pruebas y promoción

Secuencia requerida:

1. Suite local y build.
2. Aplicar migración sólo en `inmoadmin-dev` después de fingerprint.
3. Cargar fixtures sintéticos: propietario multiunidad, cotitular, otro tenant y usuario no autorizado.
4. Ejecutar `supabase/production/tests/202608270002_condominium_owner_portal_checks.sql` en DEV.
5. Probar accesos positivos y negativos, Storage y logs desde Preview branch-scoped a DEV.
6. Abrir Draft PR; revisar diff frente a `main` y coordinación con Administradora IA.
7. Sólo después de aprobación: merge a `main` limpio, migración productiva y deployment coordinado.
8. La activación de `owner_portal_enabled` y creación de usuarios requieren autorización separada.

Validación ejecutada en DEV:

- preflight confirmó las dependencias y ausencia previa de los objetos del portal;
- migración aplicada correctamente;
- checks estructurales aprobados;
- prueba RLS transaccional aprobada para multiunidad, unidad no relacionada del mismo condominio, otro tenant, portal apagado y `anon`;
- fixture sintético revertido: cero accesos, cero documentos y cero archivos persistidos;
- fingerprint de los tres tenants DEV antes/después: `476c325f2380fb5d230d000ea7b36fc3`;
- rollback probado: elimina funciones/tablas/columnas y conserva únicamente el bucket privado vacío;
- migración reaplicada y checks repetidos correctamente;
- suite local: 560/560;
- build Next.js: 73 páginas, correcto; sólo avisos no bloqueantes por fuentes externas inaccesibles durante el build aislado.

## Rollback

`supabase/production/rollback/202608270002_condominium_owner_portal_rollback.sql` restaura el helper legacy y elimina tablas, funciones y columnas únicamente si no existen accesos, documentos, archivos o rutas de comprobantes. Si ya existe actividad, aborta sin borrar datos. Supabase no permite eliminar un bucket directamente por SQL; el rollback conserva el bucket privado vacío. Su eliminación posterior, si se desea, debe realizarse mediante la API administrativa de Storage.

## Riesgos abiertos

1. La fundación/hardening condominal existe en Producción y DEV, pero sus migraciones históricas no forman parte del `main` actual; debe conciliarse esa deuda de versionado antes de integrar esta migración.
2. Falta validar desde Preview el ciclo completo del token de carga firmada contra el bucket privado; la estructura, RLS y ausencia de exposición pública ya fueron validadas en DEV.
3. Falta definir quién publica documentos y el proceso de revocación.
4. Falta completar y verificar el padrón de correos de Dirección.
5. El recibo administrativo para Génova debe expresar correctamente que Antive custodió los fondos antes de publicarse.
6. Ningún cambio de este track puede promoverse mientras exista conflicto con Administradora IA.

## Requisito para PR

No abrir PR hasta cerrar el riesgo 1 y completar el Preview branch-scoped contra DEV. La migración y las pruebas RLS ya quedaron aplicadas y aprobadas en DEV; en Preview resta validar el ciclo completo de Storage, los accesos negativos desde la aplicación y la ausencia de secretos/PII en bundles, respuestas y logs.
