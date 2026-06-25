# Matriz de fuentes y precedencia

Tarea: V0-04
Versión: 1.0
Fecha: 25 de junio de 2026

## Propósito

Esta matriz define qué tabla manda para cada hecho empresarial y qué tablas
solo sirven como comprobación, detalle o consecuencia operativa.

La misma operación puede aparecer en varios módulos porque InmoAdmin registra:

- el documento que origina el derecho;
- el pago;
- el resumen actualizado;
- el movimiento de caja;
- el comprobante;
- el efecto sobre otra cuenta.

Que existan varios registros no significa que existan varios ingresos.

## Jerarquía general

Para cada concepto se distinguen cinco funciones:

| Función | Qué representa |
|---|---|
| Fuente de generación | Documento que origina el ingreso o costo |
| Fuente de cobro/pago | Aplicación monetaria contra ese documento |
| Fuente de caja | Entrada o salida física de dinero |
| Fuente de saldo | Resultado pendiente a una fecha de corte |
| Fuente de comprobación | Evidencia, resumen o reflejo redundante |

Una tabla puede cumplir funciones diferentes según la métrica. Por ejemplo,
`comisiones_admin` es fuente de generación y estado de cobro, mientras
`cash_movements` comprueba el movimiento monetario.

## Reglas globales de precedencia

1. Para **devengado**, manda el documento que origina el ingreso.
2. Para **cobrado**, manda el pago aplicado al documento.
3. Para **caja**, manda el movimiento monetario conciliado.
4. Para **saldo**, se reconstruye generación menos aplicaciones.
5. Los campos resumen se usan para comparar, no para volver a sumar.
6. Una copia creada para sincronizar módulos hereda el mismo hecho económico.
7. Un comprobante nunca crea por sí mismo ingreso, costo o caja.
8. Una salida a un tercero no es costo propio si solo entrega fondos bajo
   custodia.
9. Una retención de comisión puede reclasificar dinero de terceros como dinero
   propio, pero no necesariamente crea una nueva entrada de caja.
10. Cuando no exista vínculo confiable, la cifra se clasifica como “no
    conciliada”; no se deduplica por coincidencia aproximada sin mostrarlo.

---

# Matriz ejecutiva

| Dominio | Hecho | Fuente primaria | Fuente secundaria | No sumar adicionalmente |
|---|---|---|---|---|
| Cierres | Comisión generada | `cierres.comision` | recibo/firma relacionados | precio, apartados, abonos |
| Cierres | Cobro aplicado | `cierre_pagos` | `cierres.cobrado` | recibos copiados a pagos |
| Cierres | Saldo | comisión menos `cierre_pagos` | `cierres.pendiente` | saldo almacenado como otro importe |
| Apartados | Anticipo recibido antes del cierre | `recibos_apartado` + `recibos_abonos` | PDFs/comprobantes | comisión final |
| Administración | Comisión generada | `comisiones_admin` | cálculo de `contracts` | `cash_movements.comision_cobrada` |
| Administración | Comisión cobrada | estado/fecha en `comisiones_admin` | `cash_movements` | renta completa |
| Rentas | Dinero recibido para propietario | `payments` + receptor | `cash_movements.renta_cobrada` | ingreso de Emporio |
| Póliza | Cobro | `poliza_caja` | banderas del expediente | anticipo/saldo almacenados como otro cobro |
| Mantenimiento | Importe generado | cotización aprobada | ticket | ambos importes |
| Mantenimiento | Costo generado | cotización aprobada | ticket | pago a proveedor |
| Mantenimiento | Cobro/pago de caja | movimiento vinculado | estados del ticket | cierre del ticket como cobro adicional |
| Liquidaciones | Obligación/pago al propietario | `owner_payments` | recibo y movimiento de caja | renta o comisión como otro ingreso |
| Condominios | Cuota del condómino | `cuotas_condominio` | recibo | ingreso de Emporio |
| Condominios | Honorario propio | registro de honorario | `cash_movements` | cuota total o fondo |

---

# Cierres, apartados y abonos

## Comisión generada

### Fuente primaria

`cierres`, una fila por operación confirmada.

```text
clave lógica: cierre:{cierres.id}
importe: cierres.comision
fecha: cierres.fecha_cierre
```

### Fuentes de contexto

- `recibos_apartado`, mediante `cierres.recibo_id`;
- `firmas`, mediante `cierres.firma_id`;
- `propiedades`, mediante `cierres.propiedad_id`.

### Exclusiones

- `cierres.precio` es volumen comercializado.
- `recibos_apartado.monto` no genera una segunda comisión.
- `recibos_abonos.monto` no genera ingreso adicional.
- `firmas.monto_cierre` no se suma como comisión.

## Cobros de cierres

### Fuente primaria

`cierre_pagos`.

