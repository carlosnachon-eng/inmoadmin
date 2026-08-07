# Reporte de implementación P0 — administración de condominios

Fecha: 17 de julio de 2026
Base: `main` en commit `5e2fced`
Estado: implementación local lista para validación en demo; **no apta todavía para producción**

## Resultado ejecutivo

Se implementó la base de seguridad P0 sin consultar ni modificar filas reales:

- autorización por acción, condominio y unidad;
- RLS forzada y grants restrictivos;
- mutaciones financieras mediante APIs y RPC transaccionales;
- pagos, reversas, periodos, saldos iniciales e idempotencia;
- auditoría no editable desde clientes normales;
- documentos privados y URLs firmadas;
- recibos reconstruidos desde base, sin correo/PDF libre ni BCC personal;
- importación CSV con preview, errores, resumen, backup, upsert y rollback;
- exportación CSV/PDF/ZIP aislada;
- portal por membresías y múltiples unidades;
- datos demo reproducibles y bloqueados fuera de un proyecto demo;
- pruebas locales y matriz de pruebas de integración.

No se aplicó ninguna migración, no se creó un proyecto Supabase/Vercel, no se hizo commit, push ni despliegue.

## Vulnerabilidades corregidas en código

| Riesgo | Corrección |
|---|---|
| Tablas sin RLS | Migración habilita y fuerza RLS en tablas base y nuevas |
| Cruce de condominios | `condominio_miembros` + policies + filtro server-side |
| Sólo sesión | APIs validan token, perfil, membresía, acción y alcance |
| Botones para lectura | Detalle consume capacidades por acción; lista usa permiso de módulo |
| URLs públicas | Bucket `condominios-private`, metadatos y firmas ≤10 min |
| Relay de correo | API recibe sólo `cuota_id`; resuelve destinatarios y PDF |
| BCC personal | Eliminado; variable vacía por defecto |
| Finanzas desde cliente | Cuotas, pagos, gastos, reversas y saldos vía RPC |
| Sin trazabilidad | Log con actor, rol, tenant, unidad, acción, antes/después, motivo, origen y resultado |
| Importación destructiva | Preview y commit transaccional; no borra omisiones |
| CSV con `split(",")` | Parser RFC 4180 probado |
| Éxitos parciales | Errores explícitos, RPC e idempotencia |
| Notas no guardadas | Columna, validación, RPC y exportación |
| Sin salida | Expediente ZIP con manifest e índices |
| Sin pruebas | 11 pruebas locales + SQL RLS + matriz manual |

## Archivos

### Documentación

- `docs/condominios/auditoria-p0-validada.md`
- `docs/condominios/modelo-autorizacion.md`
- `docs/condominios/matriz-pruebas-p0.md`
- `docs/condominios/reporte-implementacion-p0.md`

### Base de datos

- `supabase/migrations/202607170001_condominios_p0_security.sql`
- `supabase/tests/condominios_rls.sql`

### Servidor

- `lib/server/condominiosAuth.js`
- `lib/server/condominiosValidation.js`
- `lib/server/condominiosIdempotency.js`
- `lib/server/condominiosStorage.js`
- `lib/server/csv.js`
- `pages/api/condominios/index.js`
- `pages/api/condominios/portal.js`
- `pages/api/condominios/[id]/permisos.js`
- `pages/api/condominios/[id]/operaciones.js`
- `pages/api/condominios/[id]/recursos.js`
- `pages/api/condominios/[id]/documentos.js`
- `pages/api/condominios/[id]/importacion.js`
- `pages/api/condominios/[id]/exportar.js`
- `pages/api/enviar-recibo-condominio.js`

### Cliente

- `lib/condominiosApi.js`
- `pages/condominios.js`
- `pages/condominio/[id].js`
- `pages/condomino.js`

### Demo y pruebas

- `scripts/seed-condominios-demo.mjs`
- `scripts/clear-condominios-demo.mjs`
- `test/condominios/csv.test.mjs`
- `test/condominios/validation.test.mjs`
- `test/condominios/security-contract.test.mjs`
- `.env.example`
- `package.json`

## Migración

La migración crea:

- membresías y roles condominales;
- periodos;
- ledger de pagos;
- saldos iniciales;
- documentos;
- auditoría;
- idempotencia;
- lotes de importación;
- exportaciones;
- rate limits;
- funciones de autorización y operaciones.

También:

- agrega notas, reversa, actor y documentos a tablas existentes;
- crea unicidad de unidad/número y cuota/unidad/periodo;
- reemplaza policies condominales;
- crea bucket privado;
- revoca escrituras directas de `anon` y `authenticated`;
- concede RPC sensibles únicamente a `service_role`.

## Pruebas ejecutadas

### Automatizadas

```text
11 pruebas
11 aprobadas
0 fallidas
```

Incluyen parser CSV, duplicados, validadores, HTML, hashes, MIME/tamaño, rutas privadas y contratos de seguridad.

### Compilación

`next build` terminó correctamente y generó las rutas nuevas.

### Validación posterior P0.5

La migración en demo, RLS, Storage privado, expiración, importación,
exportación, recibos y rollback se ejecutaron posteriormente. Los resultados
finales y riesgos vigentes están en `reporte-validacion-p05.md`.

## Entorno demo

Los scripts preparan y eliminan:

