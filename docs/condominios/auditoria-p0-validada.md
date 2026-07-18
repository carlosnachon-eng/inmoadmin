# Auditoría P0 validada — módulo de condominios

Fecha: 17 de julio de 2026
Base revisada: commit `5e2fced` (`main`)
Estado: validación previa a cambios; no certifica producción

## Alcance y método

Se revisaron directamente las rutas, hooks, APIs y documentación de esquema del repositorio. No se consultaron filas reales ni se ejecutaron cambios en Supabase. Los estados de RLS y Storage se basan en `docs/bi/inventario-tablas.csv`, `docs/bi/esquema-supabase.md` y `docs/seguridad/estrategia-endurecimiento.md`; deben comprobarse contra un ambiente no productivo antes de desplegar migraciones.

## Resultado ejecutivo

Los 15 hallazgos solicitados se confirman. Los riesgos más graves son:

1. acceso a datos personales y financieros sin aislamiento reproducible;
2. mutaciones financieras directas desde el navegador;
3. detalle interno que sólo verifica sesión;
4. documentos y recibos mediante URLs públicas;
5. API de correo utilizable como relay;
6. importación que borra antes de validar;
7. ausencia de transacciones, idempotencia y auditoría inmutable.

## Hallazgos

| # | Archivo / función / bloque | Comportamiento actual | Riesgo e impacto | Corrección P0 | Prueba necesaria |
|---:|---|---|---|---|---|
| 1 | `docs/bi/inventario-tablas.csv:12,15,23,58`; `docs/seguridad/estrategia-endurecimiento.md:28` | `condominios`, `unidades_condominio`, `cuotas_condominio` y `gastos_condominio` figuran con RLS desactivado y cero políticas. | Exposición o modificación directa de datos financieros/personales. Crítico. | Migración versionada que active/force RLS y políticas por membresía. | Anónimo, usuario sin asignación y usuario de otro condominio reciben cero filas y no escriben. |
| 2 | `pages/condominios.js:125-153`; `pages/condominio/[id].js:140-155`; `pages/condomino.js:105-129` | Las consultas confían en IDs, email y filtros del cliente; no existe una entidad reproducible de asignación usuario-condominio-unidad. | Manipulación de URL/consulta permite cruce de tenants si grants/RLS lo permiten. Crítico. | `condominio_miembros`, rol y alcance por condominio/unidad; funciones RLS. | A no puede leer B aun con ID conocido; residente sólo ve unidades asignadas. |
| 3 | `pages/condominio/[id].js:92-155` | Sólo obtiene sesión; no usa `usePermiso("condominios")` ni valida alcance. | Cualquier autenticado puede intentar abrir y mutar cualquier ID. Crítico. | Lecturas aisladas por RLS y mutaciones en API con permiso/alcance. Guard UI adicional. | Usuario autenticado sin asignación recibe 403/404 y cero datos. |
| 4 | `pages/condominios.js:83-85,276-281,351-356` | Obtiene `puedeEditar`, pero muestra “Nuevo”, “Generar”, “Importar” y “Administrar” sin condicionarlo. | Usuario de lectura intenta acciones destructivas; ocultar no basta. Alto. | Condicionar UI y denegar en API/RPC. | Sólo lectura no ve controles y un POST manual retorna 403. |
| 5 | `pages/condomino.js:135-146,316-318,347-355`; `pages/condominio/[id].js:238-245,404-413,467-478`; docs de seguridad | Usa `getPublicUrl`; `documentos` y `recibos-condominio` están documentados como públicos. | Recibos/comprobantes accesibles fuera de identidad y sin expiración. Crítico. | Bucket privado `condominios-private`, metadatos, URLs firmadas por API. | URL sin firma falla; firma de A no da acceso a B; expiración comprobada. |
| 6 | `pages/api/enviar-recibo-condominio.js:5-50` | Acepta POST sin sesión, rol, alcance, rate limit o idempotencia. Correo y PDF vienen libres del cliente. | Relay de correo, fuga, spam y envío de archivo arbitrario. Crítico. | API reconstruye destinatario/PDF desde BD, valida bearer, permiso, ID, límite e idempotencia. | Sin token/otro condominio/correo alterado/duplicado son rechazados. |
| 7 | `pages/api/enviar-recibo-condominio.js:18` | BCC fijo a `carlos.nachon@emporioinmobiliario.mx`. | Copia innecesaria de datos de terceros y dependencia personal. Alto. | Eliminar; BCC opcional por `CONDOMINIOS_RECEIPT_BCC`, vacío por defecto. | Sin variable no hay BCC; lista inválida impide arranque seguro. |
| 8 | `pages/condominios.js`; `pages/condominio/[id].js`; `pages/condomino.js` | Altas, cuotas, pagos, gastos, borrados y comprobantes mutaban Supabase desde navegador. | Bypass de reglas de negocio, resultados parciales y credenciales de cliente como único control. Crítico. | APIs server-side + funciones SQL transaccionales; service role sólo servidor. | Requests manipulados fallan; operación multi-escritura hace commit total o rollback. |
| 9 | Todo el módulo; no existe tabla dedicada | No hay log inmutable de antes/después, actor, motivo, ruta y resultado. | No se puede investigar fraude/error ni probar autorización. Crítico. | `condominio_audit_log`, insert sólo por función/servidor, sin update/delete para roles normales. | Cada operación crea evento; cliente no puede editar/borrar. |
| 10 | `pages/condominios.js:210-232` | `confirmarImport` borra todas las unidades antes de insertar. | Pérdida total ante archivo o insert fallido. Crítico. | Preview persistido, backup, RPC transaccional upsert y omisiones; nunca borrado masivo implícito. | Fila inválida o fallo fuerza rollback y preserva conteo/filas previas. |
| 11 | `pages/condominios.js:192-207,399-426` | Parser usa `split(",")`; no respeta CSV escapado. UI dice Excel, input acepta `.csv`. | Corrupción silenciosa de nombres/direcciones y promesa falsa. Alto. | Parser RFC 4180 probado; texto/UI “CSV”; `.xlsx` fuera de P0. | Comas, comillas, saltos, BOM, columnas faltantes y duplicados. |
| 12 | `pages/condominios.js:175-188,210-232`; `pages/condominio/[id].js:174-525` | Varias respuestas no revisan `error`; dos inserts consecutivos pueden quedar a medias y mostrar éxito. | Inconsistencia financiera y operativa. Crítico. | `assert` de cada respuesta y RPC para operaciones compuestas. | Inyectar fallo en segunda escritura y comprobar rollback/no éxito. |
| 13 | `pages/condominio/[id].js:120,457-502,1276` | Formulario incluye `notas`; insert de gasto no las persiste. | Evidencia operativa perdida. Medio/Alto. | Columna `notas` si falta, validación y persistencia en RPC/API. | Crear gasto con notas y releer valor exacto. |
| 14 | No existe endpoint; PDF actual sólo resume estado | No hay expediente de salida con CSV, PDF, ZIP, índices, documentos y auditoría autorizada. | Dependencia del proveedor e incumplimiento de entrega ordenada. Alto. | Exportación server-side aislada, auditada y con ZIP. | ZIP de A no contiene IDs/correos/archivos de B; hash e índice coinciden. |
| 15 | `package.json` sin test; no hay suite RLS | No existen pruebas automatizadas de aislamiento, roles, storage, API ni importación. | Regresiones invisibles; compilar no demuestra seguridad. Crítico. | Node tests + pruebas SQL/RLS + matriz manual. | Suite negativa completa en ambiente efímero. |

## Hallazgos adicionales dentro de P0

- `pages/condomino.js:107-112` usa `.limit(1)`: una persona con varias unidades sólo ve una.
- `pages/condominios.js:101,168-181` utiliza valores y propietarios provisionales que pueden confundirse con reales.
- `pages/condominio/[id].js:1005` permite borrar gasto en vez de reversarlo.
- `pages/condominio/[id].js:486-500` registra honorario y caja en operaciones independientes.
- El cálculo de fondo no equivale a conciliación ni ledger.
- El endpoint de recibos interpola texto no escapado en HTML.

## Límite de la validación

No se declara el sistema apto para producción. Faltan:

1. aplicar migraciones en un proyecto Supabase demo separado;
2. verificar grants y policies efectivos con cuentas reales ficticias;
3. migrar archivos legados públicos de forma controlada;
4. ejecutar pruebas end-to-end en preview;
5. revisión jurídica/privacidad de conservación y destinatarios;
6. autorización para desplegar.
