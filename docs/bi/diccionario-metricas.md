# Diccionario empresarial de métricas

Tarea: V0-03
Versión: 1.0
Fecha: 25 de junio de 2026
Moneda inicial: MXN
Zona horaria operativa: `America/Mexico_City`

## Propósito

Este documento establece qué significa cada cifra del Centro de Inteligencia
Empresarial. Su objetivo es que Dirección, Administración y Desarrollo hablen
el mismo idioma.

Una métrica no podrá cambiar de significado para adaptarse a los datos
disponibles. Si la información requerida no existe o no es confiable, el
sistema deberá mostrarla como parcial o no disponible; nunca sustituirla
silenciosamente por otro concepto.

## Principios

1. **Generado no significa cobrado.**
2. **Cobrado no significa caja disponible.**
3. **Caja recibida no siempre pertenece a Emporio.**
4. **Ingreso no significa utilidad.**
5. **Margen no significa utilidad neta empresarial.**
6. **Pendiente no significa vencido.**
7. **Un dato faltante no equivale a cero.**
8. Cada importe deberá conservar unidad de negocio, fecha, fuente e ID de
   origen.
9. Las cifras históricas deberán utilizar la definición vigente en el periodo
   o señalar que fueron recalculadas.
10. Los montos se presentarán positivos; su naturaleza será determinada por el
    tipo de evento, no por el signo.

## Perspectivas financieras

### Devengado

Muestra el valor económico que Emporio ganó o generó por haber prestado un
servicio o concretado una operación, aunque todavía no se haya cobrado.

Responde:

> ¿Cuánto produjo la empresa durante el periodo?

### Caja

Muestra entradas y salidas de dinero según la fecha en que ocurrieron.

Responde:

> ¿Cuánto dinero entró, salió y permanece bajo control de la empresa?

Las perspectivas no deben sumarse entre sí. Un cobro puede corresponder a un
ingreso generado en un periodo anterior.

## Estado de disponibilidad

Cada métrica incluye uno de estos estados:

| Estado | Significado |
|---|---|
| Calculable | Existen fuentes suficientes para calcularla con trazabilidad |
| Parcial | Puede calcularse para algunas unidades o registros |
| Requiere conciliación | Existen fuentes, pero pueden estar duplicadas o desactualizadas |
| No disponible | Falta información indispensable |

---

# Métricas corporativas

## 1. Ingreso bruto generado

### Qué significa para Dirección

Valor de los servicios que Emporio ganó durante el periodo, antes de descontar
comisiones del equipo y costos directos.

No incluye el precio de venta de una propiedad, la renta completa recibida
para un propietario ni cuotas que pertenezcan a un condominio.

### Fórmula empresarial

```text
Ingreso bruto generado =
  comisiones inmobiliarias generadas
+ comisiones de administración generadas
+ ingresos de póliza generados
+ cargos de mantenimiento generados
+ honorarios de condominio generados
+ otros ingresos propios generados
```

### Fecha aplicable

Fecha en que se cumple el criterio de reconocimiento de cada unidad de
negocio, no la fecha de cobro.

### Incluye

- Comisión total pactada de cierres confirmados.
- Comisión mensual de administración.
- Precio propio de pólizas y servicios jurídicos.
- Importe facturable de mantenimiento.
- Honorarios propios de administración de condominios.

### Excluye

- Precio total de compraventas.
- Renta completa recaudada para propietarios.
- Depósitos en garantía.
- Cuotas y fondos de condominios.
- Anticipos todavía no reconocidos como ingreso.
- IVA u otros impuestos trasladados, cuando se registren separadamente.
- Gastos personales.

### Fuentes actuales

- `cierres.comision`
- `comisiones_admin.monto`
- `poliza_expedientes.monto_poliza`
- `maintenance_tickets.charged_amount`
- `maintenance_quotes.monto_final`
- `condominios.honorarios_emporio`
- `gastos_condominio`

### Disponibilidad

