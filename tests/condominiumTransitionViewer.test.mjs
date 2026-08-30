import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { activeTransitionMembership, buildTransitionViewerSummary, TRANSITION_VIEWER_ROLE } from "../lib/condominios/transitionViewer.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migration = await read("../supabase/migrations/202608300001_condominium_transition_viewer.sql");
const rollback = await read("../supabase/production/rollback/202608300001_condominium_transition_viewer_rollback.sql");
const page = await read("../pages/antive-transicion.js");
const home = await read("../pages/index.js");
const layout = await read("../components/Layout.js");
const rlsTests = await read("../supabase/dev/tests/202608300001_condominium_transition_viewer_rls_tests.sql");

test("rol externo es específico, temporal y nunca obtiene edición", () => {
  assert.equal(TRANSITION_VIEWER_ROLE, "antive_transition");
  assert.match(migration, /Antive — Transición \/ Consulta/);
  assert.match(migration, /p\.role_id='antive_transition'/);
  assert.match(migration, /m\.access_role='transition_viewer'/);
  assert.match(migration, /m\.can_edit_transition=false/);
  assert.match(migration, /m\.expires_at is null or m\.expires_at>now\(\)/);
  assert.doesNotMatch(migration, /insert into public\.profiles|insert into auth\.users|@gmail|@hotmail/i);
});

test("sólo agrega SELECT a los cuatro objetos faltantes", () => {
  for (const policy of ["cuotas_transition_viewer_select", "historical_recoveries_transition_viewer_select", "maintenance_transition_viewer_select", "operation_controls_transition_viewer_select"]) {
    assert.match(migration, new RegExp(`create policy ${policy}`));
  }
  assert.doesNotMatch(migration, /create policy[\s\S]{0,100}for (?:insert|update|delete|all)/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)/i);
});

test("membresía inactiva o expirada se rechaza", () => {
  const valid = { access_role: "transition_viewer", active: true, expires_at: "2099-01-01T00:00:00Z" };
  assert.equal(activeTransitionMembership(valid, new Date("2026-09-01T00:00:00Z")), true);
  assert.equal(activeTransitionMembership({ ...valid, active: false }, new Date("2026-09-01T00:00:00Z")), false);
  assert.equal(activeTransitionMembership({ ...valid, expires_at: "2026-08-01T00:00:00Z" }, new Date("2026-09-01T00:00:00Z")), false);
});

test("KPI separa cobranza corriente de recuperación histórica", () => {
  const result = buildTransitionViewerSummary({
    units: [{ id: "u1" }],
    fees: [{ monto: 500, status: "pagado" }, { monto: 500, status: "pendiente" }],
    historicalAccounts: [{ reported_balance: 9000 }],
    recoveries: [{ amount: 2000, status: "APLICADO" }, { amount: 1000, status: "PENDIENTE_APLICACION" }],
  });
  assert.deepEqual(result, { unitCount: 1, currentIssued: 1000, currentCollected: 500, currentPending: 500, currentCollectionRate: .5, historicalInitial: 9000, historicalRecovered: 2000, historicalPending: 7000 });
});

test("experiencia externa usa OTP preexistente y nunca el dashboard interno", () => {
  assert.match(page, /shouldCreateUser: false/);
  assert.match(page, /emailRedirectTo: `\$\{window\.location\.origin\}\/antive-transicion`/);
  assert.match(page, /profile\.role_id !== TRANSITION_VIEWER_ROLE/);
  assert.match(page, /can_edit_transition/);
  assert.match(home, /perfilAntiveActivo[\s\S]*window\.location\.replace\("\/antive-transicion"\)/);
  assert.match(layout, /esAntiveTransicion[\s\S]*router\.replace\("\/antive-transicion"\)/);
  assert.match(layout, /if \(esAntiveTransicion\) return null/);
  assert.doesNotMatch(page, /Layout|\/coordinador-ia-sombra|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_SERVICE_ROLE/);
});

test("UI consulta campos mínimos, omite PII/evidencia y no contiene mutaciones", () => {
  for (const table of ["condominios", "unidades_condominio", "cuotas_condominio", "condominium_historical_accounts", "condominium_historical_payments", "condominium_historical_recoveries", "condominium_provider_preparations", "condominium_transition_items", "maintenance_tickets", "condominium_operation_controls"]) assert.match(page, new RegExp(`from\\(\"${table}\"\\)`));
  assert.doesNotMatch(page, /propietario_email|residente_email|telefono|evidence_path|source_reference|notes/);
  assert.doesNotMatch(page, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|fetch\(\s*["'`]\/api\//);
  assert.match(page, /Vista externa · sólo consulta/);
});

test("rollback conserva auditoría si ya existe un perfil real", () => {
  assert.match(rollback, /ROLLBACK ABORTADO: existen perfiles Antive/);
  assert.doesNotMatch(rollback, /delete from public\.profiles|delete from auth\.users/i);
});

test("pruebas SQL cubren aislamiento, denegación DML, expiración y Tecaxco", () => {
  for (const phrase of ["otro tenant", "INSERT de cuota", "UPDATE de cuota", "DELETE de cuota", "membresía expirada", "Tecaxco"] ) assert.match(rlsTests, new RegExp(phrase, "i"));
  assert.match(rlsTests, /rollback;/);
});
