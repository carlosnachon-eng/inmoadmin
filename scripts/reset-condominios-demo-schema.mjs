import pg from "pg";
import { validateDemoEnvironment } from "./lib/demo-environment-guard.mjs";

const config = validateDemoEnvironment(process.env, {
  operation: "rollback total de esquema demo P0.5",
  writeCapable: true,
});
const client = new pg.Client({
  connectionString: config.databaseUrl,
  application_name: "inmoadmin-condominios-demo-p05-reset",
  statement_timeout: 120_000,
  query_timeout: 120_000,
  ssl: { rejectUnauthorized: false },
});
try {
  await client.connect();
  await client.query("select set_config('app.settings.environment','demo',false)");
  await client.query("select set_config('app.settings.project_ref',$1,false)", [config.projectRef]);
  const identity = await client.query(`
    select
      current_setting('app.settings.environment', true) as environment,
      current_setting('app.settings.project_ref', true) as project_ref
  `);
  if (
    identity.rows[0].environment !== "demo"
    || identity.rows[0].project_ref !== "kmxzvcngfrzcasedtexw"
  ) {
    throw new Error("La sesión no corresponde al demo autorizado.");
  }
  await client.query(`
    do $$
    begin
      if current_setting('app.settings.environment', true) is distinct from 'demo'
         or current_setting('app.settings.project_ref', true) is distinct from 'kmxzvcngfrzcasedtexw' then
        raise exception 'OPERACIÓN CANCELADA: EL DESTINO NO ESTÁ CONFIRMADO COMO AMBIENTE DEMO.';
      end if;
    end
    $$;
    drop schema public cascade;
    create schema public authorization postgres;
    grant usage on schema public to postgres, anon, authenticated, service_role;
    grant all on schema public to postgres, service_role;
  `);
  console.log(JSON.stringify({
    ok: true,
    projectRef: config.projectRef,
    schemaReset: true,
    productionBlocked: true,
  }, null, 2));
} finally {
  await client.end().catch(() => {});
}
