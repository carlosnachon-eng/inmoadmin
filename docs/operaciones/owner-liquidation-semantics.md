# Semántica determinística de liquidaciones

## Pregunta de negocio

Una renta forma parte del saldo que Emporio debe entregar al propietario sólo
cuando el dinero fue efectivamente recibido por Emporio.

## Precedencia de fuentes

1. `payments.recibido_por` es la señal transaccional primaria:
   - `emporio`: el dinero está en poder de Emporio;
   - `propietario`: fue recibido directamente por el propietario.
2. Si el pago histórico no tiene receptor, `contracts.rent_receiver` define el
   flujo esperado:
   - `inmobiliaria`: Emporio recibe y después liquida;
   - `propietario`: pago directo, sin saldo a entregar por Emporio.
3. Para un contrato directo histórico sin `payments.recibido_por`, una entrada
   coincidente en `cash_movements` con `type = entrada` y
   `category = renta_cobrada` acredita que Emporio recibió físicamente la renta.

Esta precedencia reproduce el flujo de `pages/cobranza.js`: al cobrar para
Emporio se registra `payments.recibido_por = emporio` y una entrada de renta;
al pagar directamente al propietario se registra `recibido_por = propietario`
sin entrada a caja de Emporio.

## Comisión devengada y comisión retenible

La comisión contractual se devenga cuando la renta administrada fue pagada,
independientemente de quién recibió la renta. `comisiones_admin` es el ledger
primario de ese devengado por contrato y periodo.

Sólo es retenible en una liquidación la comisión asociada a renta recibida por
Emporio. En contratos con pago directo al propietario, la comisión queda como
cobro manual al propietario y no reduce un saldo de renta inexistente en caja.

`calculateOwnerLiquidation()` expone por separado:

- `totalCommissionAccrued`: comisión devengada sobre todas las rentas pagadas;
- `totalRetainableCommission`: comisión descontable de rentas en poder de Emporio;
- `totalRent`: únicamente rentas recibidas por Emporio;
- `balance`: saldo que Emporio puede entregar después de comisión retenible,
  gastos, mantenimientos y pagos parciales previos.

Ni el cálculo ni el Centro Operativo crean movimientos de caja, cobran
comisiones o ejecutan liquidaciones.
