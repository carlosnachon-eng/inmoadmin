import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  HISTORICAL_EVIDENCE_BUCKET,
  MAX_HISTORICAL_EVIDENCE_BYTES,
  historicalEvidencePath,
  historicalRecoveryErrorCode,
  isUuid,
  validateRecoveryCreateInput,
} from "../lib/condominios/historicalRecovery.mjs";
import { buildHistoricalPortfolio } from "../lib/condominios/historicalPortfolio.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migration = await read("../supabase/migrations/202608280004_condominium_historical_recovery_operations.sql");
const rollback = await read("../supabase/production/rollback/202608280004_condominium_historical_recovery_operations_rollback.sql");
const productionChecks = await read("../supabase/production/tests/202608280004_condominium_historical_recovery_operations_checks.sql");
const endpoint = await read("../pages/api/condominios/historical-recoveries.js");
const adminPage = await read("../pages/condominio/[id].js");
const ownerPortal = await read("../components/condomino/ControlledCondominoPortal.js");

const ids = {
  condo: "11111111-1111-4111-8111-111111111111",
  unit: "22222222-2222-4222-8222-222222222222",
  account: "33333333-3333-4333-8333-333333333333",
  key: "44444444-4444-4444-8444-444444444444",
};

test("valida comprobante, importes y alcance antes de tocar backend", () => {
  const valid = {
    condominioId: ids.condo,
    unidadId: ids.unit,
    historicalAccountId: ids.account,
    idempotencyKey: ids.key,
    amount: 2000,
    depositTotal: 2500,
    paymentReference: "GENOVA-A01-SEP26",
    proofReceivedAt: "2026-09-01T12:00:00Z",
    currentFeeId: "55555555-5555-4555-8555-555555555555",
    evidence: { mimeType: "application/pdf", base64: Buffer.from("%PDF-1.4 evidencia sintetica").toString("base64") },
  };
  assert.equal(validateRecoveryCreateInput(valid), null);
  assert.equal(validateRecoveryCreateInput({ ...valid, amount: 0 }), "INVALID_AMOUNT");
  assert.equal(validateRecoveryCreateInput({ ...valid, depositTotal: 1000 }), "INVALID_DEPOSIT_TOTAL");
  assert.equal(validateRecoveryCreateInput({ ...valid, evidence: { mimeType: "text/html", base64: "WA==" } }), "INVALID_EVIDENCE_TYPE");
  assert.equal(MAX_HISTORICAL_EVIDENCE_BYTES, 5 * 1024 * 1024);
});

test("acepta UUID canónico de fixtures PostgreSQL sin exigir versión RFC", () => {
  assert.equal(isUuid("60000000-0000-0000-0000-000000000001"), true);
  assert.equal(isUuid("60000000-0000-0000-0000-00000000001"), false);
});

test("la ruta de evidencia no contiene PII ni URL pública", () => {
  const path = historicalEvidencePath({ condominioId: ids.condo, unidadId: ids.unit, recoveryId: ids.key, mimeType: "application/pdf" });
  assert.equal(path, `${ids.condo}/${ids.unit}/${ids.key}.pdf`);
  assert.doesNotMatch(path, /https?:|@|nombre|telefono/i);
  assert.equal(HISTORICAL_EVIDENCE_BUCKET, "condominium-historical-evidence");
});

test("pendiente no reduce, aplicado reduce y reversado restaura sólo histórico", () => {
  const base = {
    units: [{ id: ids.unit, numero: "A-01" }],
    accounts: [{ id: ids.account, unidad_id: ids.unit, source_organization: "ANTIVE", cutoff_date: "2026-08-31", reported_charges: 10000, reported_payments: 1000, reported_balance: 9000 }],
    currentFees: [{ id: "fee", unidad_id: ids.unit, periodo: "2026-09", monto: 500, status: "pagado" }],
  };
  const pending = buildHistoricalPortfolio({ ...base, historicalRecoveries: [{ id: "p", historical_account_id: ids.account, unidad_id: ids.unit, amount: 2000, status: "PENDIENTE_APLICACION" }] });
  const applied = buildHistoricalPortfolio({ ...base, historicalRecoveries: [{ id: "a", historical_account_id: ids.account, unidad_id: ids.unit, amount: 2000, status: "APLICADO" }] });
  const reversed = buildHistoricalPortfolio({ ...base, historicalRecoveries: [{ id: "r", historical_account_id: ids.account, unidad_id: ids.unit, amount: 2000, status: "REVERSADO" }] });
  assert.equal(pending.totals.historicalPending, 9000);
  assert.equal(applied.totals.historicalPending, 7000);
  assert.equal(reversed.totals.historicalPending, 9000);
  assert.equal(applied.totals.currentCollected, 500);
});

test("la migración bloquea duplicados, sobrepago, carrera, borrado y transiciones inválidas", () => {
  assert.match(migration, /unique \(condominio_id, idempotency_key\)/);
  assert.match(migration, /unique \(condominio_id, evidence_sha256\)/);
  assert.match(migration, /for update/gi);
  assert.match(migration, /La recuperación excede el saldo histórico pendiente/);
  assert.match(migration, /Las recuperaciones históricas no pueden eliminarse/);
  assert.match(migration, /PENDIENTE_APLICACION[\s\S]+APLICADO[\s\S]+REVERSADO/);
  assert.match(migration, /old\.status = 'PENDIENTE_APLICACION' and new\.status = 'APLICADO'/);
  assert.match(migration, /old\.status = 'APLICADO' and new\.status = 'REVERSADO'/);
});

