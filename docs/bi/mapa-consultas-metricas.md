# V0-06 · Mapa de consultas por métrica

Versión: 1.0  
Fecha: 26 de junio de 2026  
Alcance: diseño de lectura, sin SQL productivo

## 1. Propósito

Este documento traduce el diccionario de métricas V0-03 y las reglas de
deduplicación V0-04 a una estrategia concreta de consulta.

No contiene migraciones definitivas. Las consultas están descritas como
pseudoconsultas para guiar la implementación futura.

## 2. Criterio de lectura

Cada métrica debe definir:

- fuente primaria;
- fuente secundaria o evidencia;
- filtro temporal;
- nivel de agregación;
- necesidad de servidor, vista o snapshot;
- trazabilidad mínima.

## 3. Mapa ejecutivo

| Métrica | Fuente primaria | Vista/función futura | Cálculo recomendado | Snapshot |
|---|---|---|---|---:|
| Ingreso bruto generado | Fuentes de generación por unidad | `bi_eventos_base` + vistas por dominio | Servidor/API | No inicial |
| Cobrado | Pagos aplicados por fuente | `bi_eventos_base` | Servidor/API | No inicial |
| Pendiente por cobrar | Generado menos cobrado por documento | Función por corte | Servidor/API | Sí al cierre |
| Vencido | Pendiente con fecha límite vencida | Función por corte | Servidor/API | Sí al cierre |
| Caja | `cash_movements` + cajas específicas | Vista de caja clasificada | Servidor/API | Sí |
| Neto para Emporio | Ingreso propio cobrado menos costos/salidas propias | Función agregada | Servidor/API | Recomendado |
| Fondos de terceros | Rentas/cuotas/depósitos administrados | Vista de fondos terceros | Servidor/API | Sí |
| Comisión vendedor | `cierres`, políticas de comisión | Función futura | Servidor/API | Recomendado |
| Comisión gerente | `cierres`, políticas de comisión | Función futura | Servidor/API | Recomendado |
| Administración | `comisiones_admin` | `bi_admin_eventos` | Vista + API | Recomendado |
| Póliza | `poliza_caja`, `poliza_expedientes` | `bi_poliza_eventos` | Vista + API | Recomendado |
| Mantenimiento | `maintenance_quotes`, `maintenance_tickets`, caja | `bi_mantenimiento_eventos` | Vista + API | Recomendado |
| Margen | Ingreso propio menos costo directo | Función por unidad | Servidor/API | Recomendado |
| Flujo | Entradas menos salidas por caja | Vista de caja clasificada | Servidor/API | Sí |
| Pipeline | Leads/citas/proyectos/cierres probables | `bi_comercial_eventos` | Servidor/API | Sí |

## 4. Consultas por métrica

### 4.1 Ingreso bruto generado

Pregunta:

> ¿Cuánto produjo Emporio en el periodo?

Fuentes por unidad:

| Unidad | Fuente primaria | Fecha |
|---|---|---|
| Cierres | `cierres.comision` | `fecha_cierre` |
| Administración | `comisiones_admin.monto` | `periodo` |
| Póliza | `poliza_expedientes.monto_poliza` o criterio definido | `fecha_inicio` / evento confirmado |
| Mantenimiento | cotización aprobada o ticket cerrado | fecha de aprobación/cierre |
| Condominios | `condominios.honorarios_emporio` o registro de honorario | periodo |

Pseudoconsulta:

```text
leer eventos con:
  economic_classification = ingreso_propio
  event_type = ingreso_generado
  event_date entre periodo
agrupar por business_unit
sumar amount
conservar source_table/source_id
```

Recomendación:

- No consultar cada tabla desde frontend.
- Implementar por vistas de dominio y agregar en servidor.
- Si una unidad no tiene criterio firme, mostrar estado `parcial`.

### 4.2 Cobrado

Pregunta:

> ¿Cuánto ingreso propio se convirtió en cobro?

Fuentes:

| Unidad | Fuente primaria | No sumar |
|---|---|---|
| Cierres | `cierre_pagos.monto` | `cierres.cobrado` |
| Administración | `comisiones_admin` con `status = cobrada` y `fecha_cobro` | `cash_movements.comision_cobrada` |
| Póliza | `poliza_caja` con `tipo = ingreso` | resumen del expediente |
| Mantenimiento | movimiento vinculado o cobro aprobado | ticket + caja si duplican |
| Condominios | honorario propio cobrado | cuota total |

Pseudoconsulta:

```text
leer eventos con:
  economic_classification = ingreso_propio
  event_type in (cobro_recibido, cuenta_por_cobrar_liquidada)
  cash_date/event_date entre periodo
deduplicar por source_key
sumar amount
```

Riesgo:

