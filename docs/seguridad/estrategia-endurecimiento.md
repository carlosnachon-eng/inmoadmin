# Estrategia paralela de endurecimiento de seguridad

Estado: pendiente de planeación y autorización
Origen: hallazgos de V0-02
Fecha: 25 de junio de 2026

Este trabajo está separado del diccionario de métricas y no autoriza cambios
en producción. Su propósito es preparar una corrección gradual de RLS, grants
y Storage sin romper módulos actuales.

## Principio

No se cerrará una tabla o bucket hasta identificar:

- quién lo consume;
- si el consumo es público, autenticado o de servidor;
- qué operaciones realiza;
- qué prueba demuestra que sigue funcionando;
- cómo revertir el cambio.

## Matriz inicial de sensibilidad

| Grupo | Objetos principales | Riesgo actual | Acceso objetivo |
|---|---|---|---|
| Finanzas críticas | `cash_movements`, `cierre_pagos`, `comisiones_admin`, `owner_payments`, `owner_payment_receipts`, `cuentas_bancarias` | Lectura o escritura demasiado amplia | Dirección/Administración; APIs privilegiadas con validación |
| Datos personales | `profiles`, `solicitudes_inquilino`, `propietarios_inmuebles`, `compradores` | Enumeración, modificación o exposición de documentos | Titular limitado, Jurídico y roles autorizados |
| Operación interna | `contracts`, `payments`, `maintenance_tickets`, `maintenance_quotes`, `firmas_citas` | Usuarios no autorizados pueden alterar estados | Usuarios autenticados según módulo y alcance |
| Condominios | `condominios`, `cuotas_condominio`, `gastos_condominio`, `unidades_condominio` | Datos financieros y personales sin RLS | Administración y portales con acceso por identidad |
| Recursos humanos | `checadas`, `guardias`, `llaves` | Información interna expuesta | Usuario propio, responsables y Dirección |
| Documentos | `documentos`, `poliza-docs`, `receipts`, `recibos-condominio` | Lectura, carga, actualización o borrado público/anónimo | Buckets privados; URLs firmadas; carga por rol o API |
| Contenido público | `propiedades`, `visitas_propiedad`, `solicitudes_contacto_propiedad` | Riesgo de cerrar funciones públicas legítimas | Lectura/insert público mínimo, gestión autenticada |

## Operaciones objetivo por tipo de usuario

### Anónimo

Debe poder:

- leer propiedades publicadas;
- registrar contacto o visita con validación mínima;
- enviar formularios públicos estrictamente necesarios;
- verificar documentos mediante una API o vista con campos limitados.

No debe poder:

- leer tablas financieras;
- enumerar perfiles o roles internos;
- actualizar o borrar registros operativos;
- listar documentos privados;
- reemplazar o eliminar archivos.

### Usuario autenticado

Debe recibir acceso por módulo y alcance, no acceso global por el simple hecho
de estar autenticado.

### Admin/Dirección

Puede consultar información ejecutiva y administrar módulos autorizados. La
validación debe basarse en `profiles.role_id` y `permisos_modulo`.

### Service role

Solo en servidor. Cada API debe validar sesión, rol, alcance y entrada antes
de utilizarlo.

## Módulos que podrían romperse

| Cambio | Módulos en riesgo |
|---|---|
| Cerrar `contracts`, `payments` y `properties` | Contratos, Cobranza, Propietario, Inquilino, Liquidaciones |
| Cerrar mantenimiento | Mantenimiento, Inquilino, Propietario, Condominios |
| Cerrar recibos y abonos | Recibos, Firmas, Cierres, verificación pública |
| Cerrar perfiles | Login, Layout, permisos, clientes, KPIs |
| Cerrar solicitudes y póliza | Formularios públicos, Jurídico, expedientes |
| Hacer privados buckets públicos | PDFs, comprobantes, fotografías y portales |
| Quitar acceso anónimo a `poliza-docs` | Registro público y complementación documental |

## Orden recomendado

1. Crear pruebas de acceso que reflejen el comportamiento actual.
2. Inventariar cada consulta por rol y módulo.
3. Proteger primero operaciones de borrado y actualización anónimas.
4. Proteger tablas financieras sin RLS.
5. Proteger perfiles y datos personales.
6. Migrar documentos sensibles a acceso privado con URLs firmadas.
7. Sustituir políticas por correo con roles y permisos.
8. Aplicar alcance propio/todos.
9. Revocar grants innecesarios cuando las políticas estén comprobadas.
10. Auditar logs y repetir pruebas.

Los cambios se dividirán en migraciones pequeñas por dominio. No se ejecutará
un cierre general de permisos en una sola entrega.

## Plan de pruebas

Para cada migración:

1. Usuario anónimo:
   - operaciones públicas permitidas;
   - lecturas y escrituras sensibles rechazadas.
2. Usuario interno sin módulo:
   - acceso rechazado.
3. Usuario con permiso de lectura:
   - lectura permitida;
   - edición rechazada.
4. Usuario con edición:
   - operaciones necesarias permitidas.
5. Admin:
   - flujo completo permitido.
6. Portales:
   - propietario, inquilino y condomino solo ven sus registros.
7. APIs:
   - service role nunca se expone;
   - sesión y rol se validan.
8. Storage:
   - carga, lectura, actualización y borrado por bucket;
   - URLs firmadas;
   - archivos públicos legítimos.
9. Regresión:
   - login, propiedades, cobranza, recibos, firmas, póliza, mantenimiento y
     condominios.

## Migraciones previstas

Los nombres son provisionales:

```text
*_security_test_helpers.sql
*_secure_financial_tables.sql
*_secure_profiles_and_people.sql
*_secure_operations.sql
*_secure_condominiums.sql
*_secure_storage_documents.sql
*_replace_email_policies.sql
*_tighten_table_grants.sql
```

Cada migración deberá:

- crear políticas nuevas antes de eliminar las antiguas cuando sea posible;
- ser compatible con la aplicación desplegada;
- incluir consultas de validación;
- documentar objetos afectados;
- evitar cambios de datos.

## Rollback

Antes de aplicar una migración:

1. exportar políticas y grants vigentes;
2. guardar SQL inverso;
3. identificar el último despliegue compatible;
4. probar la reversión fuera de producción.

Si una política bloquea un módulo:

1. detener nuevas migraciones;
2. restaurar únicamente políticas/grants del dominio afectado;
3. validar el flujo;
4. registrar el incidente;
5. corregir hacia delante después del análisis.

No se deshabilitará RLS globalmente como mecanismo habitual de rollback.

## Estado

Esta estrategia queda registrada como línea paralela. La preparación detallada
de políticas, migraciones y casos de prueba requiere una tarea independiente y
aprobación explícita. No forma parte de V0-03.
