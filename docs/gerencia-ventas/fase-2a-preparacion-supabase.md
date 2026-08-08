# Fase 2A Gerencia de Ventas: preparacion Supabase segura

Estado: preparacion, sin ejecucion de SQL.
Fecha: 8 de agosto de 2026.
Rama: `codex/fase-2a-supabase-prep`.

## Objetivo

Preparar la infraestructura para continuar Fase 2A sin modificar Supabase
Produccion directamente. Esta fase documental y de migracion revisable busca:

- crear una estructura formal de migraciones;
- definir un Supabase dev/preview separado;
- disenar tablas y RLS para oportunidades, disponibilidad y supervision;
- permitir una transicion no destructiva desde `cierres.vendedor`;
- reservar puntos de integracion futura con Respond.io;
- no bloquear el modelo futuro "Mi trabajo / Supervisar".

No se ejecutaron migraciones, no se llamo a Respond.io y no se modifico
Produccion.

## Plan exacto para crear Supabase dev/preview

1. Entrar al dashboard de Supabase con la cuenta autorizada.
2. Crear un proyecto nuevo, separado de Produccion, por ejemplo:
   `inmoadmin-dev` o `inmoadmin-preview`.
3. Elegir region igual o cercana a Produccion para evitar diferencias de
   latencia.
4. Guardar las claves del nuevo proyecto en un gestor seguro:
   - Project URL;
   - anon key;
   - service role key;
   - database password;
   - connection string.
5. No copiar secretos al repositorio.
6. Configurar `.env.local` local contra dev/preview.
7. Configurar variables de Vercel Preview contra dev/preview.
8. Mantener Vercel Production apuntando al proyecto productivo.
9. Ejecutar migraciones primero en dev/preview.
10. Validar login, RLS y modulos criticos antes de considerar Produccion.

## Variables de entorno a separar

Cada ambiente debe tener su propio valor:

| Variable | Local dev | Vercel Preview | Vercel Production |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dev | Supabase dev/preview | Supabase prod |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon dev | anon dev/preview | anon prod |
| `SUPABASE_SERVICE_ROLE_KEY` | service dev | service dev/preview | service prod |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | URL preview | URL produccion |
| `CRON_SECRET` | dev/test | preview distinto | prod distinto |
| `RESPOND_IO_TOKEN` | vacio o token sandbox | no usar real salvo autorizacion | prod |
| `RESEND_API_KEY` | dev/test | preview/test | prod |
| `EASYBROKER_API_KEY` | dev/test | preview/test | prod |
| `GOOGLE_SERVICE_ACCOUNT` | dev/test | preview/test | prod |

Regla: Preview no debe usar service role productivo.

## Esquema/tablas minimas a replicar

Para que Inmoadmin funcione en desarrollo con Gerencia de Ventas se requiere
replicar estructura, RLS, policies e indices de:

### Seguridad y organizacion

- `profiles`
- `roles`
- `permisos_modulo`
- `users`, si alguna pantalla historica lo sigue consultando

### Comercial

- `clientes`
- `citas`
- `seguimientos_cliente`
- `kpis_diarios`
- `cierres`
- `cierre_pagos`
- `recibos_apartado`
- `recibos_abonos`
- `firmas`
- `firma_etapas`
- `firmas_citas`
- `firmas_usuarios`
- `cartas_oferta`
- `leads_respond`
- `envios`
- `envios_propiedades`

### Propiedades

- `propiedades`
- `propietarios_inmuebles`
- `visitas_propiedad`
- `solicitudes_contacto_propiedad`

### Administracion operativa que puede afectar dashboards existentes

- `properties`
- `contracts`
- `payments`
- `maintenance_tickets`
- `maintenance_quotes`
- `owner_payments`
- `property_expenses`
- `cash_movements`

### Storage

Replicar buckets y policies, pero no necesariamente archivos reales:

- documentos de recibos;
- firmas;
- comprobantes;
- fotos de propiedades;
- documentos de poliza;
- cualquier bucket usado por rutas activas.

## Estrategia de datos de prueba/sanitizados

Decision aprobada: iniciar con seed minimo sintetico. No se usara snapshot de
Produccion en esta etapa.

Archivo preparado:

```text
supabase/seed/202608080001_fase_2a_minimal_seed.sql
```

El seed contiene un conjunto ficticio para validar:

- admin;
- gerente_ventas;
- coord_operaciones;
- varios asesores;
- clientes;
- citas;
- seguimientos;
- propiedades;
- cierres nuevos;
- renovaciones;
- operaciones perdidas;
- ausencias;
- oportunidades en distintas etapas;
- eventos de auditoria;
- metadatos Respond.io sinteticos.

Mas adelante se evaluara snapshot sanitizado si hace falta volumen historico.

Alternativas futuras:

1. Seed minimo manual:
   - roles reales;
   - perfiles internos ficticios;
   - 5 a 10 clientes ficticios;
   - citas de prueba;
   - cierres sinteticos;
   - recibos ficticios;
   - oportunidades nuevas.

