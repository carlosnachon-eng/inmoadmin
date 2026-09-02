import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RESERVE_FUND_RECORD_KINDS,
  RESERVE_FUND_STATUSES,
  reserveFundReceiptPublicShape,
  validateReserveFundAntiveBatchInput,
  validateReserveFundEvidenceEnrichmentInput,
} from "../lib/condominios/reserveFund.mjs";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const migration = await read("../supabase/migrations/202609010003_condominium_reserve_fund_antive_unverified.sql");
const rollback = await read("../supabase/production/rollback/202609010003_condominium_reserve_fund_antive_unverified_rollback.sql");
const checks = await read("../supabase/production/tests/202609010003_condominium_reserve_fund_antive_unverified_checks.sql");
const sqlTests = await read("../supabase/dev/tests/202609010003_condominium_reserve_fund_antive_unverified_tests.sql");
const endpoint = await read("../pages/api/condominios/reserve-fund.js");
const adminPage = await read("../pages/condominio/[id].js");

const validBatch = {
  condominioId: "10000000-0000-4000-8000-000000000001",
  batchId: "10000000-0000-4000-8000-000000000002",
  sourceFileSha256: "a".repeat(64),
  sourceSheet: "TRANSICION",
  receivedConfirmedBy: "ANTIVE-QA",
  receivedConfirmedAt: "2099-01-01T12:00:00.000Z",
  records: [{
    receiptId: "10000000-0000-4000-8000-000000000003",
    idempotencyKey: "10000000-0000-4000-8000-000000000004",
    unidadId: "10000000-0000-4000-8000-000000000005",
    amount: 500,
    sourceRange: "K2",
  }],
};

test("valida lote Antive por archivo, hoja, celda y unidad sin exigir evidencia bancaria", () => {
  assert.equal(validateReserveFundAntiveBatchInput(validBatch), null);
  assert.equal(validateReserveFundAntiveBatchInput({ ...validBatch, sourceFileSha256: "x" }), "INVALID_SOURCE_FILE_HASH");
  assert.equal(validateReserveFundAntiveBatchInput({ ...validBatch, sourceSheet: "" }), "INVALID_SOURCE_SHEET");
  assert.equal(validateReserveFundAntiveBatchInput({ ...validBatch, receivedConfirmedBy: "" }), "INVALID_ANTIVE_CONFIRMATION");
  assert.equal(validateReserveFundAntiveBatchInput({
    ...validBatch,
    records: [...validBatch.records, { ...validBatch.records[0], receiptId: "10000000-0000-4000-8000-000000000006" }],
  }), "DUPLICATE_SOURCE_RECORD");
});

test("la evidencia se exige sólo al enriquecer y antes de conciliar", () => {
  const base = {
    condominioId: validBatch.condominioId,
    receiptId: validBatch.records[0].receiptId,
    paymentReference: "REF-QA",
    proofDate: "2099-01-02",
  };
  assert.equal(validateReserveFundEvidenceEnrichmentInput(base), "INVALID_EVIDENCE_TYPE");
  assert.match(migration, /No existe evidencia suficiente para conciliar/);
  assert.match(migration, /condominium_enrich_reserve_fund_receipt_evidence/);
});

test("el contrato distingue recibido Antive, pendiente, conciliado, reversado y anulado", () => {
  assert.equal(RESERVE_FUND_STATUSES.receivedByAntiveUnverified, "received_by_antive_unverified");
  assert.equal(RESERVE_FUND_STATUSES.voided, "voided");
  assert.equal(RESERVE_FUND_RECORD_KINDS.antiveHistoricalReport, "antive_historical_report");
  const shaped = reserveFundReceiptPublicShape({
    id: validBatch.records[0].receiptId,
    record_kind: "antive_historical_report",
    status: "received_by_antive_unverified",
    evidence_path: null,
    source_sheet: "TRANSICION",
    source_range: "K2",
  });
  assert.equal(shaped.status, "received_by_antive_unverified");
  assert.equal(shaped.evidence_available, false);
  assert.equal(shaped.source_range, "K2");
});

