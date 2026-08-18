import { calculateOwnerLiquidation, maintenanceOwnerBalance } from "./ownerLiquidation.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const ADMINISTRATIVE_WORK_CENTER_ROLES = new Set(["admin", "coord_operaciones"]);
export const ADMINISTRATIVE_BUCKETS = [
  "critico",
  "vencido",
  "para_hoy",
  "requiere_autorizacion",
  "esperando_tercero",
  "proximo",
];

const BUCKET_RANK = new Map(ADMINISTRATIVE_BUCKETS.map((bucket, index) => [bucket, index]));
const PRIORITY_RANK = new Map([["P0", 0], ["P1", 1], ["P2", 2]]);
const CLOSED_MAINTENANCE = new Set(["terminado", "cerrado", "cancelado"]);
const OPEN_STAGE_STATUSES = new Set(["pendiente", "en_proceso", "bloqueada"]);
const EXTERNAL_RESPONSIBLES = new Set([
  "banco",
  "notaria",
  "propietario",
  "comprador",
  "inquilino",
  "proveedor",
]);

const normalize = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\s+/g, "_");

const datePart = (value) => {
  if (!value) return null;
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || null;
};

const utcDay = (value) => {
  const day = datePart(value);
  if (!day) return null;
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
};

const daysBetween = (from, to) => {
  const start = utcDay(from);
  const end = utcDay(to);
  if (start === null || end === null) return null;
  return Math.round((end - start) / DAY_MS);
};

const hoursSince = (value, now) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (now.getTime() - timestamp) / HOUR_MS);
};

const mexicoToday = (now) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(now);

const todayInTimezone = (now, timezone) => {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "America/Mexico_City",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return mexicoToday(now);
  }
};

const combineDateTime = (date, time) => {
  const day = datePart(date);
  if (!day) return null;
  const rawTime = String(time || "23:59:00").match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  const cleanTime = rawTime
    ? `${rawTime[1]}:${rawTime[2]}:${rawTime[3] || "00"}`
    : "23:59:00";
  return `${day}T${cleanTime}-06:00`;
};

const dataQuality = (missingFields = []) => ({
  status: missingFields.length ? "partial" : "complete",
  missingFields,
});

const contextKeyFor = (sourceType, sourceId, ruleKey) => (
  `administrative:${sourceType}:${sourceId}:rule:${ruleKey}`
);

function workItem({
  contextKey: explicitContextKey = null,
  sourceType,
  sourceId,
  ruleKey,
  priority,
  bucket,
  title,
  reason,
  recommendedAction,
  responsibleArea,
  responsibleProfileId = null,
  waitingOn = null,
  dueAt = null,
  lastActivityAt = null,
  href,
  metadata = {},
  missingFields = [],
}) {
  const contextKey = explicitContextKey || contextKeyFor(sourceType, sourceId, ruleKey);
  return {
    id: contextKey,
    contextKey,
    sourceType,
    sourceId: String(sourceId),
    ruleKey,
    priority,
    bucket,
    title,
    reason,
    recommendedAction,
    responsibleArea,
    responsibleProfileId: responsibleProfileId || null,
    waitingOn,
    dueAt,
    lastActivityAt,
    href,
    metadata,
    dataQuality: dataQuality(missingFields),
  };
}

const money = (value) => new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
}).format(Number(value) || 0);

export function sanitizeAdministrativeSourceRows(sourceType, rows = []) {
  if (!["cuotas_condominio", "pagos_servicios", "payments", "owner_payment_receipts"].includes(sourceType)) return rows;
  return rows.map(({ comprobante_url, receipt_url, firma_url, ...row }) => ({
    ...row,
    hasReceipt: Boolean(comprobante_url || receipt_url || firma_url),
    ...(sourceType === "owner_payment_receipts" ? {
      hasTransferReceipt: Boolean(comprobante_url),
      hasSignature: Boolean(firma_url),
    } : {}),
  }));
}

