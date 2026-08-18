import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/202608180001_fase_1_administrative_case_supervision.sql", import.meta.url), "utf8");

test("supervisión tiene RLS, escritura por RPC y sin políticas abiertas", () => {
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all .* authenticated/);
  assert.match(migration, /security definer/);
  assert.doesNotMatch(migration, /using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
});

test("frontera de seguridad excluye autonomía y acciones financieras", () => {
  assert.match(migration, /autonomy_mode text not null default 'manual'/);
  assert.match(migration, /'manual','supervisado','automatico'/);
  assert.doesNotMatch(migration, /p_autonomy_mode/);
  for (const forbidden of ["transferencia_ejecutada", "devolucion_autorizada", "contrato_modificado", "negociacion_aceptada"]) {
    assert.doesNotMatch(migration, new RegExp(forbidden));
  }
  assert.match(migration, /actor_type in \('system','ai','human'\)/);
});
