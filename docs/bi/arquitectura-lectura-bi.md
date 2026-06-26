# V0-06 · Arquitectura de lectura BI y estrategia de consultas

Versión: 1.0  
Fecha: 26 de junio de 2026  
Alcance: diseño, sin implementación productiva

## 1. Objetivo

Definir cómo el Centro de Inteligencia Empresarial consumirá información de
InmoAdmin sin duplicar datos, sin afectar el rendimiento y sin modificar los
módulos operativos.

V0-06 no crea pantallas, APIs, migraciones definitivas, políticas RLS ni
cambios en módulos existentes. Su salida es una arquitectura de lectura para
construir después el motor de métricas.

## 2. Decisión arquitectónica recomendada

El Centro de Inteligencia debe leer mediante una capa intermedia controlada,
no directamente desde el frontend contra todas las tablas operativas.

La arquitectura recomendada es:

```text
Tablas operativas existentes
        ↓
Vistas SQL de normalización y trazabilidad
        ↓
Funciones SQL / endpoints internos para agregación
        ↓
API del Centro de Inteligencia
        ↓
Frontend ejecutivo
```

### Por qué

- Evita N+1 queries desde React.
- Evita consultas gigantes y frágiles en el frontend.
- Permite mantener trazabilidad hasta el registro origen.
- Centraliza deduplicación, signos, estados y clasificación económica.
- Reduce riesgo de romper módulos operativos.
- Permite optimizar vistas, índices y snapshots sin cambiar la UI.

## 3. Qué se consultará directamente de tablas

Las tablas operativas se pueden consultar directamente solo cuando el uso sea:

1. Detalle puntual de un registro origen.
2. Auditoría o drill-down desde una métrica agregada.
3. Validación interna durante desarrollo.
4. Consulta pequeña filtrada por ID.

No se recomienda que el frontend ejecutivo consulte directamente estas tablas
para construir KPIs globales.

| Tabla | Consulta directa permitida | Motivo |
|---|---|---|
| `cierres` | Detalle de cierre por `id` | Registro origen de comisión generada. |
| `cierre_pagos` | Detalle de pago por `id` o `cierre_id` | Evidencia del cobro aplicado. |
| `comisiones_admin` | Detalle por `id`, `contract_id` o `periodo` | Fuente primaria de comisión administrativa. |
| `payments` | Detalle de renta o pago por contrato | Fondo de tercero y cobranza operativa. |
| `cash_movements` | Detalle de movimiento de caja por `id` | Evidencia monetaria y conciliación. |
| `poliza_caja` | Detalle de cobro/pago de póliza por `id` | Fuente principal de caja de póliza. |
| `poliza_expedientes` | Detalle de expediente por `id` | Contexto legal, estado y monto esperado. |
| `maintenance_tickets` | Detalle de ticket por `id` | Contexto operativo y estado. |
| `maintenance_quotes` | Detalle de cotización por `id` o `ticket_id` | Fuente de importe/costo aprobado. |
| `owner_payments` | Detalle de liquidación por `id` | Obligación/pago a propietario. |
| `owner_payment_receipts` | Evidencia por liquidación o propietario | Comprobación, no fuente primaria de ingreso. |
| `cuotas_condominio` | Detalle por condominio/unidad/periodo | Fondo de terceros. |
| `gastos_condominio` | Detalle por gasto | Uso de fondos de condominio. |
| `condominios` | Catálogo por `id` | Contexto y honorarios. |

## 4. Qué debería salir de vistas SQL

Las vistas deben normalizar conceptos, no reemplazar las tablas operativas.
Su función es entregar filas trazables con una forma común.

### 4.1 Vista base de eventos BI

Propuesta futura:

```text
bi_eventos_base
```

Propósito:

- Unificar eventos financieros, comerciales y operativos en un formato común.
- Mantener `source_table`, `source_id` y `source_key`.
- Aplicar clasificación del catálogo V0-05.
- Separar ingreso propio, fondos de terceros, costo, cuentas por cobrar,
  cuentas por pagar y pipeline.

Columnas conceptuales:

| Columna | Propósito |
|---|---|
| `event_id` | Clave lógica estable, no necesariamente UUID físico. |
| `source_table` | Tabla origen real. |
| `source_id` | ID origen real. |
| `source_key` | Clave lógica de deduplicación. |
| `business_unit` | Unidad o dominio del catálogo. |
| `event_type` | Tipo de evento del catálogo. |
| `economic_classification` | Ingreso propio, fondo tercero, costo, CxC, CxP o pipeline. |
| `direction` | `entrada`, `salida` o `neutral`. |
| `amount` | Importe positivo. |
| `currency` | Inicialmente `MXN`. |
| `event_date` | Fecha empresarial del evento. |
| `cash_date` | Fecha de caja, cuando aplique. |
| `normalized_status` | Estado normalizado. |
| `original_status` | Estado original de la tabla fuente. |
| `trace_url` | Ruta interna futura al registro origen. |
| `metadata` | JSON con contexto mínimo para drill-down. |