test("la migración es aditiva, auditable, idempotente y sin importación real", () => {
  assert.match(migration, /create table public\.condominium_reserve_fund_import_batches/);
  assert.match(migration, /record_kind text not null default 'bank_receipt'/);
  assert.match(migration, /received_by_antive_unverified/);
  assert.match(migration, /condominium_reserve_fund_antive_source_unique/);
  assert.match(migration, /source_file_sha256[\s\S]+source_sheet[\s\S]+source_range[\s\S]+source_unit_id/);
  assert.match(migration, /condominium_void_reserve_fund_batch/);
  assert.match(migration, /condominium_void_reserve_fund_receipt/);
  assert.match(migration, /Los lotes de Fondo de Reserva no pueden eliminarse/);
  assert.doesNotMatch(migration, /13 unidades|6,500|6500|A-0[1-9]|B-\d|C-\d/i);
  assert.doesNotMatch(migration, /insert into public\.(cuotas_condominio|condominium_historical|gastos_condominio)/i);
});

test("las transiciones fallan cerrado y no permiten conciliar sin soporte", () => {
  assert.match(migration, /old\.status = 'received_by_antive_unverified' and new\.status = 'reconciled'/);
  assert.match(migration, /old\.status in \('pending','received_by_antive_unverified'\) and new\.status = 'voided'/);
  assert.match(migration, /old\.status = 'reconciled' and new\.status = 'reversed'/);
  assert.match(migration, /evidence_path is null or receipt\.evidence_sha256 is null/);
  assert.match(migration, /for update/);
});

test("RLS y grants limitan la operación a personal interno autorizado", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /condominium_internal_permission\('condominios', true\)/);
  assert.match(migration, /revoke all on table public\.condominium_reserve_fund_import_batches from public, anon, authenticated, service_role/);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all) on table public\.condominium_reserve_fund_import_batches/i);
  assert.match(checks, /RPC histórica expuesta fuera del operador autenticado/);
});

test("endpoint soporta lote, enriquecimiento y anulación sin exponer service_role al cliente", () => {
  for (const action of ["import-antive-received", "enrich-evidence", "void", "void-batch"]) {
    assert.match(endpoint, new RegExp(`action === "${action}"`));
  }
  assert.match(endpoint, /operatorDb\.rpc\("condominium_import_antive_reserve_fund_batch"/);
  assert.match(endpoint, /operatorDb\.rpc\("condominium_enrich_reserve_fund_receipt_evidence"/);
  assert.match(endpoint, /serviceDb\.storage/);
  assert.doesNotMatch(adminPage, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
  assert.doesNotMatch(endpoint, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE/);
});

test("UI no presenta lo recibido por Antive como adeudo pendiente", () => {
  for (const label of [
    "Recibido por Antive — pendiente de evidencia documental",
    "Pendiente de recepción",
    "Conciliado",
    "Reversado / anulado",
    "Completar evidencia",
    "Anular lote",
  ]) assert.match(adminPage, new RegExp(label, "i"));
  assert.match(adminPage, /no se mostrarán como adeudo/i);
  assert.match(adminPage, /No se inventará fecha de depósito, referencia ni comprobante/i);
});

test("pruebas SQL cubren idempotencia, lote, reversa, aislamiento e invariantes", () => {
  for (const evidence of [
    "se concilió sin evidencia suficiente",
    "reintento idempotente duplicó el lote",
    "archivo/celda/unidad duplicados",
    "se aceptó unidad de otro condominio",
    "anulación de lote incompleta",
    "alteró mantenimiento, históricos, recuperaciones, gastos, KPI o portal",
    "usuario externo ve datos",
  ]) assert.match(sqlTests, new RegExp(evidence, "i"));
  assert.match(sqlTests, /CONDOMINIUM_RESERVE_FUND_ANTIVE_TESTS_OK/);
});

test("rollback de esquema falla cerrado cuando existe actividad y preserva anulación operativa", () => {
  assert.match(rollback, /ROLLBACK ABORTADO: existen lotes históricos Antive/);
  assert.match(rollback, /utilice anulación auditada/);
  assert.doesNotMatch(rollback, /delete from|truncate/i);
  assert.match(checks, /CONDOMINIUM_RESERVE_FUND_ANTIVE_POSTCHECK_OK/);
});
