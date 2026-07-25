import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  assertAppliedMigrationUnchanged,
  migrationSha256,
} from "../../scripts/lib/demo-migration-integrity.mjs";

const appliedDemoHashes = Object.freeze({
  "supabase/demo-migrations/202607170000_condominios_demo_baseline.sql":
    "527798ca99c4369e8e1c115fe1eb3380d3a14b24c009e61b3d397079e3a3d23e",
  "supabase/demo-migrations/202607170002_condominios_demo_service_role.sql":
    "abdadfc5865a7b7eebdd606b12a49375a4516f6930f48a34ef5bdfd92abe9b9d",
  "supabase/demo-migrations/202607170004_condominios_demo_app_access.sql":
    "f325b52aa9acc8acdd0145aa99577353217f56013031cb048d4b4ab5428bd1ae",
  "supabase/demo-migrations/202607170005_condominios_demo_readonly_role.sql":
    "8bc1a8bf76d6f7c0830d2ac163c90cd79c775bf0aca48db10331f1314bf4fe15",
  "supabase/migrations/202607170001_condominios_p0_security.sql":
    "99d66bb6758968d654649b5aed6e617d058af19f65728877877dbb16ff3857f1",
  "supabase/migrations/202607170003_condominios_p0_tenant_scope.sql":
    "78ae034041ed18a539f2a801090f94a808e1ec375ba92bfd3045855b98d8fe81",
  "supabase/migrations/202607170006_condominios_p0_rate_limit_digest.sql":
    "dfed0bb487102ac479a9d570a7b0944e27f92c9274465b7c0cb58e6278cb237e",
});

test("las siete migraciones locales coinciden byte por byte con Demo", () => {
  for (const [filename, appliedHash] of Object.entries(appliedDemoHashes)) {
    const currentSql = fs.readFileSync(filename, "utf8");
    assert.equal(migrationSha256(currentSql), appliedHash, filename);
  }
});

test("un cambio de espacio o salto final continúa bloqueando", () => {
  const filename = Object.keys(appliedDemoHashes)[0];
  const currentSql = fs.readFileSync(filename, "utf8");
  assert.throws(() => assertAppliedMigrationUnchanged({
    filename,
    appliedHash: appliedDemoHashes[filename],
    currentSql: `${currentSql} `,
  }), /La migración aplicada cambió/);
});

test("cualquier cambio SQL funcional continúa bloqueando", () => {
  const filename = Object.keys(appliedDemoHashes)[0];
  const currentSql = fs.readFileSync(filename, "utf8");
  assert.throws(() => assertAppliedMigrationUnchanged({
    filename,
    appliedHash: appliedDemoHashes[filename],
    currentSql: currentSql.replace("begin;", "begin;\nselect 1;"),
  }), /La migración aplicada cambió/);
});