```text
clave lógica: cierre_pago:{cierre_pagos.id}
documento: cierre:{cierre_id}
importe: monto
fecha: fecha
```

### Fuente de comprobación

- `cierres.cobrado`
- `cierres.cobrado_bool`
- `cierres.pendiente`

Estos campos resumen deben coincidir con los pagos, pero no se suman.

## Conversión de apartado a pago

Al crear un cierre desde un recibo, el sistema copia:

- `recibos_apartado.monto` a `cierre_pagos`;
- cada `recibos_abonos.monto` a `cierre_pagos`.

Los marcadores actuales son:

```text
recibo_inicial:{recibo_id}
recibo_abono:{abono_id}
```

### Regla

Antes de existir el cierre:

- apartado y abonos representan anticipos recibidos;
- no representan comisión generada;
- pueden formar parte de caja o fondos con tratamiento pendiente.

Después de existir el cierre:

- `cierre_pagos` será la fuente del cobro aplicado;
- los recibos originales conservan trazabilidad;
- no se sumarán recibos y pagos de cierre en el mismo total.

### Claves de linaje

```text
apartado:{recibos_apartado.id}
abono:{recibos_abonos.id}
```

Cuando se copie a `cierre_pagos`, la clave de origen deberá permanecer
asociada al pago. Actualmente está dentro de `notas`, por lo que la
deduplicación es posible, pero frágil.

### Riesgo semántico

Debe confirmarse si el apartado recibido representa:

- pago de comisión a Emporio;
- anticipo del precio de la operación;
- fondo transitorio destinado a otra parte.

La copia técnica a `cierre_pagos` no resuelve por sí sola esa clasificación
contable.

---

# Administración, cobranza y caja

## Comisión generada

### Fuente primaria

`comisiones_admin`.

```text
clave natural: contract_id + periodo
importe: monto
fecha empresarial: periodo
```

Existe una restricción única para `contract_id, periodo`, lo que hace a esta
tabla la mejor fuente del devengado.

### Fuente secundaria

`contracts` permite calcular la comisión esperada usando:

- `monthly_rent`;
- `commission_type`;
- `commission_value`;
- `rent_receiver`.

Ese cálculo sirve para validar o generar el registro mensual; no se suma a
`comisiones_admin`.

## Comisión cobrada

### Fuente primaria

`comisiones_admin` donde:

```text
status = 'cobrada'
fecha = fecha_cobro
```

### Fuente de comprobación

`cash_movements` con:

```text
type = 'entrada'
category = 'comision_cobrada'
```

### Regla

La comisión se cuenta una vez como ingreso generado y una vez como cobro en
sus respectivas perspectivas. El movimiento de caja no crea un segundo
ingreso.

## Renta recibida

### Fuente operativa

`payments` identifica:

- contrato;
- importe;
- periodo;
- estado;
- receptor.

### Fuente de caja

`cash_movements.category = 'renta_cobrada'` cuando Emporio recibió el dinero.

### Clasificación

La renta completa es:

- entrada de caja;
- fondo de terceros;
- base para liquidación.

No es ingreso bruto de Emporio. Únicamente la comisión administrativa es
ingreso propio.

## Retención de comisión al liquidar

El flujo actual registra:

1. entrada por la renta completa;
2. salida por la liquidación al propietario;
3. otra entrada por `comision_cobrada`.

### Riesgo

Cuando la comisión ya estaba incluida dentro de la renta recibida, el tercer
movimiento es una reclasificación económica, no una nueva entrada física. Si
se suman las tres filas literalmente, la caja queda inflada.

### Regla BI

- Para ingreso cobrado: usar `comisiones_admin`.
- Para entrada física: usar la renta recibida.
- Para fondos de terceros: renta recibida menos comisión y deducciones.
- Para salida física: liquidación al propietario.
- El movimiento `comision_cobrada` retenido se marcará como evidencia de
  reclasificación, no como entrada adicional, hasta que exista contabilidad de
  cuentas separadas.

## Reversión de comisión

Actualmente una comisión puede volver a `pendiente` sin eliminar o revertir
su movimiento de caja. Por tanto:

- el estado operativo puede diferir de caja;
- no se borrará ninguna fila automáticamente;
- se generará brecha de conciliación.

---

# Póliza jurídica

## Cobros

### Fuente primaria

`poliza_caja`.

```text
clave lógica: poliza_caja:{id}
documento: expediente_id o solicitud_id
importe: monto
fecha: fecha
```

Conceptos principales:

- `investigacion`;
- `anticipo_poliza`;
- `saldo_poliza`;
- `pago_poliza`.

## Fuentes de comprobación

En `poliza_expedientes`:

- `monto_poliza`;
- `anticipo_poliza`;
- `anticipo_pagado`;
- `saldo_poliza`;
- `saldo_pagado`;
- fechas y métodos de pago.

