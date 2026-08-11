import { createClient } from "@supabase/supabase-js";
import {
  buildAdministrativeWorkCenter,
  isAdministrativeWorkCenterRole,
} from "../../../lib/operaciones/administrativeWorkCenter";

const SOURCE_PAGE_SIZE = 1000;

const SOURCE_QUERIES = {
  payments: (client) => client
    .from("payments")
    .select("id, due_date, status, created_at")
    .in("status", ["pendiente", "atrasado"]),
  contracts: (client) => client
    .from("contracts")
    .select("id, end_date, status, created_at")
    .eq("status", "activo"),
  maintenance_tickets: (client) => client
    .from("maintenance_tickets")
    .select("id, assigned_to, priority, status, payer, created_at, updated_at")
    .not("status", "in", '("terminado","cerrado","cancelado")'),
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
    const data = await fetchAllPages(() => makeQuery(client));
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

    const workCenter = buildAdministrativeWorkCenter(sources);
    return res.status(200).json({
      ok: true,
      contractVersion: "2A.2-A",
      generatedAt: workCenter.generatedAt,
      today: workCenter.today,
      viewer: { profileId: profile.id, roleId: profile.role_id },
      summary: workCenter.summary,
      items: workCenter.items,
      sourcesWithError,
    });
  } catch (error) {
    console.error("[administrative-work-center]", error?.message || error);
    return res.status(500).json({ ok: false, error: "No se pudo cargar el Centro Operativo." });
  }
}