function serviceItems(services, payments, today) {
  const currentPeriod = today.slice(0, 7);
  const paymentByService = new Map();
  (payments || []).forEach((row) => {
    const key = `${row.property_name}:${normalize(row.tipo)}:${row.periodo}`;
    const list = paymentByService.get(key) || [];
    list.push(row);
    paymentByService.set(key, list);
  });

  return (services || []).flatMap((service) => {
    if (!service?.id || service.aplica !== true) return [];
    const type = normalize(service.tipo);
    const frequency = normalize(service.periodicidad);
    const payer = normalize(service.quien_paga);
    const missing = [];
    if (!service.property_name) missing.push("property_name");
    if (!type) missing.push("tipo");
    if (!frequency) missing.push("periodicidad");
    if (!payer) missing.push("quien_paga");
    const expected = frequency === "mensual";
    const rows = paymentByService.get(`${service.property_name}:${type}:${currentPeriod}`) || [];
    const row = rows.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
    const status = normalize(row?.status);
    const hasReceipt = row?.hasReceipt === true;
    const daysUntil = daysBetween(today, row?.fecha_limite);
    let ruleKey;
    let bucket = "para_hoy";
    let priority = "P1";
    let title;
    let reason;
    let action;

    if (row && !status) missing.push("pago.status");
    if (row && !row.fecha_limite && !["pagado", "en_revision"].includes(status)) missing.push("pago.fecha_limite");
    if (!row && ["bimestral", "anual"].includes(frequency)) missing.push("proximo_periodo_esperado");

    if (missing.length || (row && row.property_name !== service.property_name)) {
      ruleKey = "servicio_datos_inconsistentes";
      bucket = "requiere_autorizacion";
      title = "Servicio con información por revisar";
      reason = "Faltan datos estructurados para determinar el control correcto del servicio.";
      action = "Completar o corregir la configuración del servicio antes de continuar.";
    } else if (status === "en_revision" && hasReceipt) {
      ruleKey = "comprobante_servicio_pendiente";
      title = "Comprobante de servicio pendiente de revisión";
      reason = "Se recibió comprobante y todavía no ha sido aplicado o rechazado.";
      action = "Validar el comprobante y aplicar o rechazar el pago.";
    } else if (row && daysUntil !== null && daysUntil < 0 && status !== "pagado") {
      ruleKey = "servicio_vencido";
      bucket = daysUntil <= -10 ? "critico" : "vencido";
      priority = bucket === "critico" ? "P0" : "P1";
      title = "Servicio vencido";
      reason = `El pago de ${type.replace(/_/g, " ")} venció hace ${Math.abs(daysUntil)} días.`;
      action = hasReceipt ? "Validar el comprobante y aplicar o rechazar el pago." : "Confirmar pago y evitar afectación al inmueble.";
    } else if (row && daysUntil !== null && daysUntil <= 7 && status !== "pagado") {
      ruleKey = "servicio_proximo";
      bucket = daysUntil === 0 ? "para_hoy" : "proximo";
      priority = daysUntil === 0 ? "P1" : "P2";
      title = "Pago de servicio próximo";
      reason = daysUntil === 0 ? "El servicio vence hoy." : `El servicio vence en ${daysUntil} días.`;
      action = "Confirmar responsable y programar o validar el pago.";
    } else if (expected && !row) {
      ruleKey = "servicio_periodo_sin_control";
      bucket = Number(today.slice(8, 10)) > 10 ? "vencido" : "para_hoy";
      title = "Servicio sin control del periodo";
      reason = `No existe registro esperado para ${currentPeriod}.`;
      action = "Crear el control del periodo y confirmar fecha límite y responsable de pago.";
    } else if (row?.gasto_id && ["propietario", "inmobiliaria", "emporio"].includes(payer)) {
      ruleKey = "servicio_emporio_por_conciliar";
      bucket = "requiere_autorizacion";
      title = "Servicio pagado por Emporio por conciliar";
      reason = "El servicio está ligado a un gasto por cuenta del propietario.";
      action = "Confirmar que el gasto quede reflejado en la liquidación del propietario.";
    }
    if (!ruleKey) return [];
    return [workItem({
      contextKey: `service:${service.id}:period:${currentPeriod}`,
      sourceType: "servicios",
      sourceId: service.id,
      ruleKey, priority, bucket, title, reason, recommendedAction: action,
      responsibleArea: "Administración",
      waitingOn: ["inquilino", "propietario"].includes(payer) && !hasReceipt ? payer : null,
      dueAt: datePart(row?.fecha_limite),
      lastActivityAt: row?.created_at || null,
      href: "/propiedades",
      metadata: { type, frequency, payer: payer || null, period: currentPeriod, status: status || null, hasReceipt, paidByEmporio: Boolean(row?.gasto_id) },
      missingFields: missing,
    })];
  });
}

function keyItems(rows, now) {
  return (rows || []).flatMap((row) => {
    if (!row?.id || row.activa !== true || row.en_resguardo !== false || !row.fecha_prestamo) return [];
    const daysOut = Math.floor((now.getTime() - new Date(row.fecha_prestamo).getTime()) / DAY_MS);
    if (!Number.isFinite(daysOut) || daysOut < 1) return [];
    return [workItem({
      sourceType: "llaves", sourceId: row.id, ruleKey: "llave_fuera_resguardo",
      priority: daysOut >= 3 ? "P0" : "P1", bucket: daysOut >= 3 ? "critico" : "vencido",
      title: `Llave ${row.numero || "sin número"} fuera de resguardo`,
      reason: `${daysOut} día${daysOut === 1 ? "" : "s"} fuera de resguardo${row.portador_nombre ? ` con ${row.portador_nombre}` : ""}.`,
      recommendedAction: "Contactar al portador y registrar devolución o extensión autorizada.",
      responsibleArea: "Operaciones", waitingOn: row.portador_nombre ? "portador" : null,
      dueAt: row.fecha_prestamo, lastActivityAt: row.fecha_prestamo, href: "/checador",
      metadata: { keyNumber: row.numero || null, propertyName: row.propiedad || null, holder: row.portador_nombre || null, daysOut },
      missingFields: [!row.numero && "numero", !row.propiedad && "propiedad", !row.portador_nombre && "portador_nombre"].filter(Boolean),
    })];
  });
}

