-- DEV: pruebas transaccionales; no persisten gastos, perfiles ni controles.
begin;
set local statement_timeout = '60s';

insert into public.condominios(id,nombre,direccion,total_unidades,cuota_mensual,honorarios_emporio,activo,notas)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01','QA_ONLY_LEGACY_EXPENSE_CONDO','QA only',1,0,0,true,'QA rollback transaction');

insert into public.condominium_operation_controls(condominio_id,money_movements_enabled)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',false);

insert into public.condominium_financial_controls(condominio_id, ledger_enabled)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',false);

create temporary table legacy_expense_test_scope on commit drop as
select 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01'::uuid as condominio_id;
grant select on legacy_expense_test_scope to authenticated, anon;

do $$ begin
  if (select count(*) from legacy_expense_test_scope) <> 1 then
    raise exception 'TEST_REQUIRES_LEDGER_OFF_MONEY_MOVEMENTS_OFF_CONDOMINIUM';
  end if;
  if exists(select 1 from public.condominium_financial_controls where ledger_enabled) then
    raise exception 'TEST_REAL_LEDGER_ALREADY_ENABLED';
  end if;
end $$;

create temporary table legacy_expense_before on commit drop as
select count(*)::bigint as row_count,
       md5(coalesce(string_agg(row_to_json(g)::text, '|' order by g.id::text), '')) as fingerprint
from public.gastos_condominio g;

insert into public.roles(id,nombre,descripcion,es_externo)
values('antive_transition','Antive QA','Rol externo sintético transaccional',true)
on conflict(id) do nothing;

insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values
('ffffffff-ffff-4fff-8fff-ffffffffe101','legacy.expense.admin@example.invalid','{}'::jsonb,'{}'::jsonb,now(),now()),
('ffffffff-ffff-4fff-8fff-ffffffffe102','legacy.expense.readonly@example.invalid','{}'::jsonb,'{}'::jsonb,now(),now()),
('ffffffff-ffff-4fff-8fff-ffffffffe103','legacy.expense.owner@example.invalid','{"rol_pretendido":"propietario"}'::jsonb,'{}'::jsonb,now(),now()),
('ffffffff-ffff-4fff-8fff-ffffffffe104','legacy.expense.antive@example.invalid','{}'::jsonb,'{}'::jsonb,now(),now());

update public.profiles set role_id='admin',active=true where id='ffffffff-ffff-4fff-8fff-ffffffffe101';
update public.profiles set role_id='asesor',active=true where id='ffffffff-ffff-4fff-8fff-ffffffffe102';
update public.profiles set role_id='propietario',active=true where id='ffffffff-ffff-4fff-8fff-ffffffffe103';
update public.profiles set role_id='antive_transition',active=true where id='ffffffff-ffff-4fff-8fff-ffffffffe104';

-- ledger OFF + interno con edición: permitido aunque money_movements_enabled=false.
select set_config('request.jwt.claims',jsonb_build_object('sub','ffffffff-ffff-4fff-8fff-ffffffffe101','email','legacy.expense.admin@example.invalid','role','authenticated')::text,true);
set local role authenticated;
insert into public.gastos_condominio(condominio_id,concepto,categoria,monto,fecha,notas)
select condominio_id,'QA_ONLY_LEGACY_EXPENSE_GATE','mantenimiento',1,current_date,'QA rollback transaction'
from legacy_expense_test_scope;
do $$ begin
  if (select count(*) from public.gastos_condominio where concepto='QA_ONLY_LEGACY_EXPENSE_GATE')<>1 then
    raise exception 'TEST_LEDGER_OFF_EDITOR_NOT_ALLOWED';
  end if;
end $$;
delete from public.gastos_condominio where concepto='QA_ONLY_LEGACY_EXPENSE_GATE';
reset role;

-- Interno sin edición, propietario y Antive: RLS impide INSERT.
select set_config('request.jwt.claims',jsonb_build_object('sub','ffffffff-ffff-4fff-8fff-ffffffffe102','role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  begin
    insert into public.gastos_condominio(condominio_id,concepto,categoria,monto,fecha)
    select condominio_id,'QA_ONLY_READONLY_EXPENSE','mantenimiento',1,current_date from legacy_expense_test_scope;
    raise exception 'TEST_READONLY_ALLOWED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub','ffffffff-ffff-4fff-8fff-ffffffffe103','role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  begin
    insert into public.gastos_condominio(condominio_id,concepto,categoria,monto,fecha)
    select condominio_id,'QA_ONLY_OWNER_EXPENSE','mantenimiento',1,current_date from legacy_expense_test_scope;
    raise exception 'TEST_OWNER_ALLOWED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub','ffffffff-ffff-4fff-8fff-ffffffffe104','role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  begin
    insert into public.gastos_condominio(condominio_id,concepto,categoria,monto,fecha)
    select condominio_id,'QA_ONLY_ANTIVE_EXPENSE','mantenimiento',1,current_date from legacy_expense_test_scope;
    raise exception 'TEST_ANTIVE_ALLOWED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- anon: sin grant/policy de escritura.
set local role anon;
do $$ begin
  begin
    insert into public.gastos_condominio(condominio_id,concepto,categoria,monto,fecha)
    select condominio_id,'QA_ONLY_ANON_EXPENSE','mantenimiento',1,current_date
    from legacy_expense_test_scope;
    raise exception 'TEST_ANON_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ledger ON bloquea incluso al administrador autorizado por RLS.
update public.condominium_financial_controls
set ledger_enabled=true,activated_at=now(),activated_by='ffffffff-ffff-4fff-8fff-ffffffffe101'
where condominio_id=(select condominio_id from legacy_expense_test_scope);
select set_config('request.jwt.claims',jsonb_build_object('sub','ffffffff-ffff-4fff-8fff-ffffffffe101','role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  begin
    insert into public.gastos_condominio(condominio_id,concepto,categoria,monto,fecha)
    select condominio_id,'QA_ONLY_LEDGER_ON_EXPENSE','mantenimiento',1,current_date
    from legacy_expense_test_scope;
    raise exception 'TEST_LEDGER_ON_ALLOWED';
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'LEGACY_EXPENSE_BLOCKED_LEDGER_ACTIVE' then raise; end if;
  end;
end $$;
reset role;

update public.condominium_financial_controls
set ledger_enabled=false,activated_at=null,activated_by=null
where condominio_id=(select condominio_id from legacy_expense_test_scope);

do $$
declare after_count bigint; after_fingerprint text;
begin
  select count(*)::bigint,
         md5(coalesce(string_agg(row_to_json(g)::text, '|' order by g.id::text), ''))
  into after_count,after_fingerprint
  from public.gastos_condominio g;
  if (select row_count from legacy_expense_before)<>after_count
     or (select fingerprint from legacy_expense_before) is distinct from after_fingerprint then
    raise exception 'TEST_EXISTING_EXPENSES_CHANGED';
  end if;
  if exists(select 1 from public.gastos_condominio where concepto like 'QA_ONLY_%') then
    raise exception 'TEST_QA_EXPENSE_RESIDUE';
  end if;
end $$;

select 'CONDOMINIUM_LEGACY_EXPENSE_LEDGER_GATE_TESTS_OK' as result;
rollback;
