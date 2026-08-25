# Génova — conciliación de controles operativos hacia `main`

**Fecha:** 25 de agosto de 2026

**Base exacta:** `8914c127f82c37f72e371adf5c3d531adbfca7bd`

**Fuente auditada:** worktree `gitDirty` de `codex/genova-phase-2-preimplementation`, base `3154b2303b377ef236f71008c5209c8485f015fc`

**Rama:** `codex/genova-operation-controls-main-reconciliation`

## Alcance conciliado

La rama interpreta `condominium_operation_controls` sin crear tablas, migrar datos o cambiar infraestructura. Una fila existente se resuelve de forma estricta: sólo un valor booleano `true` habilita una capacidad. Un condominio sin fila conserva el comportamiento legacy vigente. Si la aplicación no puede consultar la tabla de controles, las pantallas y procesos afectados fallan cerrado.

Capacidades cubiertas:

- portal de propietarios;
- comunicaciones y recordatorios;
- generación de cuotas corrientes;
- pagos reales;
- emisión y envío de recibos;
- gastos y movimientos de dinero.

## Fragmentos recuperados del worktree de Génova

| Fuente local | Fragmento incorporado | Ajuste durante la conciliación |
|---|---|---|
| `lib/condominios/operationControls.mjs` | Defaults legacy, resolución estricta, índice y filtrado por capacidad. | Se añadió un estado explícito `controls_unavailable` que bloquea si falla la lectura. |
| `pages/condominio/[id].js` | Lectura de controles; guardas de cuota, pago/recibo y gasto; autenticación del envío de recibo. | Se omitió el cambio no relacionado de feedback de unidades y se cubrieron WhatsApp, botones alternos, carga de comprobante y eliminación de gasto. |
| `pages/api/cron-recordatorios.js` | Consulta previa y filtrado de cuotas por cobranza/comunicaciones. | La consulta fallida detiene el cron condominal con 503 antes de modificar o enviar. |
| `pages/api/enviar-recibo-condominio.js` | Autenticación, autorización interna, vínculo cuota-condominio y controles antes de Resend. | Se preservaron errores públicos genéricos y logs sin datos personales. |
| `pages/condomino.js` | Verificación de `condominium_owner_portal_allowed`. | Error o respuesta distinta de `true` bloquea el portal. |

## Dependencia descubierta y cubierta

`pages/condominios.js` tenía una segunda ruta para generar cuotas del mes. No estaba modificada en `gitDirty`, pero dejarla intacta habría permitido intentar la misma acción desde otra pantalla. Se añadió la lectura de controles, estado visual bloqueado, guarda en el handler y botón deshabilitado. No se añadió funcionalidad nueva.

## Cambios locales descartados

Se excluyeron deliberadamente:

- `pages/api/recibos/trigger-firmas.js` y `pages/propiedades.js`, porque corresponden a reservas/inventario;
- `lib/condominios/mutationFeedback.mjs` y el cambio de alta/edición de unidades, porque corrigen falso éxito pero no interpretan capacidades operativas;
- `.gitignore`, documentos históricos, payloads privados y archivos de salida;
- scripts de importación de Génova, seeds, fixtures y datos sintéticos;
- migraciones, rollback y cambios de esquema ya aplicados o propios de otras fases;
- cualquier archivo de Shadow, Administradora IA, flags, WhatsApp IA o work center;
- archivos duplicados con sufijo ` 2` y cambios no relacionados del worktree compartido.

## Regresión esperada

- **Génova / preimplementation:** las seis capacidades booleanas permanecen apagadas y el lifecycle se muestra como no operativo; no hay portal, comunicaciones, cuotas, pagos, recibos ni movimientos.
- **Tecaxco:** al no introducirse una fila o cambio de datos, conserva el fallback legacy habilitado y su operación actual.
- **Condominio operativo genérico:** la ausencia de fila conserva el mismo fallback legacy; una fila operativa con booleanos `true` también permanece habilitada.
- **Base de datos:** RLS, funciones y políticas existentes siguen siendo la última línea de defensa. Esta rama no modifica SQL ni datos.

## Validaciones

- Prueba focalizada de controles, UI, cron, portal y recibos: 6/6.
- Suite completa del repositorio: 410/410.
- Build de Next.js: correcto, 73 páginas generadas; sólo hubo advertencias de optimización de Google Fonts por red restringida.
- `git diff --check`: correcto.
- Auditoría de secretos y datos personales: sin archivos de Génova, credenciales o PII añadidos.

## Dependencia pendiente para Preview

No se creó deployment. La rama nueva no tiene variables Preview propias y Vercel heredaría variables globales compartidas con Production. La lista de configuración confirma que `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` tienen entradas globales aplicables a Preview/Production, mientras que los overrides DEV existentes pertenecen a otras ramas.

Para continuar de forma segura se necesita:

- **Objeto afectado:** variables Vercel Preview limitadas a `codex/genova-operation-controls-main-reconciliation`.
- **Valores requeridos:** URL, anon key y service role exclusivos de `inmoadmin-dev` (`hjfwjnejbcpmknvfpdcq`), más `SUPABASE_ENVIRONMENT=dev`.
- **Riesgo:** desplegar sin esos overrides podría conectar el Preview al proyecto productivo.
- **Dependencia:** una fuente autorizada que permita duplicar los secretos DEV sin revelarlos; el CLI local no tiene sesión de Supabase y Vercel no devuelve valores de variables sensibles.
- **Cambio propuesto:** crear sólo los cuatro overrides branch-scoped; no modificar valores globales, Production ni flags Shadow.
- **Pruebas posteriores:** inspeccionar deployment, confirmar project ref DEV desde runtime seguro, probar UI bloqueada, cron/recibo negativos, portal denegado, Tecaxco sanitizado operativo y ausencia de secretos en bundle/logs.

Hasta cerrar esta dependencia, el Preview y la validación funcional remota permanecen pendientes y la conciliación se clasifica como **B) dependencia adicional antes de merge**.

## Restricciones conservadas

No se tocó Producción, el alias productivo, `main`, datos de Génova o Tecaxco, migraciones, Shadow ni infraestructura compartida. La rama no autoriza activar Génova.