function liquidationItems(sources, today) {
  const period = today.slice(0, 7);
  const owners = [...new Set((sources.properties || []).map((row) => row.owner_email).filter(Boolean))];
  return owners.flatMap((ownerEmail) => {
    const result = calculateOwnerLiquidation({
      ownerEmail, period, properties: sources.properties, contracts: sources.contracts,
      payments: sources.payments,
      ownerPayments: (sources.owner_payments || []).map((row) => ({
        ...row,
        period_key: periodKeyFromDescription(row.period_description) || row.period_key,
      })),
      propertyExpenses: sources.property_expenses, maintenanceTickets: sources.maintenance_tickets,
      cashMovements: sources.cash_movements,
    });
    const ownerSourceId = (sources.properties || [])
      .filter((row) => row.owner_email === ownerEmail && row.id)
      .map((row) => String(row.id))
      .sort()[0];
    if (!ownerSourceId) return [];
    const items = [];
    if (result.balance > 0) items.push(workItem({
      contextKey: `owner-liquidation:${ownerSourceId}:period:${period}`,
      sourceType: "owner_liquidations", sourceId: ownerSourceId, ruleKey: result.totalPaid > 0 ? "liquidacion_parcial" : "liquidacion_pendiente",
      priority: "P1", bucket: "requiere_autorizacion",
      title: result.totalPaid > 0 ? "Liquidación parcial con saldo" : "Liquidación pendiente al propietario",
      reason: `${money(result.balance)} pendientes de liquidar sobre rentas efectivamente cobradas.`,
      recommendedAction: "Revisar el cálculo determinístico y autorizar o registrar la entrega al propietario.",
      responsibleArea: "Administración", dueAt: `${period}-10`, href: "/liquidaciones",
      metadata: { period, totalRent: result.totalRent, totalCommission: result.totalRetainableCommission, totalCommissionAccrued: result.totalCommissionAccrued, totalExpenses: result.totalExpenses, totalMaintenance: result.totalDiscountedMaintenance + result.totalPriorMaintenance, totalPaid: result.totalPaid, balance: result.balance, requiresFinancialAuthorization: true },
    }));
    result.priorPendingMaintenance.forEach((ticket) => items.push(workItem({
      sourceType: "maintenance_tickets", sourceId: ticket.id, ruleKey: "mantenimiento_propietario_pendiente_descuento",
      priority: "P1", bucket: "requiere_autorizacion", title: "Mantenimiento pendiente de descontar",
      reason: `${money(maintenanceOwnerBalance(ticket))} pendientes de reflejar en la liquidación del propietario.`,
      recommendedAction: "Revisar y autorizar el descuento en la siguiente liquidación.", responsibleArea: "Administración",
      href: "/liquidaciones", metadata: { period, balance: maintenanceOwnerBalance(ticket), requiresFinancialAuthorization: true },
    })));
    return items;
  });
}

function ownerReceiptItems(rows) {
  return (rows || []).flatMap((row) => {
    if (!row?.id) return [];
    const method = normalize(row.forma_pago);
    const incomplete = (method === "transferencia" && row.hasTransferReceipt !== true)
      || (method === "efectivo" && row.hasSignature !== true);
    if (!incomplete) return [];
    return [workItem({
      sourceType: "owner_payment_receipts", sourceId: row.id, ruleKey: "evidencia_entrega_incompleta",
      priority: "P1", bucket: "requiere_autorizacion", title: "Evidencia de entrega incompleta",
      reason: method === "transferencia" ? "La entrega por transferencia no tiene comprobante registrado." : "La entrega en efectivo no tiene firma registrada.",
      recommendedAction: "Verificar la entrega y adjuntar la evidencia faltante; no ejecutar un nuevo pago desde esta bandeja.",
      responsibleArea: "Administración", dueAt: datePart(row.fecha), lastActivityAt: row.created_at || null,
      href: "/liquidaciones", metadata: { paymentMethod: method, hasReceipt: row.hasReceipt === true, requiresFinancialAuthorization: true },
    })];
  });
}

function periodKeyFromDescription(value) {
  const normalized = normalize(value);
  const year = normalized.match(/(?:19|20)\d{2}/)?.[0];
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const month = months.findIndex((name) => normalized.includes(name));
  return year && month >= 0 ? `${year}-${String(month + 1).padStart(2, "0")}` : null;
}