- En administración, una comisión retenida de una renta ya cobrada puede ser
  reclasificación, no nueva entrada física.

### 4.3 Pendiente por cobrar

Pregunta:

> ¿Qué ingreso ya ganó Emporio pero todavía no ha cobrado?

Cálculo:

```text
pendiente por documento =
  ingreso generado del documento
- cobros aplicados al mismo documento
- cancelaciones/ajustes válidos
```

Recomendación:

- Calcular por servidor o función SQL.
- No calcular como total generado menos total cobrado global si no comparten
  documento.
- Guardar snapshot mensual cuando se cierre periodo.

Trazabilidad:

- Debe listar documentos con saldo y su fuente:
  `cierres.id`, `comisiones_admin.id`, expediente, ticket u honorario.

### 4.4 Vencido

Pregunta:

> ¿Qué dinero pendiente ya debió haberse cobrado o pagado?

Fuentes posibles:

| Dominio | Campo candidato |
|---|---|
| Administración/rentas | `payments.due_date`, `payment_date`, `status` |
| Cierres | fecha esperada aún por definir |
| Póliza | saldo y fechas de expediente |
| Condominios | `cuotas_condominio.fecha_vencimiento` |
| CxP | fechas de pago/liquidación |

Recomendación:

- Requiere fecha de vencimiento confiable por dominio.
- Si no existe fecha, no inventarla: marcar como `no disponible` o
  `parcial`.
- Snapshot recomendado al cierre de mes.

### 4.5 Caja

Pregunta:

> ¿Qué dinero entró y salió físicamente?

Fuentes:

- `cash_movements`
- `poliza_caja`
- movimientos de mantenimiento y liquidaciones según vínculos

Regla:

Caja no equivale automáticamente a ingreso propio.

Pseudoconsulta:

```text
leer movimientos monetarios entre fechas
clasificar:
  ingreso_propio
  fondos_terceros
  costo
  cuenta_por_pagar
  reclasificacion
agrupar entradas/salidas
```

Recomendación:

- Crear vista futura de caja clasificada.
- Separar caja propia estimada y fondos de terceros.
- Snapshot diario o mensual cuando se formalice conciliación.

### 4.6 Neto para Emporio

Pregunta:

> ¿Cuánto dinero realmente pertenece a Emporio?

Cálculo conceptual:

```text
neto para Emporio =
  ingreso propio cobrado
- costos directos pagados
- comisiones internas pagadas
- egresos propios
```

Excluye:

- fondos de terceros;
- rentas completas;
- cuotas de condominio;
- depósitos que deban devolverse.

Recomendación:

- No implementar como primera métrica si aún no están clasificadas todas las
  salidas.
- Mostrar con estado `parcial` hasta tener reglas de comisiones internas y
  costos.

### 4.7 Fondos de terceros

Pregunta:

> ¿Cuánto dinero bajo control de Emporio no pertenece a Emporio?

Fuentes:

| Dominio | Fuente |
|---|---|
| Administración | rentas recibidas y liquidaciones |
| Condominios | cuotas cobradas menos gastos/pagos |
| Depósitos/garantías | registros actuales o futuros |
| Propietarios | `owner_payments` y recibos |

Recomendación:

- Requiere snapshot de posición por fecha.
- No mezclar con ingreso.
- Prioridad alta para Dirección por riesgo financiero.

### 4.8 Comisión vendedor y gerente

Pregunta:

> ¿Qué obligaciones internas genera la actividad comercial?

Fuentes actuales:

- `cierres`
- usuario/asesor/vendedor
- reglas de comisión internas, si existen en código o políticas externas

Riesgo:

- Si la política de comisión no está estructurada, no debe calcularse con
  supuestos ocultos.

Recomendación:

- Diseñar regla en servidor.
- Marcar como `no disponible` o `parcial` hasta tener fuente clara de
  porcentajes, excepciones y pagos realizados.

### 4.9 Administración

Pregunta:

> ¿Qué tan sano es el ingreso recurrente de administración?

Fuentes:

- `comisiones_admin`
- `contracts`
- `payments`
- `cash_movements`

Pseudoconsultas:

```text
ingreso recurrente = sum(comisiones_admin.monto por periodo)
cobrado = sum(comisiones_admin.monto where status cobrada)
pendiente = monto - cobrado por comisión
renta administrada = sum(payments.amount clasificada como fondos_terceros)
```

Recomendación:

- Vista `bi_admin_eventos`.
- Conciliación separada con `cash_movements`.

### 4.10 Póliza jurídica

Pregunta:

> ¿Qué produce, cobra y arriesga el módulo jurídico?

Fuentes:

- `poliza_expedientes`
- `poliza_caja`
- solicitudes/inquilino como contexto operativo y riesgo

Recomendación:

