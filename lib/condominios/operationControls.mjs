export const EXISTING_CONDOMINIUM_DEFAULTS = Object.freeze({
  ownerPortalEnabled: true,
  communicationsEnabled: true,
  currentBillingEnabled: true,
  receiptsEnabled: true,
  realPaymentsEnabled: true,
  moneyMovementsEnabled: true,
});

export const PREIMPLEMENTATION_DEFAULTS = Object.freeze({
  ownerPortalEnabled: false,
  communicationsEnabled: false,
  currentBillingEnabled: false,
  receiptsEnabled: false,
  realPaymentsEnabled: false,
  moneyMovementsEnabled: false,
});

const BOOLEAN_FIELDS = {
  ownerPortalEnabled: "owner_portal_enabled",
  communicationsEnabled: "communications_enabled",
  currentBillingEnabled: "current_billing_enabled",
  receiptsEnabled: "receipts_enabled",
  realPaymentsEnabled: "real_payments_enabled",
  moneyMovementsEnabled: "money_movements_enabled",
};

export function resolveCondominiumOperationControls(row) {
  if (!row) return { ...EXISTING_CONDOMINIUM_DEFAULTS, lifecycleStatus: "legacy_uncontrolled" };

  const resolved = { lifecycleStatus: row.lifecycle_status || "preimplementation" };
  for (const [output, input] of Object.entries(BOOLEAN_FIELDS)) {
    resolved[output] = row[input] === true;
  }
  return resolved;
}

export function unavailableCondominiumOperationControls() {
  return { ...PREIMPLEMENTATION_DEFAULTS, lifecycleStatus: "controls_unavailable" };
}

export function indexCondominiumOperationControls(rows = []) {
  return new Map(rows.filter((row) => row?.condominio_id).map((row) => [
    String(row.condominio_id),
    resolveCondominiumOperationControls(row),
  ]));
}

export function controlsForCondominium(index, condominiumId) {
  return index?.get(String(condominiumId || "")) || resolveCondominiumOperationControls(null);
}

export function filterRowsByCondominiumCapability(rows, index, capability, getCondominiumId = (row) => row?.condominio_id) {
  if (!Object.hasOwn(EXISTING_CONDOMINIUM_DEFAULTS, capability)) {
    throw new Error(`Capacidad condominal desconocida: ${capability}`);
  }
  return (rows || []).filter((row) => controlsForCondominium(index, getCondominiumId(row))[capability]);
}
