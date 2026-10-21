-- DEV ONLY. Exercise effective RLS with PostgreSQL roles and simulated JWT claims.
begin;
create temporary table cierre251_principals as
select
 (select id from public.profiles where active and role_id='admin' and email='carlos.nachon@emporioinmobiliario.mx' limit 1) admin_id,
 (select email from public.profiles where active and role_id='admin' and email='carlos.nachon@emporioinmobiliario.mx' limit 1) admin_email,
 (select id from public.profiles where active and role_id<>'admin' order by id limit 1) advisor_id;
grant select on cierre251_principals to authenticated;
create function pg_temp.expect_denied(statement text) returns void language plpgsql as $$
declare actual text;
begin
 begin execute statement; exception when others then actual:=sqlstate; end;
 if actual is distinct from '42501' then raise exception 'expected permission denied, got %',actual;end if;
end $$;
do $$begin
 if (select admin_id is null or advisor_id is null from cierre251_principals) then raise exception 'dev_principals_missing';end if;
 if exists(select 1 from public.cierres where id=-251970) then raise exception 'fixture_collision';end if;
 insert into public.cierres(id,propiedad,comision,pendiente,anio,mes,fecha_cierre,operacion,origen)
 values(-251970,'DEV ISSUE251 RLS FIXTURE',1000,1000,2026,10,'2026-10-20','RENTA','manual');
end $$;
set local role authenticated;
do $$ declare claims text; affected bigint; begin
 select jsonb_build_object('sub',admin_id,'email',admin_email,'role','authenticated')::text into claims from cierre251_principals;
 perform set_config('request.jwt.claims',claims,true);
 perform set_config('request.jwt.claim.sub',(select admin_id::text from cierre251_principals),true);
 assert (select count(*)=1 from public.cierres where id=-251970),'admin_parent_visibility';
 insert into public.cierre_pagos(cierre_id,monto) values(-251970,10);
 update public.cierre_pagos set monto=20 where cierre_id=-251970;
 get diagnostics affected=row_count;assert affected=1,'admin_update';
 assert (select count(*)=1 from public.cierre_pagos where cierre_id=-251970 and monto=20),'admin_read';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select advisor_id from cierre251_principals),'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',(select advisor_id::text from cierre251_principals),true);
 perform pg_temp.expect_denied('insert into public.cierre_pagos(cierre_id,monto) values(-251970,99)');
 update public.cierre_pagos set monto=99 where cierre_id=-251970;
 get diagnostics affected=row_count;assert affected=0,'advisor_update';
 delete from public.cierre_pagos where cierre_id=-251970;
 get diagnostics affected=row_count;assert affected=0,'advisor_delete';
 perform pg_temp.expect_denied('truncate public.cierre_pagos');
end $$;
reset role;
do $$begin
 assert (select count(*)=1 from public.cierre_pagos where cierre_id=-251970 and monto=20),'fixture_payment_changed';
end $$;
set local role anon;
select pg_temp.expect_denied('select * from public.cierre_pagos');
select pg_temp.expect_denied('insert into public.cierre_pagos(cierre_id,monto) values(-251970,99)');
reset role;
select jsonb_build_object('result','PASS','admin_create_read_update',true,'advisor_write_denied',true,'anon_read_write_denied',true,'authenticated_truncate_denied',true,'authorization','sql_roles_and_claims_not_browser_auth','rollback_mandatory',true) result;
rollback;
