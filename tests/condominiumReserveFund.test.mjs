import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  MAX_RESERVE_FUND_EVIDENCE_BYTES,
  RESERVE_FUND_EVIDENCE_BUCKET,
  reserveFundErrorCode,
  reserveFundEvidencePath,
  validateReserveFundCreateInput,
} from "../lib/condominios/reserveFund.mjs";
import { buildHistoricalPortfolio } from "../lib/condominios/historicalPortfolio.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migration = await read("../supabase/migrations/202609010002_condominium_reserve_fund_contributions.sql");
const rollback = await read("../supabase/production/rollback/202609010002_condominium_reserve_fund_contributions_rollback.sql");
const productionChecks = await read("../supabase/production/tests/202609010002_condominium_reserve_fund_contributions_checks.sql");
const endpoint = await read("../pages/api/condominios/reserve-fund.js");
const adminPage = await read("../pages/condominio/[id].js");
const ownerPortal = await read("../components/condomino/ControlledCondominoPortal.js");
const transitionView = await read("../pages/antive-transicion.js");

const ids = {
  condo: "11111111-1111-4111-8111-111111111111",
  unit: "22222222-2222-4222-8222-222222222222",
  contribution: "33333333-3333-4333-8333-333333333333",
};

const validPayload = {
  condominioId: ids.condo,
  unidadId: ids.unit,
  idempotencyKey: ids.contribution,
  amount: 500,
  sourceOrganization: "ANTIVE",
  paymentReference: "FONDO-RESERVA-A01",
  proofDate: "2026-09-01",
  evidence: {
    mimeType: "application/pdf",
    base64: Buffer.from("%PDF-1.4 evidencia sintetica").toString("base64"),
  },
};

test("valida alcance, importe, origen, referencia y evidencia antes del backend", () => {
  assert.equal(validateReserveFundCreateInput(validPayload), null);
  assert.equal(validateReserveFundCreateInput({ ...validPayload, amount: 0 }), "INVALID_AMOUNT");
  assert.equal(validateReserveFundCreateInput({ ...validPayload, sourceOrganization: "" }), "INVALID_SOURCE");
  assert.equal(validateReserveFundCreateInput({ ...validPayload, paymentReference: "x" }), "INVALID_REFERENCE");
  assert.equal(validateReserveFundCreateInput({ ...validPayload, evidence: { mimeType: "text/html", base64: "WA==" } }), "INVALID_EVIDENCE_TYPE");
  assert.equal(MAX_RESERVE_FUND_EVIDENCE_BYTES, 5 * 1024 * 1024);
});

test("la ruta de evidencia es privada, tenant-scoped y no contiene PII", () => {
  const path = reserveFundEvidencePath({
    condominioId: ids.condo,
    unidadId: ids.unit,
    contributionId: ids.contribution,
    mimeType: "application/pdf",
  });
  assert.equal(path, `${ids.condo}/${ids.unit}/${ids.contribution}.pdf`);
  assert.doesNotMatch(path, /https?:|@|nombre|telefono/i);
  assert.equal(RESERVE_FUND_EVIDENCE_BUCKET, "condominium-reserve-fund-evidence");
});

test("el modelo es independiente de cuotas, históricos, recuperaciones y gastos", () => {
  const createTable = migration.match(/create table public\.condominium_reserve_fund_contributions[\s\S]+?\n\);/)?.[0] || "";
  for (const field of [
    "condominio_id", "unidad_id", "amount", "source_organization", "proof_date",
    "deposit_date", "payment_reference", "evidence_path", "status", "bank_confirmed_by", "reconciled_by",
    "reconciled_at", "idempotency_key",
  ]) assert.match(createTable, new RegExp(`\\b${field}\\b`));
  assert.match(createTable, /status in \('pending','reconciled','reversed'\)/);
  assert.doesNotMatch(createTable, /cuotas_condominio|historical_accounts|historical_recoveries|gastos_condominio/);

  const portfolio = buildHistoricalPortfolio({
    units: [{ id: ids.unit, numero: "A-01" }],
    accounts: [{ id: "account", unidad_id: ids.unit, reported_charges: 1000, reported_payments: 0, reported_balance: 1000 }],
    historicalRecoveries: [],
    currentFees: [{ id: "fee", unidad_id: ids.unit, monto: 500, status: "pendiente" }],
  });
  assert.equal(portfolio.totals.historicalPending, 1000);
  assert.equal(portfolio.totals.currentPending, 500);
  assert.equal(portfolio.totals.currentCollectionRate, 0);
});

test("la base previene duplicados, borrado y transiciones inválidas", () => {
  assert.match(migration, /unique \(condominio_id, idempotency_key\)/);
  assert.match(migration, /unique \(condominio_id, evidence_sha256\)/);
  assert.match(migration, /Las aportaciones al Fondo de Reserva no pueden eliminarse/);
  assert.match(migration, /old\.status = 'pending' and new\.status = 'reconciled'/);
  assert.match(migration, /old\.status = 'reconciled' and new\.status = 'reversed'/);
  assert.match(migration, /for update/);
});