En `solicitudes_inquilino`:

- `cobro_investigacion`;
- `fecha_cobro_investigacion`;
- `monto_investigacion`.

### Regla

Las banderas y montos del expediente no se vuelven a sumar cuando existe
`poliza_caja`. Sirven para:

- calcular el saldo esperado;
- detectar cobros faltantes;
- comprobar consistencia.

## Prevención lógica de duplicados

Para movimientos automáticos:

```text
investigación: solicitud_id + concepto
anticipo: expediente_id + concepto anticipo_poliza
saldo: expediente_id + concepto saldo_poliza
pago total: expediente_id + concepto pago_poliza
```

Actualmente no existen restricciones únicas para estas combinaciones y Caja
Póliza permite captura manual. Por ello:

- no se eliminarán coincidencias automáticamente;
- movimientos repetidos exactos se marcarán como duplicados probables;
- pagos divididos legítimos deberán conservarse si existe evidencia.

## Generado

`poliza_expedientes.monto_poliza` será fuente del importe contractual, pero no
se reconocerá como generado hasta aprobar el evento empresarial
correspondiente. Nunca se sumará `monto_poliza` y `poliza_caja` dentro del
mismo concepto.

---

# Mantenimiento

## Cotización

### Fuente primaria del presupuesto

`maintenance_quotes`.

```text
clave lógica: quote:{id}
ticket: ticket_id
importe al cliente: monto_final
costo: costo_proveedor
```

Una cotización pendiente no es ingreso generado.

## Importe y costo generados

### Precedencia

1. Cotización aprobada asociada al ticket.
2. Si no existe cotización aprobada, valores confirmados del ticket.
3. Si ambas fuentes difieren, registrar brecha.

### Regla

`maintenance_quotes` y `maintenance_tickets` describen el mismo servicio. No
se suman:

```text
importe generado = una sola fuente por ticket
costo directo = una sola fuente por ticket
```

## Cobro y pago

### Fuentes de caja

- entrada: `cash_movements.category = 'mantenimiento_cobrado'`;
- anticipo: `cash_movements.category = 'anticipo_mantenimiento'`;
- salida: `cash_movements.category = 'pago_proveedor'`.

### Fuentes de comprobación

- `advance_amount`, `advance_paid`;
- `status_pago`;
- `fecha_cobro_propietario`;
- `recibo_cobro_id`;
- `descontado_de_liquidacion`.

### Riesgo actual

Al cambiar un ticket a `cerrado`, el sistema crea automáticamente:

- una salida por el costo de proveedor;
- una entrada por el total cobrado.

Cambiar nuevamente el estado y volver a cerrarlo puede crear movimientos
repetidos. Además, `cerrado` no demuestra que el dinero haya sido recibido o
pagado.

### Claves lógicas

```text
mtto_generado:{ticket_id}
mtto_cobro:{ticket_id}:{tipo_de_pago}:{secuencia}
mtto_costo:{ticket_id}:{proveedor_o_secuencia}
```

Mientras no exista referencia estructurada:

- coincidencias por ticket, categoría, monto y fecha serán duplicados
  probables;
- no se sumará automáticamente el total del ticket y el movimiento de caja;
- anticipos se aplicarán antes de calcular el saldo.

## Mantenimiento descontado de liquidación

Cuando el propietario paga mediante descuento:

- el ticket representa el cargo generado;
- el descuento reduce fondos por entregar al propietario;
- no necesariamente existe una entrada física adicional;
- `owner_payment_receipts` aporta evidencia;
- `descontado_de_liquidacion` evita aplicar nuevamente el mismo cargo.

Ese descuento es compensación de cuentas, no un cobro adicional en caja.

---

# Liquidaciones y pagos a propietarios

## Renta recibida

Fuente primaria operativa: `payments`.

Fuente de caja cuando recibe Emporio:
`cash_movements.category = 'renta_cobrada'`.

La renta es fondo de terceros, no ingreso propio.

## Obligación con el propietario

### Fuente primaria

Se reconstruye desde:

```text
rentas recibidas por Emporio
- comisiones de administración
- gastos autorizados
- mantenimiento a cargo del propietario
- anticipos o liquidaciones previas
```

`owner_payments.total_liquid` es un resumen operativo de esa obligación.

## Pago al propietario

### Fuente primaria operativa

`owner_payments.amount_paid`.

### Evidencia

`owner_payment_receipts`.

### Fuente de caja

`cash_movements.category = 'liquidacion_propietario'`.

### Regla

Las tres fuentes representan el mismo pago desde ángulos diferentes:

- obligación/pago registrado;
- comprobante;
- salida monetaria.

No se suman entre sí.

### Clave lógica provisional

```text
propietario_normalizado + periodo + secuencia_de_pago
```

No es suficientemente robusta porque:

