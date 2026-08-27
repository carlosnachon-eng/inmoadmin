# Portal Condómino — Plan / implementación aislada

Fecha: 27 de agosto de 2026
Rama: `codex/genova-owner-portal`
Base final validada: `origin/main` `6fa9d2fdb05779bda77f8c94df19bdfcc8a0f3d7` (rama creada originalmente desde `03908aa55ba3d385c952b42342a127429617c354` y rebasada sin conflictos)
Estado: implementado en rama aislada y validado en `inmoadmin-dev`; no aplicado en Producción; no contiene PII ni usuarios reales.

## Decisión operativa corregida

La apertura de Génova no depende de completar 23 correos. `owner_portal_enabled` habilita la capacidad del condominio, pero el acceso efectivo se concede individualmente mediante una relación explícita y activa entre una identidad confirmada y una o varias unidades.

- Propietario con correo confirmado, identidad validada y relación unidad–correo inequívoca: puede habilitarse.
- Propietario sin correo, con identidad pendiente o relación ambigua: permanece sin acceso.
- Una nueva alta individual no requiere reactivar el condominio, modificar cuotas ni esperar a otras unidades.
- Nunca se crea una relación por coincidencia de nombre.

## A. Bloqueos reales para abrir el MVP

1. **Historial de migraciones:** incorporar a `main` las migraciones base y de hardening condominal que ya existen en DEV y Producción. La migración del portal no debe depender de objetos productivos ausentes del historial versionado.
2. **Autorización explícita para condominios controlados:** ajustar `condominium_owner_has_unit` para que Génova y cualquier condominio con fila en `condominium_operation_controls` exijan una relación activa en `condominium_unit_portal_access`. El fallback por correos legacy de `unidades_condominio` debe conservarse únicamente para condominios sin fila de control, evitando regresión en Tecaxco.
3. **Recortar el PR al MVP de lectura:** separar del primer PR las rutas de carga/descarga, bucket, documentos, recibos y gastos. Si esas superficies permanecieran desplegadas, sí requerirían validación completa; al excluirlas del MVP no bloquean su apertura.
4. **Preview aislado:** ejecutar el Preview branch-scoped exclusivamente contra `inmoadmin-dev` y aprobar los accesos positivos y negativos desde la aplicación, RLS, multiunidad, otro tenant, portal apagado, logs y bundle cliente.

No son bloqueos: completar 23/23 correos, gastos, documentos, comprobantes administrativos, incidencias o mantenimiento.

## B. Funciones que pueden posponerse

El primer portal visible para Génova incluirá solamente:

1. unidad o selector de unidades autorizadas;
2. saldo administrativo histórico Antive;
3. pagos históricos registrados;
4. cuota corriente de septiembre de 2026 y periodos posteriores;
5. separación clara entre histórico Antive y administración Emporio.

Se posponen y deben quedar fuera de la navegación y de las rutas accesibles del PR MVP:

- carga y descarga de comprobantes;
- recibos administrativos;
- documentos;
- gastos;
- incidencias y mantenimiento.

El código ampliado ya preparado para Storage y documentos se conserva como trabajo posterior, pero no debe mezclarse en el PR MVP. Cuando una función se retome tendrá su propia validación de RLS, Storage, acceso negativo, logs y bundle.

## C. Alta progresiva por propietario

1. Recibir el correo directamente del propietario por el procedimiento privado autorizado.
2. Confirmar identidad y correo fuera del repositorio; identificar inequívocamente la unidad o unidades y el tipo de acceso (`OWNER`, `COOWNER` o `AUTHORIZED_RESIDENT`).
3. Detener el alta si existe ambigüedad, contradicción o una relación sustentada sólo por nombre.
4. Consultar si la cuenta Auth ya existe. Si no existe, crearla server-side con correo confirmado y sin invitación masiva; nunca usar `inviteUserByEmail`.
5. Insertar exclusivamente las relaciones confirmadas en `condominium_unit_portal_access`, con actor administrador y sin notas que reproduzcan PII innecesaria.
6. Verificar como esa identidad que sólo aparecen sus unidades; intentar expresamente otra unidad del mismo condominio y otro tenant.
7. Informar al propietario que podrá solicitar su enlace OTP desde el portal. `shouldCreateUser:false` impide altas espontáneas.
8. Para una nueva persona posterior, repetir los pasos individuales. No cambiar `owner_portal_enabled`, cuotas ni relaciones de terceros.
9. Para revocar acceso, marcar únicamente su relación como inactiva y registrar `revoked_at`; no borrar historia ni afectar a cotitulares.

Un correo puede relacionarse con varias unidades sólo mediante filas explícitas. Una unidad puede tener varios titulares autorizados mediante relaciones independientes.

## D. Requisitos para PR y Preview

1. Conciliar las migraciones base/hardening en una rama coordinada con Administradora IA.
2. Reducir el diff del portal al MVP de sólo lectura y aplicar la regla explícita para condominios controlados.
3. Rebasar sobre el `origin/main` vigente y confirmar que no hay cambios Shadow/flags dentro del diff.
4. Ejecutar suite completa, regresiones condominales, build y `git diff --check`.
5. Aplicar el SQL final únicamente en DEV y repetir fingerprint, checks estructurales, rollback y RLS.
6. Crear Preview branch-scoped a DEV con identidades sintéticas: acceso individual, multiunidad, cotitular, unidad sin relación, otro tenant, `anon` y portal apagado.
7. Confirmar que la interfaz MVP no presenta gastos, documentos, comprobantes, recibos o incidencias y que no depende de Storage ni `service_role`.
8. Revisar respuestas, consola, logs y bundle para confirmar ausencia de PII y secretos.
9. Abrir Draft PR con migración, rollback, evidencia y plan de despliegue. No habilitar Génova ni crear usuarios reales dentro del PR.

Storage no es requisito de Preview para este MVP porque el PR inicial no debe incluir ninguna función visible o endpoint que lo utilice.

## Estado de la implementación ampliada existente

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

Proceso progresivo, fuera del repositorio:

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

## Autenticación progresiva

1. Mantener `owner_portal_enabled=false` durante el desarrollo y QA del MVP; no esperar a completar todos los correos.
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
5. Probar accesos positivos y negativos y logs desde Preview branch-scoped a DEV. Storage sólo se prueba cuando se reincorpore en una fase posterior.
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
2. La implementación ampliada mezcla el MVP con Storage/documentos; debe separarse antes del PR para no desplegar superficies pospuestas.
3. El helper actual todavía permite fallback por correo legacy en condominios controlados; debe limitarse conforme al bloqueo 2 de la sección A.
4. Ningún cambio de este track puede promoverse mientras exista conflicto con Administradora IA.

La falta de correos de propietarios no constituye riesgo global: cada identidad se habilita únicamente cuando su validación individual termina.

## Dictamen

**GO PARA PREPARAR PR DEL PORTAL MVP**

El PR todavía no debe abrirse hasta conciliar las migraciones base/hardening, recortar el diff al MVP de lectura y limitar el fallback legacy. Después deberá completar Preview contra DEV y las validaciones indicadas en la sección D. No se requiere completar el padrón de correos ni validar Storage para este alcance reducido.
