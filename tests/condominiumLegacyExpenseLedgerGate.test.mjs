import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveLegacyExpenseGate } from "../lib/condominios/legacyExpenseGate.mjs";

const page = readFileSync(new URL("../pages/condominio/[id].js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260924152734_condominium_legacy_expense_ledger_gate_hotfix.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../supabase/production/rollback/20260924152734_condominium_legacy_expense_ledger_gate_hotfix_rollback.sql", import.meta.url), "utf8");
const devTests = readFileSync(new URL("../supabase/dev/tests/20260924152734_condominium_legacy_expense_ledger_gate_hotfix_tests.sql", import.meta.url), "utf8");

test("ausencia de fila equivale a ledger inactivo y habilita gastos legacy", () => {
  assert.deepEqual(resolveLegacyExpenseGate(null), { loaded: true, enabled: true, ledgerEnabled: false, reason: null });
});

test("ledger activo y errores de lectura fallan cerrado", () => {
  assert.equal(resolveLegacyExpenseGate({ ledger_enabled: true }).enabled, false);
  assert.equal(resolveLegacyExpenseGate(null, new Error("network")).enabled, false);
});

test("la UI usa ledger_enabled y no money_movements_enabled para gastos", () => {
  assert.match(page, /from\("condominium_financial_controls"\)\.select\("ledger_enabled"\)/);
  assert.match(page, /disabled=\{!legacyExpenseGate\.enabled\}/);
  const expenseSection = page.slice(page.indexOf("const guardarGasto"), page.indexOf("const guardarTicket"));
  assert.doesNotMatch(expenseSection, /moneyMovementsEnabled/);
  assert.match(expenseSection, /expenseError\.code === "55000"/);
});

test("el guard SQL sólo bloquea el flujo legacy cuando el ledger está activo", () => {
  assert.match(migration, /condominium_financial_controls/);
  assert.match(migration, /coalesce\(c\.ledger_enabled, false\)/);
  assert.match(migration, /LEGACY_EXPENSE_BLOCKED_LEDGER_ACTIVE/);
  assert.doesNotMatch(migration.slice(migration.indexOf("create or replace function")), /money_movements_enabled/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke all on function public\.condominium_expense_operation_guard\(\) from public, anon, authenticated/);
});

test("el rollback restaura exactamente el gate legacy anterior", () => {
  assert.match(rollback, /money_movements_enabled/);
  assert.match(rollback, /Los gastos y movimientos reales están bloqueados durante preimplementación/);
  assert.doesNotMatch(rollback, /drop table|delete from|truncate/i);
});

test("DEV cubre permisos, ledger ON/OFF y preservación de gastos", () => {
  assert.match(devTests, /money_movements_enabled\)\s*values\([^;]+false\)/s);
  assert.match(devTests, /TEST_LEDGER_OFF_EDITOR_NOT_ALLOWED/);
  assert.match(devTests, /TEST_READONLY_ALLOWED/);
  assert.match(devTests, /TEST_OWNER_ALLOWED/);
  assert.match(devTests, /TEST_ANTIVE_ALLOWED/);
  assert.match(devTests, /TEST_ANON_ALLOWED/);
  assert.match(devTests, /TEST_LEDGER_ON_ALLOWED/);
  assert.match(devTests, /TEST_EXISTING_EXPENSES_CHANGED/);
  assert.match(devTests, /rollback;/);
});