function condominiumCollectionItems(condominios, unidades, cuotas, today) {
  const activeCondominiums = new Set((condominios || [])
    .filter((row) => row?.id && row.activo !== false)
    .map((row) => String(row.id)));

  const feesByUnit = new Map();
  (cuotas || []).forEach((row) => {
    if (!row?.id || !row.unidad_id || !row.condominio_id) return;
    const unitId = String(row.unidad_id);
    const list = feesByUnit.get(unitId) || [];
    list.push(row);
    feesByUnit.set(unitId, list);
  });

  const currentPeriod = String(today).slice(0, 7);
  const currentDay = Number(String(today).slice(8, 10));

  return (unidades || []).flatMap((unit) => {
    if (!unit?.id || !unit.condominio_id || unit.activo === false) return [];
    const unitId = String(unit.id);
    const condominiumId = String(unit.condominio_id);
    if (!activeCondominiums.has(condominiumId)) return [];

    const unitFees = (feesByUnit.get(unitId) || [])
      .filter((fee) => String(fee.condominio_id) === condominiumId);
    const unpaidFees = unitFees.filter((fee) => normalize(fee.status) !== "pagado");
    const overdueFees = unpaidFees.filter((fee) => {
      const overdueDays = daysBetween(fee.fecha_vencimiento, today);
      return overdueDays !== null && overdueDays >= 1;
    });
    const receiptFees = unpaidFees.filter((fee) => fee.hasReceipt === true);
    const hasCurrentPeriodFee = unitFees.some((fee) => String(fee.periodo || "") === currentPeriod);
    const oldestOverdueDueAt = overdueFees
      .map((fee) => datePart(fee.fecha_vencimiento))
      .filter(Boolean)
      .sort()[0] || null;
    const oldestUnpaidDueAt = unpaidFees
      .map((fee) => datePart(fee.fecha_vencimiento))
      .filter(Boolean)
      .sort()[0] || null;
    const overdueDays = oldestOverdueDueAt === null
      ? 0
      : Math.max(0, daysBetween(oldestOverdueDueAt, today) || 0);
    const overdueBalance = overdueFees.reduce((total, fee) => total + (Number(fee.monto) || 0), 0);
    const latestCreatedAt = unitFees
      .map((fee) => fee.created_at)
      .filter(Boolean)
      .sort()
      .reverse()[0] || null;
    const hasReceipt = receiptFees.length > 0;
    const critical = overdueFees.length >= 2 || overdueDays >= 30;

    let ruleKey = null;
    let priority = "P1";
    let bucket = null;
    let title = null;
    let reason = null;
    let recommendedAction = null;
    let waitingOn = null;
    let dueAt = oldestOverdueDueAt || oldestUnpaidDueAt;

    if (critical) {
      ruleKey = "moroso_critico";
      priority = "P0";
      bucket = "critico";
      title = "Morosidad crítica de condominio";
      reason = `${overdueFees.length} cuota${overdueFees.length === 1 ? "" : "s"} vencida${overdueFees.length === 1 ? "" : "s"}, ${money(overdueBalance)} de saldo y ${overdueDays} días desde el vencimiento más antiguo.`;
      recommendedAction = hasReceipt
        ? "Validar el comprobante pendiente y aplicar el pago antes de continuar la gestión de cobranza."
        : "Gestionar el adeudo hoy y registrar el siguiente compromiso de pago en Condominios.";
      waitingOn = hasReceipt ? null : "condomino";
    } else if (hasReceipt) {
      ruleKey = "comprobante_pendiente_aplicar";
      bucket = "para_hoy";
      title = "Comprobante de cuota pendiente de aplicar";
      reason = "Existe al menos un comprobante asociado a una cuota que todavía no está pagada.";
      recommendedAction = "Validar el comprobante y aplicar o rechazar el pago hoy.";
    } else if (overdueFees.length === 1 && overdueDays >= 5) {
      ruleKey = "moroso_reciente";
      bucket = "vencido";
      title = "Morosidad reciente de condominio";
      reason = `La cuota lleva ${overdueDays} días vencida y representa ${money(overdueBalance)} de saldo.`;
      recommendedAction = "Contactar al condómino y registrar el compromiso de pago.";
      waitingOn = "condomino";
    } else if (overdueFees.length === 1) {
      ruleKey = "cuota_vencida";
      bucket = "vencido";
      title = "Cuota de condominio vencida";
      reason = `La cuota lleva ${overdueDays} día${overdueDays === 1 ? "" : "s"} vencida y representa ${money(overdueBalance)} de saldo.`;
      recommendedAction = "Confirmar recepción del pago o iniciar seguimiento de cobranza.";
      waitingOn = "condomino";
    } else if (!hasCurrentPeriodFee) {
      ruleKey = "cuota_periodo_no_generada";
      bucket = currentDay > 10 ? "vencido" : "para_hoy";
      title = "Cuota mensual de condominio no generada";
      reason = `La unidad activa no tiene una cuota registrada para ${currentPeriod}.`;
      recommendedAction = "Generar y verificar la cuota mensual de la unidad.";
      dueAt = `${currentPeriod}-10`;
    }

    if (!ruleKey) return [];

    return [workItem({
      contextKey: `condominio:${condominiumId}:unidad:${unitId}:cobranza`,
      sourceType: "condominio_cobranza",
      sourceId: unitId,
      ruleKey,
      priority,
      bucket,
      title,
      reason,
      recommendedAction,
      responsibleArea: "administracion_condominios",
      waitingOn,
      dueAt,
      lastActivityAt: latestCreatedAt,
      href: `/condominio/${condominiumId}`,
      metadata: {
        overdueInstallments: overdueFees.length,
        overdueBalance,
        oldestOverdueDueAt,
        overdueDays,
        hasReceipt,
        hasCurrentPeriodFee,
        currentPeriod,
      },
    })];
  });
}

