export const TRANSITION_VIEWER_ROLE = "antive_transition";

export const TRANSITION_VIEWER_TABS = Object.freeze([
  "resumen",
  "unidades",
  "cobranza",
  "historico",
  "proveedores",
  "pendientes",
]);

const amount = (value) => Number(value || 0);

export function activeTransitionMembership(row, now = new Date()) {
  if (!row || row.access_role !== "transition_viewer" || row.active !== true) return false;
  return !row.expires_at || new Date(row.expires_at).getTime() > now.getTime();
}

export function buildTransitionViewerSummary({ units = [], fees = [], historicalAccounts = [], recoveries = [] } = {}) {
  const currentIssued = fees.reduce((sum, row) => sum + amount(row.monto), 0);
  const currentCollected = fees
    .filter((row) => row.status === "pagado")
    .reduce((sum, row) => sum + amount(row.monto), 0);
  const historicalInitial = historicalAccounts.reduce((sum, row) => sum + amount(row.reported_balance), 0);
  const historicalRecovered = recoveries
    .filter((row) => row.status === "APLICADO")
    .reduce((sum, row) => sum + amount(row.amount), 0);

  return {
    unitCount: units.length,
    currentIssued,
    currentCollected,
    currentPending: Math.max(currentIssued - currentCollected, 0),
    currentCollectionRate: currentIssued > 0 ? currentCollected / currentIssued : 0,
    historicalInitial,
    historicalRecovered,
    historicalPending: Math.max(historicalInitial - historicalRecovered, 0),
  };
}
