# Reglas de deduplicación y conciliación

Tarea: V0-04
Versión: 1.0
Fecha: 25 de junio de 2026

## Objetivo

Evitar que una operación aparezca varias veces al integrar módulos de
InmoAdmin.

Deduplicar no significa borrar registros. Significa reconocer que varias filas
representan el mismo hecho económico y seleccionar una sola fuente para cada
métrica.

## Tipos de duplicación

### Copia intencional

Un módulo copia datos a otro para continuar el flujo.

Ejemplo:

```text
recibos_abonos → cierre_pagos
```

### Resumen y detalle

Una tabla guarda el total y otra los movimientos.

Ejemplo:

```text
cierres.cobrado ↔ suma de cierre_pagos
```

### Documento y caja

Una tabla registra el derecho o estado y otra el movimiento monetario.

Ejemplo:

```text
comisiones_admin ↔ cash_movements
```

### Evidencia duplicada

Un recibo o comprobante documenta un pago registrado en otra tabla.

Ejemplo:

```text
owner_payment_receipts ↔ owner_payments
```

### Duplicado accidental

La misma acción se ejecuta más de una vez y crea varias filas equivalentes.

Ejemplo:

```text
cerrar repetidamente un ticket → varios movimientos de caja
```

## Niveles de coincidencia

| Nivel | Evidencia | Tratamiento |
|---|---|---|
| Exacta | ID o clave de origen compartida | Deduplicación automática |
| Fuerte | documento, tipo, importe y fecha coherentes | Vinculación automática auditable |
| Probable | importe, fecha y descripción similares | No sumar provisionalmente; revisión |
| Débil | solo importe o texto parecido | Mantener separado y alertar |

## Regla fundamental

La deduplicación se aplica dentro de una perspectiva:

- devengado;
- cobro aplicado;
- caja;
- costo;
- obligación.

Dos filas relacionadas pueden aparecer legítimamente en perspectivas
diferentes. Por ejemplo, una comisión generada y su cobro no son duplicados si
se muestran en columnas distintas.

---

# Identificadores lógicos

Estas claves son convenciones documentales de V0-04. No se crean todavía en la
base de datos.

| Hecho | Clave lógica |
|---|---|
| Cierre generado | `cierre:{cierre_id}` |
| Pago de cierre | `cierre_pago:{pago_id}` |
| Apartado | `apartado:{recibo_id}` |
| Abono | `abono:{abono_id}` |
| Comisión administrativa | `admin:{contract_id}:{periodo}` |
| Cobro de póliza | `poliza_caja:{id}` |
| Póliza por concepto | `poliza:{expediente_id}:{concepto}:{secuencia}` |
| Mantenimiento generado | `mtto:{ticket_id}:generado` |
| Costo de mantenimiento | `mtto:{ticket_id}:costo:{secuencia}` |
| Cobro de mantenimiento | `mtto:{ticket_id}:cobro:{secuencia}` |
| Liquidación | `owner:{owner_id}:{periodo}:{secuencia}` |
| Honorario de condominio | `condominio:{id}:{periodo}:honorario` |

Cuando no exista `owner_id`, usar correo normalizado es solo una solución
provisional.

---

# Reglas por flujo

## D-01 — Cierre y pagos

Para ingreso generado:

```text
contar cierres.comision una vez por cierres.id
```

Para cobrado:

```text
sumar cierre_pagos.monto una vez por cierre_pagos.id
```

No sumar:

- `cierres.cobrado`;
- `cierres.pendiente`;
- `recibos_apartado`;
- `recibos_abonos`.

Los campos de `cierres` se usan para conciliación.

## D-02 — Apartado convertido en cierre

Si existe un `cierre_pagos` cuyo marcador sea:

```text
recibo_inicial:{recibo_id}
```

el importe del apartado queda representado como cobro de cierre y no vuelve a
sumarse desde `recibos_apartado`.

## D-03 — Abono convertido en cierre

Si existe:

```text
recibo_abono:{abono_id}
```

en `cierre_pagos.notas`, el abono se cuenta mediante `cierre_pagos`.