**Parcial.** Cierres y administración tienen una base de reconocimiento
identificable. Póliza, mantenimiento y condominios requieren fijar el evento
exacto que convierte una cotización o importe esperado en ingreso generado.

### Riesgo de interpretación

El módulo actual mezcla cierres cobrados, caja de pólizas y margen de
mantenimiento en un solo total. Ese resultado no representa ingreso generado.

---

## 2. Cobrado

### Qué significa para Dirección

Importe efectivamente recibido durante el periodo que liquida total o
parcialmente un ingreso propio de Emporio.

Responde:

> ¿Cuánto de lo que hemos generado ya se convirtió en cobro?

### Fórmula

```text
Cobrado =
  pagos de cierres recibidos
+ comisiones de administración cobradas
+ cobros de póliza
+ cobros de mantenimiento
+ honorarios de condominio cobrados
+ otros ingresos propios cobrados
```

### Fecha aplicable

Fecha real del pago.

### Incluye

- Pagos parciales.
- Anticipos, únicamente cuando estén clasificados como cobro de un ingreso
  reconocido o se muestren por separado como anticipo.

### Excluye

- Rentas completas recibidas para entregar a propietarios.
- Depósitos y garantías.
- Fondos de condominio.
- Movimientos internos entre cuentas.
- Promesas de pago.

### Fuentes actuales

- `cierre_pagos.monto`, por `fecha`
- `comisiones_admin`, con `status = 'cobrada'` y `fecha_cobro`
- `poliza_caja`, con `tipo = 'ingreso'`
- `cash_movements`, según categoría y referencia
- movimientos derivados de mantenimiento y condominios

### Regla contra duplicados

Un mismo cobro se contará una sola vez. Si una comisión aparece tanto en
`comisiones_admin` como en `cash_movements`, el ledger de comisión define el
concepto y el movimiento de caja comprueba la entrada; no se suman ambos.

### Disponibilidad

**Requiere conciliación.** Existen fuentes suficientes, pero faltan referencias
obligatorias entre algunos movimientos y sus documentos origen.

---

## 3. Pendiente por cobrar

### Qué significa para Dirección

Ingreso ya generado que todavía no ha sido cobrado.

### Fórmula

```text
Pendiente por cobrar =
  ingreso generado acumulado
- cobros aplicados a ese ingreso
- notas de crédito, cancelaciones o ajustes válidos
```

El cálculo deberá hacerse por documento u operación antes de sumarse.

### Fecha aplicable

Saldo vigente a una fecha de corte.

### Incluye

- Saldos parciales.
- Comisiones generadas no cobradas.
- Servicios terminados o reconocidos pendientes de pago.

### Excluye

- Pipeline no concretado.
- Cotizaciones no aprobadas.
- Cobros futuros de servicios aún no prestados.
- Fondos que corresponden a terceros.

### Fuentes actuales

- `cierres.comision` menos `cierre_pagos`
- `comisiones_admin` con estado pendiente
- saldos de póliza
- saldos de mantenimiento

### Regla de calidad

Los saldos almacenados, como `cierres.pendiente`, se compararán contra el
saldo reconstruido desde movimientos. Una discrepancia será un incidente de
calidad, no un ajuste automático.

### Disponibilidad

**Parcial y requiere conciliación.**

---

## 4. Vencido

### Qué significa para Dirección

Parte del pendiente por cobrar cuya fecha límite ya pasó.

### Fórmula

```text
Vencido =
  suma de saldos pendientes
  donde fecha de vencimiento < fecha de corte
```

### Diferencia frente a pendiente

Todo vencido está pendiente, pero no todo pendiente está vencido.

### Segmentación recomendada

- 1–30 días.
- 31–60 días.
- 61–90 días.
- Más de 90 días.

### Fuentes actuales

- `payments.due_date` para cobranza de rentas.
- Fechas de vigencia o pago de algunos módulos.

### Disponibilidad

**Parcial.** No existe fecha de vencimiento para la mayoría de cierres,
comisiones administrativas, pólizas y mantenimientos. Hasta registrar esa
fecha, esos saldos se mostrarán como “pendientes sin vencimiento definido”, no
como cartera corriente.

