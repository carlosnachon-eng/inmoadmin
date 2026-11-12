import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const num = (v) => Number(v) || 0;
const todayMx = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

async function authenticate(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return { error: "Sesión requerida", status: 401 };

  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return { error: "Sesión inválida", status: 401 };

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role_id,active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || profile.active === false) {
    return { error: "Perfil sin acceso", status: 403 };
  }
  if (!["consultora_negocios", "admin"].includes(profile.role_id)) {
    return { error: "Acceso reservado a consultoría", status: 403 };
  }
  return { user, profile };
}

const safe = async (query) => {
  try {
    const result = await query;
    return result.error ? [] : (result.data || []);
  } catch {
    return [];
  }
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido" });
  }

  const auth = await authenticate(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const hoy = todayMx();
  const ahora = new Date(hoy + "T12:00:00-06:00");
  const hace30 = new Date(ahora.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const en30 = new Date(ahora.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const monthStart = hoy.slice(0, 8) + "01";

  const [properties, contracts, payments, maintenance, closings, policyRequests] = await Promise.all([
    safe(admin.from("properties").select("id,status,administration_status")),
    safe(admin.from("contracts").select("id,status,start_date,end_date,monthly_rent")),
    safe(admin.from("payments").select("id,status,due_date,amount,payment_date")),
    safe(admin.from("maintenance_tickets").select("id,status,priority,created_at")),
    safe(admin.from("cierres").select("id,estado,anio,mes,comision,pendiente")),
    safe(admin.from("solicitudes_inquilino").select("id,status,created_at")),
  ]);

  const activeContracts = contracts.filter(c => c.status === "activo");
  const expiring30 = activeContracts.filter(c => c.end_date && c.end_date >= hoy && c.end_date <= en30);
  const occupiedProperties = properties.filter(p => ["occupied","ocupada","rentada"].includes(String(p.status || "").toLowerCase()));
  const administeredProperties = properties.filter(p => {
    const s = String(p.administration_status || "").toLowerCase();
    return ["active","activo","administrada","managed"].includes(s);
  });

  const overdue = payments.filter(p => p.status === "atrasado");
  const pending = payments.filter(p => p.status === "pendiente");
  const paid30 = payments.filter(p => p.status === "pagado" && (p.payment_date || p.due_date) >= hace30);
  const collectionBase30 = payments.filter(p => p.due_date >= hace30 && p.due_date <= hoy);
  const due30 = collectionBase30.reduce((s,p) => s + num(p.amount), 0);
  const paidBase30 = collectionBase30.filter(p => p.status === "pagado").reduce((s,p) => s + num(p.amount), 0);

  const openMaintenance = maintenance.filter(m => !["cerrado","cancelado","resuelto"].includes(String(m.status || "").toLowerCase()));
  const urgentMaintenance = openMaintenance.filter(m => ["alta","urgente","critica","crítica"].includes(String(m.priority || "").toLowerCase()));

  const y = Number(hoy.slice(0,4));
  const m = Number(hoy.slice(5,7));
  const monthClosings = closings.filter(c => Number(c.anio) === y && Number(c.mes) === m && c.estado === "activo");
  const commissionsMonth = monthClosings.reduce((s,c) => s + num(c.comision), 0);
  const pendingCommissions = closings.filter(c => c.estado === "activo").reduce((s,c) => s + num(c.pendiente), 0);

  const openPolicies = policyRequests.filter(r => ["pendiente","en_revision","nuevo","en_proceso"].includes(String(r.status || "").toLowerCase()));
  const recentPolicies = policyRequests.filter(r => String(r.created_at || "").slice(0,10) >= monthStart);

  return res.status(200).json({
    generated_at: new Date().toISOString(),
    portfolio: {
      properties_total: properties.length,
      properties_administered: administeredProperties.length,
      properties_occupied: occupiedProperties.length,
      active_contracts: activeContracts.length,
      monthly_rent_active: activeContracts.reduce((s,c) => s + num(c.monthly_rent), 0),
      contracts_expiring_30d: expiring30.length,
    },
    collections: {
      overdue_count: overdue.length,
      overdue_amount: overdue.reduce((s,p) => s + num(p.amount), 0),
      pending_count: pending.length,
      pending_amount: pending.reduce((s,p) => s + num(p.amount), 0),
      paid_last_30d_count: paid30.length,
      due_last_30d_amount: due30,
      paid_on_due_last_30d_amount: paidBase30,
      collection_rate_30d: due30 > 0 ? Math.round((paidBase30 / due30) * 1000) / 10 : null,
    },
    maintenance: {
      open_count: openMaintenance.length,
      urgent_count: urgentMaintenance.length,
    },
    commercial: {
      closings_month: monthClosings.length,
      commissions_month: commissionsMonth,
      pending_commissions: pendingCommissions,
    },
    legal: {
      open_policy_requests: openPolicies.length,
      policy_requests_month: recentPolicies.length,
    },
  });
}
