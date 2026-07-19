import fs from "node:fs/promises";
import path from "node:path";
import { validateDemoEnvironment } from "./lib/demo-environment-guard.mjs";

const config = validateDemoEnvironment(process.env, {
  operation: "preparación de runtime local aislado P0.5",
  writeCapable: false,
});
const source = process.cwd();
const target = "/private/tmp/inmoadmin-condominios-p05-runtime";
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });
const excluded = new Set([
  ".git",
  ".next",
  "node_modules",
  ".env.local",
  ".env.demo.local",
  ".env.development.local",
  ".env.production.local",
]);
await fs.cp(source, target, {
  recursive: true,
  filter: (entry) => {
    const relative = path.relative(source, entry);
    if (!relative) return true;
    return !excluded.has(relative.split(path.sep)[0]);
  },
});
await fs.symlink(path.join(source, "node_modules"), path.join(target, "node_modules"), "dir");

const runtimeEnv = [
  "APP_ENV=demo",
  "SUPABASE_ENVIRONMENT=demo",
  "NEXT_PUBLIC_APP_ENV=demo",
  "INMOADMIN_DEMO=true",
  "CONDOMINIOS_DEMO_CONFIRM=CREATE_FICTITIOUS_ONLY",
  `NEXT_PUBLIC_SUPABASE_URL=${config.url}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${config.anonKey}`,
  `SUPABASE_SERVICE_ROLE_KEY=${config.serviceRoleKey}`,
  "NEXT_PUBLIC_APP_URL=http://127.0.0.1:3105",
  `CONDOMINIOS_DEMO_PASSWORD=${process.env.CONDOMINIOS_DEMO_PASSWORD}`,
  `CONDOMINIOS_DEMO_TEST_EMAIL=${process.env.CONDOMINIOS_DEMO_TEST_EMAIL || ""}`,
  "CONDOMINIOS_AUDIT_SALT=p05-demo-only-not-production",
  "CONDOMINIOS_RECEIPT_SEND_ENABLED=false",
  "CONDOMINIOS_RECEIPT_BCC=",
  "",
].join("\n");
for (const name of [".env.development.local", ".env.production.local"]) {
  const file = path.join(target, name);
  await fs.writeFile(file, runtimeEnv, { mode: 0o600 });
  await fs.chmod(file, 0o600);
}
console.log(JSON.stringify({
  ok: true,
  runtime: target,
  projectRef: config.projectRef,
  productionEnvCopied: false,
  originalEnvLocalRead: false,
}, null, 2));
