export const unavailableLegacyExpenseGate = () => ({
  loaded: false,
  enabled: false,
  ledgerEnabled: null,
  reason: "No fue posible confirmar el estado de Financial Core.",
});

export const resolveLegacyExpenseGate = (financialControl, error = null) => {
  if (error) return unavailableLegacyExpenseGate();

  const ledgerEnabled = financialControl?.ledger_enabled === true;
  return {
    loaded: true,
    enabled: !ledgerEnabled,
    ledgerEnabled,
    reason: ledgerEnabled
      ? "Financial Core está activo; el registro legacy de gastos está bloqueado."
      : null,
  };
};
