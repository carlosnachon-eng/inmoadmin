# Matriz de pruebas P0 — condominios

Fecha: 17 de julio de 2026
Alcance: código local y Supabase demo separado
Regla: compilar no certifica seguridad ni autoriza producción

## Estados

- **PASÓ local:** ejecutada sin depender de datos reales.
- **PENDIENTE demo:** requiere aplicar la migración en un Supabase no productivo.
- **BLOQUEANTE:** debe pasar antes de habilitar un piloto real.

## Automatizadas locales

| ID | Control | Evidencia | Estado |
|---|---|---|---|
| JS-01 | CSV con BOM, CRLF, comas, comillas y saltos internos | `test/condominios/csv.test.mjs` | PASÓ local |
| JS-02 | CSV inválido y comillas abiertas | `test/condominios/csv.test.mjs` | PASÓ local |
| JS-03 | Duplicados y correos inválidos por fila | `test/condominios/csv.test.mjs` | PASÓ local |
| JS-04 | Exportación CSV reversible | `test/condominios/csv.test.mjs` | PASÓ local |
| JS-05 | UUID, periodo, fecha y dinero | `test/condominios/validation.test.mjs` | PASÓ local |
| JS-06 | Límites de texto y caracteres de control | `test/condominios/validation.test.mjs` | PASÓ local |
| JS-07 | Escape HTML y hash estable | `test/condominios/validation.test.mjs` | PASÓ local |
| JS-08 | MIME, tamaño y ruta privada | `test/condominios/validation.test.mjs` | PASÓ local |
| JS-09 | API de recibos no acepta correo/PDF libre | `test/condominios/security-contract.test.mjs` | PASÓ local |
| JS-10 | Portal no resuelve identidad por email ni usa URL pública | mismo archivo | PASÓ local |
| JS-11 | Contrato RLS, grants, bucket privado y auditoría | mismo archivo | PASÓ local |
| BUILD-01 | Compilación optimizada Next.js | `next build` | PASÓ local |

Comando:

```bash
npm run test:p0
```

Resultado local: 11 pruebas, 11 aprobadas, 0 fallidas.

## Base de datos y aislamiento

El archivo `supabase/tests/condominios_rls.sql` contiene la prueba negativa mínima. Debe ejecutarse en una rama/proyecto demo y dentro de una transacción.

| ID | Identidad | Intento | Resultado esperado | Estado |
|---|---|---|---|---|
| RLS-01 | Sin sesión | Leer cualquiera de las cuatro tablas base | 0 filas / 401 en API | PENDIENTE demo, BLOQUEANTE |
| RLS-02 | Autenticado sin membresía | Consultar ID conocido | 0 filas / 403 | PENDIENTE demo, BLOQUEANTE |
| RLS-03 | Usuario condominio A | Consultar B por URL, REST y relación | 0 filas / 403 o 404 | PENDIENTE demo, BLOQUEANTE |
| RLS-04 | Condómino A-101 | Consultar A-102 | 0 filas | PENDIENTE demo, BLOQUEANTE |
| RLS-05 | Condómino con dos unidades | Consultar ambas asignadas | 2 unidades y nada más | PENDIENTE demo |
| RLS-06 | Comité A | Consultar B | 0 filas | PENDIENTE demo, BLOQUEANTE |
| RLS-07 | Sólo lectura | INSERT/UPDATE/DELETE directo y por API | privilegio denegado / 403 | PENDIENTE demo, BLOQUEANTE |
| RLS-08 | Authenticated | Ejecutar RPC privilegiada directamente | permiso denegado | PENDIENTE demo, BLOQUEANTE |

## Operaciones y finanzas