---

## 5. Entradas de caja

### Qué significa para Dirección

Dinero que ingresó a las cuentas o caja controladas por Emporio durante el
periodo, sin afirmar todavía que sea ingreso propio.

### Fórmula

```text
Entradas de caja =
  suma de movimientos monetarios de entrada
```

### Incluye

- Ingresos propios cobrados.
- Rentas recibidas para propietarios.
- Anticipos.
- Depósitos.
- Fondos de terceros.

### Excluye

- Ingreso generado no cobrado.
- Promesas o fechas futuras.

### Fuentes actuales

- `cash_movements`, con `type = 'entrada'`
- `poliza_caja`, con `tipo = 'ingreso'`
- cobros de cierres que deberán conciliarse con caja

### Disponibilidad

**Requiere conciliación.** `cierre_pagos` no está formalmente vinculado con
`cash_movements`, por lo que todavía no existe una tesorería única.

---

## 6. Salidas de caja

### Qué significa para Dirección

Dinero que salió de las cuentas o caja controladas por Emporio durante el
periodo.

### Fórmula

```text
Salidas de caja =
  pagos a propietarios
+ pagos a proveedores
+ comisiones pagadas
+ gastos operativos pagados
+ devoluciones
+ otros egresos reales
```

### Fuentes actuales

- `cash_movements`, con `type = 'salida'`
- `poliza_caja`, con `tipo = 'egreso'`
- `owner_payments`
- pagos de vendedores y gerente registrados en cierres

### Disponibilidad

**Parcial y requiere conciliación.** Algunos pagos se reflejan como estado o
saldo, pero no como movimiento de caja relacionado.

---

## 7. Flujo neto de efectivo

### Qué significa para Dirección

Cambio neto de efectivo durante un periodo.

### Fórmula

```text
Flujo neto de efectivo =
  entradas de caja
- salidas de caja
```

### Interpretación

- Positivo: entró más dinero del que salió.
- Negativo: salió más dinero del que entró.

No equivale a utilidad. Puede ser positivo porque se recibió dinero de
propietarios o anticipos, y puede ser negativo porque se pagó una obligación
generada en un periodo anterior.

### Disponibilidad

**Parcial y requiere conciliación.**

---

## 8. Fondos de terceros

### Qué significa para Dirección

Dinero bajo custodia de Emporio que pertenece económica o contractualmente a
propietarios, inquilinos, condominios u otras partes.

### Fórmula conceptual

```text
Fondos de terceros pendientes de entregar =
  dinero de terceros recibido
- aplicaciones autorizadas
- devoluciones o liquidaciones realizadas
```

### Incluye

- Rentas cobradas por cuenta del propietario.
- Depósitos en garantía bajo custodia.
- Cuotas y fondos de condominio.
- Importes recibidos destinados a proveedores o terceros.

### Excluye

- Comisión propia de Emporio.
- Honorarios ya devengados.
- Margen propio de mantenimiento.

### Fuentes actuales

- `cash_movements` en categorías de renta y liquidación.
- `payments`.
- `owner_payments`.
- `cuotas_condominio`.
- contratos según `rent_receiver`.

### Disponibilidad

**Parcial.** Falta una clasificación contable uniforme y una relación completa
entre cobro, retención y liquidación.

### Riesgo de interpretación

Estos fondos pueden estar físicamente en una cuenta de Emporio, pero no deben
presentarse como ingreso, utilidad ni efectivo libre.

---

## 9. Caja propia estimada

### Qué significa para Dirección

Parte de la caja bajo control que, después de separar obligaciones conocidas
con terceros, podría considerarse de Emporio.

### Fórmula conceptual

```text
Caja propia estimada =
  saldo de caja conciliado
- fondos de terceros pendientes
- obligaciones inmediatas ya comprometidas
```

### Disponibilidad

**No disponible de forma confiable.** No existe conciliación bancaria completa
ni una cuenta contable única. Hasta entonces se utilizará el calificativo
“estimada” y se mostrará cobertura de datos.

