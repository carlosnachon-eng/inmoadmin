-- Preserve even zero-value historical payment rows after cancellation.
-- Existing cancellation eligibility and attribution controls stay intact.
create or replace function cierre_audit_private.guard_pago() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_estado text; v_cierre_id bigint;
begin
 if tg_op='UPDATE' and old.cierre_id is distinct from new.cierre_id then
  raise exception 'pago_cierre_inmutable';
 end if;
 if tg_op='DELETE' then v_cierre_id:=old.cierre_id;
 else v_cierre_id:=new.cierre_id; end if;
 select estado into v_estado from public.cierres where id=v_cierre_id for update;
 if v_estado='cancelado' then raise exception 'cierre_cancelado_no_admite_pagos'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
drop trigger cierre_pago_cancelacion_guard on public.cierre_pagos;
create trigger cierre_pago_cancelacion_guard before insert or update or delete on public.cierre_pagos
for each row execute function cierre_audit_private.guard_pago();
revoke all on function cierre_audit_private.guard_pago() from public,anon,authenticated,service_role;