| ID | Escenario | Comprobación | Estado |
|---|---|---|---|
| FIN-01 | Generar el mismo periodo dos veces | Segunda ejecución crea 0, no duplica | PENDIENTE demo |
| FIN-02 | Registrar dos veces el mismo pago | Idempotencia devuelve cache o conflicto; una fila | PENDIENTE demo, BLOQUEANTE |
| FIN-03 | Periodo cerrado | Cuota, pago y gasto son rechazados | PENDIENTE demo, BLOQUEANTE |
| FIN-04 | Reabrir como no Dirección | 403 | PENDIENTE demo |
| FIN-05 | Reversar pago | Original queda marcado, cuota vuelve a pendiente, motivo y auditoría existen | PENDIENTE demo |
| FIN-06 | Reversar gasto | No hay DELETE; se conservan antes/después y motivo | PENDIENTE demo |
| FIN-07 | Fallo en segunda escritura RPC | Rollback completo | PENDIENTE demo, BLOQUEANTE |
| FIN-08 | Saldo inicial duplicado | Restricción única / 409 | PENDIENTE demo |
| FIN-09 | Notas de gasto | Valor exacto persiste y se exporta | PENDIENTE demo |

## Documentos y recibos

| ID | Escenario | Resultado esperado | Estado |
|---|---|---|---|
| DOC-01 | URL de objeto sin firma | Acceso denegado | PENDIENTE demo, BLOQUEANTE |
| DOC-02 | URL firmada | Expira en máximo 10 minutos | PENDIENTE demo, BLOQUEANTE |
| DOC-03 | Documento de unidad B solicitado por A | 403/404, sin URL | PENDIENTE demo, BLOQUEANTE |
| DOC-04 | HTML o archivo >10 MB | 400/413 | PASÓ validación local; PENDIENTE Storage |
| DOC-05 | Reusar ruta | Carga no sobrescribe | PENDIENTE demo |
| MAIL-01 | Sin token | 401 | PENDIENTE preview |
| MAIL-02 | Usuario sin `enviar_recibo` | 403 | PENDIENTE preview |
| MAIL-03 | Correo o PDF inyectado por cliente | Campos ignorados/no aceptados | PASÓ contrato local |
| MAIL-04 | Repetición con misma llave | Un solo envío lógico | PENDIENTE demo |
| MAIL-05 | Más de 20/hora | 429 | PENDIENTE demo |
| MAIL-06 | BCC no configurado | No se envía BCC | PENDIENTE preview |

## Importación y exportación

| ID | Escenario | Resultado esperado | Estado |
|---|---|---|---|
| IMP-01 | Archivo inválido | Preview con errores; commit bloqueado | PASÓ parser; PENDIENTE API demo |
| IMP-02 | Duplicado dentro del CSV | Error por fila | PASÓ local |
| IMP-03 | Cambio y omisión | Resumen de altas/cambios/sin cambio/omisiones | PENDIENTE demo |
| IMP-04 | Fallo en fila intermedia | Rollback y backup previo conservado | PENDIENTE demo, BLOQUEANTE |
| IMP-05 | Unidad omitida | No se elimina | PENDIENTE demo, BLOQUEANTE |
| IMP-06 | Confirmación | Descarga CSV de resultado | PENDIENTE navegador demo |
| EXP-01 | Exportar A | ZIP sólo contiene A | PENDIENTE demo, BLOQUEANTE |
| EXP-02 | Usuario sin permiso | 403 | PENDIENTE demo |
| EXP-03 | ZIP | Incluye CSV, PDF, documentos, índice, manifest y hashes | PENDIENTE demo |
| EXP-04 | Auditoría | Evento de exportación con hash/tamaño | PENDIENTE demo |

## Revisión manual de interfaz

Probar a 375, 768 y 1440 px:

1. sólo lectura no ve mutaciones;
2. cada rol sólo ve acciones devueltas por `/permisos`;
3. portal permite cambiar entre varias unidades;
4. errores de API no muestran éxito;
5. CSV se anuncia como CSV, no Excel;
6. demo muestra únicamente nombres ficticios;
7. consola sin errores;
8. enlaces firmados abren y expiran.

## Evidencia necesaria para cerrar P0

No marcar P0 como certificado hasta adjuntar:

1. salida completa de `condominios_rls.sql`;
2. IDs ficticios de dos condominios y capturas de resultados cruzados vacíos;
3. log de pruebas API negativas;
4. manifest y hash de una exportación demo;
5. evidencia de expiración de URL;
6. comprobación de buckets legados;
7. rollback ensayado sobre copia demo.
