import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/202608190003_fase_2a_shadow_production_schema.sql", import.meta.url), "utf8");
const checks = await readFile(new URL("../supabase/production/tests/202608190003_fase_2a_shadow_production_schema_checks.sql", import.meta.url), "utf8");
const rollback = await readFile(new URL("../supabase/production/rollback/202608190003_fase_2a_shadow_production_schema_rollback.sql", import.meta.url), "utf8");

const tables = [
  "shadow_conversations", "shadow_messages", "shadow_ingestion_events",
  "shadow_context_matches", "shadow_context_query_audit", "shadow_human_evaluations",
  "shadow_ai_runs", "shadow_ai_decisions",
];

test("migración productiva crea exactamente el esquema Shadow final", () => {
  for (const table of tables) assert.match(migration, new RegExp(`create table public\\.${table} \\(`));
  assert.match(migration, /respond_admin/);
  assert.match(migration, /outbound_human/);
  assert.match(migration, /create function public\.ingest_shadow_message\(p_envelope jsonb, p_classification jsonb\)/);
  assert.match(migration, /production-migration:202608190003:fase-2a-shadow/);
  assert.doesNotMatch(migration, /FASE2A-(?:P0|QA)|insert into public\.(?!shadow_)/i);
});

test("seguridad productiva conserva RLS, roles y service_role server-side", () => {
  assert.match(migration, /alter table public\.%I enable row level security/);
  assert.match(migration, /revoke all on public\.%I from public, anon, authenticated/);
  assert.match(migration, /role_id in \('admin','coord_operaciones'\)/);
  assert.match(migration, /actor_profile_id = auth\.uid\(\)/);
  assert.match(migration, /revoke all on function public\.ingest_shadow_message\(jsonb,jsonb\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.ingest_shadow_message\(jsonb,jsonb\) to service_role/);
  assert.doesNotMatch(migration, /using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(migration, /payments|cash_movements|contracts|maintenance_tickets/);
});

test("checks exigen objetos vacíos y grants cerrados", () => {
  for (const table of tables) assert.match(checks, new RegExp(table));
  assert.match(checks, /Tabla % no está vacía/);
  assert.match(checks, /anon tiene acceso/);
  assert.match(checks, /Grants incorrectos en ingest_shadow_message/);
  assert.match(checks, /Provider respond_admin ausente/);
  assert.match(checks, /Dirección outbound_human ausente/);
});

test("rollback sólo elimina objetos propios y vacíos", () => {
  assert.match(rollback, /Ownership no comprobado/);
  assert.match(rollback, /Rollback bloqueado: % contiene datos/);
  for (const table of tables) assert.match(rollback, new RegExp(`drop table public\\.${table}`));
  assert.doesNotMatch(rollback, /cascade|truncate|delete from/i);
  assert.doesNotMatch(rollback, /drop extension|drop table public\.profiles/i);
});
