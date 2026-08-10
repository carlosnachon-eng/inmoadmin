import { createClient } from "@supabase/supabase-js";

export const DEV_PROJECT_REF = "hjfwjnejbcpmknvfpdcq";
export const PROD_PROJECT_REF = "bnzrnizrmonjxlktbhlp";
const KNOWN_PROJECT_REFS = new Set([DEV_PROJECT_REF, PROD_PROJECT_REF]);
const PUBLIC_PREVIEW_ENVS = new Set(["dev", "development", "preview"]);

export const SALES_SCOPE = "ventas";
export const MANAGEMENT_ROLES = new Set(["admin", "gerente_ventas"]);
export const ADVISOR_ROLE = "asesor";
export const META_MENSUAL_NUEVA = 380000;
export const META_CITAS_DIARIAS = 2;

export const CITA_CONFIRMACION_ESTADOS = new Set([
  "pendiente_confirmar",
  "confirmada",
  "cancelada",
  "no_show",
  "realizada",
]);

export const RESPOND_CUSTOM_FIELDS = [
  "atn_area",
  "atn_servicio",
  "atn_estado",
  "atn_destino",
  "atn_proxima_accion",
  "atn_fecha_proxima_accion",
  "atn_sla_vencido",
  "ven_presupuesto_compra",
  "ven_renta_mensual_objetivo",
  "ven_plazo",
  "inm_tipo",
  "inm_zona",
];

function normalizedEnv(value) {
  return String(value || "").trim().toLowerCase();
}

export function serverAppEnvironment() {
  const vercel = normalizedEnv(process.env.VERCEL_ENV);
  if (vercel === "production") return "production";
  if (vercel === "preview") return "preview";
  if (vercel === "development") return "development";
  if (vercel) return "unknown";

  const explicit = normalizedEnv(process.env.APP_ENV || process.env.SUPABASE_ENVIRONMENT);
  if (explicit === "production" || explicit === "prod") return "production";
  if (PUBLIC_PREVIEW_ENVS.has(explicit) || explicit === "test") return explicit === "development" ? "development" : "preview";
  return "unknown";
}

export function publicAppEnvironment() {
  const explicit = normalizedEnv(process.env.NEXT_PUBLIC_APP_ENV);
  if (explicit === "production" || explicit === "prod") return "production";
  if (PUBLIC_PREVIEW_ENVS.has(explicit)) return explicit;
  return "unknown";
}

export function isProductionApp() {
  return serverAppEnvironment() === "production";
}

export function isPublicProductionApp() {
  return publicAppEnvironment() === "production";
}

export function isFase2AEnabledServer() {
  return normalizedEnv(process.env.FASE_2A_ENABLED) === "true";
}

export function isFase2AEnabledPublic() {
  return normalizedEnv(process.env.NEXT_PUBLIC_FASE_2A_ENABLED) === "true";
}

function projectRefFromUrl(url) {
  const match = String(url || "").match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
  return match?.[1] || null;
}

export function assertSupabaseEnvironment(url = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const env = serverAppEnvironment();
  const ref = projectRefFromUrl(url);
  if (!url || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("Configuracion Supabase incompleta.");
  }
  if (!ref || !KNOWN_PROJECT_REFS.has(ref)) {
    throw new Error("Bloqueo de seguridad: Supabase project ref desconocido.");
  }
  if (env === "unknown") {
    throw new Error("Bloqueo de seguridad: entorno no reconocido.");
  }
  if (env === "production" && ref !== PROD_PROJECT_REF) {
    throw new Error("Bloqueo de seguridad: Produccion debe usar exclusivamente Supabase Produccion.");
  }
  if (env !== "production" && ref !== DEV_PROJECT_REF) {
    throw new Error("Bloqueo de seguridad: Preview/Development deben usar exclusivamente Supabase DEV.");
  }
  return { env, projectRef: ref };
}

export function assertFase2AEnabled() {
  if (!isFase2AEnabledServer()) {
    const error = new Error("Fase 2A no habilitada en este entorno.");
    error.statusCode = 404;
    throw error;
  }
}

function respondEmailAliases() {
  if (isProductionApp()) return {};
  try {
    const raw = process.env.RESPOND_IO_PROFILE_MAP;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return Object.fromEntries(
      Object.entries(parsed).map(([respondEmail, profileEmail]) => [normalizeEmail(respondEmail), normalizeEmail(profileEmail)])
    );
  } catch {
    return {};
  }
}

