import test from "node:test";
import assert from "node:assert/strict";
import { selectContractsForPeriod } from "../lib/operaciones/ownerLiquidation.js";

test("selects one effective contract per property when date ranges overlap", () => {
  const contracts = [
    { id: "old", property_name: "Luxtown 17", start_date: "2026-05-20", end_date: "2026-10-19", status: "vencido" },
    { id: "new", property_name: "Luxtown 17", start_date: "2026-07-20", end_date: "2027-06-19", status: "activo" },
    { id: "other", property_name: "Prisma 101", start_date: "2026-05-02", end_date: "2026-12-01", status: "activo" },
  ];

  const selected = selectContractsForPeriod(contracts, ["Luxtown 17", "Prisma 101"], "2026-10");
  assert.deepEqual(selected.map((row) => row.id).sort(), ["new", "other"]);
});

test("historical periods still choose a dated contract even if it is now vencido", () => {
  const contracts = [
    { id: "old", property_name: "Casa A", start_date: "2026-01-01", end_date: "2026-06-30", status: "vencido" },
    { id: "new", property_name: "Casa A", start_date: "2026-07-01", end_date: "2027-06-30", status: "activo" },
  ];

  assert.equal(selectContractsForPeriod(contracts, ["Casa A"], "2026-05")[0]?.id, "old");
});