- condominio ficticio de 60 unidades;
- propietarios/residentes `.invalid`;
- Dirección, admin, líder/operativo, cobranza, mantenimiento, comité, condómino y sólo lectura;
- tres periodos de cuotas;
- pagos, morosidad y gastos;
- comprobantes PDF claramente ficticios.

Protecciones:

- `NEXT_PUBLIC_APP_ENV=demo`;
- `INMOADMIN_DEMO=true`;
- `CONDOMINIOS_DEMO_CONFIRM=CREATE_FICTITIOUS_ONLY`;
- bloqueo explícito del project ref productivo conocido;
- marcador exacto antes de limpiar;
- contraseñas aleatorias no impresas.

El ambiente separado fue creado y validado sin reutilizar credenciales ni
datos de producción.

Con las variables demo cargadas:

```bash
pnpm demo:condominios:seed
pnpm demo:condominios:clear
```

Todas las cuentas usan `CONDOMINIOS_DEMO_PASSWORD`; sus correos aparecen en el script y terminan en el dominio reservado `example.invalid`.

## Variables de entorno

Requeridas en servidor:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
CONDOMINIOS_AUDIT_SALT
CONDOMINIOS_RECEIPT_FROM
CONDOMINIOS_RECEIPT_BCC
```

`CONDOMINIOS_RECEIPT_BCC` debe permanecer vacío salvo autorización jurídica/operativa expresa.

Sólo demo:

```text
NEXT_PUBLIC_APP_ENV=demo
INMOADMIN_DEMO=true
CONDOMINIOS_DEMO_CONFIRM=CREATE_FICTITIOUS_ONLY
CONDOMINIOS_DEMO_PASSWORD=<mínimo 16 caracteres, sólo demo>
```

## Despliegue propuesto

1. crear Supabase y Vercel separados para demo;
2. copiar únicamente variables demo;
3. tomar snapshot del esquema demo;
4. revisar tipos/constraints reales contra la migración;
5. aplicar la migración en demo;
6. ejecutar `supabase/tests/condominios_rls.sql`;
7. ejecutar `npm run test:p0` y `npm run build`;
8. ejecutar seed demo;
9. probar todos los roles y dos condominios ficticios;
10. migrar objetos legados ficticios al bucket privado;
11. ejecutar exportación y validar manifest/hashes;
12. ensayar rollback;
13. solicitar revisión de seguridad;
14. sólo después preparar un plan de producción con ventana y respaldo.

## Rollback

No hacer `DROP` inmediato después de recibir datos reales.

En demo:

1. detener tráfico;
2. conservar ZIP de salida y snapshot;
3. revertir el frontend a la versión previa;
4. revocar rutas nuevas;
5. restaurar el snapshot completo si la migración no aplica;
6. si ya existen movimientos P0, conservar tablas de auditoría/pagos/documentos y restaurar por backup, no por borrado;
7. verificar conteos e integridad antes de reabrir.

Antes de producción debe generarse un `down` específico a partir del esquema verificado. No se incluye un `DROP` genérico porque podría destruir movimientos reales.

## Riesgos pendientes

### Bloqueantes

1. La migración no ha sido ejecutada contra un clon del esquema real.
2. No existe aún evidencia ejecutada de aislamiento A/B.
3. Los objetos condominales legados en buckets públicos siguen requiriendo inventario y migración de bytes; no se hizo privado el bucket compartido `documentos` porque afectaría módulos ajenos.
4. No se probó expiración real ni signed upload en Supabase demo.
5. No se ensayó exportación completa/rollback.
6. No se revisaron conservación, destinatarios y avisos de privacidad con Jurídico.
7. La ruta detalle conserva código legado no invocado para el antiguo PDF; RLS impide que escriba, pero debe retirarse después de validar que el recibo server-side cubre el diseño requerido.

### Altos

1. Las operaciones simples de unidad usan API server-side y auditoría secuencial; si la auditoría fallara después de la escritura, la API reporta error aunque la fila exista. Antes del piloto deben migrarse a RPC transaccional o probarse con inyección de fallo.
2. La exportación síncrona tiene límite de 100 MB; expedientes mayores requieren trabajo asíncrono por periodos.
3. El rate limit vive en Postgres; debe vigilarse crecimiento y latencia.
4. El cálculo visible de “fondo” sigue siendo informativo, no conciliación bancaria.
5. La creación de recibo y envío de correo no forman una transacción externa; la idempotencia permite reintentar, pero Resend necesita pruebas de sandbox.

## Evidencia de aislamiento

La evidencia implementada, todavía no ejecutada en demo, se compone de:

1. policies RLS por `auth.uid()` → `condominio_miembros`;
2. restricción adicional por `unidad_id` para residente/condómino;
3. revocación de escrituras directas;
4. RPC sensibles sólo para `service_role`;
5. APIs que comprueban el mismo permiso antes de usar la credencial privilegiada;
6. prueba SQL negativa A/B en `supabase/tests/condominios_rls.sql`.

No se afirma que A no puede leer B hasta ejecutar esa prueba en el proyecto demo.

## Recomendación P1 — no desarrollada

Después de cerrar todos los bloqueantes P0:

1. conciliación bancaria y cuentas separadas por condominio;
2. flujo formal de autorización de gastos;
3. estado de cuenta por unidad basado en ledger;
4. notificaciones/plantillas versionadas;
5. exportaciones asíncronas por periodo;
6. administración de membresías con doble aprobación;
7. tablero operativo del piloto.

No iniciar P1 hasta que la matriz P0 bloqueante esté aprobada.
