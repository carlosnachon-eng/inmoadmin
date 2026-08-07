# Plan de validación P0.5 — Supabase demo

Fecha: 17 de julio de 2026
Estado final: validación técnica completada en demo; producción y P1 bloqueados

## Alcance aislado

P0/P0.5 cubre membresías, unidades, cuotas, pagos, gastos, documentos,
importación, exportación y auditoría. La gestión de incidencias condominales y
su automatización quedan expresamente fuera de esta fase y deberán diseñarse
como tablas, APIs y pruebas propias en una fase posterior.

## Objetivo

Validar la implementación P0 sobre un Supabase independiente, con datos completamente ficticios y evidencia reproducible, sin consultar ni modificar producción.

## Destinos

- Producción bloqueada: `bnzrnizrmonjxlktbhlp`.
- Demo permitido: `kmxzvcngfrzcasedtexw`.
- Región demo: AWS `us-east-1`, comparable con producción.
- Organización demo: `Emporio Inmobiliario Demo`, plan Free.

## Orden obligatorio

1. aprobar pruebas unitarias de la guarda anti-producción;
2. validar `.env.demo.local` sin abrir conexión;
3. preparar baseline reproducible para la base vacía;
4. ejecutar baseline y migración P0 únicamente mediante runner protegido;
5. validar esquema, grants, RLS, funciones y bucket;
6. crear Condominio Demo A (60 unidades) y B (mínimo 10);
7. probar aislamiento por rol, tenant y unidad;
8. probar documentos, expiración, nombres maliciosos y sustitución;
9. probar recibos y correo técnico controlado;
10. probar importación transaccional y rollback;
11. generar y revisar exportación ZIP aislada;
12. ensayar migración de archivos ficticios legados;
13. ensayar rollback completo y reinstalación;
14. ejecutar aplicación local conectada sólo al demo;
15. documentar seguridad y cero impacto productivo.

## Criterios de interrupción

La ejecución se detiene ante cualquier inconsistencia de referencia, URL, conexión, clave, allowlist o blocklist; ante cualquier dato no ficticio; o si una prueba demuestra cruce entre A y B.

## Estado de producción

No se utilizarán credenciales productivas, `.env.local`, datos reales, usuarios reales, documentos reales ni comandos de despliegue. No se hará commit, push o publicación.

## Resultado

Los pasos 1 a 15 se ejecutaron en `kmxzvcngfrzcasedtexw`. La base se reconstruyó
desde cero con las siete migraciones finales y el seed ficticio. Las pruebas
automatizadas de RLS, Storage, importación, exportación, migración de legados,
rollback, recibos, build y dependencias quedaron documentadas en los archivos
`evidencia-*`, `ensayo-*` y `reporte-validacion-p05.md`.

Dictamen: **GO con reservas para continuar usando el ambiente demo; NO-GO para
producción y para iniciar P1** hasta cerrar el envío real con credencial Resend
exclusiva de demo y definir la verificación pública de folio/QR.
