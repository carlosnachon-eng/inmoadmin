-- Fase 2A - Dry-run solo lectura para confirmacion de citas.
-- No ejecutar como migracion. No modifica datos.

with normalizadas as (
  select
    id,
    estado,
    confirmacion_estado,
    case
      when confirmacion_estado in ('pendiente_confirmar', 'confirmada', 'cancelada', 'no_show', 'realizada')
        then confirmacion_estado
      when estado in ('efectiva', 'calificada', 'realizada') then 'realizada'
      when estado = 'cancelada' then 'cancelada'
      when estado = 'no_show' then 'no_show'
      when estado = 'confirmada' then 'confirmada'
      else 'pendiente_confirmar'
    end as lectura_compatible
  from public.citas
)
select
  lectura_compatible,
  count(*) as total
from normalizadas
group by lectura_compatible
order by lectura_compatible;

-- Valores de estado que no tienen mapeo explicito.
select
  estado,
  count(*) as total,
  min(id::text) as ejemplo_id
from public.citas
where estado is not null
  and estado not in ('efectiva', 'calificada', 'realizada', 'cancelada', 'no_show', 'confirmada')
group by estado
order by total desc, estado;
