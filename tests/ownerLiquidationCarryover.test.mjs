import test from "node:test";
import assert from "node:assert/strict";
import {
  administrationCommissionForPeriod,
  calculateOwnerLiquidation,
} from "../lib/operaciones/ownerLiquidation.js";

const ownerEmail = "owner@example.com";
const properties = [{ name: "Prisma 1202", owner_email: ownerEmail }];
const contracts = [{
  id: "contract-1",
  property_name: "Prisma 1202",
  start_date: "2026-09-01",
  end_date: "2027-08-31",
  monthly_rent: 15600,
  commission_type: "porcentaje",
  commission_value: 10,
  rent_receiver: "inmobiliaria",
}];
const payments = [
  { contract_id: "contract-1", due_date: "2026-09-01", amount: 15600, status: "pagado", recibido_por: "emporio" },
  { contract_id: "contract-1", due_date: "2026-10-01", amount: 15600, status: "pagado", recibido_por: "emporio" },
];

test("renewal expense waives monthly administration for the same property and period", () => {
  const expenses = [{ property_name: "Prisma 1202", paid_by: "propietario", date: "2026-09-01", amount: 15600, description: "Comisión por renovación" }];
  assert.equal(administrationCommissionForPeriod(contracts[0], expenses, "2026-09"), 0);
  assert.equal(administrationCommissionForPeriod(contracts[0], expenses, "2026-10"), 1560);
});

test("Daniela-style September debt carries into October after renewal waiver", () => {
  const propertyExpenses = [
    { property_name: "Prisma 1202", paid_by: "propietario", date: "2026-09-01", amount: 15600, description: "Comisión por renovación" },
    { property_name: "Prisma 1202", paid_by: "propietario", date: "2026-09-15", amount: 3000, description: "septiembre" },
  ];
  const ownerPayments = [{
    owner_email: ownerEmail,
    period_key: "2026-08",
    status: "pagado",
    amount_paid: 0,
  }];

  const september = calculateOwnerLiquidation({
    ownerEmail,
    period: "2026-09",
    properties,
    contracts,
    payments,
    ownerPayments,
    propertyExpenses,
    maintenanceTickets: [],
    cashMovements: [],
  });
  assert.equal(september.totalCommission, 0);
  assert.equal(september.totalCommissionWaivedByRenewal, 1560);
  assert.equal(september.netBeforePayments, -3000);
  assert.equal(september.balance, 0);
  assert.equal(september.ownerDebt, 3000);

  const october = calculateOwnerLiquidation({
    ownerEmail,
    period: "2026-10",
    properties,
    contracts,
    payments,
    ownerPayments,
    propertyExpenses,
    maintenanceTickets: [],
    cashMovements: [],
  });
  assert.equal(october.priorBalance, -3000);
  assert.equal(october.priorOwnerDebt, 3000);
  assert.equal(october.totalCommission, 1560);
  assert.equal(october.totalLiquid, 11040);
  assert.equal(october.balance, 11040);
  assert.equal(october.ownerDebt, 0);
});

test("a full settlement is the carryover baseline", () => {
  const ownerPayments = [
    { owner_email: ownerEmail, period_key: "2026-08", status: "pagado", amount_paid: 999999 },
    { owner_email: ownerEmail, period_key: "2026-09", status: "pagado_parcial", amount_paid: 1000 },
  ];
  const result = calculateOwnerLiquidation({
    ownerEmail,
    period: "2026-10",
    properties,
    contracts,
    payments,
    ownerPayments,
    propertyExpenses: [],
    maintenanceTickets: [],
    cashMovements: [],
  });
  assert.equal(result.carryBasedOnSettledPeriod, "2026-08");
  assert.equal(result.priorBalance, 13040);
});