2. Snapshot sanitizado:
   - reemplazar nombres, telefonos, correos y notas;
   - conservar ids tecnicos solo si no exponen personas reales;
   - truncar URLs privadas;
   - no copiar PDFs, comprobantes ni documentos sensibles;
   - conservar distribucion de fechas y montos cuando sirva para BI.

Recomendacion vigente: mantener seed minimo hasta que Fase 2A necesite validar
historicos complejos.

## Estructura propuesta de migraciones

```text
supabase/
  README.md
  migrations/
    202608080001_fase_2a_gerencia_ventas_base.sql
```

Convencion:

- `YYYYMMDDNNNN_descripcion.sql`
- una migracion por entrega logica;
- SQL revisable en PR antes de ejecucion;
- incluir RLS en la misma migracion de tablas nuevas;
- evitar backfills automaticos en migraciones estructurales;
- backfills historicos deben ser scripts separados y autorizados.

## Primera migracion SQL de Fase 2A

Archivo:

```text
supabase/migrations/202608080001_fase_2a_gerencia_ventas_base.sql
```

Contenido principal:

- `gv_supervision_edges`
- `gv_advisor_availability`
- `gv_opportunities`
- `gv_opportunity_events`
- helpers:
  - `current_profile_role_id()`
  - `is_internal_management_role()`
  - `can_supervise_profile(profile_id)`
- columnas opcionales en `cierres`:
  - `advisor_profile_id`
  - `operation_type_structured`
  - `operation_type_confidence`
  - `operation_type_source`
  - `classified_by`
  - `classified_at`
  - `classification_notes`
- indices para consultas gerenciales;
- campos de proxima accion, riesgo, perdida, oferta/apartado y metadatos
  Respond.io;
- RLS y policies iniciales.

La migracion no hace backfill ni toca datos existentes.

## RLS/policies propuestas

### Principios

- El asesor ve su propio espacio.
- El gerente ve su propio espacio y los asesores asignados.
- Coordinacion puede supervisar procesos/subordinados asignados.
- Admin ve todos los niveles.
- Ver "como" otro usuario debe ser solo lectura.
- Toda accion registra el usuario real con `auth.uid()`.
- No existe impersonacion tecnica.

### `gv_supervision_edges`

- Select:
  - admin;
  - supervisor de la relacion;
  - subordinado de la relacion.
- Write:
  - solo admin inicialmente.

Motivo: la jerarquia es sensible. Fase 2A no debe permitir que cualquier
gerente redefina sus subordinados sin control.

### `gv_advisor_availability`

- Select:
  - propio;
  - supervisor asignado;
  - admin.
- Write:
  - admin;
  - gerente_ventas solo sobre subordinados asignados.

Uso: ausencias temporales, capacidad evaluable y lectura de cumplimiento sin
modificar `profiles.active`.

### `gv_opportunities`

- Select:
  - asesor asignado;
  - supervisor asignado;
  - admin.
- Insert:
  - asesor crea oportunidades propias;
  - supervisor crea oportunidades para subordinados.
- Update:
- asesor propio;
- supervisor del asesor;
- admin.
- Delete:
  - solo admin.

Recomendacion: en la app preferir cierre/cancelacion logica sobre delete.

### `gv_opportunity_events`

- Select:
  - quien puede ver la oportunidad.
- Insert:
  - quien puede actuar sobre la oportunidad;
  - `actor_profile_id` debe ser `auth.uid()`.

Debe registrar como minimo:

- creacion;
- cambio de etapa;
- cambio de asesor;
- proxima accion;
- fecha de proxima accion;
- riesgo;
- oferta/apartado;
- perdida;
- clasificacion de perdida;
- cierre;
- intervencion/correccion de Gerencia;
- sincronizacion externa controlada.

## Estrategia no destructiva para `cierres.vendedor`

Problema actual:

- `cierres.vendedor` es texto libre.
- Existen variaciones de mayusculas, nombres parciales, combinaciones y valores
  ambiguos.
- No debe reinterpretarse el historico automaticamente.

Transicion propuesta:

1. Mantener `cierres.vendedor` intacto como campo historico.
2. Agregar `cierres.advisor_profile_id` nullable.
3. Agregar `cierres.operation_type_structured` con valores:
   - `nueva`
   - `renovacion`
   - `otro`
4. Agregar campos de trazabilidad:
   - `operation_type_confidence`
   - `operation_type_source`
   - `classified_by`
   - `classified_at`
   - `classification_notes`
5. Para cierres nuevos, capturar `advisor_profile_id` desde el flujo que ya
   conoce al asesor.
6. Para historico:
   - sugerir matches por heuristica en una vista de revision;
   - solo confirmar manualmente casos claros;
   - dejar ambiguos como null;
   - nunca sobrescribir `vendedor`.
7. Reportes gerenciales:
   - usar `advisor_profile_id` cuando exista;
   - caer a lectura historica por texto solo en reportes legacy;
   - mostrar advertencia cuando el dato sea ambiguo.

Regla comercial:

- La meta mensual de nueva produccion debe usar `operation_type_structured =
  'nueva'` cuando exista.
