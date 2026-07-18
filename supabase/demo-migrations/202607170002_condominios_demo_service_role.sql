begin;

do $$
begin
  if current_setting('app.settings.environment', true) is distinct from 'demo'
     or current_setting('app.settings.project_ref', true) is distinct from 'kmxzvcngfrzcasedtexw' then
    raise exception 'OPERACIÓN CANCELADA: EL DESTINO NO ESTÁ CONFIRMADO COMO AMBIENTE DEMO.';
  end if;
end
$$;

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;

commit;
