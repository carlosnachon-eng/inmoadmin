# V0-07 · Primera lectura BI para cierres y administración

Versión: 1.0  
Fecha: 26 de junio de 2026  
Estado: implementación inicial controlada

## 1. Objetivo

Crear una base técnica mínima para consultar y conciliar cierres y
administración desde una capa BI, sin modificar módulos operativos y sin crear
dashboard completo.

## 2. Alcance implementado

Incluido:

- Cierres.
- Administración.
- Ingreso generado.
- Cobrado.
- Pendiente reconstruido.
- Estado de confianza.
- Trazabilidad básica por tabla e ID origen.
- Endpoint interno protegido.

Excluido:

- Póliza jurídica.
- Mantenimiento.
- Condominios.
- Forecast.
- Snapshots.
- Dashboard completo.
- Migraciones.
- RLS, Storage o permisos de Supabase.

## 3. API creada

```text
GET /api/ejecutivo/bi-cierres-admin?year=2026&month=6
```

Opcional:

```text
GET /api/ejecutivo/bi-cierres-admin?year=2026&month=6&include=events
```

Requiere:

```text
Authorization: Bearer {access_token}
```

Roles permitidos:

- `admin`
- `direccion`
- correo de Dirección configurado como respaldo

## 4. Tablas leídas

| Tabla | Uso |
|---|---|
| `cierres` | Ingreso generado por comisión y pendiente base del cierre. |
| `cierre_pagos` | Cobrado por fecha real de pago y conciliación contra cierres. |
| `comisiones_admin` | Comisión administrativa generada, cobrada y pendiente. |
| `profiles` | Autorización del endpoint. |

No se escriben datos en ninguna tabla.

## 5. Métricas disponibles

### Cierres

| Métrica | Cálculo |
|---|---|
| `ingreso_generado` | Suma de `cierres.comision` con `fecha_cierre` dentro del periodo. |
| `cobrado` | Suma de `cierre_pagos.monto` con `fecha` dentro del periodo. |
| `pendiente_reconstruido` | Para cierres del periodo: `cierres.comision - suma(cierre_pagos.monto)` por cierre. |

Conciliación:

- Compara `cierres.cobrado` contra suma real de `cierre_pagos`.
- Compara `cierres.pendiente` contra pendiente reconstruido.
- Si hay diferencia, marca `requiere_conciliacion`.

### Administración

| Métrica | Cálculo |
|---|---|
| `ingreso_generado` | Suma de `comisiones_admin.monto` donde `periodo = YYYY-MM`. |
| `cobrado` | Suma de `comisiones_admin.monto` con `status = cobrada` y `fecha_cobro` dentro del periodo. |
| `pendiente_reconstruido` | Comisiones del periodo cuyo `status` no sea `cobrada`. |

Conciliación:

- Si una comisión aparece como cobrada pero no tiene `fecha_cobro`, marca
  estado `parcial`.
- En V0-07 no cruza todavía contra `cash_movements` para evitar mezclar
  evidencia de caja con ingreso propio.

## 6. Estado de confianza

| Estado | Uso |
|---|---|
| `calculable` | Fuentes suficientes y sin diferencias detectadas. |
| `parcial` | Faltan fechas o datos relevantes. |
| `requiere_conciliacion` | El resumen del sistema no coincide con el detalle reconstruido. |
| `no_disponible` | Reservado para futuras métricas sin fuente suficiente. |

## 7. Trazabilidad

Cada dominio devuelve:

- tablas fuente;
- uso de cada tabla;
- conteo de registros revisados;
- detalle de pendiente con:
  - `source_table`;
  - `source_id`;
  - `source_key`;
  - importes del sistema;
  - importes reconstruidos.

## 8. Cómo validar números

### Cierres

Para un mes:

1. Filtrar `cierres.fecha_cierre` dentro del periodo.
2. Sumar `cierres.comision`.
3. Filtrar `cierre_pagos.fecha` dentro del periodo.
4. Sumar `cierre_pagos.monto`.
5. Para cada cierre del periodo, sumar sus pagos en `cierre_pagos`.
6. Comparar:
   - `cierres.cobrado` vs suma de pagos;
   - `cierres.pendiente` vs `comision - pagos`.

### Administración

Para un mes:

1. Filtrar `comisiones_admin.periodo = YYYY-MM`.
2. Sumar `monto` para ingreso generado.
3. Filtrar `status = cobrada` y `fecha_cobro` dentro del periodo.
4. Sumar `monto` para cobrado.
5. Considerar pendiente toda comisión del periodo que no esté `cobrada`.

## 9. Decisiones importantes

- No se crearon vistas SQL todavía.
- No se crearon funciones SQL todavía.
- La primera “vista de dominio” vive en código como capa de lectura JS.
- Esto permite probar criterios antes de crear migraciones definitivas.
- El endpoint no reemplaza aún al dashboard ejecutivo existente.

## 10. Riesgos conocidos

| Riesgo | Tratamiento V0-07 |
|---|---|
| `cierres.cobrado` puede no coincidir con `cierre_pagos`. | Se marca `requiere_conciliacion`. |
| Administración puede tener cobros sin `fecha_cobro`. | Se marca `parcial`. |
| `periodo` debe estar en formato `YYYY-MM`. | Se documenta como supuesto operativo actual. |
| Pagos de cierre pueden corresponder a cierres de otro periodo. | Cobrado usa fecha real del pago; generado usa fecha del cierre. |
| Caja no equivale a ingreso. | No se cruza todavía con `cash_movements`. |

## 11. Siguiente paso recomendado

Validar manualmente varios meses contra el sistema actual antes de conectar
esta API a una pantalla.