- Mientras haya historico sin clasificar, los reportes deben marcar esa parte
  como dato heredado/preliminar.

## Integracion futura con Respond.io Growth Developer API

No se hicieron llamadas, no se usaron API keys y no se modifico Respond.io.

### Datos que podriamos leer

Segun el tipo de integracion disponible normalmente para Developer API:

- contactos;
- telefonos/correos;
- canal de origen;
- tags;
- assignee o usuario asignado;
- estado de conversacion;
- timestamps de primera y ultima interaccion;
- mensajes o eventos de conversacion, si el plan y permisos lo permiten;
- campos personalizados;
- webhooks/eventos de conversacion.

La integracion debe confirmarse contra la documentacion vigente antes de
implementar.

### Relacion con `clientes` y `profiles`

Relacion sugerida:

- `clientes.telefono` normalizado contra telefono de Respond.io;
- `clientes.correo` contra email de contacto;
- `profiles.email` contra assignee interno si Respond.io expone email del
  usuario;
- `gv_opportunities.respond_contact_id` para contacto externo;
- `gv_opportunities.respond_conversation_id` para conversacion;
- `gv_opportunities.respond_channel` para canal;
- `gv_opportunities.source = 'respond_io'`.

No se debe depender solo del nombre del contacto.

### Campos reservados desde Fase 2A

La migracion reserva:

- `source`
- `source_external_id`
- `respond_contact_id`
- `respond_conversation_id`
- `respond_channel`
- `respond_assignee_id`
- `respond_status`
- `respond_first_activity_at`
- `respond_last_inbound_at`
- `respond_last_outbound_at`
- `respond_metadata`
- `last_synced_at`
- `last_activity_at`

Esto permite conectar Respond.io despues sin cambiar de nuevo la estructura
base de oportunidades.

### Riesgos de integracion Respond.io

- Duplicados por telefono con formatos distintos.
- Cambios de asignacion en Respond.io que no coincidan con `profiles`.
- Conversaciones compartidas por varios asesores.
- Mensajes sensibles que no deben replicarse completos.
- Rate limits de API.
- Necesidad de webhooks firmados si se sincroniza en tiempo real.

Recomendacion: comenzar solo con metadatos de contacto/conversacion, no con
contenido completo de mensajes.

## Impacto futuro de "Mi trabajo / Supervisar"

La migracion evita bloquear este modelo mediante:

- `gv_supervision_edges` para jerarquia flexible;
- `can_supervise_profile(profile_id)` como helper central;
- `actor_profile_id` y `acted_as_profile_id` en eventos;
- policies que distinguen propiedad, supervision y admin.

Modelo futuro:

- Asesor:
  - ve y trabaja sus oportunidades;
  - no ve oportunidades ajenas.
- Gerente de ventas:
  - ve su propio trabajo;
  - supervisa asesores asignados;
  - puede crear/editar oportunidades de su equipo si se autoriza en UI.
- Coordinacion:
  - supervisa procesos o subordinados asignados;
  - no obtiene acceso global por defecto.
- Admin:
  - acceso global.
- Ver como:
  - solo lectura;
  - no cambia `auth.uid()`;
  - cualquier accion conserva usuario real.

## Acciones que requieren autorizacion antes de continuar

1. Crear proyecto Supabase dev/preview.
2. Confirmar si dev/preview usara seed minimo o snapshot sanitizado.
3. Proporcionar variables dev/preview en entorno local y Vercel Preview.
4. Autorizar ejecucion de migraciones en dev/preview.
5. Revisar SQL de Fase 2A antes de ejecutar.
6. Confirmar `coord_operaciones` queda contemplado desde Fase 2A, sin centro de
   trabajo completo todavia.
7. Confirmar `gerente_ventas` puede ver y editar oportunidades de sus asesores
   asignados con auditoria real.
8. Confirmar reglas exactas de clasificacion historica de cierres.
9. Confirmar alcance inicial de Respond.io: metadatos solamente o tambien
   eventos de conversacion.

## Riesgos antes de continuar

- Sin Supabase dev/preview, cualquier migracion tocaria Produccion.
- Sin acceso directo a metadatos no se pueden validar FKs/RLS reales al 100%.
- `cierres.vendedor` tiene datos ambiguos; un backfill automatico podria
  atribuir ventas incorrectamente.
- La coexistencia de `propiedades` y `properties` requiere cuidado al modelar
  oportunidades.
- Si Respond.io se integra sin normalizacion, puede crear duplicados de
  clientes.
- Si las policies se prueban solo con service role, podrian fallar para usuarios
  reales.
- Si la jerarquia se modela demasiado rigida, despues costara soportar
  coordinadores y supervision por procesos.

## Decision recomendada

Antes de escribir UI de Fase 2A:

1. Crear Supabase dev/preview.
2. Ejecutar esta migracion ahi.
3. Validar RLS con usuarios reales:
   - asesor;
   - gerente_ventas;
   - coord_operaciones;
   - admin.
4. Cargar datos minimos.
5. Solo despues conectar la pantalla de Gerencia Ventas a las nuevas tablas.