### 4.2 Vistas por dominio

Antes de crear una vista global, conviene definir vistas por dominio para
evitar una vista monolítica difícil de auditar.

| Vista propuesta | Fuente principal | Propósito |
|---|---|---|
| `bi_cierres_eventos` | `cierres`, `cierre_pagos` | Comisión generada, cobros aplicados, saldo reconstruido. |
| `bi_admin_eventos` | `comisiones_admin`, `payments`, `cash_movements` | Comisión administrativa, renta como fondo de tercero, cobranza. |
| `bi_poliza_eventos` | `poliza_caja`, `poliza_expedientes` | Cobros de póliza, anticipos, saldos y riesgo documental. |
| `bi_mantenimiento_eventos` | `maintenance_tickets`, `maintenance_quotes`, `cash_movements` | Importe generado, costo, margen y caja de mantenimiento. |
| `bi_condominios_eventos` | `cuotas_condominio`, `gastos_condominio`, `condominios` | Cuotas como fondos de terceros, gastos y honorarios. |
| `bi_liquidaciones_eventos` | `owner_payments`, `owner_payment_receipts`, `cash_movements` | Pagos a propietarios, obligaciones y evidencia. |
| `bi_comercial_eventos` | leads/citas/propiedades/proyectos | Actividad comercial, visitas, contactos, citas y pipeline. |

### 4.3 Vistas de conciliación

Estas vistas no alimentan totales principales; detectan diferencias.

| Vista propuesta | Qué compara |
|---|---|
| `bi_cierres_conciliacion` | `cierres.cobrado/pendiente` vs suma de `cierre_pagos`. |
| `bi_admin_conciliacion` | `comisiones_admin` vs `cash_movements.comision_cobrada`. |
| `bi_poliza_conciliacion` | `poliza_caja` vs montos/resúmenes del expediente. |
| `bi_mantenimiento_conciliacion` | cotización/ticket/caja para evitar doble cobro. |
| `bi_liquidaciones_conciliacion` | `owner_payments`, recibos y caja. |

## 5. Qué conviene calcular en servidor

Debe calcularse en servidor todo lo que:

- Combine más de una tabla.
- Requiera deduplicación.
- Requiera permisos ejecutivos.
- Requiera agregación mensual/anual.
- Pueda crecer en volumen.
- Necesite ocultar detalles sensibles al frontend.

| Cálculo | Dónde calcular | Motivo |
|---|---|---|
| Ingreso generado por unidad | Servidor/API o función SQL | Une varias fuentes y reglas. |
| Cobrado por unidad | Servidor/API o función SQL | Requiere deduplicación y clasificación. |
| Pendiente por cobrar | Servidor/API | Debe reconstruirse por documento antes de sumar. |
| Vencido | Servidor/API | Depende de fecha de corte y estado. |
| Caja propia estimada | Servidor/API | Requiere separar fondos de terceros. |
| Fondos de terceros | Servidor/API | Alta sensibilidad financiera. |
| Margen | Servidor/API | Combina ingreso y costo por unidad. |
| Pipeline comercial | Servidor/API | Requiere estados, probabilidades y fechas. |
| Ranking mensual | Servidor/API | Agregación, filtros y ordenamiento. |
| Alertas de conciliación | Servidor/API | Cruce entre fuentes y umbrales. |

El frontend debe recibir datos ya agregados y trazables, no reconstruir el
modelo financiero.

## 6. Métricas que requerirán snapshots históricos

Un snapshot es necesario cuando el valor puede cambiar con el tiempo aunque el
periodo analizado sea pasado.

| Métrica | Requiere snapshot | Por qué |
|---|---:|---|
| Caja real del día | Sí | Debe conservar corte histórico y conciliación. |
| Pendiente por cobrar al cierre de mes | Sí | Cambia cuando se cobran saldos después. |
| Vencido al cierre de mes | Sí | Cambia con pagos posteriores. |
| Forecast financiero | Sí | Depende de pipeline y supuestos de ese momento. |
| Pipeline comercial mensual | Sí | Las oportunidades cambian de etapa o se eliminan. |
| Ranking mensual por unidad/asesor | Recomendado | Evita recalcular con datos corregidos sin trazabilidad. |
| Productividad por asesor | Recomendado | Roles, equipo y asignaciones pueden cambiar. |
| Fondos de terceros bajo custodia | Sí | Es una posición a una fecha de corte. |
| Margen por mantenimiento | Recomendado | Costos pueden corregirse después. |
| Ingreso generado histórico | No inicialmente | Puede recalcularse si las fuentes son estables; si hay ajustes, registrar diferencias. |
| Cobrado histórico | No inicialmente | Puede recalcularse desde pagos, salvo conciliación bancaria futura. |

