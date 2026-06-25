# Auditoría del esquema real de Supabase

Tarea: V0-02  
Proyecto: `bnzrnizrmonjxlktbhlp` (`inmoadmin`, rama `main`)  
Fecha de auditoría: 25 de junio de 2026

## Alcance y método

La auditoría se realizó desde el SQL Editor del proyecto con consultas
exclusivamente de lectura sobre:

- `pg_class` y `pg_namespace`;
- `information_schema.columns`;
- `pg_constraint`;
- `pg_policies`;
- `information_schema.role_table_grants`;
- `pg_indexes`;
- `storage.buckets`.

No se ejecutó `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `CREATE`, `DROP` ni una
migración. Tampoco se consultaron filas de negocio.

Los metadatos obtenidos se contrastaron con las llamadas a Supabase existentes
en `pages`, `components` y `lib`.

## Resumen

| Elemento | Cantidad |
|---|---:|
| Tablas públicas | 58 |
| Vistas públicas | 1 |
| Columnas | 972 |
| Claves foráneas | 68 |
| Llaves primarias o restricciones únicas | 68 |
| Políticas RLS públicas | 80 |
| Buckets de Storage | 14 |

El inventario resumido por objeto se encuentra en
`docs/bi/inventario-tablas.csv`.

## Tablas reales encontradas

### Finanzas, cierres y recibos

- `cash_movements`
- `cierre_pagos`
- `cierres`
- `comisiones_admin`
- `cuentas_bancarias`
- `owner_payment_receipts`
- `owner_payments`
- `property_expenses`
- `recibos_abonos`
- `recibos_apartado`
- `recibos_folios`
- `recibos_log`

### Administración y cobranza

- `contracts`
- `payments`
- `pagos_servicios`
- `properties`
- `servicios_inmueble`

### Comercial, clientes y pipeline

- `asesores`
- `citas`
- `clientes`
- `envios`
- `envios_propiedades`
- `firmas`
- `firma_comentarios`
- `firma_etapas`
- `firmas_citas`
- `firmas_usuarios`
- `kpis_diarios`
- `leads_respond`
- `seguimientos_cliente`

### Propiedades y marketing

- `propiedades`
- `propietarios_inmuebles`
- `proyectos_eventos`
- `solicitudes_contacto_propiedad`
- `visitas_propiedad`
- `migracion_easybroker_estado`

### Póliza jurídica

- `compradores`
- `poliza_caja`
- `poliza_documentos`
- `poliza_expedientes`
- `poliza_recibos`
- `solicitudes_inquilino`

### Mantenimiento

- `maintenance_quotes`
- `maintenance_tickets`

### Condominios

- `condominios`
- `cuotas_condominio`
- `gastos_condominio`
- `unidades_condominio`

### Organización, seguridad y operación

- `checadas`
- `gastos_personales`
- `guardias`
- `llaves`
- `llaves_movimientos`
- `permisos_modulo`
- `profiles`
- `roles`
- `users`

### Cartas

- `cartas_oferta`

### Vista

- `profiles_con_rol`

`gastos_personales` existe, pero queda explícitamente fuera del modelo
financiero empresarial.

## Columnas financieras importantes

### Cierres

`cierres` contiene generación y saldos resumidos:

- `fecha_cierre`, `operacion`, `precio`;
- `comision`, `cobrado`, `pendiente`;
- `vendedor`, `com_vendedor`, `pag_vendedor`, `pend_vend`;
- `comision_inmobiliaria`;
- `monto_gerente`, `gerente_pagado_monto`;
- `fecha_cobro_asesor`, `fecha_cobro_gerente`;
- `propiedad_id`, `recibo_id`, `firma_id`;
- `origen`, `confirmado_por`, `confirmado_en`.

`cierre_pagos` representa cobros detallados mediante:

- `cierre_id`, `concepto`, `monto`, `fecha`, `metodo_pago`.

No contiene fecha esperada de cobro ni identificador UUID del asesor.

### Administración

`contracts` contiene:

- renta y vigencia: `monthly_rent`, `start_date`, `end_date`;
- comisión: `commission_type`, `commission_value`, `commission_who`;
- cobranza: `commission_status`;
- receptor de renta: `rent_receiver`;
- relaciones: `property_id`, `tenant_id`.

`payments` contiene vencimiento y pago de rentas:

- `amount`, `due_date`, `payment_date`, `status`;
- `contract_id`, periodo, método y receptor.

`comisiones_admin` contiene:

- `contract_id`, `periodo`, `monto`, `tipo`;
- `status`, `fecha_cobro`, `forma_pago`.

No existe relación directa entre `comisiones_admin` y su movimiento de caja.

### Caja

`cash_movements` contiene:

- `type`, `category`, `amount`, `date`;
- `reference_id`, `reference_type`;
- método, descripción, notas y creador.

La combinación `reference_id` + `reference_type` es útil, pero no tiene clave
foránea ni restricción única. No existe `due_date` ni contraparte normalizada.

### Mantenimiento

`maintenance_tickets` separa:

- `provider_cost`, `charged_amount`;
- `advance_amount`, `advance_paid`;
- `status_pago`, `fecha_cobro_propietario`;
- `payer`, `descontado_de_liquidacion`;
- `property_id`, `condominio_id`.

`maintenance_quotes` contiene:

- `ticket_id`, `costo_proveedor`, `margen_pct`, `monto_final`, `status`.

No existe una fecha formal de compromiso ni una fecha de cierre del ticket.

### Póliza

`poliza_expedientes` contiene:

- `monto_poliza`, `anticipo_poliza`, `saldo_poliza`;
- banderas y fechas de pago;
- `fecha_inicio`, `fecha_termino`, `fecha_vigencia`;
- `status`, `status_expediente`;
- `expediente_anterior_id` para renovaciones.

`poliza_caja` contiene los ingresos y egresos reales:

- `fecha`, `tipo`, `concepto`, `monto`;
- `expediente_id`, `solicitud_id`.

No existe asesor, origen comercial ni fecha estimada de cobro en el
expediente.

### Condominios

`condominios` contiene `cuota_mensual`, `honorarios_emporio` y `activo`.
`gastos_condominio` registra concepto, categoría, monto y fecha.

No existe una tabla específica de facturación o cobro de honorarios de
Emporio. Por ello todavía no puede asumirse que
`condominios.honorarios_emporio` sea ingreso generado o cobrado.

## Relaciones detectadas

### Cadena comercial principal

```text
profiles
  ├─ clientes.asesor_id
  ├─ citas.asesor_id
  ├─ recibos_apartado.asesor_id
  └─ propiedades.agente_id

