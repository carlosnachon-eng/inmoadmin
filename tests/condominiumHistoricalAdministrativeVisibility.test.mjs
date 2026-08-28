import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  buildHistoricalPortfolio,
  latestHistoricalAccounts,
} from "../lib/condominios/historicalPortfolio.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const adminPage = await read("../pages/condominio/[id].js");
const ownerPortal = await read("../components/condomino/ControlledCondominoPortal.js");

const units = Array.from({ length: 24 }, (_, index) => ({
  id: `unit-${index + 1}`,
  numero: `${String.fromCharCode(65 + Math.floor(index / 8))}-${String((index % 8) + 1).padStart(2, "0")}`,
}));

const historicalPaymentRows = [
  ...units.map((unit, index) => ({
    id: `payment-base-${index + 1}`,
    historical_account_id: `account-${index + 1}`,
    unidad_id: unit.id,
    reported_period: "2026-01",
    reported_amount: 500,
    received_by: "ANTIVE",
    review_status: "REPORTADO",
  })),
  ...units.slice(0, 16).map((unit, index) => ({
    id: `payment-extra-${index + 1}`,
    historical_account_id: `account-${index + 1}`,
    unidad_id: unit.id,
    reported_period: "2026-02",
    reported_amount: 500,
    received_by: "ANTIVE",
    review_status: "REPORTADO",
  })),
  {
    id: "payment-extra-large",
    historical_account_id: "account-1",
    unidad_id: "unit-1",
    reported_period: "2026-03",
    reported_amount: 3500,
    received_by: "ANTIVE",
    review_status: "REPORTADO",
  },
];

const paymentsByUnit = historicalPaymentRows.reduce((map, payment) => {
  map.set(payment.unidad_id, (map.get(payment.unidad_id) || 0) + payment.reported_amount);
  return map;
}, new Map());

const accounts = units.map((unit, index) => {
  const charges = index === 23 ? 3500 : 4500;
  const payments = paymentsByUnit.get(unit.id) || 0;
  return {
    id: `account-${index + 1}`,
    unidad_id: unit.id,
    source_organization: "ANTIVE",
    source_label: "SALDO HISTÓRICO REPORTADO POR ANTIVE",
    cutoff_date: "2026-08-20",
    created_at: "2026-08-20T00:00:00Z",
    reported_charges: charges,
    reported_payments: payments,
    reported_balance: charges - payments,
    review_status: "REPORTADO",
  };
});

const septemberFees = units.slice(0, 23).map((unit, index) => ({
  id: `fee-${index + 1}`,
  unidad_id: unit.id,
  periodo: "2026-09",
  monto: 500,
  status: "pendiente",
}));

test("reproduce sin alterar el padrón histórico y la cobranza corriente confirmados", () => {
  const portfolio = buildHistoricalPortfolio({
    units,
    accounts,
    historicalPayments: historicalPaymentRows,
    historicalRecoveries: [],
    currentFees: septemberFees,
  });

  assert.equal(portfolio.accountCount, 24);
  assert.equal(portfolio.paymentCount, 41);
  assert.equal(portfolio.totals.historicalCharges, 107000);
  assert.equal(portfolio.totals.historicalPayments, 23500);
  assert.equal(portfolio.totals.initialHistoricalBalance, 83500);
  assert.equal(portfolio.totals.historicalRecovered, 0);
  assert.equal(portfolio.totals.historicalPending, 83500);
  assert.equal(portfolio.totals.currentIssued, 11500);
  assert.equal(portfolio.totals.currentCollected, 0);
  assert.equal(portfolio.totals.currentCollectionRate, 0);
  assert.equal(portfolio.totals.administrativeTotal, 95000);
});

