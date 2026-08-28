const amount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const latestAccountKey = (account) => `${account?.unidad_id || ""}::${String(account?.source_organization || "").trim().toUpperCase()}`;

export function latestHistoricalAccounts(accounts = []) {
  const latest = new Map();
  for (const account of accounts) {
    if (!account?.unidad_id) continue;
    const key = latestAccountKey(account);
    const current = latest.get(key);
    const candidateOrder = `${account.cutoff_date || ""}::${account.created_at || ""}::${account.id || ""}`;
    const currentOrder = current
      ? `${current.cutoff_date || ""}::${current.created_at || ""}::${current.id || ""}`
      : "";
    if (!current || candidateOrder > currentOrder) latest.set(key, account);
  }
  return [...latest.values()];
}

export function buildHistoricalPortfolio({
  units = [],
  accounts = [],
  historicalPayments = [],
  historicalRecoveries = [],
  currentFees = [],
} = {}) {
  const currentAccounts = latestHistoricalAccounts(accounts);
  const currentAccountIds = new Set(currentAccounts.map((account) => account.id));
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const paymentsByUnit = new Map();
  const recoveriesByUnit = new Map();
  const feesByUnit = new Map();

  for (const payment of historicalPayments) {
    if (!currentAccountIds.has(payment.historical_account_id)) continue;
    const rows = paymentsByUnit.get(payment.unidad_id) || [];
    rows.push(payment);
    paymentsByUnit.set(payment.unidad_id, rows);
  }
  for (const recovery of historicalRecoveries) {
    if (!currentAccountIds.has(recovery.historical_account_id)) continue;
    const rows = recoveriesByUnit.get(recovery.unidad_id) || [];
    rows.push(recovery);
    recoveriesByUnit.set(recovery.unidad_id, rows);
  }
  for (const fee of currentFees) {
    const rows = feesByUnit.get(fee.unidad_id) || [];
    rows.push(fee);
    feesByUnit.set(fee.unidad_id, rows);
  }

  const rows = currentAccounts.map((account) => {
    const unitPayments = paymentsByUnit.get(account.unidad_id) || [];
    const unitRecoveries = recoveriesByUnit.get(account.unidad_id) || [];
    const unitFees = feesByUnit.get(account.unidad_id) || [];
    const initialHistoricalBalance = amount(account.reported_balance);
    const historicalRecovered = unitRecoveries
      .filter((recovery) => recovery.status === "APLICADO")
      .reduce((sum, recovery) => sum + amount(recovery.amount), 0);
    const currentIssued = unitFees.reduce((sum, fee) => sum + amount(fee.monto), 0);
    const currentCollected = unitFees
      .filter((fee) => fee.status === "pagado")
      .reduce((sum, fee) => sum + amount(fee.monto), 0);
    const historicalPending = Math.max(0, initialHistoricalBalance - historicalRecovered);
    const currentPending = Math.max(0, currentIssued - currentCollected);

    return {
      accountId: account.id,
      unitId: account.unidad_id,
      unitNumber: unitsById.get(account.unidad_id)?.numero || "—",
      sourceOrganization: account.source_organization,
      sourceLabel: account.source_label,
      cutoffDate: account.cutoff_date,
      reviewStatus: account.review_status,
      historicalCharges: amount(account.reported_charges),
      historicalPayments: amount(account.reported_payments),
      historicalPaymentDetails: unitPayments,
      initialHistoricalBalance,
      historicalRecovered,
      historicalPending,
      currentFees: unitFees,
      currentIssued,
      currentCollected,
      currentPending,
      currentCollectionRate: currentIssued > 0 ? currentCollected / currentIssued : 0,
      administrativeTotal: historicalPending + currentPending,
    };
  }).sort((left, right) => String(left.unitNumber).localeCompare(String(right.unitNumber), "es", { numeric: true }));

  const totals = rows.reduce((summary, row) => ({
    historicalCharges: summary.historicalCharges + row.historicalCharges,
    historicalPayments: summary.historicalPayments + row.historicalPayments,
    initialHistoricalBalance: summary.initialHistoricalBalance + row.initialHistoricalBalance,
    historicalRecovered: summary.historicalRecovered + row.historicalRecovered,
    historicalPending: summary.historicalPending + row.historicalPending,
    currentIssued: summary.currentIssued + row.currentIssued,
    currentCollected: summary.currentCollected + row.currentCollected,
    currentPending: summary.currentPending + row.currentPending,
    administrativeTotal: summary.administrativeTotal + row.administrativeTotal,
  }), {
    historicalCharges: 0,
    historicalPayments: 0,
    initialHistoricalBalance: 0,
    historicalRecovered: 0,
    historicalPending: 0,
    currentIssued: 0,
    currentCollected: 0,
    currentPending: 0,
    administrativeTotal: 0,
  });

  totals.currentIssued = currentFees.reduce((sum, fee) => sum + amount(fee.monto), 0);
  totals.currentCollected = currentFees
    .filter((fee) => fee.status === "pagado")
    .reduce((sum, fee) => sum + amount(fee.monto), 0);
  totals.currentPending = Math.max(0, totals.currentIssued - totals.currentCollected);
  totals.administrativeTotal = totals.historicalPending + totals.currentPending;
  totals.currentCollectionRate = totals.currentIssued > 0
    ? totals.currentCollected / totals.currentIssued
    : 0;

  return {
    rows,
    totals,
    accountCount: currentAccounts.length,
    paymentCount: [...paymentsByUnit.values()].reduce((sum, payments) => sum + payments.length, 0),
    sourceOrganizations: [...new Set(currentAccounts.map((account) => account.source_organization).filter(Boolean))],
  };
}
