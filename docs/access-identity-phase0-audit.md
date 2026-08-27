# Modernización de acceso e identidad — Fase 0

Fecha de corte: 2026-08-27. Proyecto Supabase auditado: `bnzrnizrmonjxlktbhlp` (Producción). La inspección de base fue de solo lectura; las únicas tablas creadas fueron temporales de sesión para ejecutar la prueba de rol `authenticated`.

## Conclusión P0

`profiles.active=false` no revoca la identidad de Supabase Auth ni invalida sus JWT/sesiones. La interfaz oculta permisos mediante `lib/permisos.js`, pero la base y varios endpoints aceptan un JWT válido sin comprobar de forma uniforme que el perfil siga activo.

La prueba reproducible usó el UUID histórico inactivo `a71f6bdd-9c4d-48b2-a6ab-4f96b5dfc016`, fijó los claims `sub` y `role=authenticated`, cambió al rol SQL `authenticated` y ejecutó `select count(*)` sobre todas las tablas `public` y `storage`. Resultado efectivo:

- 55 tablas devolvieron filas visibles, con 34,441 filas en total.
- 58 tablas permitieron la consulta pero devolvieron cero filas.
- 19 tablas rechazaron `SELECT` por privilegios.
- `storage.objects` devolvió filas visibles.
- Entre las tablas con datos visibles estuvieron `cash_movements`, `checadas`, `cierre_pagos`, `citas`, `clientes`, `comisiones_admin`, `firmas`, `inspecciones`, `llaves`, `llaves_movimientos`, `owner_payment_receipts`, `payments`, `profiles`, `properties`, `property_expenses`, `propiedades` y `roles`.

Esto demuestra exposición de lectura para una identidad inactiva; no es una inferencia basada solo en el número de políticas. No se intentaron escrituras reales en Producción.

### Tablas sin RLS

Las 15 tablas sin RLS conceden al rol `authenticated` los cuatro privilegios de tabla (`SELECT`, `INSERT`, `UPDATE`, `DELETE`):

`checadas`, `checador_vehiculos_movimientos`, `cierre_pagos`, `comisiones_admin`, `cuentas_bancarias`, `firmas_citas`, `guardias`, `llaves`, `llaves_movimientos`, `maintenance_quotes`, `owner_payment_receipts`, `propietarios_inmuebles`, `recibos_abonos`, `solicitudes_inquilino` y `vehiculos`.

Las tablas con cero filas no dejan de ser vulnerables: el privilegio permite insertar cuando no existe otro control. Las pruebas de mutación se limitaron a catálogo/políticas para evitar disparadores, bitácoras o efectos externos incluso dentro de una transacción.

### Políticas, funciones y RPCs

- Hay 162 políticas en total y 94 aplicables explícitamente a `authenticated`.
- Por operación, las políticas de `authenticated` sin referencia textual directa a `active` fueron: 8 `ALL`, 11 `DELETE`, 20 `INSERT`, 50 `SELECT` y 17 `UPDATE`. Este conteo es señal de revisión, no prueba aislada de vulnerabilidad, porque algunas expresiones delegan en helpers.
- Hay 58 funciones públicas, 49 `security definer`, 25 `security definer` ejecutables por `authenticated` y 5 también ejecutables por `anon`.
- Diez `security definer` ejecutables por `authenticated` no contienen una comprobación textual de `active`: `buscar_solicitud_por_folio`, `condominium_auth_email`, `condominium_owner_has_unit`, `condominium_owner_portal_allowed`, `create_operational_recurring_task`, `disable_operational_recurring_task`, `edit_operational_recurring_task`, `handle_new_user`, `registrar_proyecto_evento` y `shadow_operational_authorized_role`. Deben revisarse por semántica y reducirse sus grants; `handle_new_user` es un trigger y no debe exponerse como RPC.

### Endpoints server-side

La revisión estática encontró endpoints que validan el JWT y/o el rol, pero no `profiles.active`, y luego usan cliente privilegiado o una RPC. Los internos prioritarios son:

- `firmas/restaurar-flujo-activo`
- `analizar-solicitud`
- `recibos/trigger-firmas`
- `recibos/sincronizar-abono-cierre`
- `cierres/recibo-comision`
- `rent-receipts`
- `ejecutivo/conciliacion-poliza`
- `ejecutivo/bi-cierres-admin`
- `ejecutivo/conciliacion-cierres`
- `ejecutivo/conciliacion-comisiones-admin`
- `ejecutivo/conciliacion-mantenimiento`
- `ejecutivo/centro-inteligencia`
- `operaciones/maintenance-operational-events`

Los endpoints de partners y los portales externos deben conservar su autenticación actual y recibir un guard equivalente específico de su dominio, no el guard de empleados internos.

## Mecanismo propuesto para desactivación efectiva