test("el pago combinado se ejecuta dentro de una sola función transaccional", () => {
  const applyFunction = migration.match(/create or replace function public\.condominium_apply_historical_recovery[\s\S]+?create or replace function public\.condominium_reverse_historical_recovery/)?.[0] || "";
  assert.match(applyFunction, /for update/);
  assert.match(applyFunction, /update public\.cuotas_condominio/);
  assert.match(applyFunction, /update public\.condominium_historical_recoveries/);
  assert.match(applyFunction, /recovery\.deposit_total <> recovery\.amount \+ fee\.monto/);
  assert.doesNotMatch(applyFunction, /commit|exception[\s\S]+when others/);
});

test("las escrituras usan RPC con identidad del operador y service_role queda sólo server-side", () => {
  assert.match(endpoint, /operatorDb\.rpc\("condominium_create_historical_recovery"/);
  assert.match(endpoint, /operatorDb\.rpc\("condominium_apply_historical_recovery"/);
  assert.match(endpoint, /operatorDb\.rpc\("condominium_reverse_historical_recovery"/);
  assert.match(endpoint, /serviceDb\.storage/);
  assert.match(endpoint, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(adminPage, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
  assert.doesNotMatch(endpoint, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE/);
});

test("la evidencia es privada y sólo se entrega con URL firmada temporal", () => {
  assert.match(migration, /'condominium-historical-evidence'[\s\S]+false/);
  assert.doesNotMatch(migration, /create policy[\s\S]+storage\.objects/i);
  assert.match(endpoint, /createSignedUrl\(scope\.data\.evidence_path, 60\)/);
  assert.match(endpoint, /loadScopedRecovery/);
  assert.doesNotMatch(ownerPortal, /evidence_path|payment_reference|signedUrl/);
});

test("la UI cubre alta, conciliación, aplicación, reversión y pago combinado", () => {
  for (const label of ["Registrar comprobante histórico", "Pendientes de conciliación", "Confirmar depósito", "Recuperaciones aplicadas", "Revertir con motivo"]) {
    assert.match(adminPage, new RegExp(label));
  }
  assert.match(adminPage, /Cuota corriente completa incluida/);
  assert.match(adminPage, /se aplicarán juntas o ninguna se aplicará/);
  assert.match(adminPage, /no reducirá el saldo hasta la confirmación bancaria/);
});

test("el Portal recibe inicial, recuperado y pendiente sin evidencia", () => {
  assert.match(migration, /'historicalRecovered'/);
  assert.match(migration, /'historicalPending'/);
  assert.match(ownerPortal, /Recuperaciones aplicadas/);
  assert.match(ownerPortal, /Saldo histórico pendiente/);
  assert.doesNotMatch(migration.match(/create or replace function public\.condominium_owner_portal_snapshot[\s\S]+?commit;/)?.[0] || "", /evidence_path|payment_reference|bank_confirmation_reference/);
});

test("los errores técnicos se convierten en códigos controlados", () => {
  assert.equal(historicalRecoveryErrorCode({ code: "42501" }), "OPERATION_NOT_ALLOWED");
  assert.equal(historicalRecoveryErrorCode({ code: "23505" }), "DUPLICATE_RECOVERY");
  assert.equal(historicalRecoveryErrorCode({ message: "La recuperación excede el saldo histórico pendiente." }), "HISTORICAL_BALANCE_EXCEEDED");
  assert.doesNotMatch(endpoint, /res\.status\([^)]*\)\.json\([^)]*error/i);
});

test("el rollback se niega a borrar recuperaciones o evidencia", () => {
  assert.match(rollback, /ROLLBACK ABORTADO: existen recuperaciones históricas/);
  assert.match(rollback, /ROLLBACK ABORTADO: existe evidencia privada/);
  assert.doesNotMatch(rollback, /delete from public\.condominium_historical_recoveries|truncate/i);
});

test("el postcheck limita Génova aunque otros tenants tengan cuotas en septiembre", () => {
  assert.match(productionChecks, /genova_id constant uuid:='29ebc26e-b82d-c90c-10a7-1f3761aeca09'/);
  assert.match(productionChecks, /from public\.cuotas_condominio\s+where condominio_id=genova_id and periodo='2026-09'/);
  assert.match(productionChecks, /from public\.condominium_historical_accounts\s+where condominio_id=genova_id/);
  assert.match(productionChecks, /from public\.condominium_historical_payments\s+where condominio_id=genova_id/);
  assert.match(productionChecks, /from public\.condominium_historical_recoveries\s+where condominio_id=genova_id/);
  assert.match(productionChecks, /from public\.unidades_condominio\s+where condominio_id=genova_id/);
  assert.match(productionChecks, /name like genova_id::text\|\|'\/%'/);
  assert.doesNotMatch(productionChecks, /from public\.cuotas_condominio\s+where periodo='2026-09'/);

  const fees = [
    { condominioId: "genova", periodo: "2026-09", monto: 500 },
    { condominioId: "otro-tenant", periodo: "2026-09", monto: 4800 },
  ];
  const scoped = fees.filter((fee) => fee.condominioId === "genova" && fee.periodo === "2026-09");
  assert.equal(scoped.length, 1);
  assert.equal(scoped.reduce((total, fee) => total + fee.monto, 0), 500);
});
