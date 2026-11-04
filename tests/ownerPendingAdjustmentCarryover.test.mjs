import test from "node:test";
import assert from "node:assert/strict";
import { calculateOwnerLiquidation } from "../lib/operaciones/ownerLiquidation.js";

test("pending historical owner adjustment remains in carried balance", () => {
  const ownerEmail = "owner@example.com";
  const properties = [{ name: "Casa 1", owner_email: ownerEmail }];
  const contracts = [{
    id: "c1", property_name: "Casa 1", start_date: "2026-01-01", end_date: "2027-01-01",
    status: "activo", monthly_rent: 10000, commission_type: "fijo", commission_value: 500,
    rent_receiver: "inmobiliaria",
  }];
  const payments = [
    { contract_id: "c1", due_date: "2026-08-01", amount: 10000, status: "pagado", recibido_por: "emporio" },
    { contract_id: "c1", due_date: "2026-09-01", amount: 10000, status: "pagado", recibido_por: "emporio" },
  ];
  const ownerPayments = [
    { owner_email: ownerEmail, period_key: "2026-07", period_description: "julio de 2026", status: "pagado", amount_paid: 9500, total_liquid: 9500 },
    { owner_email: ownerEmail, period_key: "2026-06", period_description: "Ajuste junio de 2026", status: "pendiente", amount_paid: 0, total_liquid: 575 },
    { owner_email: ownerEmail, period_key: "2026-08", period_description: "agosto de 2026", status: "pagado_parcial", amount_paid: 9000, total_liquid: 9500 },
    { owner_email: ownerEmail, period_key: "2026-09", period_description: "septiembre de 2026", status: "pagado_parcial", amount_paid: 9500, total_liquid: 9500 },
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

  assert.equal(result.pendingAdjustmentBalance, 575);
  assert.equal(result.priorBalance, 1075);
  assert.equal(result.pendingAdjustments.length, 1);
});
