import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { validateDemoEnvironment } from "./lib/demo-environment-guard.mjs";

const config = validateDemoEnvironment(process.env, {
  operation: "migraciones P0.5",
  writeCapable: true,
});

const migrationFiles = [
  "supabase/demo-migrations/202607170000_condominios_demo_baseline.sql",
  "supabase/migrations/202607170001_condominios_p0_security.sql",
  "supabase/demo-migrations/202607170002_condominios_demo_service_role.sql",
  "supabase/migrations/202607170003_condominios_p0_tenant_scope.sql",
  "supabase/demo-migrations/202607170004_condominios_demo_app_access.sql",
  "supabase/demo-migrations/202607170005_condominios_demo_readonly_role.sql",
  "supabase/migrations/202607170006_condominios_p0_rate_limit_digest.sql",
];

const client = new pg.Client({
  connectionString: config.databaseUrl,
  application_name: "inmoadmin-condominios-demo-p05",
  statement_timeout: 120_000,
  query_timeout: 120_000,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query("select set_config('app.settings.environment','demo',false)");
  await client.query(
    "select set_config('app.settings.project_ref',$1,false)",
    [config.projectRef],
  );
  const target = await client.query(`
    select
      current_database() as database_name,
      current_user as database_user,
      current_setting('app.settings.environment', true) as environment,
      current_setting('app.settings.project_ref', true) as project_ref
  `);
  const identity = target.rows[0];
  if (identity.environment !== "demo" || identity.project_ref !== config.projectRef) {
    throw new Error("La sesión Postgres no conservó la identidad demo esperada.");
  }
  console.log("[DEMO DB]", JSON.stringify({
    database: identity.database_name,
    user: identity.database_user,
    projectRef: identity.project_ref,
    productionBlocked: true,
  }));

  await client.query(`
    create table if not exists public.p05_demo_migration_history (
      filename text primary key,
      sha256 text not null,
      applied_at timestamptz not null default now(),
      project_ref text not null check (project_ref = 'kmxzvcngfrzcasedtexw')
    )
  `);

  for (const relativePath of migrationFiles) {
    const absolutePath = path.resolve(relativePath);
    const sql = await fs.readFile(absolutePath, "utf8");
    const sha256 = crypto.createHash("sha256").update(sql).digest("hex");
    const existing = await client.query(
      "select sha256 from public.p05_demo_migration_history where filename=$1",
      [relativePath],
    );
    if (existing.rowCount) {
      if (existing.rows[0].sha256 !== sha256) {
        throw new Error(`La migración aplicada cambió: ${relativePath}`);
      }
      console.log(`[DEMO MIGRATION] ya aplicada ${relativePath}`);
      continue;
    }
    console.log(`[DEMO MIGRATION] aplicando ${relativePath}`);
    await client.query(sql);
    await client.query(
      `insert into public.p05_demo_migration_history(filename,sha256,project_ref)
       values ($1,$2,$3)`,
      [relativePath, sha256, config.projectRef],
    );
    console.log(`[DEMO MIGRATION] aprobada ${relativePath}`);
  }
} finally {
  await client.end().catch(() => {});
}
