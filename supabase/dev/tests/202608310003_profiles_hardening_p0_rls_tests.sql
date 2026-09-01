-- Prueba transaccional RLS directa. Usa únicamente perfiles sintéticos y hace ROLLBACK.
begin;
set local statement_timeout='60s';

insert into public.profiles(id,email,full_name,role,active,role_id)
values
  ('91000000-0000-4000-8000-000000000001','qa-internal-active@example.invalid','QA internal active','staff',true,'admin'),
  ('91000000-0000-4000-8000-000000000002','qa-internal-inactive@example.invalid','QA internal inactive','staff',false,'admin'),
  ('91000000-0000-4000-8000-000000000003','qa-owner-one@example.invalid','QA owner one','staff',true,'propietario'),
  ('91000000-0000-4000-8000-000000000004','qa-owner-two@example.invalid','QA owner two','staff',true,'propietario'),
  ('91000000-0000-4000-8000-000000000005','qa-antive@example.invalid','QA transition','staff',true,'antive_transition')
on conflict(id) do nothing;

set local role anon;
do $$
begin
  begin perform 1 from public.profiles limit 1; raise exception 'anon SELECT inesperado';
  exception when insufficient_privilege then null; end;
  begin insert into public.profiles(id) values('91000000-0000-4000-8000-000000000099'); raise exception 'anon INSERT inesperado';
  exception when insufficient_privilege then null; end;
  begin update public.profiles set active=active where false; raise exception 'anon UPDATE inesperado';
  exception when insufficient_privilege then null; end;
  begin delete from public.profiles where false; raise exception 'anon DELETE inesperado';
  exception when insufficient_privilege then null; end;
  begin truncate public.profiles; raise exception 'anon TRUNCATE inesperado';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.profiles;
  if v_count<>1 then raise exception 'propietario ve % perfiles; esperado 1',v_count; end if;
  if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'propietario no ve su perfil'; end if;
  begin update public.profiles set full_name=full_name where id=auth.uid(); raise exception 'propietario UPDATE inesperado';
  exception when insufficient_privilege then null; end;
  begin delete from public.profiles where id=auth.uid(); raise exception 'propietario DELETE inesperado';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000005',true);
set local role authenticated;
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.profiles;
  if v_count<>1 then raise exception 'Antive ve % perfiles; esperado 1',v_count; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.profiles;
  if v_count<5 then raise exception 'interno activo perdió directorio operativo'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.profiles;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='p0_inactive_profile_gate') then
    if v_count<>0 then raise exception 'interno inactivo no fue bloqueado por Phase 0'; end if;
  elsif v_count<>1 then
    raise exception 'interno inactivo debe ver como máximo su propia fila';
  end if;
end $$;
reset role;

set local role service_role;
update public.profiles set full_name=full_name where id='91000000-0000-4000-8000-000000000003';
do $$
begin
  begin insert into public.profiles(id) values('91000000-0000-4000-8000-000000000099'); raise exception 'service INSERT inesperado';
  exception when insufficient_privilege then null; end;
  begin delete from public.profiles where false; raise exception 'service DELETE inesperado';
  exception when insufficient_privilege then null; end;
  begin truncate public.profiles; raise exception 'service TRUNCATE inesperado';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'PROFILES_HARDENING_P0_RLS_TESTS_OK' as result;
rollback;