Propuesta futura no definitiva:

```text
bi_metric_snapshots
```

Con columnas conceptuales:

```text
id
snapshot_date
period_start
period_end
metric_key
business_unit
value
currency
definition_version
source_hash
generated_at
generated_by
metadata
```

No crear esta tabla en V0-06. Solo queda recomendada para fases posteriores.

## 7. Consultas potencialmente costosas

| Consulta | Riesgo | Recomendación |
|---|---|---|
| Dashboard anual completo con todas las unidades | Muchas agregaciones y joins | API agregada por periodo, no frontend directo. |
| Saldo pendiente reconstruido de todos los cierres | Suma de pagos por cierre | Vista o función agrupada por `cierre_id`. |
| Administración mensual por contrato | Volumen por periodo y contrato | Filtros obligatorios por mes/año; índices futuros. |
| Caja mezclando categorías | Alto riesgo semántico | Separar por clasificación antes de agregar. |
| Mantenimiento con tickets + quotes + caja | Duplicación y joins ambiguos | Vista específica de mantenimiento. |
| Liquidaciones por propietario | Falta `owner_id` consistente | Normalización progresiva de propietario. |
| Pipeline histórico | Estados mutables | Snapshot mensual/semanal. |
| Ranking por asesor | Asignaciones y nombres no normalizados | Resolver identidad de usuario/asesor antes de comparar. |

## 8. Índices que podrían necesitarse en el futuro

No crear en V0-06. Estos índices se proponen para cuando se implementen vistas,
funciones o APIs y se midan consultas reales.

| Tabla | Índice futuro recomendado | Motivo |
|---|---|---|
| `cierres` | `(fecha_cierre)` | Filtros por periodo. |
| `cierres` | `(vendedor)` | Ranking/productividad comercial. |
| `cierre_pagos` | `(cierre_id)` | Saldos por cierre. |
| `cierre_pagos` | `(fecha)` | Cobrado por periodo. |
| `comisiones_admin` | `(periodo)` | Ingreso mensual recurrente. |
| `comisiones_admin` | `(contract_id, periodo)` | Ya existe lógica única; validar índice físico. |
| `comisiones_admin` | `(status, fecha_cobro)` | Cobrado por periodo. |
| `payments` | `(contract_id)` | Relación con contratos. |
| `payments` | `(period_year, period_month)` | Rentas por periodo. |
| `payments` | `(payment_date, status)` | Cobranza y vencidos. |
| `cash_movements` | `(date)` | Caja por periodo. |
| `cash_movements` | `(category, date)` | Caja por clasificación operativa. |
| `cash_movements` | `(reference_type, reference_id)` | Trazabilidad y conciliación. |
| `poliza_caja` | `(fecha, tipo)` | Cobros/pagos por periodo. |
| `poliza_caja` | `(expediente_id)` | Drill-down y conciliación. |
| `maintenance_quotes` | `(ticket_id)` | Relación con tickets. |
| `maintenance_quotes` | `(status)` | Cotizaciones aprobadas. |
| `maintenance_tickets` | `(status, status_pago)` | Salud operativa y cobranza. |
| `owner_payments` | `(owner_email, period_description)` | Liquidaciones por propietario. |
| `owner_payments` | `(payment_date, status)` | Pagos y pendientes. |
| `cuotas_condominio` | `(condominio_id, periodo)` | Cuotas por condominio/periodo. |
| `cuotas_condominio` | `(status, fecha_vencimiento)` | Vencidos de cuotas. |
| `gastos_condominio` | `(condominio_id, fecha)` | Gastos por periodo. |

## 9. Tiempo real vs cálculo no inmediato

| Información | Tiempo real | Recomendación |
|---|---:|---|
| Detalle de un cierre | Sí | Leer registro origen. |
| Cobros del día | Sí | Vista/API filtrada por fecha. |
| Ingreso generado mensual | Sí, con caché ligera | Agregación simple por periodo. |
| Pendiente por cobrar | Casi real | Recalcular por API; no en cada render. |
| Vencido | Casi real | Calcular por corte diario o bajo demanda. |
| Caja propia estimada | No siempre | Requiere conciliación; mostrar estado de confianza. |
| Fondos de terceros bajo custodia | No siempre | Ideal con snapshot diario/mensual. |
| Forecast anual | No | Snapshot + modelo de supuestos. |
| Pipeline histórico | No | Snapshot de etapas. |
| Ranking mensual | Sí para mes actual; snapshot para meses cerrados | Evita cambios retroactivos invisibles. |
| Alertas de riesgo | Casi real | Generar en servidor con umbrales. |