El endpoint actual ya evita insertar dos veces el mismo abono buscando ese
marcador. V0 deberá auditar que los pagos históricos lo conserven.

## D-04 — Anticipos sin cierre

Apartados y abonos sin cierre relacionado:

- se muestran como anticipos recibidos no aplicados;
- no se suman a comisión generada;
- no se mezclan con pagos de cierres;
- requieren clasificación de fondos propios o de terceros.

## D-05 — Saldo de cierre

```text
saldo_reconstruido =
  cierres.comision
- suma(cierre_pagos.monto)
```

Comparar contra:

- `cierres.cobrado`;
- `cierres.pendiente`;
- `cobrado_bool`.

La diferencia es una brecha; no se corrige automáticamente.

---

## D-06 — Comisión administrativa

Contar una comisión generada por:

```text
contract_id + periodo
```

La restricción única existente respalda esta regla.

No sumar el cálculo del contrato si ya existe `comisiones_admin`.

## D-07 — Comisión administrativa y caja

Para ingreso/cobro:

```text
usar comisiones_admin
```

Para caja:

```text
usar cash_movements solo como movimiento físico o evidencia
```

No sumar ambos en “ingreso cobrado”.

## D-08 — Comisión retenida de renta

Si una renta completa ya entró a caja y después la comisión se retiene al
liquidar:

- la comisión cambia de fondo de tercero a fondo propio;
- no constituye otra entrada física;
- el movimiento `comision_cobrada` debe tratarse como reclasificación cuando
  la descripción o el contexto indiquen “retenida de liquidación”.

## D-09 — Renta y comisión

`payments.amount` y `cash_movements.renta_cobrada` representan la renta
completa. No se suman a ingreso de administración.

Solo `comisiones_admin.monto` representa ingreso propio.

## D-10 — Reversión de estado

Si una comisión vuelve a pendiente pero permanece el movimiento de caja:

- no eliminar movimiento;
- marcar discrepancia;
- solicitar revisión;
- no escoger automáticamente el mayor o menor importe.

---

## D-11 — Póliza y caja

Los cobros de póliza provienen únicamente de `poliza_caja`.

No sumar adicionalmente:

- `anticipo_poliza`;
- `saldo_poliza`;
- `monto_investigacion`;
- banderas de pagado.

Esos campos validan el total esperado.

## D-12 — Duplicado probable de póliza

Marcar para revisión cuando existan movimientos con:

- mismo `expediente_id` o `solicitud_id`;
- mismo concepto;
- mismo monto;
- misma fecha;
- mismo método.

No consolidar automáticamente pagos parciales con conceptos diferentes.

## D-13 — Pago completo frente a anticipo y saldo

Para un expediente:

```text
pago_poliza
```

no debe coexistir económicamente con:

```text
anticipo_poliza + saldo_poliza
```

si ambos conjuntos cubren el mismo importe. La coexistencia se marca como
posible duplicación.

---

## D-14 — Cotización y ticket

Para cada ticket:

1. elegir una cotización aprobada como fuente;
2. usar el ticket como respaldo;
3. no sumar `monto_final` y `charged_amount`;
4. no sumar `costo_proveedor` y `provider_cost`.

Si existen varias cotizaciones aprobadas, el ticket queda en revisión.

## D-15 — Cierre del ticket

El estado `cerrado` no crea un segundo ingreso. Para cobrado se necesita un
movimiento o evidencia de aplicación.

## D-16 — Movimientos repetidos de mantenimiento

Marcar duplicado probable si existen varias filas de caja con:

- misma categoría;
- mismo ticket inferido;
- mismo monto;
- fechas iguales o cercanas;
- descripción equivalente.

La solución definitiva requerirá `reference_id = ticket_id` y
`reference_type`.

## D-17 — Anticipo de mantenimiento

```text
saldo =
  importe generado
- anticipos aplicados
- cobros finales
```

`advance_amount` y `advance_paid` no se suman a caja si ya existe un movimiento
de anticipo.

## D-18 — Descuento en liquidación

Si `descontado_de_liquidacion = true`, el cargo al propietario ya fue aplicado
a su saldo. No crear otro ingreso ni volver a descontarlo en periodos futuros.