---

## 10. Neto para Emporio

### Qué significa para Dirección

Valor económico que queda para Emporio después de descontar costos y
participaciones directamente atribuibles al ingreso.

### Fórmula

```text
Neto para Emporio =
  ingreso bruto generado
- comisión de vendedor generada
- comisión de gerente generada
- costos directos atribuibles
- participaciones directas de terceros
```

### No incluye todavía

- Nómina administrativa general.
- Renta de oficinas.
- Marketing corporativo.
- Impuestos.
- Costos indirectos no asignados.

Por ello, en V0 y V1 esta métrica no deberá llamarse “utilidad neta de la
empresa”.

### Fuentes actuales

- Cierres: comisión y participaciones del equipo.
- Mantenimiento: importe cobrado/generado menos proveedor.
- Otras unidades: costos directos cuando estén registrados.

### Disponibilidad

**Parcial.** Es más confiable para cierres y mantenimiento que para póliza,
administración o condominios.

---

# Comisiones del equipo

## 11. Comisión de vendedor generada

### Qué significa

Participación del asesor originada por un cierre confirmado, independientemente
de si ya fue pagada.

### Fórmula actual

```text
Comisión vendedor generada =
  cierres.com_vendedor
```

### Fuente

- `cierres.com_vendedor`
- vendedor identificado en `cierres.vendedor`

### Disponibilidad

**Calculable con limitaciones.** El monto existe, pero el vendedor es texto
libre y no un `asesor_id` canónico.

---

## 12. Comisión de vendedor pagada

### Qué significa

Importe de comisión del asesor que ya salió o fue liquidado.

### Fórmula actual

```text
Comisión vendedor pagada =
  cierres.pag_vendedor
```

### Saldo

```text
Comisión vendedor pendiente =
  comisión vendedor generada
- comisión vendedor pagada
```

`cierres.pend_vend` es un saldo almacenado que deberá compararse con la
fórmula.

### Disponibilidad

**Calculable con conciliación pendiente de caja.**

---

## 13. Comisión de gerente generada

### Qué significa

Participación del gerente correspondiente a cierres del periodo.

### Fórmula oficial

```text
Comisión gerente generada =
  suma del monto aprobado y almacenado por cierre
```

### Fuente actual

- `cierres.monto_gerente`

La lógica actual también recalcula porcentajes usando metas y porcentajes
hardcodeados. El Centro no deberá repetir ese cálculo hasta que las reglas
estén versionadas en base de datos.

### Disponibilidad

**Calculable usando el monto almacenado; regla de origen no gobernada.**

---

## 14. Comisión de gerente pagada

### Fórmula

```text
Comisión gerente pagada =
  cierres.gerente_pagado_monto

Comisión gerente pendiente =
  monto_gerente
- gerente_pagado_monto
```

### Disponibilidad

**Calculable con conciliación pendiente de caja.**

---

# Métricas por unidad de negocio

## 15. Cierres inmobiliarios

### Generado

```text
Suma de cierres.comision por fecha_cierre
```

Un registro en `cierres` se considera actualmente una operación confirmada.
No existe estado de cancelación en la tabla; cualquier reversión deberá
registrarse explícitamente en el futuro.

### Cobrado

```text
Suma de cierre_pagos.monto por fecha de pago
```

### Pendiente

```text
cierres.comision - suma de cierre_pagos aplicados
```

### Volumen comercializado

```text
Suma de cierres.precio
```

El volumen comercializado no es ingreso.

### Segmentación

- Venta.
- Renta.
- Renovación, cuando esté identificada formalmente.

### Disponibilidad

**Generado y cobrado calculables; pendiente requiere conciliación.**

---

## 16. Administración

### Qué significa

Ingreso propio por administrar inmuebles o contratos. No incluye la renta
completa del propietario.

### Generado

```text
Suma de comisiones_admin.monto por periodo
```

`comisiones_admin` es la fuente preferida porque existe una restricción única
por `contract_id + periodo`.