function paymentItems(rows, today) {
  return (rows || []).flatMap((row) => {
    const status = normalize(row.status);
    if (!row.id || !["pendiente", "atrasado", "en_revision"].includes(status)) return [];
    const daysUntil = daysBetween(today, row.due_date);

    if (status === "en_revision" && row.hasReceipt) return [workItem({
      sourceType: "payments", sourceId: row.id, ruleKey: "comprobante_renta_pendiente",
      priority: "P1", bucket: "para_hoy", title: "Comprobante de renta pendiente de revisión",
      reason: "Se recibió comprobante para una renta que todavía no está aplicada.",
      recommendedAction: "Validar el comprobante y aplicar o rechazar el pago.",
      responsibleArea: "Administración", dueAt: datePart(row.due_date), lastActivityAt: row.created_at || null,
      href: "/cobranza", metadata: { status, hasReceipt: true },
    })];
    if (daysUntil === null || daysUntil > 7) return [];

    const overdueDays = Math.max(0, -daysUntil);
    const bucket = overdueDays >= 10
      ? "critico"
      : daysUntil < 0
        ? "vencido"
        : daysUntil === 0
          ? "para_hoy"
          : "proximo";
    const priority = bucket === "critico" ? "P0" : ["vencido", "para_hoy"].includes(bucket) ? "P1" : "P2";

    return [workItem({
      sourceType: "payments",
      sourceId: row.id,
      ruleKey: "renta_pendiente",
      priority,
      bucket,
      title: overdueDays ? "Renta vencida" : daysUntil === 0 ? "Renta para cobrar hoy" : "Cobro próximo",
      reason: overdueDays
        ? `${overdueDays} día${overdueDays === 1 ? "" : "s"} de atraso.`
        : daysUntil === 0
          ? "El cobro vence hoy."
          : `El cobro vence en ${daysUntil} días.`,
      recommendedAction: "Confirmar el cobro y registrar el siguiente paso en Cobranza.",
      responsibleArea: "Administración",
      waitingOn: "inquilino",
      dueAt: datePart(row.due_date),
      lastActivityAt: row.created_at || null,
      href: "/cobranza",
      metadata: { status, daysUntil, overdueDays },
    })];
  });
}

function contractItems(rows, today) {
  return (rows || []).flatMap((row) => {
    if (!row.id || normalize(row.status) !== "activo") return [];
    const daysUntil = daysBetween(today, row.end_date);
    if (daysUntil === null || daysUntil > 30) return [];
    const overdueDays = Math.max(0, -daysUntil);
    const bucket = overdueDays >= 15
      ? "critico"
      : daysUntil < 0
        ? "vencido"
        : daysUntil === 0
          ? "para_hoy"
          : "proximo";

    return [workItem({
      sourceType: "contracts",
      sourceId: row.id,
      ruleKey: "renovacion_contrato",
      priority: bucket === "critico" ? "P0" : ["vencido", "para_hoy"].includes(bucket) ? "P1" : "P2",
      bucket,
      title: "Renovación de contrato",
      reason: daysUntil < 0
        ? `El contrato activo venció hace ${overdueDays} días.`
        : daysUntil === 0
          ? "El contrato vence hoy."
          : `El contrato vence en ${daysUntil} días.`,
      recommendedAction: "Confirmar renovación, terminación o sustitución del contrato.",
      responsibleArea: "Administración",
      dueAt: datePart(row.end_date),
      lastActivityAt: row.created_at || null,
      href: "/contratos",
      metadata: { status: normalize(row.status), daysUntil, overdueDays },
    })];
  });
}

function maintenanceItems(rows, quotes, now) {
  const ticketsWithPendingQuote = new Set((quotes || [])
    .filter((quote) => quote.ticket_id && normalize(quote.status) === "pendiente")
    .map((quote) => String(quote.ticket_id)));

  return (rows || []).flatMap((row) => {
    const status = normalize(row.status);
    if (!row.id || CLOSED_MAINTENANCE.has(status)) return [];
    if (ticketsWithPendingQuote.has(String(row.id))) return [];
    const inactiveHours = hoursSince(row.updated_at || row.created_at, now);
    const urgent = normalize(row.priority) === "urgente";
    if (!urgent && (inactiveHours === null || inactiveHours < 24)) return [];
    const critical = urgent || inactiveHours >= 72;

    return [workItem({
      sourceType: "maintenance_tickets",
      sourceId: row.id,
      ruleKey: "mantenimiento_sin_avance",
      priority: critical ? "P0" : "P1",
      bucket: critical ? "critico" : "para_hoy",
      title: urgent ? "Mantenimiento urgente" : "Mantenimiento sin avance",
      reason: inactiveHours === null
        ? "No existe una fecha válida de última actividad."
        : `${Math.floor(inactiveHours)} horas sin actualización.`,
      recommendedAction: "Asignar la siguiente acción y registrar avance operativo hoy.",
      responsibleArea: "Mantenimiento",
      responsibleProfileId: row.assigned_to || null,
      lastActivityAt: row.updated_at || row.created_at || null,
      href: "/mantenimiento",
      metadata: {
        status,
        priority: normalize(row.priority),
        payer: normalize(row.payer) || null,
        inactiveHours: inactiveHours === null ? null : Math.floor(inactiveHours),
      },
      missingFields: inactiveHours === null ? ["lastActivityAt"] : [],
    })];
  });
}

