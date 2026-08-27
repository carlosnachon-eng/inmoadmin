# Portal Condómino MVP — Génova

Fecha: 27 de agosto de 2026

Rama: `codex/genova-owner-portal`

Base: `origin/main` `6fa9d2fdb05779bda77f8c94df19bdfcc8a0f3d7`

Draft PR: [#79](https://github.com/carlosnachon-eng/inmoadmin/pull/79)

Estado: validado en DEV y Preview; sin cambios en Producción, usuarios reales, correos ni OTP.

## Alcance del MVP

El portal inicial muestra exclusivamente:

1. la unidad o unidades expresamente autorizadas;
2. los cargos históricos recibidos de Antive;
3. los pagos históricos registrados;
4. el saldo administrativo histórico Antive;
5. las cuotas corrientes administradas por Emporio.

La interfaz separa “Histórico Antive” de “Administración corriente Emporio”. No presenta Storage, comprobantes, documentos, gastos, mantenimiento ni incidencias. Tampoco deja botones muertos o rutas visibles hacia esas funciones.

## Baseline de migraciones condominales

DEV y Producción contienen la fundación y el hardening condominal, pero no tienen la tabla `supabase_migrations.schema_migrations`. Además, los números originales `202608250001` y `202608250002` coinciden con migraciones Shadow ya versionadas en `main`. Colocar los SQL condominales dentro del directorio ordinario de migraciones podría intentar recrear objetos existentes o ejecutar la migración equivocada.

La conciliación adoptada es deliberadamente no ejecutable:

- las dos migraciones reales ya aplicadas se conservaron, sin modificar un byte, en `supabase/baselines/applied/`;
- sus hashes SHA-256 son `57ba8ee236694ad1857de7a97dc4e3624b40db609016ae108840017b44dc935b` y `d480cdcb6eaaf87609418e011ca315fd73693e264f43fcddd3bfd33b5507578e`;
- `supabase/baselines/README.md` prohíbe reejecutarlas en DEV o Producción y explica el orden para ambientes nuevos;
- `202608270001_condominium_baseline_checks.sql` comprueba de forma sólo lectura que el baseline exista realmente;
- no debe usarse `supabase db push` hasta reconciliar de forma global el historial de migraciones del repositorio.

Esta estrategia incorpora la fuente histórica real al repositorio, preserva exactamente los ambientes actuales y evita una segunda arquitectura. La migración nueva del portal se ejecutará, cuando exista autorización, como SQL controlado e identificado, no mediante un `db push` indiscriminado.

## Acceso explícito y compatibilidad

`condominium_unit_portal_access` representa una relación muchos-a-muchos entre correo validado y unidad. Admite `OWNER`, `COOWNER` y `AUTHORIZED_RESIDENT`.

Para cualquier condominio que tenga fila en `condominium_operation_controls`:

- el acceso exige una relación activa y explícita;
- no se compara por nombre;
- no se elige una unidad con `.limit(1)`;
- RLS y los RPC son la autoridad final;
- `owner_portal_enabled=false` bloquea todas las consultas del propietario.

Para Tecaxco y condominios sin fila de control se conserva el fallback legacy por correo existente. El fallback no se aplica a Génova ni a otro condominio controlado.

## Alta progresiva por propietario

1. Recibir el correo por el canal privado autorizado y confirmar la identidad.
2. Identificar de forma inequívoca cada unidad y el carácter de la relación.
3. Detener el alta ante cualquier ambigüedad; nunca inferir por coincidencia de nombre.
4. Crear la identidad de Auth individualmente, server-side y sin invitación masiva. No usar `inviteUserByEmail`.
5. Insertar sólo las relaciones confirmadas en `condominium_unit_portal_access`.
6. Verificar con una identidad sintética equivalente que sólo aparecen sus unidades y que fallan una unidad ajena, Tecaxco y otro tenant.
7. Una vez autorizada la apertura, el propietario solicita su propio enlace OTP. `shouldCreateUser:false` evita altas espontáneas.
8. Para revocar, desactivar únicamente la relación correspondiente y conservar el historial.

Un correo puede representar varias unidades sólo mediante filas explícitas. Una unidad puede tener varios titulares mediante relaciones independientes. Un correo compartido requiere autorización expresa.

## RLS y datos visibles

- `anon` no tiene ejecución de los RPC ni acceso a la tabla de relaciones.
- Un propietario no puede leer correos o relaciones de otros titulares.
- El correo se deriva de la identidad autenticada; el cliente no entrega un correo confiable al RPC.
- El snapshot exige autorización sobre la unidad solicitada.
- El histórico no expone hashes de fuente, evidencia ni notas internas.
- El portal no usa `service_role`, Storage ni endpoints privilegiados.
- Las respuestas se limitan a `unit`, `historical`, `historicalPayments` y `currentFees`.

## Validación realizada

### DEV

- baseline estructural en DEV: `CONDOMINIUM_BASELINE_OK`;
- migración MVP aplicada únicamente en `inmoadmin-dev`;
- checks estructurales: `CONDOMINIUM_OWNER_PORTAL_MVP_CHECKS_OK`;
- pruebas RLS transaccionales: `CONDOMINIUM_OWNER_PORTAL_RLS_TESTS_OK`;
- multiunidad: acceso a dos unidades relacionadas y rechazo de una tercera;
- rechazo de una unidad ajena del mismo condominio, otro tenant, portal apagado y `anon`;
- Tecaxco sintético conserva el fallback legacy;
- rollback probado, seguido por reaplicación y repetición de checks;
- cero relaciones sintéticas persistidas al finalizar.

### Aplicación y Preview

- pruebas focalizadas: 12/12;
- suite completa final: 558/558;
- build local y Preview: 73 páginas, correcto;
- `git diff --check`: limpio;
- consola del acceso público: sin warnings ni errores;
- el Preview sólo muestra correo autorizado y solicitud de acceso; no expone rutas o botones pospuestos;
- bundle local: sin `service_role`, sin endpoint privado y sin referencias a módulos pospuestos;
- variables Preview limitadas a Supabase DEV `hjfwjnejbcpmknvfpdcq`; no se configuró `SUPABASE_SERVICE_ROLE_KEY`;
- no se enviaron OTP ni correos y no se crearon usuarios reales.

La primera ejecución completa presentó una variación de 1 ms en una prueba de tiempos de Shadow. Sin modificar Shadow, la prueba aislada pasó 81/81 y la suite completa repetida pasó 558/558. Se documenta como prueba sensible al reloj, no como regresión del portal.

## Archivos funcionales

- `pages/condomino.js`: acceso sin alta espontánea, selector multiunidad y vista histórica/corriente.
- `supabase/migrations/202608270002_condominium_owner_portal.sql`: relación explícita, RLS y RPC mínimos.
- `supabase/production/rollback/202608270002_condominium_owner_portal_rollback.sql`: reversión segura antes de altas reales.
- `supabase/dev/tests/202608270002_condominium_owner_portal_rls_tests.sql`: aislamiento y compatibilidad.
- `supabase/production/tests/202608270002_condominium_owner_portal_checks.sql`: pre/postcheck estructural.

## Riesgos y condiciones para promoción

1. El historial global de migraciones sigue sin estar registrado en `supabase_migrations`; no usar `db push` en DEV o Producción.
2. Antes de Producción debe capturarse baseline, aplicar únicamente el SQL del portal, ejecutar postchecks y verificar Tecaxco de forma no destructiva.
3. La migración productiva y el deployment requieren coordinación expresa con Administradora IA y un `main` limpio.
4. `owner_portal_enabled` debe permanecer deshabilitado hasta una autorización operativa independiente.
5. La creación de identidades y relaciones reales es otra intervención productiva y debe ejecutarse individualmente, sin padrón en Git ni PII en logs.

## Checklist posterior de merge/deployment

1. Aprobar el Draft PR y confirmar el HEAD exacto y diff contra el `main` vigente.
2. Repetir suite, build, `git diff --check` y búsqueda de PII/secretos.
3. Coordinar ventana con Administradora IA; mergear sólo a un `main` limpio.
4. Capturar baseline productivo de esquema, RLS, Tecaxco y otros tenants sin PII.
5. Confirmar recuperación y rollback; abortar si el baseline no coincide.
6. Aplicar únicamente `202608270002_condominium_owner_portal.sql` como ejecución controlada.
7. Ejecutar checks estructurales y pruebas seguras de aislamiento; comparar Tecaxco antes/después.
8. Desplegar la aplicación exclusivamente desde el nuevo SHA limpio de `main`.
9. Verificar logs, bundle, 401/403 esperados y ausencia de 500/secretos.
10. Mantener `owner_portal_enabled=false` y cero usuarios reales hasta autorización separada.

## Dictamen

**GO PARA ABRIR PR DEL PORTAL MVP**

El Draft PR #79 está abierto. No autoriza merge, migración productiva, deployment, alta de propietarios ni apertura del portal.