clientes ── citas.cliente_id
propiedades ── citas.propiedad_id
propiedades ── recibos_apartado.propiedad_id
recibos_apartado ── recibos_abonos.recibo_id
recibos_apartado ── firmas.recibo_id
firmas ── firma_etapas.firma_id
firmas ── firmas_citas.firma_id
cierres ── cierre_pagos.cierre_id
```

`cierres` se relaciona formalmente con `propiedades`, `recibos_apartado` y
`firmas`, pero conserva al vendedor únicamente en `vendedor` como texto.

### Administración

```text
properties ── contracts.property_id
contracts ── payments.contract_id
contracts ── comisiones_admin.contract_id
contracts ── servicios_inmueble.contract_id
servicios_inmueble ── pagos_servicios.servicio_id
```

### Mantenimiento

```text
properties ── maintenance_tickets.property_id
condominios ── maintenance_tickets.condominio_id
maintenance_tickets ── maintenance_quotes.ticket_id
```

### Póliza

```text
solicitudes_inquilino ── poliza_expedientes.inquilino_id
propietarios_inmuebles ── poliza_expedientes.propietario_id
poliza_expedientes ── poliza_caja.expediente_id
poliza_expedientes ── poliza_documentos.expediente_id
poliza_expedientes ── poliza_recibos.expediente_id
poliza_expedientes ── poliza_expedientes.expediente_anterior_id
```

### Condominios

```text
condominios ── unidades_condominio.condominio_id
condominios ── cuotas_condominio.condominio_id
unidades_condominio ── cuotas_condominio.unidad_id
condominios ── gastos_condominio.condominio_id
```

## Campos ambiguos o redundantes

### Identidad de usuario

Existen tres representaciones:

- `auth.users`, referida en los metadatos como `users`;
- `public.users`;
- `public.profiles`.

Además existe `asesores`. Las relaciones no usan una única tabla de identidad.
El modelo BI deberá decidir una dimensión de persona canónica.

### Propiedades

Existen dos catálogos distintos:

- `properties`: cartera administrada, nombres en inglés;
- `propiedades`: catálogo comercial/web, nombres en español.

No existe relación formal entre ambos. No deben fusionarse por nombre.

### Estados duplicados

- `poliza_expedientes.status` y `status_expediente`;
- `maintenance_tickets.status` y `status_pago`;
- `recibos_apartado.estatus` y `flujo_estado`;
- `profiles.role` y `role_id`.

Cada par tiene semánticas diferentes, pero el frontend no siempre las
distingue explícitamente.

### Montos duplicados o derivados

- `cierres.cobrado` frente a la suma de `cierre_pagos`;
- `cierres.pendiente` frente a `comision - pagos`;
- `cierres.comision_inmobiliaria` frente a comisión menos pagos al equipo;
- `recibos_apartado.monto`, `monto_previo` y `monto_total_acordado`;
- `poliza_expedientes.anticipo`, `anticipo_poliza` y `saldo_poliza`;
- `maintenance_tickets.cost` y `provider_cost`.

V0 deberá comparar, no asumir que estos campos están sincronizados.

### Campos de persona en texto

`vendedor`, `recibido_por`, `created_by`, `creado_por` y otros campos alternan
entre UUID, correo, nombre y texto libre. Esto impide atribución histórica
confiable sin normalización.

### Fechas

Hay mezcla de `date`, `timestamp` y `timestamptz`. Algunas operaciones usan
`updated_at` como sustituto de fecha de cobro o cierre, lo cual no es
contablemente seguro.

## Inconsistencias entre frontend y esquema

### Confirmadas

1. `pages/ejecutivo.js` consulta `contracts.updated_at`, pero la columna no
   existe. La respuesta de esa consulta puede fallar y el código ignora
   `ct.error`, dejando administración incompleta.

2. `pages/solicitud-inquilino.js` y
   `pages/poliza/solicitud/[id].js` intentan actualizar
   `solicitudes_inquilino.ingreso_total_ia`, columna inexistente. En PostgREST,
   esto puede provocar que falle toda la actualización que acompaña el
   análisis.

3. Varias rutas insertan `recibos_log.notas`, pero `recibos_log` solo contiene
   `id`, `recibo_id`, `accion`, `usuario_id` y `created_at`. Esos registros de
   bitácora pueden no guardarse.

### Falsos positivos descartados

Los nombres con guion encontrados en `.storage.from(...)`, por ejemplo
`poliza-docs`, `recibos-apartado`, `receipts` y `documentos`, son buckets de
Storage reales, no tablas faltantes.

No se detectó una tabla de frontend inexistente después de separar las
referencias de Storage. La revisión estática no garantiza que todos los
objetos dinámicos de `insert` o `update` coincidan; los tres casos anteriores
sí fueron confirmados manualmente.

## Riesgos de RLS y permisos

### Severidad crítica: RLS deshabilitado

Las siguientes 17 tablas tienen RLS deshabilitado y los roles `anon` y
`authenticated` conservan privilegios amplios:

- `checadas`
- `cierre_pagos`
- `comisiones_admin`
- `condominios`
- `cuentas_bancarias`
- `cuotas_condominio`
- `firmas_citas`
- `gastos_condominio`
- `guardias`
- `llaves`
- `llaves_movimientos`
- `maintenance_quotes`
- `owner_payment_receipts`
- `propietarios_inmuebles`
- `recibos_abonos`
- `solicitudes_inquilino`
- `unidades_condominio`

Esto puede permitir lectura o modificación anónima directa mediante la API,
incluyendo información financiera y datos personales. V0-02 no cambia estas
políticas; deben corregirse mediante una migración revisada y probada, nunca
manualmente en producción.

### Severidad crítica: políticas públicas sin restricción

Existen políticas `ALL` con `USING true` y `WITH CHECK true` para tablas como:

- `cash_movements`
- `contracts`
- `maintenance_tickets`
- `owner_payments`
- `payments`
- `profiles`
- `properties`
- `property_expenses`

El rol PostgreSQL `public` incluye usuarios anónimos. Por tanto, estas
políticas no representan “todos los usuarios internos”; permiten acceso mucho
más amplio.

`gastos_personales` y `kpis_diarios` tienen el mismo patrón.

### Cierres

Las políticas de `cierres` contienen correos personales hardcodeados. Esto:

- no escala con roles;
- puede dejar acceso activo a cuentas que cambien de función;
- contradice la matriz `profiles` + `permisos_modulo`;
- dificulta el acceso seguro del futuro API ejecutivo.

### Perfiles y roles

- `profiles` permite `ALL` con condición verdadera para `public`.
- `roles` permite lectura pública.
- `profiles` contiene correo, teléfono, estado y rol.

La combinación facilita enumerar usuarios y modificar perfiles si la API
confirma los privilegios observados.

### Tablas con RLS pero sin políticas

- `leads_respond`
- `users`

Estas tablas quedan inaccesibles mediante clientes normales, salvo service
role. Puede ser deliberado, pero debe documentarse porque el frontend o BI no
podrán consultarlas directamente.

### Storage

Se encontraron 14 buckets. Son especialmente sensibles:

- `documentos` es público y sus políticas permiten todas las operaciones a
  `public`;
- `recibos-condominio` es público y permite todas las operaciones a `public`;
- `poliza-docs` es privado, pero sus políticas permiten leer, insertar,
  actualizar y eliminar a `anon`;
- `receipts`, `llaves-fotos` y `mantenimiento-fotos` están marcados como
  públicos aunque contienen comprobantes o evidencia operativa.

La auditoría no descargó archivos. Este riesgo deberá tratarse como trabajo de
seguridad independiente y reversible.

## Datos faltantes para conciliación

### Cierres

- `asesor_id` canónico en `cierres`;
- fecha esperada de cobro;
- fecha de vencimiento de cada saldo;
- identificador de origen en cada pago;
- regla versionada de comisión de gerente;
- costos directos atribuibles.

### Administración

- `updated_at` o historial de cambios en `contracts`;
- fecha de vencimiento de la comisión;
- relación entre `comisiones_admin` y `cash_movements`;
- registro explícito de renovación;
- relación entre `properties` y `propiedades`, si realmente representan el
  mismo inmueble.

### Caja

- contraparte normalizada;
- vencimiento;
- moneda;
- referencia obligatoria y validada;
- estado de conciliación;
- cuenta bancaria afectada.

### Mantenimiento

- fecha comprometida;
- fecha real de término/cierre;
- vínculo directo del ticket con la cotización aprobada;
- vínculo inequívoco con cobro y pago de proveedor;
- separación de facturado, cobrado y descontado de liquidación.

### Póliza

- asesor responsable;
- origen comercial;
- fecha estimada de cobro;
- historial de cambios de estado;
- definición de cuándo `monto_poliza` se considera generado.

### Pipeline

- asesor en `firmas`;
- valor de comisión esperado;
- probabilidad;
- próxima acción y fecha;
- historial de transición de etapas;
- motivo de pérdida en clientes u oportunidades.

### Condominios

- fecha de inicio del servicio;
- responsable;
- ledger de honorarios generados y cobrados;
- relación entre honorarios y movimientos de caja.

### Gobierno

- moneda explícita en las tablas financieras;
- claves de deduplicación en movimientos;
- bitácora histórica de modificaciones;
- periodo conciliado y estado de cierre;
- catálogo único de personas, unidades y categorías financieras.

## Riesgos para el Centro de Inteligencia

1. La seguridad actual impide exponer nuevas vistas BI hasta corregir RLS.
2. Los saldos almacenados pueden diferir de sus movimientos detallados.
3. La identidad de asesores no es consistente.
4. Las dos tablas de propiedades no están relacionadas.
5. No existe trazabilidad completa entre generación, cobro y caja.
6. Varias fechas representan actualización técnica, no hecho económico.
7. La falta de historial impide reconstruir algunos estados pasados.
8. Los errores de columnas inexistentes son ignorados en varias consultas.

## Conclusión de V0-02

El esquema contiene las fuentes necesarias para comenzar la conciliación, pero
no es seguro construir vistas ejecutivas accesibles desde el cliente con las
políticas actuales.

Antes de crear migraciones se requiere:

1. aprobar una estrategia de RLS compatible con el sistema actual;
2. definir la fuente primaria de cada concepto financiero;
3. resolver o aceptar explícitamente las tres incompatibilidades confirmadas;
4. decidir cómo normalizar personas y propiedades sin alterar históricos.

V0-02 no realizó cambios en la base de datos.