### Cobrado

```text
Suma de comisiones_admin.monto
donde status = 'cobrada'
por fecha_cobro
```

`cash_movements.category = 'comision_cobrada'` servirá para conciliación, no
como un ingreso adicional.

### Pendiente

```text
Suma de comisiones_admin.monto
donde status = 'pendiente'
```

### Ingreso recurrente mensual contratado

```text
Suma de la comisión calculada de contratos activos
```

Es una expectativa recurrente, no ingreso generado hasta crear la comisión del
periodo.

### Excluye

- `payments.amount` y rentas completas.
- Depósitos.
- Liquidaciones a propietarios.

### Disponibilidad

**Calculable para generado, cobrado y pendiente, sujeto a conciliación con
caja.**

---

## 17. Póliza jurídica

### Qué significa

Ingreso propio por pólizas, investigaciones y servicios jurídicos.

### Generado propuesto

```text
Monto de póliza reconocido cuando el expediente alcanza
el estado empresarial que confirme la prestación o compromiso
```

El estado exacto deberá definirse en V0-04. No debe usarse
`renta_mensual` como ingreso de póliza.

### Cobrado

```text
Suma de poliza_caja.monto
donde tipo = 'ingreso'
```

Debe segmentarse por concepto:

- Investigación.
- Anticipo de póliza.
- Saldo de póliza.
- Pago completo.
- Otros.

### Pendiente

```text
Monto reconocido de póliza
- cobros aplicados al expediente
```

Los campos `anticipo_poliza`, `saldo_poliza`, `anticipo_pagado` y
`saldo_pagado` sirven como control, pero deben conciliarse contra
`poliza_caja`.

### Disponibilidad

**Cobrado calculable; generado y pendiente requieren definición y
conciliación.**

---

## 18. Mantenimiento

### Qué significa

Servicio de coordinación o ejecución de mantenimiento donde Emporio cobra un
importe y puede incurrir en costo de proveedor.

### Generado propuesto

```text
Importe aprobado al cliente
```

Fuente preferida:

- cotización aprobada en `maintenance_quotes.monto_final`;
- respaldo operativo en `maintenance_tickets.charged_amount`.

Si existen varias cotizaciones para un ticket, solo una aprobada podrá
reconocerse.

### Cobrado

```text
Entradas de caja aplicadas al ticket
```

`status = 'cerrado'` o `updated_at` no prueban por sí mismos el cobro.

### Costo directo

```text
Costo de proveedor atribuible al ticket
```

Fuente:

- `maintenance_quotes.costo_proveedor`;
- `maintenance_tickets.provider_cost`;
- salida de caja al proveedor para conciliación.

### Margen de mantenimiento

```text
Ingreso generado de mantenimiento
- costo directo de proveedor
```

### Pendiente

```text
importe generado
- anticipos cobrados
- liquidaciones cobradas
```

### Disponibilidad

**Margen esperado parcialmente calculable; cobro y saldo requieren relación
inequívoca con caja.**

---

## 19. Honorarios de condominio

### Qué significa

Honorarios propios de Emporio por administrar un condominio.

### Generado propuesto

```text
Honorario mensual devengado por cada condominio activo
```

### Cobrado

Cobro identificado y relacionado con el periodo del honorario.

### Excluye

- Cuotas de condóminos.
- Fondo operativo.
- Gastos del condominio.

### Disponibilidad

**No disponible de forma confiable.** `honorarios_emporio` configura el importe
esperado y algunos registros en `gastos_condominio` representan honorarios,
pero no existe un ledger mensual de generación y cobro.

---

# Rentabilidad

## 20. Costo directo

### Qué significa

Costo que puede atribuirse sin ambigüedad a un ingreso, operación o servicio.

### Ejemplos

- Comisión del vendedor.
- Comisión del gerente.
- Proveedor de mantenimiento.
- Investigación o proveedor jurídico, si se registra.
- Participación directa acordada con un tercero.

### Excluye