export function getServerSupabase(jwt) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assertSupabaseEnvironment(url);
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assertSupabaseEnvironment(url);
  if (!service) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function authHeaderToken(req) {
  const header = req.headers.authorization || "";
  const [, token] = header.match(/^Bearer\s+(.+)$/i) || [];
  return token || null;
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function dateKey(value) {
  return String(value || "").slice(0, 10);
}

export function nowMxDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

export function toIsoFromRespondTimestamp(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const ms = raw > 1e14 ? Math.floor(raw / 1000) : raw;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function fmtMoney(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function pct(value, total, decimals = 1) {
  if (!total) return "n/d";
  return `${((Number(value || 0) / Number(total || 0)) * 100).toFixed(decimals)}%`;
}

export function safeName(profile) {
  return profile?.full_name || profile?.email || "Sin nombre";
}

function snapshotContactName(snapshot) {
  return snapshot?.metadata?.contact_name || snapshot?.metadata?.contactName || "Contacto sin nombre";
}

export function citaConfirmationStatus(cita) {
  if (CITA_CONFIRMACION_ESTADOS.has(cita?.confirmacion_estado)) return cita.confirmacion_estado;
  if (["efectiva", "calificada", "realizada"].includes(cita?.estado)) return "realizada";
  if (cita?.estado === "cancelada") return "cancelada";
  if (cita?.estado === "no_show") return "no_show";
  if (cita?.estado === "confirmada") return "confirmada";
  return "pendiente_confirmar";
}

export function respondInboxLink(contactId) {
  const workspaceId = process.env.RESPOND_IO_WORKSPACE_ID;
  return contactId && workspaceId ? `https://app.respond.io/space/${encodeURIComponent(String(workspaceId))}/inbox/${encodeURIComponent(String(contactId))}` : null;
}

const hasOpenPendingResponse = (item) =>
  Boolean(item?.respond_unanswered_since) &&
  item?.respond_conversation_status === "open";

export function resolveRespondProfile(assignee, profiles) {
  const email = normalizeEmail(assignee?.email);
  const byEmail = new Map((profiles || []).map((profile) => [normalizeEmail(profile.email), profile]));
  if (!email) {
    return { profile: null, status: assignee?.id ? "bot" : "unmatched", method: assignee?.id ? "respond_user_without_email" : "none" };
  }
  const exact = byEmail.get(email);
  if (exact) return { profile: exact, status: "matched", method: "email_exact" };

  const aliasEmail = respondEmailAliases()[email];
  const alias = aliasEmail ? byEmail.get(aliasEmail) : null;
  if (alias) return { profile: alias, status: "matched", method: "dev_alias_email" };

  return { profile: null, status: "unmatched", method: "no_email_match" };
}

export function buildWorkItems({ profileId, opportunities = [], snapshots = [], citas = [], seguimientos = [], profilesById = new Map() }) {
  const today = nowMxDate();
  const items = [];
  const oppById = new Map(opportunities.map((opp) => [opp.id, opp]));

  snapshots
    .filter((snap) => !profileId || snap.mapped_profile_id === profileId)
    .forEach((snap) => {
      if (hasOpenPendingResponse(snap)) {
        items.push({
          id: `respond-${snap.id}`,
          type: "sin_respuesta",
          source: "respond_io",
          types: ["sin_respuesta"],
          severity: "critica",
          title: "Cliente espera respuesta",
          reason: "La ultima actividad detectada en Respond.io fue entrante y no existe respuesta posterior.",
          client: snapshotContactName(snap),
          ownerId: snap.mapped_profile_id,
          ownerName: safeName(profilesById.get(snap.mapped_profile_id)),
          respondContactId: snap.respond_contact_id,
          respondDeepLink: respondInboxLink(snap.respond_contact_id),
          channel: snap.respond_channel_source || "Respond.io",
          stage: snap.respond_lifecycle || "Sin etapa",
          nextAction: snap.atn_proxima_accion || "Responder conversacion",
          dueAt: snap.respond_unanswered_since,
          risk: "critico",
          conversationStatus: snap.respond_conversation_status,
        });
      }
    });

  opportunities
    .filter((opp) => !profileId || opp.asesor_id === profileId)
    .forEach((opp) => {
      const due = opp.next_action_at ? dateKey(opp.next_action_at) : null;
      const stale = opp.last_activity_at ? (Date.now() - new Date(opp.last_activity_at).getTime()) / 36e5 > 96 : true;
      if (hasOpenPendingResponse(opp)) {
        items.push({
          id: `opp-respond-${opp.id}`,
          type: "sin_respuesta",
          source: "oportunidad",
          types: ["sin_respuesta", "oportunidad"],
          severity: "critica",
          title: "Oportunidad con cliente esperando respuesta",
          reason: "La oportunidad tiene metadata de Respond.io con cliente sin respuesta.",
          client: opp.clientes?.nombre || opp.title,
          property: opp.propiedades?.titulo || "",
          ownerId: opp.asesor_id,
          clientId: opp.cliente_id,
          ownerName: safeName(profilesById.get(opp.asesor_id)),
          respondContactId: opp.respond_contact_id,
          respondDeepLink: respondInboxLink(opp.respond_contact_id),
          channel: opp.respond_channel_source || opp.respond_channel || "Respond.io",
          stage: opp.stage,
          nextAction: opp.next_action || "Responder conversacion",
          dueAt: opp.respond_unanswered_since,
          risk: "critico",
          conversationStatus: opp.respond_conversation_status || opp.respond_status,
          opportunityId: opp.id,
        });
      }
      if (opp.next_action_at && due < today) {
        items.push({
          id: `opp-overdue-${opp.id}`,
          type: "vencido",
          source: "oportunidad",
          types: ["vencido", "oportunidad"],
          severity: "critica",
          title: "Seguimiento vencido",
          reason: "La proxima accion formal vencio antes de hoy.",
          client: opp.clientes?.nombre || opp.title,
          property: opp.propiedades?.titulo || "",
          ownerId: opp.asesor_id,
          clientId: opp.cliente_id,
          ownerName: safeName(profilesById.get(opp.asesor_id)),
          respondContactId: opp.respond_contact_id,
          respondDeepLink: respondInboxLink(opp.respond_contact_id),
          channel: opp.respond_channel_source || opp.respond_channel || "Manual",
          stage: opp.stage,
          nextAction: opp.next_action || "Definir siguiente paso",
          dueAt: opp.next_action_at,
          risk: opp.risk_level,
          conversationStatus: opp.respond_conversation_status || opp.respond_status,
          opportunityId: opp.id,
        });
      } else if (opp.next_action_at && due === today) {
        items.push({
          id: `opp-today-${opp.id}`,
          type: "hoy",
          source: "oportunidad",
          types: ["hoy", "oportunidad"],
          severity: "alta",
          title: "Proxima accion hoy",
          reason: "La oportunidad tiene una accion formal programada para hoy.",
          client: opp.clientes?.nombre || opp.title,
          property: opp.propiedades?.titulo || "",
          ownerId: opp.asesor_id,
          clientId: opp.cliente_id,
          ownerName: safeName(profilesById.get(opp.asesor_id)),
          respondContactId: opp.respond_contact_id,
          respondDeepLink: respondInboxLink(opp.respond_contact_id),
          channel: opp.respond_channel_source || opp.respond_channel || "Manual",
          stage: opp.stage,
          nextAction: opp.next_action || "Dar seguimiento",
          dueAt: opp.next_action_at,
          risk: opp.risk_level,
          conversationStatus: opp.respond_conversation_status || opp.respond_status,
          opportunityId: opp.id,
        });
      }
      if (["alto", "critico"].includes(opp.risk_level)) {
        items.push({
          id: `opp-risk-${opp.id}`,
          type: "riesgo",
          source: "oportunidad",
          types: ["riesgo", "oportunidad"],
          severity: opp.risk_level === "critico" ? "critica" : "alta",
          title: "Oportunidad en riesgo",
          reason: opp.risk_reason || "La oportunidad esta marcada con riesgo alto/critico.",
          client: opp.clientes?.nombre || opp.title,
          property: opp.propiedades?.titulo || "",
          ownerId: opp.asesor_id,
          clientId: opp.cliente_id,
          ownerName: safeName(profilesById.get(opp.asesor_id)),
          respondContactId: opp.respond_contact_id,
          respondDeepLink: respondInboxLink(opp.respond_contact_id),
          channel: opp.respond_channel_source || opp.respond_channel || "Manual",
          stage: opp.stage,
          nextAction: opp.next_action || "Intervenir riesgo",
          dueAt: opp.next_action_at || opp.last_activity_at,
          risk: opp.risk_level,
          conversationStatus: opp.respond_conversation_status || opp.respond_status,
          opportunityId: opp.id,
        });
      } else if (stale && !["cierre_ganado", "cierre_perdido"].includes(opp.stage)) {
        items.push({
          id: `opp-stale-${opp.id}`,
          type: "sin_actividad",
          source: "oportunidad",
          types: ["sin_actividad", "oportunidad"],
          severity: "alta",
          title: "Oportunidad sin actividad",
          reason: "No se detecta actividad reciente suficiente para el estado actual.",
          client: opp.clientes?.nombre || opp.title,
          property: opp.propiedades?.titulo || "",
          ownerId: opp.asesor_id,
          clientId: opp.cliente_id,
          ownerName: safeName(profilesById.get(opp.asesor_id)),
          respondContactId: opp.respond_contact_id,
          respondDeepLink: respondInboxLink(opp.respond_contact_id),
          channel: opp.respond_channel_source || opp.respond_channel || "Manual",
          stage: opp.stage,
          nextAction: opp.next_action || "Actualizar oportunidad",
          dueAt: opp.last_activity_at || opp.created_at,
          risk: opp.risk_level,
          conversationStatus: opp.respond_conversation_status || opp.respond_status,
          opportunityId: opp.id,
        });
      } else if (!["cierre_ganado", "cierre_perdido"].includes(opp.stage)) {
        items.push({
          id: `opp-active-${opp.id}`,
          type: "oportunidad",
          source: "oportunidad",
          types: ["oportunidad"],
          severity: "normal",
          title: "Oportunidad activa",
          reason: "Forma parte del pipeline activo y requiere mantenimiento ordinario.",
          client: opp.clientes?.nombre || opp.title,
          property: opp.propiedades?.titulo || "",
          ownerId: opp.asesor_id,
          clientId: opp.cliente_id,
          ownerName: safeName(profilesById.get(opp.asesor_id)),
          respondContactId: opp.respond_contact_id,
          respondDeepLink: respondInboxLink(opp.respond_contact_id),
          channel: opp.respond_channel_source || opp.respond_channel || "Manual",
          stage: opp.stage,
          nextAction: opp.next_action || "Mantener seguimiento",
          dueAt: opp.next_action_at || opp.last_activity_at || opp.created_at,
          risk: opp.risk_level,
          conversationStatus: opp.respond_conversation_status || opp.respond_status,
          opportunityId: opp.id,
        });
      }
    });

  citas
    .filter((cita) => !profileId || cita.asesor_id === profileId)
    .filter((cita) => dateKey(cita.fecha_hora) === today)
    .forEach((cita) => {
      items.push({
        confirmationStatus: citaConfirmationStatus(cita),
        id: `cita-${cita.id}`,
        type: "cita",
        source: "cita",
        types: ["cita"],
        severity: citaConfirmationStatus(cita) === "pendiente_confirmar" ? "alta" : "normal",
        title: "Cita de hoy",
        reason: "Existe una cita programada para hoy con estado de confirmacion operativo.",
        client: cita.clientes?.nombre || "Cliente sin nombre",
        property: cita.propiedades?.titulo || "",
        ownerId: cita.asesor_id,
        clientId: cita.cliente_id,
        citaId: cita.id,
        citaEstado: cita.estado,
        citaConfirmacionEstado: citaConfirmationStatus(cita),
        citaNotas: cita.notas || "",
        ownerName: safeName(profilesById.get(cita.asesor_id)),
        channel: "Cita",
        stage: citaConfirmationStatus(cita),
        nextAction: citaConfirmationStatus(cita) === "pendiente_confirmar" ? "Confirmar asistencia" : "Registrar resultado",
        dueAt: cita.fecha_hora,
        risk: citaConfirmationStatus(cita) === "pendiente_confirmar" ? "normal" : "bajo",
        conversationStatus: "",
      });
    });

  const severityRank = { critica: 0, alta: 1, normal: 2 };
  return items
    .sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) || String(a.dueAt || "").localeCompare(String(b.dueAt || "")))
    .slice(0, 80);
}

export function calculateSummary({ opportunities = [], snapshots = [], citas = [], profileId = null }) {
  const today = nowMxDate();
  const activeOpps = opportunities.filter((opp) => !profileId || opp.asesor_id === profileId).filter((opp) => !["cierre_ganado", "cierre_perdido"].includes(opp.stage));
  const todayCitas = citas.filter((cita) => (!profileId || cita.asesor_id === profileId) && dateKey(cita.fecha_hora) === today);
  const scopedCitas = citas.filter((cita) => !profileId || cita.asesor_id === profileId);
  const appointmentStats = scopedCitas.reduce((acc, cita) => {
    const status = citaConfirmationStatus(cita);
    acc.scheduled += 1;
    if (status === "confirmada") acc.confirmed += 1;
    if (status === "cancelada") acc.cancelled += 1;
    if (status === "no_show") acc.noShow += 1;
    if (status === "realizada") acc.completed += 1;
    if (status === "pendiente_confirmar") acc.pendingConfirmation += 1;
    return acc;
  }, { scheduled: 0, confirmed: 0, cancelled: 0, noShow: 0, completed: 0, pendingConfirmation: 0 });
  const pipeline = activeOpps.reduce((sum, opp) => sum + Number(opp.estimated_commission || 0), 0);
  const waitingStats = waitingResponseStats({ opportunities: activeOpps, snapshots, profileId });
  return {
    todayCitas: todayCitas.length,
    effectiveCitas: appointmentStats.completed,
    appointmentStats,
    openConversations: snapshots.filter((snap) => (!profileId || snap.mapped_profile_id === profileId) && snap.respond_conversation_status === "open").length,
    waitingResponses: waitingStats.uniqueTotal,
    waitingResponseStats: waitingStats,
    overdueActions: activeOpps.filter((opp) => opp.next_action_at && dateKey(opp.next_action_at) < today).length,
    todayActions: activeOpps.filter((opp) => opp.next_action_at && dateKey(opp.next_action_at) === today).length,
    activeOpportunities: activeOpps.length,
    riskOpportunities: activeOpps.filter((opp) => ["alto", "critico"].includes(opp.risk_level)).length,
    pipeline,
  };
}

export function waitingResponseStats({ opportunities = [], snapshots = [], profileId = null }) {
  const snapshotContacts = new Set();
  const opportunityContacts = new Set();
  let synthetic = 0;

  snapshots
    .filter((snap) => (!profileId || snap.mapped_profile_id === profileId) && hasOpenPendingResponse(snap))
    .forEach((snap) => {
      if (snap.respond_contact_id) snapshotContacts.add(`respond:${snap.respond_contact_id}`);
      else snapshotContacts.add(`snapshot:${snap.id || synthetic++}`);
    });

  opportunities
    .filter((opp) => (!profileId || opp.asesor_id === profileId) && hasOpenPendingResponse(opp))
    .forEach((opp) => {
      if (opp.respond_contact_id) opportunityContacts.add(`respond:${opp.respond_contact_id}`);
      else opportunityContacts.add(`opportunity:${opp.id || synthetic++}`);
    });

  const all = new Set([...snapshotContacts, ...opportunityContacts]);
  const consolidated = [...snapshotContacts].filter((key) => opportunityContacts.has(key)).length;
  return {
    uniqueTotal: all.size,
    fromSnapshots: snapshotContacts.size,
    fromOpportunities: opportunityContacts.size,
    consolidated,
  };
}

export function filterItems(items, filter) {
  if (!filter || filter === "todos") return items;
  if (filter === "hoy") return items.filter((item) => item.type === "hoy" || item.type === "cita");
  if (filter === "vencidos") return items.filter((item) => item.type === "vencido");
  if (filter === "sin_respuesta") return items.filter((item) => item.type === "sin_respuesta");
  if (filter === "citas") return items.filter((item) => item.type === "cita");
  if (filter === "oportunidades") return items.filter((item) => item.opportunityId);
  if (filter === "riesgo") return items.filter((item) => item.type === "riesgo" || ["alto", "critico"].includes(item.risk));
  return items;
}