test("conciliación y reversa sólo cambian el registro independiente", () => {
  const reconcile = migration.match(/create function public\.condominium_reconcile_reserve_fund_contribution[\s\S]+?create function public\.condominium_reverse_reserve_fund_contribution/)?.[0] || "";
  const reverse = migration.match(/create function public\.condominium_reverse_reserve_fund_contribution[\s\S]+?alter table public\.condominium_reserve_fund_contributions enable row level security/)?.[0] || "";
  assert.match(reconcile, /set status = 'reconciled'/);
  assert.match(reconcile, /deposit_date = p_deposit_date/);
  assert.match(reverse, /set status = 'reversed'/);
  for (const sql of [reconcile, reverse]) {
    assert.doesNotMatch(sql, /update public\.(cuotas_condominio|condominium_historical|gastos_condominio)/);
  }
});

test("RLS limita lectura a personal interno y no concede DML directo", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /for select\s+to authenticated\s+using \(public\.condominium_internal_permission\('condominios', false\)\)/);
  assert.match(migration, /revoke all on table public\.condominium_reserve_fund_contributions from public, anon, authenticated, service_role/);
  assert.match(migration, /grant select on table public\.condominium_reserve_fund_contributions to authenticated, service_role/);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all) on table public\.condominium_reserve_fund_contributions/i);
  assert.doesNotMatch(migration, /create policy[\s\S]+for (insert|update|delete|all)/i);
});

test("las escrituras usan RPC con sesión y service role queda server-side", () => {
  assert.match(endpoint, /operatorDb\.rpc\("condominium_create_reserve_fund_contribution"/);
  assert.match(endpoint, /operatorDb\.rpc\("condominium_reconcile_reserve_fund_contribution"/);
  assert.match(endpoint, /operatorDb\.rpc\("condominium_reverse_reserve_fund_contribution"/);
  assert.match(endpoint, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(endpoint, /serviceDb\.storage/);
  assert.doesNotMatch(adminPage, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
  assert.doesNotMatch(endpoint, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE/);
});

test("la evidencia es privada y sólo se consulta con URL firmada breve", () => {
  assert.match(migration, /'condominium-reserve-fund-evidence'[\s\S]+false/);
  assert.doesNotMatch(migration, /create policy[\s\S]+storage\.objects/i);
  assert.match(endpoint, /createSignedUrl\(scope\.data\.evidence_path, 60\)/);
  assert.match(endpoint, /loadScopedContribution/);
  assert.doesNotMatch(ownerPortal, /condominium_reserve_fund|reserve.fund|Fondo de Reserva/i);
  assert.doesNotMatch(transitionView, /condominium_reserve_fund|reserve.fund|Fondo de Reserva/i);
});

test("la UI crea una sección separada con flujo pendiente, conciliado y reversado", () => {
  for (const label of [
    "FONDO DE RESERVA", "Aportaciones independientes", "Registrar aportación",
    "Pendiente de conciliación", "Conciliar aportación", "Revertir aportación",
  ]) assert.match(adminPage, new RegExp(label, "i"));
  assert.match(adminPage, /No forman parte de cuotas de mantenimiento, cartera histórica, recuperaciones, gastos ni KPI de cobranza/);
  assert.match(adminPage, /from\("condominium_reserve_fund_contributions"\)\.select/);
  assert.doesNotMatch(adminPage, /from\("condominium_reserve_fund_contributions"\)[\s\S]{0,200}\.(?:insert|update|delete)\(/);
});

test("los errores técnicos se convierten en estados controlados", () => {
  assert.equal(reserveFundErrorCode({ code: "42501" }), "OPERATION_NOT_ALLOWED");
  assert.equal(reserveFundErrorCode({ code: "23505" }), "DUPLICATE_CONTRIBUTION");
  assert.equal(reserveFundErrorCode({ message: "La aportación ya no está pendiente." }), "CONTRIBUTION_NOT_PENDING");
  assert.doesNotMatch(endpoint, /res\.status\([^)]*\)\.json\([^)]*error/i);
});

test("rollback y postcheck no destruyen actividad real ni importan las 13 aportaciones", () => {
  assert.match(rollback, /ROLLBACK ABORTADO: existen aportaciones al Fondo de Reserva/);
  assert.match(rollback, /ROLLBACK ABORTADO: existe evidencia privada/);
  assert.doesNotMatch(rollback, /delete from|truncate/i);
  assert.match(productionChecks, /condominium_reserve_fund_contributions/);
  assert.equal((migration.match(/insert into public\.condominium_reserve_fund_contributions/gi) || []).length, 1);
  assert.doesNotMatch(migration, /6500|13 unidades|A-0[1-9]|B-\d|C-\d/i);
});