function quoteItems(rows, now) {
  return (rows || []).flatMap((row) => {
    if (!row.id || normalize(row.status) !== "pendiente") return [];
    const payer = normalize(row.payer);
    const waitingOn = ["propietario", "inquilino"].includes(payer) ? payer : null;
    if (!waitingOn) return [];
    const inactiveHours = hoursSince(row.updated_at || row.created_at, now);

    return [workItem({
      sourceType: "maintenance_quotes",
      sourceId: row.id,
      ruleKey: "cotizacion_esperando_respuesta",
      priority: inactiveHours !== null && inactiveHours >= 72 ? "P1" : "P2",
      bucket: "esperando_tercero",
      title: "Cotización pendiente de respuesta",
      reason: `La cotización sigue pendiente de ${waitingOn}.`,
      recommendedAction: "Confirmar recepción y solicitar aprobación o rechazo de la cotización.",
      responsibleArea: "Mantenimiento",
      waitingOn,
      lastActivityAt: row.updated_at || row.created_at || null,
      href: "/mantenimiento",
      metadata: {
        status: normalize(row.status),
        payer,
        ticketId: row.ticket_id || null,
        inactiveHours: inactiveHours === null ? null : Math.floor(inactiveHours),
      },
    })];
  });
}

function signatureItems(firmas, etapas, now) {
  const stagesBySignature = new Map();
  (etapas || []).forEach((stage) => {
    if (!stage.firma_id || !OPEN_STAGE_STATUSES.has(normalize(stage.status))) return;
    const list = stagesBySignature.get(String(stage.firma_id)) || [];
    list.push(stage);
    stagesBySignature.set(String(stage.firma_id), list);
  });

  return (firmas || []).flatMap((row) => {
    if (!row.id || normalize(row.status) !== "activo") return [];
    const inactiveHours = hoursSince(row.updated_at || row.created_at, now);
    if (inactiveHours === null || inactiveHours < 48) return [];
    const stage = (stagesBySignature.get(String(row.id)) || [])
      .slice()
      .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
    const responsible = normalize(stage?.responsable);
    const waitingOn = EXTERNAL_RESPONSIBLES.has(responsible) ? responsible : null;

    return [workItem({
      sourceType: "firmas",
      sourceId: row.id,
      ruleKey: "firma_sin_avance",
      priority: inactiveHours >= 72 ? "P0" : "P1",
      bucket: inactiveHours >= 72 ? "critico" : waitingOn ? "esperando_tercero" : "para_hoy",
      title: "Firma sin avance",
      reason: `${Math.floor(inactiveHours)} horas sin actualización del expediente.`,
      recommendedAction: "Confirmar el siguiente responsable y actualizar la etapa del expediente.",
      responsibleArea: "Operaciones",
      waitingOn,
      lastActivityAt: row.updated_at || row.created_at || null,
      href: `/firmas/${row.id}`,
      metadata: {
        status: normalize(row.status),
        currentStage: Number(row.etapa_actual || 0),
        stageKey: stage?.clave || null,
        stageStatus: normalize(stage?.status) || null,
        stageResponsible: responsible || null,
        inactiveHours: Math.floor(inactiveHours),
      },
      missingFields: stage ? [] : ["currentStageDetail"],
    })];
  });
}

function signatureAppointmentItems(rows, firmas, today) {
  const activeSignatures = new Set((firmas || [])
    .filter((row) => normalize(row.status) === "activo")
    .map((row) => String(row.id)));

  return (rows || []).flatMap((row) => {
    if (!row.id || !row.firma_id || !activeSignatures.has(String(row.firma_id))) return [];
    const daysUntil = daysBetween(today, row.fecha);
    if (daysUntil === null || daysUntil > 7) return [];
    const bucket = daysUntil < 0 ? "vencido" : daysUntil === 0 ? "para_hoy" : "proximo";
    const dueAt = combineDateTime(row.fecha, row.hora);

    return [workItem({
      sourceType: "firmas_citas",
      sourceId: row.id,
      ruleKey: "cita_firma_pendiente",
      priority: bucket === "vencido" ? "P1" : bucket === "para_hoy" ? "P1" : "P2",
      bucket,
      title: daysUntil < 0 ? "Cita de firma vencida" : daysUntil === 0 ? "Cita de firma para hoy" : "Cita de firma próxima",
      reason: daysUntil < 0
        ? `La cita ocurrió hace ${Math.abs(daysUntil)} días y el expediente sigue activo.`
        : daysUntil === 0
          ? "La cita de firma está programada para hoy."
          : `La cita de firma está programada en ${daysUntil} días.`,
      recommendedAction: "Confirmar resultado de la cita y actualizar el expediente de firma.",
      responsibleArea: "Operaciones",
      dueAt,
      lastActivityAt: row.created_at || null,
      href: `/firmas/${row.firma_id}`,
      metadata: { firmaId: row.firma_id, type: normalize(row.tipo), daysUntil },
    })];
  });
}

