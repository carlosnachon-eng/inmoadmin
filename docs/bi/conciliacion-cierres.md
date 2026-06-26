# Conciliación de cierres

Ruta:

```text
/ejecutivo/conciliacion-cierres
```

## Objetivo

Detectar diferencias entre el cobrado registrado en `cierres` y el cobrado trazable en `cierre_pagos`.

La herramienta forma parte del Centro de Inteligencia Empresarial y sirve como control interno permanente para mejorar la calidad de la información financiera.

## Estados

- 🟢 **Conciliado**: `cierres.cobrado` coincide con `SUM(cierre_pagos.monto)`.
- 🟢 **Regularizable**: existe evidencia fuerte y el sistema puede crear un pago histórico de regularización.
- 🟡 **Revisión recomendada**: hay indicios, pero Dirección debe decidir manualmente.
- 🔴 **Sin evidencia**: no existe respaldo suficiente para regularizar automáticamente.
- ⚫ **Ignorado**: Dirección decidió conscientemente no corregir el caso; queda fuera de pendientes.

## Regularización automática

Solo se habilita cuando:

1. El cierre tiene diferencia positiva entre `cierres.cobrado` y `SUM(cierre_pagos.monto)`.
2. Existe `recibo_id` vinculado.
3. El recibo y sus abonos explican el cobrado del cierre.
4. Los componentes faltantes del recibo cuadran exactamente con la diferencia.
5. No existe ya una regularización histórica para esa evidencia.

Al confirmar, el sistema:

1. Crea un registro en `cierre_pagos`.
2. Usa `concepto = regularizacion_historica`.
3. Agrega notas con marcador, origen, evidencia, diferencia y usuario.
4. Recalcula `cierres.cobrado`.
5. Recalcula `cierres.pendiente`.
6. Actualiza `cobrado_bool`.
7. Registra evento en `recibos_log` cuando existe `recibo_id`.

## SQL opcional para persistir Ignorados

La conciliación y regularización funcionan sin esta tabla.

Esta tabla solo es necesaria para que el estado **Ignorado** quede persistido y auditado.

```sql
create table if not exists public.bi_conciliacion_ignorados (
  id uuid primary key default gen_random_uuid(),
  modulo text not null,
  entidad_tipo text not null,
  entidad_id text not null,
  motivo text not null,
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (modulo, entidad_tipo, entidad_id)
);

create index if not exists idx_bi_conciliacion_ignorados_modulo
  on public.bi_conciliacion_ignorados (modulo, entidad_tipo);
```

## Alcance actual

Implementado únicamente para cierres.

La estructura queda preparada para extender el mismo patrón a:

- Administración.
- Póliza Jurídica.
- Mantenimiento.
- Caja.
- Comisiones.
