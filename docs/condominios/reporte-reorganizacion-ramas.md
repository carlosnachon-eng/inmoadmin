# Reporte de reorganización P0/P0.5

Fecha: 17 de julio de 2026
Estado: separación local terminada; sin push, despliegue ni cambios en producción

## 1. Protección y origen

- Origen solicitado: `5e2fced34d819928c5b973f7aa8308e4b336bf8a`.
- Respaldo local: `codex/backup-condominios-p0-p05-full`.
- Commit del respaldo: `64b51ad1467bb058fe31bdef6bf584b08b402f3a`.
- El respaldo conserva los 66 archivos del estado previo, excepto secretos
  ignorados.
- `.env.demo.local` permanece ignorado, con permisos locales restrictivos y
  fuera de todos los commits.
- Producción `bnzrnizrmonjxlktbhlp` permaneció bloqueada. Todas las conexiones
  ejecutadas apuntaron al demo `kmxzvcngfrzcasedtexw`.

## 2. Rama de infraestructura y seguridad

Rama: `codex/security-dependencies-2026`
Commit único: `3c51956dff022ce2301f0e03dd81d829954dcf60`
Mensaje: `chore(security): update framework and document dependencies`

### Archivos

- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`

No contiene páginas, APIs, migraciones, scripts, documentación funcional ni
variables del módulo condominal.

### Dependencias y lockfile

- Next.js `15.5.20`
- jsPDF `4.2.1`
- jsPDF AutoTable `5.0.8`
- Google APIs `173.0.0`
- override de PostCSS `8.5.10`
- `packageManager: pnpm@11.9.0`
- lockfile regenerado sin `pg` ni scripts de condominios

### Validación

- instalación con pnpm `11.9.0`: aprobada;
- `pnpm audit --prod`: cero vulnerabilidades conocidas;
- build completo: aprobado, 67 páginas;
- `git diff --check`: aprobado;
- revisión de secretos y lockfile: aprobada;
- lint y pruebas generales: el repositorio base no define scripts para ellos.

### Matriz de regresión manual de infraestructura

| Área | Comprobación requerida antes de producción | Estado |
|---|---|---|
| Autenticación y sesiones | login, renovación, logout, roles | Pendiente manual |
| Navegación y Layout | escritorio y móvil | Pendiente manual |
| Propiedades y fichas | alta, edición, PDF, archivos | Pendiente manual |
| Cartas y ofertas | crear, aceptar, descargar | Pendiente manual |
| Recibos | renta, apartado y comisión | Pendiente manual |
| Liquidaciones | cálculo, descuento, pago, documentos | Pendiente manual |
| Propietarios | portal y reporte | Pendiente manual |
| Inspecciones | alta, fotos, PDF | Pendiente manual |
| Blindaje Legal | solicitud, dictamen y documentos | Pendiente manual |
| Integraciones | Google Sheets y correo | Pendiente con credenciales controladas |
| Crons y APIs | autenticación, ejecución y errores | Pendiente en preview |
| Vercel | build, variables, funciones y límites | Pendiente en preview |

Recomendación: **GO CON RESERVAS** para abrir un PR independiente; no promover
a producción hasta completar esta matriz en preview.

## 3. Rama condominal aislada

Rama: `codex/condominios-p0-p05`
Base: `codex/security-dependencies-2026`
Commit objetivo único: `feat(condominios): add isolated P0 and P0.5 module`

### Archivos incluidos

- configuración: `.env.example`, `.env.demo.example`, `.gitignore`,
  `package.json`, `pnpm-lock.yaml`;
- interfaz: `components/condominios/DemoBadge.js`,
  `pages/condominios.js`, `pages/condominio/[id].js`,
  `pages/condomino.js`;
- cliente y servidor: `lib/condominiosApi.js`, los cuatro módulos
  `lib/server/condominios*` y `lib/server/csv.js`;
- APIs: `pages/api/condominios/**` y
  `pages/api/enviar-recibo-condominio.js`;
- esquema: tres migraciones P0, cuatro migraciones demo, README de separación
  demo y prueba SQL RLS;
- validación: scripts `*condominios-demo*`, guarda compartida del demo,
  pruebas `test/condominios/**` y documentación `docs/condominios/**`.

Respecto de infraestructura, `package.json` sólo añade `pg` como dependencia
de desarrollo y los scripts `test:p0` y `demo:condominios:*`. El lockfile suma
111 líneas correspondientes a `pg 8.22.0` y sus dependencias transitivas.

### Superficies retiradas

- indicador demo global;
- modificaciones al Layout;
- cron condominal y función SQL de actualización automática;
- integración con la tabla compartida de incidencias;
- pestañas, consultas, exportación, seed, permisos y pruebas de incidencias;
- flujo cliente antiguo de PDF, carga pública y destinatario arbitrario;
- cambios a mantenimiento, cobranza, liquidaciones, propietarios, rentas,
  clientes, propiedades, pólizas y CRM.

La gestión de incidencias condominales se difiere a una fase posterior con
modelo y APIs propios.

## 4. Evidencia de aislamiento

Comparación contra `codex/security-dependencies-2026`:

- `components/Layout.js`: sin diff;
- `pages/api/cron-recordatorios.js`: sin diff;
- `pages/mantenimiento.js`: sin diff;
- `pages/cobranza.js`: sin diff;
- `pages/liquidaciones.js`: sin diff;
- `pages/propietario.js`: sin diff;
- `pages/api/rent-receipts.js`: sin diff;
- `pages/api/submit-solicitud.js`: sin diff;
- `pages/clientes/*`: sin diff;
- `pages/propiedades*`: sin diff;
- `pages/poliza/*`: sin diff.

Las tres migraciones P0 no contienen `maintenance_tickets`, no modifican
tablas de rentas, propiedades, clientes, pólizas, cobranza tradicional ni
buckets compartidos. Sólo usan tablas del dominio condominal, membresías,
`auth.users`, funciones propias y el bucket privado `condominios-private`.

`supabase/demo-migrations/README.md` y las guardas de cada baseline distinguen
inequívocamente las migraciones destructibles del demo de las migraciones
potencialmente promovibles.

## 5. Resultados P0/P0.5 aislado

| Validación | Resultado |
|---|---:|
| Pruebas locales | 20/20 |
| Auditoría de producción | 0 vulnerabilidades conocidas |
| Build aislado sin `.env.local` | Aprobado, 67 páginas |
| Migraciones desde cero | 7/7 |
| RLS A/B, rol y unidad | 17/17 |
| Storage privado y expiración | 12/12 |
| Importación | 13/13 |
| Exportación ZIP/PDF | Aprobada |
| Migración de legados ficticios | Aprobada |
| Recibo privado y rate limit | Aprobados |
| Rollback y reconstrucción | Aprobados |
| `git diff --check` | Aprobado |
| Revisión de secretos | Sin secretos rastreados |

Estado final reconstruido: dos tenants ficticios, 72 unidades, 14 usuarios,
15 membresías, 216 cuotas, 205 pagos, cuatro gastos y documentos privados.

El envío de correo real está deshabilitado por
`CONDOMINIOS_RECEIPT_SEND_ENABLED=false`. El endpoint sigue generando,
almacenando y auditando el recibo; sólo enviará cuando se configure una
credencial Resend exclusiva y se habilite expresamente.

## 6. Diferencias frente al P0.5 anterior

- Menor superficie: no toca Layout ni procesos compartidos.
- Menor acoplamiento: funciona sin incidencias ni automatización condominal.
- Menor riesgo de datos: no altera políticas de mantenimiento tradicional.
- Recibos: queda un solo flujo server-side; no existen URLs públicas ni PDF o
  destinatarios controlados por el navegador.
- Demo reproducible: el seed reutiliza de forma segura usuarios ficticios
  persistentes si el esquema se reconstruye sin borrar `auth`.
- Conteos actualizados: RLS pasa 17/17 después de retirar la prueba fuera de
  alcance.

## 7. Riesgos pendientes

- Un build intermedio se lanzó por error desde el árbol fuente y Next detectó
  `.env.local`. Fue una compilación estática: no ejecutó rutas API ni abrió
  conexiones. El build autoritativo se repitió y aprobó en
  `/private/tmp/inmoadmin-condominios-p05-runtime`, donde el preparador confirmó
  `productionEnvCopied: false` y `originalEnvLocalRead: false`.
- Falta E2E manual autenticado de las tres páginas condominales en un preview.
- Falta una credencial Resend exclusiva del demo y validar recepción/reintento.
- No existe verificación pública de folio o QR; requiere decisión funcional.
- La exportación síncrona mantiene límite operativo de 100 MB.
- `@supabase/auth-helpers-nextjs` está deprecado; migrarlo es una tarea global
  separada.
- Node emite advertencias ESM en scripts de prueba; no afecta build ni suite.
- Ninguna migración P0 está autorizada todavía para producción.

Recomendación: **GO CON RESERVAS** para PR y validación interna del demo.
**NO-GO para producción** hasta revisión humana, preview, regresión manual,
plan de migración y autorización explícita.

## 8. Despliegue propuesto, no ejecutado

```bash
git push -u origin codex/security-dependencies-2026
gh pr create --base main --head codex/security-dependencies-2026
```

Después de aprobar y fusionar infraestructura:

```bash
git rebase origin/main codex/condominios-p0-p05
git push -u origin codex/condominios-p0-p05
gh pr create --base main --head codex/condominios-p0-p05
```

No se ejecutó ninguno de estos comandos.

## 9. Rollback por rama

Infraestructura:

1. no fusionar o cerrar su PR si falla la matriz;
2. si ya fue fusionada, revertir únicamente su commit;
3. restaurar el lockfile con el mismo gestor y redeplegar el último release
   validado.

Condominios:

1. no fusionar o cerrar su PR;
2. si ya fue fusionada sin ejecutar migraciones, revertir su único commit;
3. si las migraciones llegaron a un ambiente nuevo, retirar primero el acceso
   a las rutas y respaldar los datos antes de una reversa SQL revisada;
4. nunca ejecutar el reset del demo en otro proyecto.

Producción no requiere rollback porque no fue consultada ni modificada.