function inspectionItems(rows) {
  return (rows || []).flatMap((row) => {
    const status = normalize(row.estatus);
    if (!row.id) return [];
    if (status === "pendiente_autorizacion_propietario") {
      return [workItem({
        sourceType: "inspecciones",
        sourceId: row.id,
        ruleKey: "inspeccion_requiere_autorizacion",
        priority: "P1",
        bucket: "requiere_autorizacion",
        title: "Inspección pendiente de autorización",
        reason: "La inspección requiere autorización explícita del propietario.",
        recommendedAction: "Solicitar y registrar la autorización del propietario.",
        responsibleArea: "Administración",
        waitingOn: "propietario",
        lastActivityAt: row.updated_at || row.created_at || null,
        href: `/inspecciones/${row.id}`,
        metadata: { status },
      })];
    }
    if (status === "pendiente_presupuesto") {
      return [workItem({
        sourceType: "inspecciones",
        sourceId: row.id,
        ruleKey: "inspeccion_pendiente_presupuesto",
        priority: "P2",
        bucket: "esperando_tercero",
        title: "Inspección pendiente de presupuesto",
        reason: "La inspección está esperando un presupuesto para continuar.",
        recommendedAction: "Solicitar o confirmar el presupuesto pendiente.",
        responsibleArea: "Administración",
        waitingOn: "proveedor",
        lastActivityAt: row.updated_at || row.created_at || null,
        href: `/inspecciones/${row.id}`,
        metadata: { status },
      })];
    }
    return [];
  });
}

function policyItems(rows, today) {
  return (rows || []).flatMap((row) => {
    if (!row.id || normalize(row.status) !== "activo") return [];
    const daysUntil = daysBetween(today, row.fecha_vigencia);
    if (daysUntil === null || daysUntil > 30) return [];
    const overdueDays = Math.max(0, -daysUntil);
    const bucket = overdueDays >= 15
      ? "critico"
      : daysUntil < 0
        ? "vencido"
        : daysUntil === 0
          ? "para_hoy"
          : "proximo";

    return [workItem({
      sourceType: "poliza_expedientes",
      sourceId: row.id,
      ruleKey: "vigencia_poliza",
      priority: bucket === "critico" ? "P0" : ["vencido", "para_hoy"].includes(bucket) ? "P1" : "P2",
      bucket,
      title: "Vigencia de póliza",
      reason: daysUntil < 0
        ? `La póliza activa venció hace ${overdueDays} días.`
        : daysUntil === 0
          ? "La póliza vence hoy."
          : `La póliza vence en ${daysUntil} días.`,
      recommendedAction: "Confirmar renovación, cierre o sustitución de la póliza.",
      responsibleArea: "Jurídico",
      dueAt: datePart(row.fecha_vigencia),
      lastActivityAt: row.updated_at || row.created_at || null,
      href: "/poliza",
      metadata: {
        status: normalize(row.status),
        expedienteStatus: normalize(row.status_expediente) || null,
        daysUntil,
        overdueDays,
      },
    })];
  });
}

export function recurringTaskItems(rows, now) {
  return (rows || []).flatMap((row) => {
    if (!row?.id || normalize(row.state) !== "active" || !row.next_due_at) return [];
    const localToday = todayInTimezone(now, row.timezone);
    const localDue = todayInTimezone(new Date(row.next_due_at), row.timezone);
    const daysUntil = daysBetween(localToday, localDue);
    const leadDays = Number(row.lead_days);
    if (daysUntil === null || !Number.isFinite(leadDays) || daysUntil > leadDays) return [];

    const bucket = daysUntil < 0 ? "vencido" : daysUntil === 0 ? "para_hoy" : "proximo";
    const responsible = Array.isArray(row.responsible) ? row.responsible[0] : row.responsible;
    const responsibleInactive = !responsible || responsible.active !== true;
    const reason = daysUntil < 0
      ? `La ejecución programada lleva ${Math.abs(daysUntil)} día${Math.abs(daysUntil) === 1 ? "" : "s"} vencida.`
      : daysUntil === 0
        ? "La ejecución programada corresponde a hoy."
        : `La ejecución programada vence en ${daysUntil} día${daysUntil === 1 ? "" : "s"}.`;

    return [workItem({
      contextKey: `operational-recurring:${row.id}:due:${row.next_due_at}`,
      sourceType: "operational_recurring_task",
      sourceId: row.id,
      ruleKey: "scheduled_occurrence_due",
      priority: bucket === "proximo" ? "P2" : "P1",
      bucket,
      title: row.title || "Tarea operativa recurrente",
      reason: responsibleInactive ? `${reason} El responsable asignado está inactivo o no disponible.` : reason,
      recommendedAction: responsibleInactive
        ? "Reasignar la tarea a un perfil operativo activo antes de confirmar su ejecución."
        : "Abrir Mantenimiento Programado y confirmar la ejecución o ajustar su programación.",
      responsibleArea: "Operaciones",
      responsibleProfileId: row.responsible_profile_id || null,
      dueAt: row.next_due_at,
      lastActivityAt: row.last_completed_at || null,
      href: `/operaciones/tareas-recurrentes?task=${encodeURIComponent(row.id)}`,
      metadata: {
        category: normalize(row.category),
        recurrenceUnit: row.recurrence_unit,
        recurrenceInterval: Number(row.recurrence_interval),
        recurrenceWeekday: row.recurrence_weekday,
        recurrenceMonthDay: row.recurrence_month_day,
        timezone: row.timezone,
        leadDays,
        daysUntil,
        locationType: row.property_id ? "property" : "condominium",
        responsibleActive: !responsibleInactive,
      },
      missingFields: responsibleInactive ? ["responsibleProfileActive"] : [],
    })];
  });
}