El descuento puede representar cobro por compensación, pero no entrada física.

---

## D-19 — Pago al propietario

Un desembolso puede aparecer en:

- `owner_payments`;
- `owner_payment_receipts`;
- `cash_movements.liquidacion_propietario`.

Contarlo una sola vez en cada perspectiva:

- pago/obligación: `owner_payments`;
- evidencia: recibo;
- caja: movimiento.

## D-20 — Total liquidable y pago

`total_liquid` es el importe calculado de la obligación.
`amount_paid` es el desembolso.

No sumarlos.

## D-21 — Pagos parciales

Cada `amount_paid` representa un desembolso real si el registro es válido.
El registro final no debe reemplazar pagos parciales salvo que explícitamente
contenga el total histórico, situación que debe detectarse y documentarse.

## D-22 — Comisión en liquidación

`owner_payments.total_commission` comprueba la retención, pero el ingreso se
origina en `comisiones_admin`. No se suman.

## D-23 — Gastos y mantenimiento descontados

Un gasto o mantenimiento retenido al propietario:

- reduce la obligación con el propietario;
- no se suma nuevamente como salida de Emporio si nunca fue pagado por
  Emporio;
- sí puede generar un movimiento distinto cuando Emporio pagó al proveedor.

---

## D-24 — Cuotas de condominio

`cuotas_condominio.monto` pertenece al condominio.

Nunca incluir en:

- ingreso bruto de Emporio;
- cobrado propio;
- margen;
- neto para Emporio.

## D-25 — Honorarios de condominio

El registro categorizado como `honorarios_emporio` y el movimiento
`honorarios_condominio` representan el mismo honorario desde documento y caja.
No se suman.

## D-26 — Configuración mensual

`condominios.honorarios_emporio` es la tarifa configurada. No demuestra que el
honorario haya sido generado ni cobrado.

## D-27 — Fondo del condominio

```text
cuotas cobradas
- gastos
- honorarios aplicados
```

es saldo del condominio, no caja propia de Emporio.

---

# Validaciones automáticas futuras

V0-04 no implementa estas validaciones; define su comportamiento.

## Severidad crítica

- pago copiado dos veces desde el mismo abono;
- más de una comisión administrativa para contrato-periodo;
- dos movimientos de caja automáticos iguales;
- cuota de condominio clasificada como ingreso propio;
- renta completa clasificada como ingreso administrativo;
- pago a propietario contado como gasto operativo.

## Severidad alta

- saldo almacenado distinto al reconstruido;
- comisión cobrada sin movimiento o evidencia;
- movimiento de caja sin documento origen;
- más de una cotización aprobada;
- ticket cobrado por encima del importe generado;
- póliza cobrada por encima del monto reconocido.

## Severidad media

- coincidencia probable sin ID de origen;
- persona o propiedad identificada solo por texto;
- fecha técnica utilizada como fecha económica;
- comprobante sin registro financiero relacionado.

# Política ante discrepancias

1. No borrar ni fusionar filas originales.
2. Conservar todas las fuentes y su linaje.
3. Seleccionar la fuente primaria según esta matriz.
4. Reportar la diferencia.
5. Mostrar nivel de confianza.
6. Solicitar revisión cuando la diferencia cambie una cifra directiva.
7. No usar `Math.max`, promedios ni aproximaciones para ocultar la brecha.

# Casos de prueba mínimos futuros

1. Cierre manual sin recibo.
2. Cierre creado desde apartado con dos abonos.
3. Nuevo abono después de creado el cierre.
4. Comisión administrativa manual.
5. Comisión retenida en liquidación.
6. Renta recibida directamente por el propietario.
7. Anticipo y saldo de póliza.
8. Pago completo de póliza sin anticipo.
9. Ticket con varias cotizaciones.
10. Ticket cerrado dos veces.
11. Mantenimiento descontado al propietario.
12. Liquidación con pagos parciales.
13. Honorario de condominio registrado junto con caja.
14. Cuota de condominio pagada.
15. Movimiento de caja manual sin referencia.
