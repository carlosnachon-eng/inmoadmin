begin;

update public.roles
set descripcion = 'Coordinación administrativa y operativa'
where id = 'coord_operaciones'
  and descripcion is distinct from 'Coordinación administrativa y operativa';

commit;