export function isAdministrativeWorkCenterRole(roleId) {
  return ADMINISTRATIVE_WORK_CENTER_ROLES.has(String(roleId || ""));
}

export function sortAndDedupeAdministrativeItems(items = []) {
  const byContext = new Map();
  items.filter(Boolean).forEach((item) => {
    const current = byContext.get(item.contextKey);
    if (!current) {
      byContext.set(item.contextKey, item);
      return;
    }
    const currentRank = BUCKET_RANK.get(current.bucket) ?? 99;
    const nextRank = BUCKET_RANK.get(item.bucket) ?? 99;
    if (nextRank < currentRank || (nextRank === currentRank && (PRIORITY_RANK.get(item.priority) ?? 99) < (PRIORITY_RANK.get(current.priority) ?? 99))) {
      byContext.set(item.contextKey, item);
    }
  });

  return [...byContext.values()].sort((a, b) => {
    const bucketDiff = (BUCKET_RANK.get(a.bucket) ?? 99) - (BUCKET_RANK.get(b.bucket) ?? 99);
    if (bucketDiff) return bucketDiff;
    const priorityDiff = (PRIORITY_RANK.get(a.priority) ?? 99) - (PRIORITY_RANK.get(b.priority) ?? 99);
    if (priorityDiff) return priorityDiff;
    const dueA = a.dueAt || "9999-12-31T23:59:59Z";
    const dueB = b.dueAt || "9999-12-31T23:59:59Z";
    if (dueA !== dueB) return dueA.localeCompare(dueB);
    const activityA = a.lastActivityAt || "9999-12-31T23:59:59Z";
    const activityB = b.lastActivityAt || "9999-12-31T23:59:59Z";
    if (activityA !== activityB) return activityA.localeCompare(activityB);
    return a.contextKey.localeCompare(b.contextKey);
  });
}

export function applyAdministrativeCaseControls(items = [], controls = [], options = {}) {
  const caseStatus = options.caseStatus === "resolved" ? "resolved" : "active";
  const byContext = new Map((controls || []).map((row) => [row.context_key, row]));
  return items.map((item) => {
    const control = byContext.get(item.contextKey);
    if (!control) return { ...item, supervision: { status: "unmodified", autonomyMode: "manual" } };
    return {
      ...item,
      bucket: control.corrected_bucket || item.bucket,
      priority: control.corrected_priority || item.priority,
      responsibleProfileId: control.responsible_profile_id || item.responsibleProfileId,
      supervision: {
        status: control.resolution_status === "resolved" ? "resolved" : "modified",
        automationPaused: control.automation_paused === true,
        manualControl: control.manual_control === true,
        requiresAuthorization: control.requires_authorization === true,
        autonomyMode: control.autonomy_mode || "manual",
        updatedAt: control.updated_at || null,
      },
    };
  }).filter((item) => caseStatus === "resolved"
    ? item.supervision.status === "resolved"
    : item.supervision.status !== "resolved");
}

export function buildAdministrativeWorkCenter(sources = {}, options = {}) {
  // regla_pendiente: documentacion_incompleta (solicitudes_inquilino).
  // Reactivar solo cuando exista una señal estructurada no-IA que acredite
  // objetivamente la completitud del expediente, sin notas ni heurísticas.
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const today = options.today || mexicoToday(now);
  const deterministicItems = sortAndDedupeAdministrativeItems([
    ...paymentItems(sources.payments, today),
    ...serviceItems(sources.servicios_inmueble, sources.pagos_servicios, today),
    ...liquidationItems(sources, today),
    ...ownerReceiptItems(sources.owner_payment_receipts),
    ...keyItems(sources.llaves, now),
    ...contractItems(sources.contracts, today),
    ...maintenanceItems(sources.maintenance_tickets, sources.maintenance_quotes, now),
    ...quoteItems(sources.maintenance_quotes, now),
    ...signatureItems(sources.firmas, sources.firma_etapas, now),
    ...signatureAppointmentItems(sources.firmas_citas, sources.firmas, today),
    ...inspectionItems(sources.inspecciones),
    ...policyItems(sources.poliza_expedientes, today),
    ...condominiumCollectionItems(
      sources.condominios,
      sources.unidades_condominio,
      sources.cuotas_condominio,
      today,
    ),
    ...recurringTaskItems(sources.operational_recurring_tasks, now),
  ]);
  const items = sortAndDedupeAdministrativeItems(
    applyAdministrativeCaseControls(deterministicItems, sources.administrative_case_controls, {
      caseStatus: options.caseStatus,
    }),
  );

  const summary = ADMINISTRATIVE_BUCKETS.reduce((acc, bucket) => {
    acc[bucket] = items.filter((item) => item.bucket === bucket).length;
    return acc;
  }, { total: items.length });

  return { items, summary, generatedAt: now.toISOString(), today };
}
