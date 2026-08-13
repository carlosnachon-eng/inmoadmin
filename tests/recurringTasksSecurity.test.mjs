import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [api, workCenterApi, migration, page] = await Promise.all([
  read("../pages/api/operaciones/recurring-tasks.js"),
  read("../pages/api/operaciones/work-center.js"),
  read("../supabase/migrations/202608120001_fase_2a2a1_operational_recurring_tasks.sql"),
  read("../pages/operaciones/tareas-recurrentes.js"),
]);

test("el API autoriza antes de crear el cliente service_role", () => {
  const handler = api.slice(api.indexOf("export default async function handler"));
  assert.ok(handler.indexOf("await authorize(req)") < handler.indexOf("process.env.SUPABASE_SERVICE_ROLE_KEY"));
  assert.match(api, /if \(!profile\?\.active \|\| !isAdministrativeWorkCenterRole\(profile\.role_id\)\)/);
});

test("las mutaciones del módulo fuente pasan únicamente por RPC allowlisted", () => {
  assert.doesNotMatch(api, /\.(insert|update|upsert|delete)\s*\(/);
  for (const rpc of ["create", "edit", "suspend", "reactivate", "disable", "complete"]) {
    assert.match(api, new RegExp(`${rpc}: \\"[a-z_]+operational_recurring_task`));
  }
  assert.match(api, /auth\.authenticated\.rpc/);
});

test("Work Center y API no exponen evidence_storage_path", () => {
  const executionFields = api.slice(api.indexOf("const EXECUTION_FIELDS"), api.indexOf("function getClient"));
  assert.doesNotMatch(executionFields, /evidence_storage_path/);
  assert.doesNotMatch(workCenterApi, /evidence_storage_path/);
});

test("RPCs derivan actor de auth.uid y bloquean doble confirmación", () => {
  assert.ok((migration.match(/auth\.uid\(\)/g) || []).length >= 6);
  assert.doesNotMatch(migration, /p_actor|actor_profile_id/);
  assert.match(migration, /where id = p_task_id for update/);
  assert.match(migration, /expected_due_at desactualizado/);
  assert.match(migration, /unique \(task_id, scheduled_due_at\)/);
});

test("authenticated conserva SELECT directo y ejecuciones sin DML", () => {
  assert.match(migration, /revoke all on table public\.operational_recurring_task_executions from public, anon, authenticated/);
  assert.match(migration, /grant select on table public\.operational_recurring_task_executions to authenticated/);
  assert.doesNotMatch(migration, /create policy[\s\S]{0,120}for (insert|update|delete)/i);
});

test("completar no crea ni modifica tickets, pagos, caja o cuotas", () => {
  for (const forbidden of ["maintenance_tickets", "cash_movements", "owner_payments", "cuotas_condominio"]) {
    assert.doesNotMatch(migration, new RegExp(forbidden));
    assert.doesNotMatch(page, new RegExp(forbidden));
  }
});