1. Crear una función SQL estable `is_active_profile()` que exija `auth.uid()` no nulo y una fila `profiles(id=auth.uid(), active=true)`.
2. Activar RLS en las 15 tablas faltantes, retirar grants amplios innecesarios y reemplazar políticas de empleados por políticas que empiecen con `is_active_profile()` además del rol/alcance actual.
3. Auditar los 25 `security definer` ejecutables por usuarios: fijar `search_path`, incorporar el guard activo dentro de cada RPC de negocio y revocar `EXECUTE` a `anon/authenticated` cuando sea trigger o función interna.
4. Aplicar la misma condición a `storage.objects`, además de bucket y ownership.
5. Crear un helper server-side único que valide JWT, perfil activo y rol; migrar a él los endpoints internos antes listados. Nunca confiar en el chequeo del navegador.
6. Al desactivar: transacción para `profiles.active=false` y reasignaciones vigentes aprobadas; luego `auth.admin.signOut(user_id, 'global')`/revocación administrativa de sesiones. Si la revocación falla, mantener el perfil inactivo: RLS/RPC/endpoints impedirán operar aun con JWT no vencido.
7. Registrar actor, motivo, fecha, conteo de sesiones revocadas y resultado; no borrar ni recrear `auth.users` ni `profiles`.

## Flujo de recuperación preparado en código

- El acceso interno ofrece “¿Olvidaste tu contraseña?” y siempre responde con texto neutral.
- `redirectTo` se deriva del mismo origen (`<origen>/auth/reset-password`), por lo que sirve para Preview sin codificar un dominio.
- `/auth/reset-password` exige evento/enlace de recuperación, sesión válida y perfil interno activo.
- Se manejan `PASSWORD_RECOVERY`, contraseña mínima de 10 caracteres, confirmación y cierre global de sesiones después del cambio.
- Se excluyen `inquilino`, `propietario`, `condomino` y partners; sus pantallas y métodos no fueron modificados.
- El login interno con contraseña vuelve a consultar `profiles.active` y el rol interno antes de aceptar la sesión.
- No se crean usuarios: `updateUser({password})` opera sobre el mismo usuario Auth y preserva UUID, perfil, rol, FKs e historial.

Para funcionar fuera de pruebas de interfaz, Supabase Auth debe autorizar exactamente la URL de Preview y posteriormente `https://<dominio-productivo>/auth/reset-password`. Añadir una URL a la lista de redirecciones y probar un correo de recuperación son cambios controlados posteriores; no se hicieron en esta fase.

## Piloto preparado (sin Marisol)

Las cinco identidades existentes y activas propuestas son:

1. Carlos — `admin` — `28e979dd-dae5-416a-a948-fff1c39f22bb`.
2. Zaye/Jurídico — `juridico` — `9a8f9bff-85f7-4754-b312-04d917deb858`.
3. Guillermo — `gerente_ventas` — `a92f8c7c-ed4f-427e-91b7-f1e261c763d3`.
4. Amanda — `asesor` — `0337a878-a9ed-4091-a0ab-b6c3f095bf1d`.
5. Ismael Ortiz — `chofer` operativo — `8d5afa31-1454-4235-a562-5cff616082a4`.

Antes del piloto real debe confirmarse con cada persona el correo de recepción. El piloto controlado comprobará solicitud neutral, recepción, callback, contraseña nueva, login, conservación de UUID/rol/historial, rechazo de enlace reutilizado/caducado y revocación de sesiones anteriores. Una cuenta de prueba desactivada verificará 401/403 o cero filas en módulos, API, RPC y Storage.

## Trazabilidad de Marisol

UUID auditado: `a75e40e8-f6f1-4f72-a688-01951da35577`. El barrido encontró 47 columnas FK hacia `profiles(id)`; dos filas vigentes referencian el UUID directamente en `operational_recurring_tasks.responsible_profile_id`.

Referencias asociadas encontradas:

- Autoría por UUID: 3 inspecciones creadas, 3 actualizadas y 2 cerradas (pueden solaparse entre sí).
- Autoría por email: 10 movimientos de caja, 1 ticket de mantenimiento, 1 recibo de propietario y 1 gasto de propiedad.
- Actividad personal: 6 checadas.
- Custodia/histórico de llaves: 31 movimientos hacia su correo, 5 desde su correo y 20 llaves con ese correo como portadora actual al corte.
- Responsabilidad vigente: 2 tareas recurrentes.

La actividad registrada abarca del 11 al 20 de agosto de 2026, no solo tres días calendario; durante los primeros tres días (11–13 de agosto) ya existe autoría y operación material. Renombrar ese perfil haría que todas las vistas que resuelven `profiles.full_name` por UUID presenten las acciones históricas ligadas al UUID como realizadas por la nueva asistente. Las columnas que guardan email/nombre textual conservarían “Marisol” o su correo, produciendo además una trazabilidad inconsistente.

Recomendación: no reutilizar ni renombrar la identidad de Marisol para otra persona. Mantener su UUID/perfil histórico (eventualmente inactivo), crear una identidad Auth y perfil nuevos para la nueva asistente, y transferir únicamente responsabilidades/estado vigente mediante movimientos auditables. Nunca actualizar autoría histórica.

## Rollback y cambios posteriores propuestos

El rollback de esta rama consiste en retirar los cambios de interfaz; no hay rollback de datos porque no se modificaron Auth, perfiles, sesiones, SMTP, variables ni configuración. Para una fase productiva posterior:

1. Copia de catálogo de políticas/grants y lista de sesiones objetivo.
2. Migración SQL versionada para helper activo, RLS, Storage, grants y RPCs.
3. Despliegue de guards server-side.
4. Allowlist exacta del callback productivo y de un Preview controlado.
5. Piloto de cinco cuentas, una por una, con ventana de soporte.
6. Si falla: revertir código y políticas a la copia versionada; conservar contraseñas nuevas válidas y los mismos UUID. Nunca restaurar mediante recreación de identidades.