- `period_description` es texto;
- se usa correo como identidad;
- no existe relación entre `owner_payments`, recibo y caja.

Hasta mejorar el esquema, la coincidencia deberá mostrar nivel de confianza.

## Liquidaciones parciales y totales

Un periodo puede tener:

- varios `pagado_parcial`;
- un `pagado` final.

El pago total final puede representar únicamente el remanente o una cifra
completa según el flujo utilizado. Para evitar duplicados:

- el efectivo pagado se obtiene de `amount_paid` por cada desembolso real;
- `total_liquid` no se suma como otro pago;
- la obligación del periodo se calcula independientemente;
- no se ignoran pagos parciales solo porque exista un registro final.

## Comisión retenida

`owner_payments.total_commission` y `comisiones_admin.monto` pueden describir
la misma comisión. La fuente primaria del ingreso es `comisiones_admin`; el
campo de liquidación sirve para comprobar que fue retenida.

---

# Condominios

## Cuotas

### Fuente primaria

`cuotas_condominio`.

### Clasificación

- cuota pagada: entrada o fondo del condominio;
- cuota pendiente: cuenta por cobrar del condominio;
- gasto: aplicación de fondos del condominio.

### Regla

Las cuotas no son ingreso de Emporio y no se incluyen en ingreso bruto,
cobrado propio, margen ni neto para Emporio.

## Gastos

`gastos_condominio` contiene:

- gastos reales del condominio;
- registros categorizados como `honorarios_emporio`.

Solo la categoría de honorarios puede representar ingreso propio.

## Honorarios Emporio

Al registrar `gastos_condominio.categoria = 'honorarios_emporio'`, el sistema
también crea `cash_movements.category = 'honorarios_condominio'`.

### Regla

- `gastos_condominio` identifica el concepto y el condominio.
- `cash_movements` comprueba la entrada.
- se cuenta un solo honorario cobrado.
- `condominios.honorarios_emporio` es configuración mensual, no cobro.
- `cuotas_condominio` no se suma.

### Clave lógica provisional

```text
condominio_id + periodo + honorarios_emporio
```

El sistema actual no registra periodo estructurado ni relación con caja. La
coincidencia por concepto y fecha será provisional.

---

# Caja consolidada

## Fuentes actuales

La pantalla Caja combina:

- `cash_movements`;
- `poliza_caja`.

La combinación visual no implica duplicación siempre que Póliza no replique
sus cobros en `cash_movements`.

## Regla

Para el total físico de entradas y salidas:

1. incluir movimientos únicos de `cash_movements`;
2. incluir movimientos únicos de `poliza_caja`;
3. excluir reclasificaciones que no impliquen movimiento físico;
4. no añadir pagos operativos que ya estén representados en caja;
5. mostrar por separado movimientos no conciliados.

## Casos que no deben sumarse

```text
comisiones_admin cobrada + cash_movements.comision_cobrada
owner_payments + owner_payment_receipts + liquidacion_propietario
ticket cerrado + mantenimiento_cobrado
poliza_expedientes anticipo_pagado + poliza_caja anticipo
gastos_condominio honorario + cash_movements honorario
recibo/abono convertido + cierre_pagos copiado
payments pagado + cash_movements renta_cobrada
```

---

# Fuentes primarias por métrica

| Métrica | Fuente primaria actual | Condición |
|---|---|---|
| Comisión de cierre generada | `cierres` | operación confirmada |
| Cobro de cierre | `cierre_pagos` | pago válido |
| Saldo de cierre | cálculo desde pagos | comparar con `cierres.pendiente` |
| Comisión administrativa generada | `comisiones_admin` | fila por contrato-periodo |
| Comisión administrativa cobrada | `comisiones_admin` | `status = cobrada` |
| Renta bajo custodia | `payments` | recibida por Emporio |
| Caja de renta | `cash_movements` | `renta_cobrada` |
| Cobro de póliza | `poliza_caja` | `tipo = ingreso` |
| Generado de mantenimiento | cotización aprobada | una por ticket |
| Costo de mantenimiento | cotización aprobada | una por ticket |
| Caja de mantenimiento | `cash_movements` | movimiento vinculado |
| Pago a propietario | `owner_payments.amount_paid` | desembolso real |
| Caja de liquidación | `cash_movements` | `liquidacion_propietario` |
| Cuota de condominio | `cuotas_condominio` | nunca ingreso propio |
| Honorario de condominio | registro de honorario | no cuota total |

## Fuentes que nunca deben actuar como atajo

- `Math.max` entre varias fuentes.
- `updated_at` como fecha de cobro.
- texto de descripción como única relación definitiva.
- estado `cerrado` como prueba universal de pago.
- `status = pagado` sin identificar quién recibió.
- suma de tablas de documento y caja en una misma perspectiva.