- `poliza_caja` manda para cobros.
- Expediente manda para contexto, estado, monto esperado y riesgo.
- No sumar anticipo/saldo/monto como cobros adicionales.

### 4.11 Mantenimiento

Pregunta:

> ¿Mantenimiento genera utilidad o solo carga operativa?

Fuentes:

- `maintenance_quotes`
- `maintenance_tickets`
- caja vinculada

Pseudocálculo:

```text
ingreso generado = monto_final aprobado o charged_amount confirmado
costo = costo_proveedor o provider_cost confirmado
margen = ingreso generado - costo
```

Recomendación:

- No usar quote y ticket como ingresos separados.
- Marcar como requiere conciliación cuando no se pueda saber si el ticket ya
  generó caja.

### 4.12 Margen

Pregunta:

> ¿Qué queda después del costo directo?

Cálculo:

```text
margen =
  ingreso propio generado o cobrado
- costo directo asociado
```

Regla:

- Calcular por unidad y por documento antes de sumar.
- No restar fondos de terceros como si fueran costo.

### 4.13 Flujo

Pregunta:

> ¿Cómo se mueve realmente el dinero?

Cálculo:

```text
flujo neto =
  entradas de caja
- salidas de caja
```

Debe separarse por:

- ingreso propio;
- fondos de terceros;
- costos;
- cuentas por pagar;
- reclasificaciones.

Recomendación:

- Vista de caja clasificada.
- Snapshot de corte.

### 4.14 Pipeline

Pregunta:

> ¿Qué probablemente pasará?

Fuentes actuales y futuras:

- leads;
- citas;
- propiedades;
- cierres probables;
- proyectos publicados;
- contactos digitales;
- renovaciones.

Recomendación:

- No mezclar pipeline con ingreso generado.
- Requiere snapshots históricos para aprender tendencias.
- El forecast debe conservar supuestos.

## 5. Diseño de funciones SQL futuras

No crear en V0-06. Propuestas:

| Función | Entrada | Salida |
|---|---|---|
| `bi_resumen_periodo(period_start, period_end)` | Fechas | KPIs principales por unidad. |
| `bi_cobranza_corte(cutoff_date)` | Fecha de corte | Pendiente, vencido y detalle. |
| `bi_flujo_periodo(period_start, period_end)` | Fechas | Entradas, salidas, caja propia/fondos tercero. |
| `bi_ranking_mensual(year, month, dimension)` | Año, mes, dimensión | Ranking por unidad, asesor o canal. |
| `bi_trazabilidad(metric_key, period_start, period_end)` | Métrica y periodo | Filas origen paginables. |

## 6. Diseño de vistas SQL futuras

No crear en V0-06. Propuestas:

| Vista | Prioridad | Motivo |
|---|---:|---|
| `bi_cierres_eventos` | Alta | Fuente más clara para ingreso y cobro. |
| `bi_admin_eventos` | Alta | Recurrente y financieramente relevante. |
| `bi_cierres_conciliacion` | Alta | Detecta diferencias de cobrado/pendiente. |
| `bi_admin_conciliacion` | Alta | Evita duplicar comisión y caja. |
| `bi_poliza_eventos` | Media | Importante, pero requiere criterio de devengado. |
| `bi_mantenimiento_eventos` | Media | Alta utilidad potencial, mayor ambigüedad. |
| `bi_condominios_eventos` | Media | Importante para fondos de terceros. |
| `bi_liquidaciones_eventos` | Media | Necesario para riesgo financiero. |
| `bi_comercial_eventos` | Media/alta | Fundamental para forecast, requiere snapshots. |
| `bi_eventos_base` | Después de vistas dominio | No conviene empezar con una vista global monolítica. |

## 7. Recomendaciones para la primera implementación técnica

La primera implementación debería ser deliberadamente pequeña:

1. Crear endpoint interno de resumen mensual protegido.
2. Iniciar con `cierres` y `comisiones_admin`, porque tienen fuentes más
   claras.
3. Devolver:
   - ingreso generado;
   - cobrado;
   - pendiente reconstruido;
   - estado de confianza;
   - conteo de registros origen.
4. No incluir todavía forecast, IA, snapshots ni fondos de terceros complejos.
5. Agregar drill-down paginado solo después de validar totales.

## 8. Criterio de aceptación de V0-06

V0-06 queda completo si:

- Existe arquitectura de lectura documentada.
- Están definidas las vistas y funciones SQL futuras.
- Existe mapa de consultas por métrica.
- Se identifican consultas costosas.
- Se proponen índices futuros sin crearlos.
- Se define qué requiere snapshot.
- Se explica cómo evitar N+1 queries.
- Se conserva trazabilidad al registro origen.
- No se modifican tablas, permisos, pantallas ni módulos operativos.
