import { createClient } from "@supabase/supabase-js";
import {
  buildAdministrativeWorkCenter,
  isAdministrativeWorkCenterRole,
  sanitizeAdministrativeSourceRows,
} from "../../../lib/operaciones/administrativeWorkCenter";

const SOURCE_PAGE_SIZE = 1000;

const SOURCE_QUERIES = {
  payments: (client) => client
    .from("payments")
    .select("id, contract_id, property_name, due_date, payment_date, amount, status, recibido_por, receipt_url, created_at"),
  contracts: (client) => client
    .from("contracts")
    .select("id, property_name, start_date, end_date, status, monthly_rent, commission_type, commission_value, rent_receiver, created_at"),
  maintenance_tickets: (client) => client
    .from("maintenance_tickets")
    .select("id, property_name, assigned_to, priority, status, payer, charged_amount, advance_paid, advance_amount, descontado_de_liquidacion, fecha_cobro_propietario, recibo_cobro_id, created_at, updated_at"),
  maintenance_quotes: (client) => client
    .from("maintenance_quotes")
    .select("id, ticket_id, payer, status, created_at, updated_at")
    .eq("status", "pendiente"),
  firmas: (client) => client
    .from("firmas")
    .select("id, status, etapa_actual, created_at, updated_at")
    .eq("status", "activo"),
  firma_etapas: (client) => client
    .from("firma_etapas")
    .select("id, firma_id, orden, clave, responsable, status, created_at")
    .in("status", ["pendiente", "en_proceso", "bloqueada"]),
  firmas_citas: (client) => client
    .from("firmas_citas")
    .select("id, firma_id, tipo, fecha, hora, created_at"),
  inspecciones: (client) => client
    .from("inspecciones")
    .select("id, estatus, fecha, created_at, updated_at")
    .in("estatus", ["pendiente_presupuesto", "pendiente_autorizacion_propietario"]),
  poliza_expedientes: (client) => client
    .from("poliza_expedientes")
    .select("id, status, status_expediente, fecha_vigencia, created_at, updated_at")
    .eq("status", "activo"),
  condominios: (client) => client
    .from("condominios")
    .select("id, activo"),
  unidades_condominio: (client) => client
    .from("unidades_condominio")
    .select("id, condominio_id, activo"),
  cuotas_condominio: (client) => client
    .from("cuotas_condominio")
    .select("id, condominio_id, unidad_id, periodo, monto, status, fecha_vencimiento, comprobante_url, created_at"),
  operational_recurring_tasks: (client) => client
    .from("operational_recurring_tasks")
    .select("id, title, category, responsible_profile_id, property_id, condominium_id, recurrence_unit, recurrence_interval, recurrence_weekday, recurrence_month_day, timezone, next_due_at, lead_days, state, last_completed_at, responsible:profiles!operational_recurring_tasks_responsible_profile_id_fkey(id, active)"),
  servicios_inmueble: (client) => client
    .from("servicios_inmueble")
    .select("id, property_name, contract_id, tipo, periodicidad, dia_corte, dia_limite_pago, aplica, quien_paga, created_at")
    .eq("aplica", true),
  pagos_servicios: (client) => client
    .from("pagos_servicios")
    .select("id, servicio_id, contract_id, property_name, tipo, periodo, status, monto, fecha_limite, comprobante_url, gasto_id, created_at"),
  properties: (client) => client
    .from("properties")
    .select("id, name, owner_email"),
  owner_payments: (client) => client
    .from("owner_payments")
    .select("id, owner_email, period_description, amount_paid, status, payment_date, created_at"),
  owner_payment_receipts: (client) => client
    .from("owner_payment_receipts")
    .select("id, owner_email, periodo, concepto, forma_pago, comprobante_url, firma_url, fecha, created_at"),
  property_expenses: (client) => client
    .from("property_expenses")
    .select("id, property_name, category, amount, paid_by, date, created_at"),
  comisiones_admin: (client) => client
    .from("comisiones_admin")
    .select("id, contract_id, monto, periodo, tipo, status, fecha_cobro, created_at"),
  cash_movements: (client) => client
    .from("cash_movements")
    .select("id, type, category, description, amount, date")
    .eq("type", "entrada")
    .eq("category", "renta_cobrada"),
  llaves: (client) => client
    .from("llaves")
    .select("id, numero, propiedad, portador_nombre, activa, en_resguardo, fecha_prestamo"),
  administrative_case_controls: (client) => client
    .from("administrative_case_controls")
    .select("context_key, corrected_bucket, corrected_priority, responsible_profile_id, resolution_status, automation_paused, manual_control, requires_authorization, autonomy_mode, updated_at"),
  administrative_profiles: (client) => client
    .from("profiles")
    .select("id, full_name, role_id, active")
    .eq("active", true),
  administrative_work_items: (client) => client
    .from("administrative_work_items")
    .select("id,domain,work_type,title,status,priority,client_identity_id,contract_id,property_id,condominium_id,unit_id,responsible_area,responsible_profile_id,next_step,follow_up_at,information_received_at,requires_authorization,duplicate_of_id,created_at,updated_at")
    .order("updated_at", { ascending: false }),
  administrative_work_evidence: (client) => client
    .from("administrative_work_evidence").select("id,work_item_id,evidence_type,summary_safe,received_at"),
  administrative_work_history: (client) => client
    .from("administrative_work_history").select("id,work_item_id,action_type,actor_type,created_at").order("created_at", { ascending: false }),
  administrative_work_approvals: (client) => client
    .from("administrative_work_approvals").select("id,work_item_id,approval_type,status,created_at").eq("status", "pending"),
};

