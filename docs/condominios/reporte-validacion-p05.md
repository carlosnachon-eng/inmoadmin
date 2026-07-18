# Reporte final de validación P0.5

Fecha: 17 de julio de 2026
Proyecto demo: `inmoadmin-condominios-demo`
Project ref: `kmxzvcngfrzcasedtexw`

## Dictamen

**GO con reservas para pruebas y demostraciones dentro del ambiente demo.**

**NO-GO para producción y NO-GO para iniciar P1.**

La reserva no se debe a aislamiento de datos: RLS, Storage, importación,
exportación, rollback y build aprobaron. Se debe a dos validaciones de producto
que aún necesitan una decisión o credencial externa:

1. ejecutar un envío real con una credencial Resend exclusiva de demo y
   confirmar recepción en el alias técnico;
2. definir e implementar el mecanismo público de verificación de folio/QR.

## Resultados

| Área | Resultado |
|---|---:|
| Guardas anti-producción | Aprobado |
| Migraciones desde base vacía | 7/7 |
| Pruebas locales | 20/20 |
| RLS tenant/rol/unidad | 17/17 |
| Storage privado | 12/12 |
| Importación | 13/13 |
| Exportación ZIP/PDF | Aprobada |
| Migración ficticia de legados | Aprobada |
| Rollback y reinstalación | Aprobados |
| Recibo privado y rate limit | Aprobados |
| Envío real de correo | Pendiente por credencial externa |
| Verificación QR/folio | Pendiente de definición |
| Build aislado | Aprobado, 67 páginas |
| Auditoría de dependencias | 0 vulnerabilidades conocidas |
| Commit local | Se realizará al cerrar la reorganización |
| Push / deploy | No realizados |

## Correcciones surgidas de la validación

- Alcance RLS del registro padre para usuarios de unidad.
- Grant de lectura tenant-scoped para gastos y documentos operativos.
- Digest de rate limit calificado en el esquema `extensions`.
- Rol demo de sólo lectura y acceso mínimo de perfiles.
- Restricción de importación y pruebas de rollback/idempotencia.
- Retención explícita de exportaciones por siete días.
- Adaptador compatible con jsPDF AutoTable 5.
- Eliminación de referencias legadas a URLs públicas.
- Actualización de Next.js `14.1.0` a `15.5.20`.
- Actualización de jsPDF a `4.2.1`, AutoTable a `5.0.8` y Google APIs a
  `173.0.0`.
- Override de PostCSS a `8.5.10`.

La auditoría pasó de 54 vulnerabilidades conocidas —3 críticas, 18 altas— a
**cero**. El build de producción aislado terminó correctamente con Next.js
15.5.20 y variables exclusivas del demo.

## Datos finales del demo

- Condominio A: 60 unidades.
- Condominio B: 12 unidades.
- 14 usuarios ficticios.
- 15 membresías, incluidas membresías globales y multiunidad.
- 216 cuotas y 205 pagos seed.
- Documentos y recibos privados.
- Ningún correo o documento de una persona real.

## Recibo

Se comprobó:

- folio y PDF reconstruidos desde base;
- hash SHA-256;
- almacenamiento privado;
- rechazo cross-tenant;
- destinatarios resueltos desde base;
- rechazo de destinatario o PDF arbitrario;
- ausencia de BCC personal fijo;
- rate limit;
- manejo explícito del error del proveedor.

No se envió correo real deliberadamente porque no existe una clave Resend
exclusiva de demo. Esto evita reutilizar infraestructura productiva.

## Riesgos no bloqueantes para el demo

- `@supabase/auth-helpers-nextjs` está deprecado; migrarlo a `@supabase/ssr`
  requiere una tarea separada y pruebas de autenticación completas.
- Node muestra advertencias de módulos ESM al ejecutar algunos scripts; no
  afectaron pruebas ni build.
- La exportación actual es síncrona y conserva el límite operativo de 100 MB.
- El envío real de recibos permanece deshabilitado por configuración hasta
  disponer de una credencial Resend exclusiva del demo.

## Condiciones previas a un piloto externo

1. Proveer `RESEND_API_KEY` exclusiva del demo.
2. Autorizar únicamente el alias técnico de prueba.
3. Ejecutar envío, recepción y reintento controlado.
4. Aprobar la decisión funcional de verificación de folio/QR.
5. Repetir build y suite final antes de promover.
6. Hacer revisión humana de ambos PR.

La rama es GO CON RESERVAS para validación interna. No debe conectarse a datos
reales ni promoverse a producción sin cumplir estas condiciones.
