# V0-08 · Pantalla mínima de validación BI

Versión: 1.0  
Fecha: 26 de junio de 2026  
URL: `/ejecutivo/bi-test`

## 1. Objetivo

Crear una pantalla temporal para validar que la capa BI de V0-07 funciona con
datos reales de cierres y administración.

No es dashboard final. No incluye gráficas, IA, forecast, póliza,
mantenimiento ni condominios.

## 2. Datos que consume

La pantalla consume:

```text
GET /api/ejecutivo/bi-cierres-admin?year={YYYY}&month={M}
```

El token de sesión se envía mediante:

```text
Authorization: Bearer {access_token}
```

## 3. Métricas mostradas

### Cierres

- Ingreso generado.
- Cobrado.
- Pendiente reconstruido.
- Estado de confianza.
- Trazabilidad y conciliación en JSON desplegable.

### Administración

- Ingreso generado.
- Cobrado.
- Pendiente reconstruido.
- Estado de confianza.
- Trazabilidad y conciliación en JSON desplegable.

### Global V0-08

- Ingreso generado total.
- Cobrado total.
- Pendiente reconstruido total.
- Estado de confianza global.
- Fecha y hora de generación de la API.
- Fecha y hora de última carga en pantalla.

## 4. Cómo validar números

### Cierres

1. Seleccionar año y mes en la pantalla.
2. En Supabase o en el sistema actual, filtrar `cierres.fecha_cierre` dentro
   del periodo.
3. Sumar `cierres.comision`.
4. Filtrar `cierre_pagos.fecha` dentro del mismo periodo.
5. Sumar `cierre_pagos.monto`.
6. Abrir “Ver trazabilidad y conciliación”.
7. Comparar por cierre:
   - `cobrado_sistema`;
   - `cobrado_reconstruido`;
   - `pendiente_sistema`;
   - `pendiente_reconstruido`.

### Administración

1. Seleccionar año y mes en la pantalla.
2. Filtrar `comisiones_admin.periodo = YYYY-MM`.
3. Sumar `monto` para ingreso generado.
4. Filtrar `comisiones_admin.status = cobrada` y `fecha_cobro` dentro del
   periodo.
5. Sumar `monto` para cobrado.
6. Abrir “Ver trazabilidad y conciliación” para revisar registros fuente.

## 5. Decisiones de alcance

- La página no se agregó al menú principal.
- La ruta es directa y experimental.
- El endpoint sigue protegiendo acceso por rol/token.
- La pantalla no modifica datos.
- La pantalla no reemplaza el dashboard ejecutivo actual.

## 6. Riesgos conocidos

| Riesgo | Tratamiento |
|---|---|
| Estado de confianza por métrica usa el estado de su unidad. | Aceptable en V0-08; en futuras versiones puede separarse por métrica. |
| Si el token expira, la pantalla mostrará error de sesión/API. | Recargar sesión entrando de nuevo a InmoAdmin. |
| Si hay diferencias entre campos resumen y detalle, aparece `requiere_conciliacion`. | Es esperado; sirve para detectar datos a revisar. |
| El rendimiento aún no está medido con muchos años/periodos amplios. | V0-08 solo consulta un mes a la vez. |

## 7. Próximo paso recomendado

Validar manualmente varios meses. Si los números coinciden, la siguiente tarea
debería ser agregar drill-down más legible o conectar esta lectura a una
primera sección formal del Centro de Inteligencia.
