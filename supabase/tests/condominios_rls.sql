-- Ejecutar sólo en Supabase demo después de aplicar la migración P0.
begin;

do $$
begin
  if current_setting('app.settings.project_ref', true) = 'bnzrnizrmonjxlktbhlp' then
    raise exception 'Prueba RLS bloqueada en producción';
  end if;
end
$$;

insert into auth.users(id,email,instance_id,aud,role,encrypted_password,email_confirmed_at,created_at,updated_at)
values
  ('10000000-0000-4000-8000-000000000001','rls-a@example.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated','',now(),now(),now()),
  ('10000000-0000-4000-8000-000000000002','rls-b@example.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated','',now(),now(),now())
on conflict (id) do nothing;

insert into public.condominios(id,nombre,total_unidades,cuota_mensual,honorarios_emporio,activo)
values
  ('20000000-0000-4000-8000-000000000001','RLS A',1,1000,100,true),
  ('20000000-0000-4000-8000-000000000002','RLS B',1,1000,100,true);
insert into public.unidades_condominio(id,condominio_id,numero,activo)
values
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','A-1',true),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','B-1',true);
insert into public.condominio_miembros(user_id,condominio_id,unidad_id,rol)
values
  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','condomino'),
  ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',null,'comite');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);

do $$
begin
  if (select count(*) from public.condominios) <> 1 then raise exception 'FAIL: aislamiento condominio'; end if;
  if exists(select 1 from public.condominios where id='20000000-0000-4000-8000-000000000002') then raise exception 'FAIL: cruce de tenant'; end if;
  if exists(select 1 from public.unidades_condominio where id='30000000-0000-4000-8000-000000000002') then raise exception 'FAIL: cruce de unidad'; end if;
  begin
    insert into public.cuotas_condominio(condominio_id,unidad_id,periodo,monto,status)
    values ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-07',1000,'pendiente');
    raise exception 'FAIL: escritura financiera directa permitida';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
rollback;
