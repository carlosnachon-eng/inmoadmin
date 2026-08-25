const normalizeAmount = (value) => Number(value) || 0;

export function contractActiveInPeriod(contract, period) {
  if (!contract || !/^\d{4}-\d{2}$/.test(String(period || ""))) return false;
  const start = `${period}-01`;
  const [year, month] = period.split("-").map(Number);
  const end = `${period}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  return (!contract.start_date || contract.start_date <= end)
    && (!contract.end_date || contract.end_date >= start);
}

export function administrationCommission(contract) {
  const value = normalizeAmount(contract?.commission_value);
  if (!value) return 0;
  return contract?.commission_type === "porcentaje"
    ? normalizeAmount(contract.monthly_rent) * value / 100
    : value;
}

export function maintenanceOwnerBalance(ticket) {
  const charge = normalizeAmount(ticket?.charged_amount);
  const advance = ticket?.advance_paid ? normalizeAmount(ticket.advance_amount) : 0;
  return Math.max(0, charge - advance);
}

const inPeriod = (value, period) => String(value || "").slice(0, 7) === period;

const normalized = (value) => String(value || "").trim().toLowerCase();

export function paymentReceivedByEmporio(payment, contract, cashMovements = [], period = "") {
  const recordedReceiver = normalized(payment?.recibido_por);
  if (recordedReceiver === "emporio") return true;
  if (recordedReceiver === "propietario") return false;

  const contractReceiver = normalized(contract?.rent_receiver) || "inmobiliaria";
  if (contractReceiver === "inmobiliaria") return true;
  if (contractReceiver !== "propietario") return false;

  // Compatibilidad con registros históricos de contratos directos que no tienen
  // payments.recibido_por, pero sí la entrada física creada por Cobranza.
  const propertyName = normalized(payment?.property_name || contract?.property_name);
  const amount = normalizeAmount(payment?.amount);
  return Boolean(propertyName) && cashMovements.some((movement) => (
    movement?.type === "entrada"
    && movement?.category === "renta_cobrada"
    && (!period || inPeriod(movement.date, period))
    && normalized(movement.description).includes(propertyName)
    && (!amount || !normalizeAmount(movement.amount) || normalizeAmount(movement.amount) === amount)
  ));
}

export function calculateOwnerLiquidation({
  ownerEmail,
  period,
  properties = [],
  contracts = [],
  payments = [],
  ownerPayments = [],
  propertyExpenses = [],
  maintenanceTickets = [],
  cashMovements = [],
}) {
  const propertyNames = properties
    .filter((row) => row.owner_email === ownerEmail)
    .map((row) => row.name)
    .filter(Boolean);
  const ownerContracts = contracts.filter((row) => (
    propertyNames.includes(row.property_name) && contractActiveInPeriod(row, period)
  ));
  const contractIds = new Set(ownerContracts.map((row) => String(row.id)));
  const collectedRents = payments.filter((row) => (
    contractIds.has(String(row.contract_id))
    && row.status === "pagado"
    && inPeriod(row.due_date, period)
  ));
  const paidContractIds = new Set(collectedRents.map((row) => String(row.contract_id)));
  const contractById = new Map(ownerContracts.map((row) => [String(row.id), row]));
  const rentsReceivedByEmporio = collectedRents.filter((row) => (
    paymentReceivedByEmporio(row, contractById.get(String(row.contract_id)), cashMovements, period)
  ));
  const emporioContractIds = new Set(rentsReceivedByEmporio.map((row) => String(row.contract_id)));
  const totalCollectedRent = collectedRents.reduce((sum, row) => sum + normalizeAmount(row.amount), 0);
  const totalRent = rentsReceivedByEmporio.reduce((sum, row) => sum + normalizeAmount(row.amount), 0);
  const totalCommissionAccrued = ownerContracts
    .filter((row) => paidContractIds.has(String(row.id)))
    .reduce((sum, row) => sum + administrationCommission(row), 0);
  const totalRetainableCommission = ownerContracts
    .filter((row) => emporioContractIds.has(String(row.id)))
    .reduce((sum, row) => sum + administrationCommission(row), 0);
  const propertySet = new Set(propertyNames);
  const expenses = propertyExpenses.filter((row) => (
    propertySet.has(row.property_name) && row.paid_by === "propietario" && inPeriod(row.date, period)
  ));
  const totalExpenses = expenses.reduce((sum, row) => sum + normalizeAmount(row.amount), 0);
  const discountedMaintenance = maintenanceTickets.filter((row) => (
    propertySet.has(row.property_name)
    && row.payer === "propietario"
    && row.descontado_de_liquidacion === true
    && inPeriod(row.created_at, period)
  ));
  const totalDiscountedMaintenance = discountedMaintenance
    .reduce((sum, row) => sum + maintenanceOwnerBalance(row), 0);
  const priorPendingMaintenance = maintenanceTickets.filter((row) => (
    propertySet.has(row.property_name)
    && row.payer === "propietario"
    && row.descontado_de_liquidacion !== true
    && String(row.created_at || "").slice(0, 7) < period
    && maintenanceOwnerBalance(row) > 0
  ));
  const totalPriorMaintenance = priorPendingMaintenance
    .reduce((sum, row) => sum + maintenanceOwnerBalance(row), 0);
  const periodPayments = ownerPayments.filter((row) => (
    row.owner_email === ownerEmail && row.period_key === period
  ));
  const paidInFull = periodPayments.some((row) => row.status === "pagado");
  const totalPaid = periodPayments.reduce((sum, row) => sum + normalizeAmount(row.amount_paid), 0);
  const totalLiquid = Math.max(0, totalRent - totalRetainableCommission - totalExpenses
    - totalDiscountedMaintenance - totalPriorMaintenance);

  return {
    ownerEmail,
    period,
    propertyNames,
    ownerContracts,
    collectedRents,
    rentsReceivedByEmporio,
    collectedRentCount: collectedRents.length,
    emporioCollectedRentCount: rentsReceivedByEmporio.length,
    totalCollectedRent,
    totalRent,
    totalCommission: totalRetainableCommission,
    totalCommissionAccrued,
    totalRetainableCommission,
    totalExpenses,
    totalDiscountedMaintenance,
    totalPriorMaintenance,
    totalLiquid,
    totalPaid,
    balance: paidInFull ? 0 : Math.max(0, totalLiquid - totalPaid),
    paidInFull,
    priorPendingMaintenance,
    expenses,
    discountedMaintenance,
  };
}