- Gastos generales no asignados.
- Fondos entregados a propietarios.
- Precio de la propiedad.

### Disponibilidad

**Parcial.**

---

## 21. Margen bruto

### Qué significa para Dirección

Cantidad que conserva una unidad después de sus costos directos, antes de
gastos corporativos.

### Fórmula

```text
Margen bruto =
  ingreso bruto generado
- costos directos
```

### Porcentaje

```text
Margen bruto % =
  margen bruto / ingreso bruto generado × 100
```

### Disponibilidad

**Parcial.** Es calculable donde existan costos directos confiables.

---

## 22. Utilidad neta empresarial

### Qué significa

Resultado después de ingresos, costos directos, gastos operativos, impuestos y
demás costos corporativos.

### Disponibilidad

**No disponible.** InmoAdmin no contiene todavía un ledger corporativo
completo de gastos, impuestos y ajustes contables. El Centro no deberá llamar
“utilidad neta” al margen conocido.

---

# Métricas de control

## 23. Tasa de realización

### Qué significa

Proporción del ingreso generado que ya se convirtió en cobro.

### Fórmula

```text
Tasa de realización =
  cobrado aplicado al ingreso generado
  / ingreso generado
  × 100
```

Debe calcularse por cohorte de generación para evitar comparar cobros antiguos
contra ingresos nuevos.

### Disponibilidad

**Parcial.**

---

## 24. Ingreso recurrente mensual

### Qué significa

Ingreso propio que puede esperarse periódicamente mientras los contratos o
servicios permanezcan activos.

### Incluye inicialmente

- Comisiones de administración activas.
- Honorarios de condominio cuando exista ledger confiable.

### Excluye

- Cierres inmobiliarios.
- Mantenimiento eventual.
- Pólizas no recurrentes.
- Renta completa del propietario.

### Disponibilidad

**Parcial; calculable principalmente para administración.**

---

## 25. Cobranza del periodo

### Qué significa

Cobros realizados durante el periodo, independientemente de cuándo se generó
el ingreso.

### Diferencia frente a tasa de realización

Cobranza responde cuánto se recibió este mes. Tasa de realización responde qué
proporción de una cohorte generada ya fue cobrada.

### Disponibilidad

**Requiere conciliación.**

---

## 26. Brecha de conciliación

### Qué significa

Diferencia entre un saldo almacenado y el saldo reconstruido desde sus
movimientos.

### Ejemplo

```text
Brecha de cierre =
  cierres.pendiente
- (cierres.comision - suma de cierre_pagos)
```

### Interpretación

Una brecha distinta de cero indica un problema de captura, sincronización,
duplicación o regla.

### Disponibilidad

**Calculable.** Será una métrica de calidad, no un indicador de desempeño.

---

# Presentación obligatoria

Toda tarjeta o reporte financiero deberá mostrar:

- nombre;
- valor;
- periodo o fecha de corte;
- perspectiva: devengado o caja;
- unidad de negocio;
- estado de disponibilidad;
- fuente;
- última actualización;
- cobertura o nivel de confianza;
- acceso a explicación y detalle.

## Etiquetas prohibidas sin suficiente evidencia

No se utilizarán estas expresiones salvo que la definición esté completamente
soportada:

- “Utilidad neta”.
- “Caja disponible”.
- “Ingreso total” sin especificar generado o cobrado.
- “Vencido” sin fecha de vencimiento.
- “Tiempo real” sin indicar última actualización.
- “Proyección” basada únicamente en promedio simple.

## Aprobación funcional pendiente

Antes de implementar las fórmulas, Dirección o Administración deberá confirmar:

1. evento de reconocimiento de póliza;
2. evento de reconocimiento de mantenimiento;
3. tratamiento contable de anticipos;
4. reconocimiento mensual de honorarios de condominio;
5. tratamiento de impuestos cuando se registren;
6. si la comisión total de cierre se reconoce en `fecha_cierre` o al cumplirse
   una condición adicional.

Estas confirmaciones no cambian el significado general; determinan el evento
operativo que activa cada métrica.