## 10. Cómo evitar N+1 queries y consultas gigantes

Reglas de implementación futura:

1. El frontend ejecutivo no debe consultar una tabla por cada tarjeta.
2. Cada pantalla debe consumir 1 a 3 endpoints agregados como máximo.
3. Los endpoints deben aceptar filtros explícitos: mes, año, unidad, asesor y
   estado.
4. Las consultas deben agrupar en SQL o servidor, no en componentes React.
5. El drill-down debe ser paginado y bajo demanda.
6. Los totales principales deben regresar junto con su estado de confianza:
   calculable, parcial, requiere conciliación o no disponible.
7. Cada fila agregada debe poder abrir su evidencia mediante `source_table` y
   `source_id`.
8. No usar `select('*')` en APIs ejecutivas.
9. No cargar listas completas para después filtrar en frontend.
10. Separar endpoints de resumen y endpoints de detalle.

Propuesta de endpoints futuros:

| Endpoint futuro | Respuesta |
|---|---|
| `/api/ejecutivo/resumen` | KPIs principales por periodo. |
| `/api/ejecutivo/unidades` | Métricas por unidad de negocio. |
| `/api/ejecutivo/flujo` | Caja, fondos de terceros y flujo neto. |
| `/api/ejecutivo/cobranza` | Pendiente, vencido y detalle paginado. |
| `/api/ejecutivo/pipeline` | Pipeline comercial y forecast. |
| `/api/ejecutivo/riesgos` | Alertas de conciliación y operación. |
| `/api/ejecutivo/detalle` | Drill-down trazable por métrica. |

Estos endpoints no se implementan en V0-06.

## 11. Trazabilidad hasta el registro origen

Cada métrica debe permitir responder:

> ¿De qué registros salió esta cifra?

Reglas:

1. Toda vista o función debe incluir `source_table` y `source_id`.
2. Las agregaciones deben conservar una lista o conteo de fuentes.
3. Para drill-down, la API debe regresar filas de evidencia paginadas.
4. Los registros derivados deben conservar `source_key`.
5. Cuando haya deduplicación, debe indicarse qué fuente ganó y cuál quedó como
   evidencia.
6. Cuando no haya trazabilidad suficiente, la métrica debe marcarse como
   parcial o requiere conciliación.

Ejemplo conceptual:

```json
{
  "metric_key": "ingreso_generado",
  "business_unit": "cierres",
  "amount": 125000,
  "status": "calculable",
  "sources": [
    { "source_table": "cierres", "source_id": "..." }
  ]
}
```

## 12. Estrategia de permisos

La capa de lectura BI debe considerar que el módulo es exclusivo de Dirección
y Admin.

Recomendación:

- No exponer vistas BI directamente al cliente público.
- Consumir datos mediante APIs internas protegidas por sesión/rol.
- Reutilizar el modelo actual de permisos de InmoAdmin.
- Evaluar RLS de tablas fuente como tarea separada de seguridad.
- Evitar que el frontend reciba datos personales innecesarios para KPIs.

V0-06 no modifica permisos.

## 13. Orden recomendado de implementación

1. Crear APIs internas vacías/estructurales del Centro de Inteligencia.
2. Implementar una primera consulta segura para resumen mensual.
3. Implementar vistas o funciones por dominio, empezando por cierres y
   administración.
4. Agregar estados de confianza y trazabilidad.
5. Agregar drill-down paginado.
6. Medir rendimiento.
7. Proponer índices con evidencia real.
8. Crear snapshots solo para métricas que lo requieran.

## 14. Riesgos principales

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Mezclar caja con ingreso | Alto | Clasificación económica obligatoria. |
| Duplicar cobros por usar documento y caja | Alto | Precedencia V0-04. |
| Frontend consultando muchas tablas | Alto | APIs agregadas. |
| Recalcular históricos mutables | Medio/alto | Snapshots para pipeline, corte de caja y vencidos. |
| RLS/permisos inconsistentes | Alto | Endurecimiento separado antes de exponer más datos. |
| Falta de IDs de referencia | Medio | Marcar como requiere conciliación. |
| Consultas lentas por periodo amplio | Medio | Filtros obligatorios, vistas, índices futuros. |
| Definiciones cambiantes | Medio | Versionar definición de métricas. |

## 15. Conclusión

El Centro de Inteligencia debe construirse como una capa de lectura trazable y
agregada, no como un conjunto de consultas directas desde la UI.

La primera implementación técnica debe iniciar con APIs internas protegidas y
consultas pequeñas por periodo, usando las reglas de V0-03, V0-04 y V0-05.

La prioridad no es mostrar más gráficas; es producir cifras confiables,
explicables y auditables para Dirección.