const durablePresentation = (row, sources) => {
  const evidence = (sources.administrative_work_evidence || []).filter((x) => x.work_item_id === row.id);
  const history = (sources.administrative_work_history || []).filter((x) => x.work_item_id === row.id).slice(0, 10);
  const approvals = (sources.administrative_work_approvals || []).filter((x) => x.work_item_id === row.id);
  return {
    contextKey: `durable:${row.id}`, durableWorkItemId: row.id, sourceType: "administrative_work",
    title: row.title, reason: `Trabajo durable · ${row.domain}`, recommendedAction: row.next_step || "Revisar seguimiento operativo.",
    priority: row.priority, bucket: row.requires_authorization ? "requiere_autorizacion" : row.follow_up_at ? "proximo" : "para_hoy",
    presentationCategory: "operational", responsibleArea: row.responsible_area || "Administración",
    responsibleProfileId: row.responsible_profile_id, dueAt: row.follow_up_at, lastActivityAt: row.updated_at,
    href: `/mi-trabajo-administrativo?workItemId=${encodeURIComponent(row.id)}`,
    supervision: { requiresAuthorization: Boolean(row.requires_authorization), status: "durable" },
    metadata: { domain: row.domain, workType: row.work_type, status: row.status, clientIdentityId: row.client_identity_id, contractId: row.contract_id, propertyId: row.property_id, condominiumId: row.condominium_id, unitId: row.unit_id, evidenceCount: evidence.length, history, approvals },
  };
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase no configurado");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getAuthenticatedClient(token) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase no configurado");
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

async function fetchAllPages(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += SOURCE_PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + SOURCE_PAGE_SIZE - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < SOURCE_PAGE_SIZE) return rows;
  }
}

async function loadSource(client, sourceType, makeQuery) {
  try {
    const data = sanitizeAdministrativeSourceRows(
      sourceType,
      await fetchAllPages(() => makeQuery(client)),
    );
    return { sourceType, data, error: null };
  } catch (error) {
    console.error(`[administrative-work-center:${sourceType}]`, error?.code || "query_error", error?.message || error);
    return {
      sourceType,
      data: [],
      error: {
        sourceType,
        code: error?.code || "SOURCE_UNAVAILABLE",
        message: `No se pudo consultar ${sourceType}.`,
      },
    };
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ ok: false, error: "Método no permitido." });
  }

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "Sesión requerida." });

  try {
    const authenticated = getAuthenticatedClient(token);
    const { data: { user }, error: userError } = await authenticated.auth.getUser(token);
    if (userError || !user) return res.status(401).json({ ok: false, error: "Sesión inválida." });

    const { data: profile, error: profileError } = await authenticated
      .from("profiles")
      .select("id, role_id, active")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile?.active) return res.status(403).json({ ok: false, error: "Perfil inactivo o no autorizado." });
    if (!isAdministrativeWorkCenterRole(profile.role_id)) {
      return res.status(403).json({ ok: false, error: "Centro Operativo no autorizado para este rol." });
    }

    const admin = getAdminClient();
    const results = await Promise.all(Object.entries(SOURCE_QUERIES)
      .map(([sourceType, makeQuery]) => loadSource(admin, sourceType, makeQuery)));

    const sources = {};
    const sourcesWithError = [];
    results.forEach((result) => {
      sources[result.sourceType] = result.data;
      if (result.error) sourcesWithError.push(result.error);
    });

    const caseStatus = req.query.status === "resolved" ? "resolved" : "active";
    const workCenter = buildAdministrativeWorkCenter(sources, { caseStatus });
    const durableItems = (sources.administrative_work_items || [])
      .filter((row) => caseStatus === "resolved" ? row.status === "resolved" : !["resolved", "cancelled"].includes(row.status))
      .map((row) => durablePresentation(row, sources));
    return res.status(200).json({
      ok: true,
      contractVersion: "3C-WORK-DURABLE-R1",
      generatedAt: workCenter.generatedAt,
      today: workCenter.today,
      viewer: { profileId: profile.id, roleId: profile.role_id },
      caseStatus,
      responsibleOptions: (sources.administrative_profiles || []).map((row) => ({
        id: row.id,
        name: row.full_name || "Perfil operativo",
        roleId: row.role_id,
      })),
      summary: workCenter.summary,
      items: [...durableItems, ...workCenter.items.filter((item) => !durableItems.some((durable) => durable.contextKey === item.contextKey))],
      durableItems,
      capabilities: { r0: true, r1Enabled: process.env.SHADOW_ADMIN_WORK_R1_ENABLED === "true" },
      sourcesWithError,
    });
  } catch (error) {
    console.error("[administrative-work-center]", error?.message || error);
    return res.status(500).json({ ok: false, error: "No se pudo cargar el Centro Operativo." });
  }
}