test("el detalle de 41 pagos no se suma otra vez sobre el resumen de cuentas", () => {
  const portfolio = buildHistoricalPortfolio({ units, accounts, historicalPayments: historicalPaymentRows });
  assert.equal(historicalPaymentRows.reduce((sum, row) => sum + row.reported_amount, 0), 23500);
  assert.equal(portfolio.totals.historicalPayments, 23500);
  assert.equal(portfolio.rows.reduce((sum, row) => sum + row.historicalPaymentDetails.length, 0), 41);
});

test("recuperaciones aplicadas reducen sólo el histórico pendiente", () => {
  const portfolio = buildHistoricalPortfolio({
    units,
    accounts,
    historicalPayments: historicalPaymentRows,
    historicalRecoveries: [
      { id: "recovery-applied", historical_account_id: "account-2", unidad_id: "unit-2", amount: 500, status: "APLICADO" },
      { id: "recovery-pending", historical_account_id: "account-2", unidad_id: "unit-2", amount: 500, status: "PENDIENTE_APLICACION" },
      { id: "recovery-reversed", historical_account_id: "account-2", unidad_id: "unit-2", amount: 500, status: "REVERSADO" },
    ],
    currentFees: septemberFees,
  });
  assert.equal(portfolio.totals.historicalRecovered, 500);
  assert.equal(portfolio.totals.historicalPending, 83000);
  assert.equal(portfolio.totals.currentIssued, 11500);
});

test("selecciona el último corte por unidad y origen para no duplicar snapshots", () => {
  const older = { ...accounts[0], id: "account-old", cutoff_date: "2026-07-31", reported_charges: 4000, reported_payments: 1000, reported_balance: 3000 };
  const latest = latestHistoricalAccounts([older, ...accounts]);
  assert.equal(latest.length, 24);
  assert.equal(latest.find((account) => account.unidad_id === "unit-1")?.id, "account-1");
});

test("sin cuotas la cobranza corriente devuelve importes y porcentaje en cero", () => {
  const portfolio = buildHistoricalPortfolio({ units, accounts, historicalPayments: historicalPaymentRows, currentFees: [] });
  assert.equal(portfolio.totals.currentIssued, 0);
  assert.equal(portfolio.totals.currentCollected, 0);
  assert.equal(portfolio.totals.currentCollectionRate, 0);
});

test("el KPI corriente incluye cuotas de unidades sin cuenta histórica sin duplicarlas", () => {
  const portfolio = buildHistoricalPortfolio({
    units,
    accounts: accounts.slice(0, 23),
    historicalPayments: historicalPaymentRows.filter((payment) => payment.unidad_id !== "unit-24"),
    currentFees: septemberFees,
  });
  assert.equal(portfolio.totals.currentIssued, 11500);
  assert.equal(portfolio.totals.currentPending, 11500);
});

test("la superficie administrativa es de lectura, separa orígenes y conserva Tecaxco", () => {
  for (const table of [
    "condominium_historical_accounts",
    "condominium_historical_payments",
    "condominium_historical_recoveries",
  ]) {
    assert.match(adminPage, new RegExp(`from\\(\"${table}\"\\)\\.select`));
    assert.doesNotMatch(adminPage, new RegExp(`from\\(\"${table}\"\\)[\\s\\S]{0,180}\\.(?:insert|update|delete)\\(`));
  }
  assert.match(adminPage, /HISTÓRICO ANTIVE/);
  assert.match(adminPage, /ADMINISTRACIÓN EMPORIO/);
  assert.match(adminPage, /SALDO ADMINISTRATIVO TOTAL/);
  assert.match(adminPage, /hasHistoricalPortfolio \? \[\{ id: "cartera"/);
  assert.match(adminPage, /Cuotas corrientes vencidas/);
  assert.doesNotMatch(adminPage, /totalCobradoHistorico|Adeudos históricos|Total cobrado histórico/);
});

test("el Portal MVP mantiene la misma separación conceptual y no cambia", () => {
  assert.match(ownerPortal, /Administración Emporio/);
  assert.match(ownerPortal, /Histórico Antive/);
  assert.match(ownerPortal, /condominium_owner_portal_snapshot/);
});
