import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Layout, { brand } from "../Layout";
import { supabase } from "../../lib/supabase";

const publicAppEnv = String(process.env.NEXT_PUBLIC_APP_ENV || "").trim().toLowerCase();
const isPreviewUi = ["dev", "development", "preview"].includes(publicAppEnv);
const fase2aEnabled = process.env.NEXT_PUBLIC_FASE_2A_ENABLED === "true";

const fmtMoney = (value) => new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const filterItems = (items, filter) => {
  if (!filter || filter === "todos") return items;
  if (filter === "hoy") return items.filter((item) => item.types?.includes("hoy") || item.types?.includes("cita"));
  if (filter === "vencidos") return items.filter((item) => item.types?.includes("vencido"));
  if (filter === "sin_respuesta") return items.filter((item) => item.types?.includes("sin_respuesta"));
  if (filter === "citas") return items.filter((item) => item.types?.includes("cita"));
  if (filter === "oportunidades") return items.filter((item) => item.types?.includes("oportunidad") || item.opportunityId);
  if (filter === "riesgo") return items.filter((item) => item.types?.includes("riesgo"));
  return items;
};

const tone = {
  critica: { bg: "#fef2f2", color: "#991b1b", border: "#fecaca", label: "Crítica" },
  alta: { bg: "#fffbeb", color: "#92400e", border: "#fde68a", label: "Alta" },
  normal: { bg: "#f9fafb", color: "#374151", border: "#e5e7eb", label: "Normal" },
  bajo: { bg: "#ecfdf5", color: "#047857", border: "#a7f3d0", label: "Bajo" },
};

const filters = [
  ["todos", "Todo"],
  ["hoy", "Hoy"],
  ["vencidos", "Vencidos"],
  ["sin_respuesta", "Sin respuesta"],
  ["citas", "Citas"],
  ["oportunidades", "Oportunidades"],
  ["riesgo", "Riesgo"],
];

const severityRank = { critica: 0, alta: 1, normal: 2, bajo: 3 };
const ACTIVE_INTERVENTION_STATUSES = new Set(["pendiente", "en_seguimiento", "sin_mejora"]);
const signalLabels = {
  sin_respuesta: "Conversación",
  vencido: "Vencido",
  riesgo: "Riesgo",
  cita: "Cita",
  hoy: "Hoy",
  oportunidad: "Oportunidad",
  sin_actividad: "Sin actividad",
};

const textLabels = {
  "new lead": "Nuevo lead",
  new_lead: "Nuevo lead",
  "en atencion": "En atención",
  en_atencion: "En atención",
  contactado: "Contactado",
  "responder conversacion": "Responder conversación",
  responder_conversacion: "Responder conversación",
  pendiente_confirmar: "Pendiente por confirmar",
  confirmada: "Confirmada",
  cancelada: "Cancelada",
  no_show: "No-show",
  realizada: "Realizada",
  evaluable: "Evaluable",
  ausencia_temporal: "Ausencia temporal",
  fuera_temporal: "Fuera temporal",
  sin_configurar: "Sin configurar",
  requiere_revision: "Requiere revisión",
  open: "Abierta",
  closed: "Cerrada",
  critico: "Crítico",
  whatsapp: "WhatsApp",
  "respond.io": "Respond.io",
  visita_agendada: "Visita agendada",
  "cita agendada": "Cita agendada",
  "cita calificada": "Cita calificada",
};

const relevanceStage = {
  cierre_ganado: 10,
  contrato_firma: 9,
  apartado: 8,
  oferta: 7,
  cita_calificada: 6,
  cita_agendada: 5,
  contactado: 4,
  lead: 3,
};

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function labelize(value) {
  const text = String(value || "").trim();
  if (!text) return "n/d";
  const key = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return textLabels[key] || textLabels[text] || text.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanContactName(value) {
  const text = String(value || "").trim();
  if (!text || !/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/.test(text)) return "Contacto sin nombre";
  return text;
}

function formatReviewDate(value) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }).replace(".", "");
}

function formatDateTime(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

function fmtDateTimeShort(value) {
  if (!value) return "Sin sincronización registrada";
  return formatDateTime(value);
}

function displayAction(value, context = {}) {
  const text = String(value || "").trim();
  const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
  if (normalized === "liberar clientes esperando respuesta") {
    const count = String(context.reason || "").match(/(\d+)\s+clientes esperando respuesta/)?.[1];
    return count ? `Revisar y responder hoy los ${count} clientes pendientes` : "Revisar y responder clientes pendientes";
  }
  const actionLabels = {
    "confirmar asistencia y enviar ubicacion": "Confirmar asistencia y enviar ubicación",
    "confirmar asistencia": "Confirmar asistencia",
    "enviar contraoferta revisada": "Enviar contraoferta revisada",
    "preparar apartado y documentos": "Preparar apartado y documentos",
    "retomar contacto y calificar presupuesto": "Retomar contacto y calificar presupuesto",
    "negociar condiciones de renta": "Negociar condiciones de renta",
  };
  if (actionLabels[normalized]) return actionLabels[normalized];
  return labelize(text);
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function interventionContextKey(item) {
  if (item.opportunityId) return `opportunity:${item.opportunityId}`;
  if (item.citaId) return `cita:${item.citaId}`;
  if (item.respondContactId) return `respond:${item.respondContactId}`;
  return `work-item:${item.id}`;
}

function interventionReasonForItem(item) {
  const key = interventionContextKey(item);
  const client = cleanContactName(item.client);
  const property = item.property ? ` · ${item.property}` : "";
  return `${key} · ${client}${property}`.slice(0, 220);
}

function recommendedActionForItem(item) {
  if (item.types?.includes("sin_respuesta")) return "Revisar y responder conversación pendiente";
  if (item.types?.includes("vencido")) return "Revisar seguimiento vencido y definir siguiente acción";
  if (item.types?.includes("riesgo")) return "Revisar riesgo con el asesor y acordar siguiente paso";
  if (item.types?.includes("cita")) return "Confirmar o actualizar la cita";
  return displayAction(item.nextAction) || "Revisar operación y acordar siguiente paso";
}

function findActiveInterventionForItem(item, interventions = []) {
  const reason = normalizeKey(interventionReasonForItem(item));
  return (interventions || []).find((intervention) => (
    ACTIVE_INTERVENTION_STATUSES.has(intervention.status)
    && intervention.advisor_profile_id === item.ownerId
    && normalizeKey(intervention.reason) === reason
  )) || null;
}

function consolidateWorkItems(items) {
  const groups = new Map();
  (items || []).forEach((item) => {
    const relationKey = item.clientId ? `client:${item.clientId}:${item.property || item.opportunityId || item.citaId || ""}` : null;
    const key = relationKey
      || (item.respondContactId ? `respond:${item.respondContactId}` : null)
      || (item.opportunityId ? `opp:${item.opportunityId}` : null)
      || (item.citaId ? `cita:${item.citaId}` : null)
      || `item:${item.id}`;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        ...item,
        client: cleanContactName(item.client),
        ids: [item.id],
        types: unique(item.types || [item.type]),
        signals: unique(item.types || [item.type]),
        reasons: unique([item.reason]),
      });
      return;
    }
    const preferred = (severityRank[item.severity] ?? 9) < (severityRank[current.severity] ?? 9) ? item : current;
    const stage = (relevanceStage[item.stage] || 0) > (relevanceStage[current.stage] || 0) ? item.stage : current.stage;
    groups.set(key, {
      ...current,
      title: preferred.title || current.title,
      severity: preferred.severity || current.severity,
      client: cleanContactName(current.client || item.client),
      property: current.property || item.property,
      stage: stage || current.stage || item.stage,
      nextAction: preferred.nextAction || current.nextAction || item.nextAction,
      dueAt: preferred.dueAt || current.dueAt || item.dueAt,
      risk: ["critico", "alto"].includes(preferred.risk) ? preferred.risk : current.risk || item.risk,
      channel: unique([current.channel, item.channel]).join(" + "),
      conversationStatus: current.conversationStatus || item.conversationStatus,
      opportunityId: current.opportunityId || item.opportunityId,
      respondContactId: current.respondContactId || item.respondContactId,
      respondDeepLink: current.respondDeepLink || item.respondDeepLink,
      confirmationStatus: current.confirmationStatus || item.confirmationStatus,
      citaId: current.citaId || item.citaId,
      citaEstado: current.citaEstado || item.citaEstado,
      citaConfirmacionEstado: current.citaConfirmacionEstado || item.citaConfirmacionEstado,
      citaNotas: current.citaNotas || item.citaNotas,
      ownerId: current.ownerId || item.ownerId,
      ownerName: current.ownerName || item.ownerName,
      ids: unique([...(current.ids || []), item.id]),
      types: unique([...(current.types || []), ...(item.types || [item.type])]),
      signals: unique([...(current.signals || []), ...(item.types || [item.type])]),
      reasons: unique([...(current.reasons || []), item.reason]),
    });
  });
  return [...groups.values()].sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) || String(a.dueAt || "").localeCompare(String(b.dueAt || "")));
}

function priorityGroups(items) {
  const count = (fn) => items.filter(fn).length;
  return [
    {
      key: "sin_respuesta",
      variant: "critica",
      count: count((item) => item.types?.includes("sin_respuesta")),
      label: "clientes esperando respuesta",
      singular: "cliente esperando respuesta",
      filter: "sin_respuesta",
    },
    {
      key: "vencidos",
      variant: "critica",
      count: count((item) => item.types?.includes("vencido")),
      label: "seguimientos vencidos",
      singular: "seguimiento vencido",
      filter: "vencidos",
    },
    {
      key: "riesgo",
      variant: "alta",
      count: count((item) => item.types?.includes("riesgo")),
      label: "oportunidades en riesgo",
      singular: "oportunidad en riesgo",
      filter: "riesgo",
    },
    {
      key: "citas",
      variant: "alta",
      count: count((item) => item.types?.includes("cita") && item.confirmationStatus === "pendiente_confirmar"),
      label: "citas agendadas por confirmar",
      singular: "cita agendada por confirmar",
      filter: "citas",
    },
    {
      key: "hoy",
      variant: "normal",
      count: count((item) => item.types?.includes("hoy")),
      label: "próximas acciones para hoy",
      singular: "próxima acción para hoy",
      filter: "hoy",
    },
  ].filter((group) => group.count > 0);
}

function Badge({ children, variant = "normal" }) {
  const st = tone[variant] || tone.normal;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, border: `1px solid ${st.border}`, background: st.bg, color: st.color, padding: "4px 9px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function Card({ label, value, sub, strong }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 16, boxShadow: "0 1px 3px rgba(17,24,39,.05)" }}>
      <p style={{ margin: 0, color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 900 }}>{label}</p>
      <p style={{ margin: "8px 0 0", color: strong ? brand.red : "#111827", fontSize: 25, fontWeight: 950 }}>{value}</p>
      {sub && <p style={{ margin: "5px 0 0", color: "#6b7280", fontSize: 12, lineHeight: 1.4 }}>{sub}</p>}
    </div>
  );
}

function EmptyModuleNotice({ data }) {
  const coverage = data?.dataCoverage || {};
  const interventions = data?.interventions || [];
  if (coverage.opportunities || coverage.respondSnapshots || interventions.length) return null;
  return (
    <Panel style={{ marginBottom: 16, borderColor: "#fde68a", background: "#fffbeb" }}>
      <strong style={{ color: "#92400e" }}>Fase 2A sin datos cargados todavía.</strong>
      <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 12, lineHeight: 1.45 }}>
        Aún no hay oportunidades registradas en este módulo, no se ha realizado una sincronización de conversaciones
        o no existen intervenciones guardadas. Los indicadores se muestran como estado inicial, no como conclusión comercial definitiva.
      </p>
    </Panel>
  );
}

function LoginPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const login = async (event) => {
    event.preventDefault();
    setError("");
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) setError(loginError.message);
  };
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f4f5f7", fontFamily: "system-ui" }}>
      <form onSubmit={login} style={{ width: "min(420px, calc(100vw - 32px))", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 24, boxShadow: "0 20px 50px rgba(17,24,39,.08)" }}>
        <Badge variant="alta">ENTORNO DEV / PREVIEW</Badge>
        <h1 style={{ margin: "14px 0 8px", fontSize: 26, color: "#111827" }}>Iniciar sesión de prueba</h1>
        <p style={{ margin: "0 0 18px", color: "#6b7280", fontSize: 13 }}>Usa únicamente usuarios autorizados para este entorno.</p>
        <label style={{ display: "block", fontSize: 12, fontWeight: 900, color: "#374151", marginBottom: 6 }}>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        <label style={{ display: "block", fontSize: 12, fontWeight: 900, color: "#374151", margin: "12px 0 6px" }}>Contraseña</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" style={inputStyle} />
        {error && <p style={{ color: "#991b1b", fontSize: 12 }}>{error}</p>}
        <button type="submit" style={{ ...buttonStyle, width: "100%", marginTop: 16 }}>Entrar</button>
      </form>
    </main>
  );
}

const inputStyle = { width: "100%", boxSizing: "border-box", border: "1px solid #d1d5db", borderRadius: 10, padding: "10px 12px", fontSize: 14 };
const buttonStyle = { border: "none", background: brand.red, color: "#fff", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 900, cursor: "pointer" };
const secondaryButtonStyle = { ...buttonStyle, background: "#f9fafb", color: "#374151", border: "1px solid #e5e7eb" };
const ghostLinkStyle = { color: "#374151", textDecoration: "none", border: "1px solid #e5e7eb", background: "#fff", borderRadius: 10, padding: "10px 12px", fontSize: 13, fontWeight: 900 };

function fmtPct(value) {
  if (value === null || value === undefined) return "—";
  return `${Number(value || 0).toFixed(1).replace(".0", "")}%`;
}

function kpiTone(value) {
  if (value === null || value === undefined) return "normal";
  if (value < 40) return "critica";
  if (value < 70) return "alta";
  return "bajo";
}

function reviewDefaultDate() {
  const date = new Date();
  date.setDate(date.getDate() + 2);
  return date.toISOString().slice(0, 10);
}

const interventionStatusLabels = {
  pendiente: "Pendiente",
  en_seguimiento: "En seguimiento",
  corregida: "Corregida",
  sin_mejora: "Sin mejora",
  cerrada_decision_tomada: "Cerrada / decisión tomada",
};

export default function WorkCenterView({ type = "advisor" }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [selectedAdvisor, setSelectedAdvisor] = useState("");
  const [filter, setFilter] = useState("todos");
  const [interventionDraft, setInterventionDraft] = useState(null);
  const [rowInterventionDraft, setRowInterventionDraft] = useState(null);
  const [citaDetail, setCitaDetail] = useState(null);
  const [savingIntervention, setSavingIntervention] = useState(false);
  const [rowInterventionMessage, setRowInterventionMessage] = useState(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncNotice, setSyncNotice] = useState(null);
  const [respondDryRunLoading, setRespondDryRunLoading] = useState(false);
  const [respondDryRunResult, setRespondDryRunResult] = useState(null);
  const [respondPilotSyncLoading, setRespondPilotSyncLoading] = useState(false);
  const [respondPilotSyncResult, setRespondPilotSyncResult] = useState(null);
  const [highlightedIntervention, setHighlightedIntervention] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: current } }) => setSession(current));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, current) => setSession(current));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isPreviewUi && !session) {
      const timer = setTimeout(() => { window.location.href = "/"; }, 300);
      return () => clearTimeout(timer);
    }
  }, [session]);

  useEffect(() => {
    if (!session?.user?.id) {
      setProfile(null);
      setLoading(false);
      return;
    }
    supabase
      .from("profiles")
      .select("id, email, full_name, role_id, active")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data: perfil }) => setProfile(perfil));
  }, [session?.user?.id]);

  const isManagerView = type === "manager";
  const canUseManager = ["admin", "gerente_ventas"].includes(profile?.role_id);
  const isUnassignedSelected = selectedAdvisor === "__unassigned";
  const mode = isManagerView ? (selectedAdvisor && !isUnassignedSelected ? "supervise" : "management") : "mine";
  const canRegisterSupervision = isManagerView && canUseManager && !isUnassignedSelected;
  const canSyncRespond = isManagerView && canUseManager;
  const canRunRespondDryRun = isManagerView && profile?.role_id === "admin";

  const loadData = async ({ sync = false } = {}) => {
    if (!session?.access_token || !profile) return;
    setLoading(true);
    setError("");
    if (!sync) setSyncNotice(null);
    try {
      const params = new URLSearchParams();
      if (isManagerView) params.set("mode", selectedAdvisor && selectedAdvisor !== "__unassigned" ? "supervise" : "management");
      else params.set("mode", "mine");
      if (selectedAdvisor && selectedAdvisor !== "__unassigned") params.set("target", selectedAdvisor);
      const res = await fetch(`/api/ejecutivo/work-center?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo cargar la vista.");
      setData(json);
      setLastUpdatedAt(new Date().toISOString());
      setLastSyncedAt(json?.managementSummary?.respondLastSyncedAt || json?.summary?.respondLastSyncedAt || null);
      if (sync && canSyncRespond) {
        setSyncing(true);
        const syncRes = await fetch("/api/ejecutivo/respond-sync", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const syncJson = await syncRes.json();
        if (!syncRes.ok) setError(syncJson.error || "No se pudo sincronizar Respond.io.");
        else {
          const coverage = syncJson?.result?.coverage;
          if (coverage && !coverage.coverageComplete) {
            setSyncNotice(`Sincronización parcial: ${coverage.contactsScanned || 0} contactos revisados. Motivo: ${coverage.stoppedReason || "cobertura incompleta"}.`);
          } else {
            setSyncNotice(null);
          }
          const refreshed = await fetch(`/api/ejecutivo/work-center?${params.toString()}`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const refreshedJson = await refreshed.json();
          if (refreshed.ok) {
            setData(refreshedJson);
            setLastUpdatedAt(new Date().toISOString());
            setLastSyncedAt(refreshedJson?.managementSummary?.respondLastSyncedAt || refreshedJson?.summary?.respondLastSyncedAt || null);
          }
        }
      }
    } catch (err) {
      setError(err.message || "Error inesperado.");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (profile) loadData();
  }, [profile?.id, selectedAdvisor, type]);

  const consolidatedItems = useMemo(() => consolidateWorkItems(data?.workList || []), [data?.workList]);
  const scopedConsolidatedItems = useMemo(() => (
    isUnassignedSelected ? consolidatedItems.filter((item) => !item.ownerId) : consolidatedItems
  ), [consolidatedItems, isUnassignedSelected]);
  const visibleItems = useMemo(() => filterItems(scopedConsolidatedItems, filter), [scopedConsolidatedItems, filter]);
  const prioritySummaries = useMemo(() => priorityGroups(scopedConsolidatedItems), [scopedConsolidatedItems]);
  const title = isManagerView ? "Mi Gerencia" : "Mi Trabajo";
  const targetName = data?.target?.full_name || data?.target?.email || "";
  const advisorById = useMemo(() => new Map((data?.advisorRows || []).map((advisor) => [advisor.id, advisor])), [data?.advisorRows]);
  const selectedWorkItemId = rowInterventionDraft?.item?.id || citaDetail?.id || null;

  const openIntervention = (payload) => {
    const advisor = advisorById.get(payload.advisorId) || {};
    setInterventionDraft({
      advisorId: payload.advisorId,
      advisorName: payload.advisorName || advisor.name || "Asesor",
      reason: payload.reason || payload.indicators?.join(" + ") || payload.why?.join(" + ") || "Revisión gerencial",
      agreedAction: payload.recommendedAction || "revisar cartera",
      reviewOn: reviewDefaultDate(),
      notes: "",
      indicators: payload.indicators || payload.why || [],
    });
  };

  const openInterventionFollowUp = (id) => {
    setHighlightedIntervention(id);
    setTimeout(() => {
      document.getElementById(`intervention-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  };

  const runRespondDryRun = async () => {
    if (!session?.access_token || !canRunRespondDryRun) return;
    setRespondDryRunLoading(true);
    setRespondDryRunResult(null);
    setError("");
    try {
      const res = await fetch("/api/ejecutivo/respond-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ dryRun: true, limitContacts: 10 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo ejecutar el dry run Respond.io.");
      setRespondDryRunResult(json.result || {});
    } catch (err) {
      setError(err.message || "No se pudo ejecutar el dry run Respond.io.");
    } finally {
      setRespondDryRunLoading(false);
    }
  };

  const runRespondPilotSync = async () => {
    if (!session?.access_token || !canRunRespondDryRun) return;
    setRespondPilotSyncLoading(true);
    setRespondPilotSyncResult(null);
    setError("");
    try {
      const res = await fetch("/api/ejecutivo/respond-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ dryRun: false, limitContacts: 10 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo ejecutar el sync piloto Respond.io.");
      setRespondPilotSyncResult(json.result || {});
    } catch (err) {
      setError(err.message || "No se pudo ejecutar el sync piloto Respond.io.");
    } finally {
      setRespondPilotSyncLoading(false);
    }
  };

  const openRowIntervention = (item) => {
    const active = findActiveInterventionForItem(item, data?.interventions || []);
    if (active?.id) {
      openInterventionFollowUp(active.id);
      return;
    }
    setError("");
    setRowInterventionMessage(null);
    setRowInterventionDraft({
      item,
      advisorId: item.ownerId,
      advisorName: item.ownerName || advisorById.get(item.ownerId)?.name || "Asesor",
      reason: interventionReasonForItem(item),
      agreedAction: recommendedActionForItem(item),
      reviewOn: reviewDefaultDate(),
      notes: "",
    });
    setTimeout(() => document.getElementById("row-intervention-note")?.focus(), 80);
  };

  const closeRowIntervention = () => {
    setRowInterventionDraft(null);
    setRowInterventionMessage(null);
  };

  const submitIntervention = async () => {
    if (!interventionDraft || !session?.access_token) return;
    setSavingIntervention(true);
    setError("");
    try {
      const res = await fetch("/api/ejecutivo/management-intervention", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          advisorProfileId: interventionDraft.advisorId,
          reason: interventionDraft.reason,
          agreedAction: interventionDraft.agreedAction,
          reviewOn: interventionDraft.reviewOn || null,
          notes: interventionDraft.notes,
          indicators: { labels: interventionDraft.indicators },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo registrar la intervención.");
      setInterventionDraft(null);
      if (json.duplicate && json.intervention?.id) setHighlightedIntervention(json.intervention.id);
      await loadData();
    } catch (err) {
      setError(err.message || "No se pudo registrar la intervención.");
    } finally {
      setSavingIntervention(false);
    }
  };

  const submitRowIntervention = async () => {
    if (!rowInterventionDraft || !session?.access_token || savingIntervention) return;
    if (!rowInterventionDraft.advisorId) {
      setRowInterventionMessage({ type: "error", text: "Esta fila no tiene asesor responsable. Primero debe revisarse la asignación." });
      return;
    }
    setSavingIntervention(true);
    setRowInterventionMessage(null);
    try {
      const item = rowInterventionDraft.item;
      const indicators = {
        contextKey: interventionContextKey(item),
        sourceItemId: item.id,
        opportunityId: item.opportunityId || null,
        citaId: item.citaId || null,
        respondContactId: item.respondContactId || null,
        signals: item.signals || item.types || [],
        risk: item.risk || null,
        stage: item.stage || null,
      };
      const contextLines = [
        rowInterventionDraft.notes ? `Nota: ${rowInterventionDraft.notes}` : null,
        `Cliente: ${cleanContactName(item.client)}`,
        item.property ? `Propiedad: ${item.property}` : null,
        `Asesor: ${rowInterventionDraft.advisorName}`,
        `Etapa: ${labelize(item.stage)}`,
        `Riesgo: ${labelize(item.risk || "normal")}`,
        `Próxima acción registrada: ${displayAction(item.nextAction, item)}`,
        `Contexto: ${interventionContextKey(item)}`,
      ].filter(Boolean).join("\n");

      const res = await fetch("/api/ejecutivo/management-intervention", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          advisorProfileId: rowInterventionDraft.advisorId,
          reason: rowInterventionDraft.reason,
          agreedAction: rowInterventionDraft.agreedAction,
          reviewOn: rowInterventionDraft.reviewOn || null,
          notes: contextLines,
          indicators,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo registrar la intervención.");
      const interventionId = json.intervention?.id;
      setRowInterventionMessage({ type: "success", text: json.duplicate ? "Ya existía una intervención activa para esta operación. Abrí el seguimiento." : "Intervención registrada correctamente." });
      if (interventionId) setHighlightedIntervention(interventionId);
      await loadData();
      setTimeout(() => {
        if (interventionId) openInterventionFollowUp(interventionId);
        setRowInterventionDraft(null);
      }, 500);
    } catch (err) {
      setRowInterventionMessage({ type: "error", text: err.message || "No se pudo registrar la intervención. Intenta nuevamente." });
    } finally {
      setSavingIntervention(false);
    }
  };

  const updateInterventionStatus = async (id, status) => {
    if (!session?.access_token) return;
    const res = await fetch("/api/ejecutivo/management-intervention", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ id, status }),
    });
    if (!res.ok) setError("No se pudo actualizar la intervención.");
    else {
      setHighlightedIntervention(id);
      await loadData();
    }
  };

  if (!fase2aEnabled) return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui" }}>Módulo no habilitado.</main>;
  if (!session) return isPreviewUi ? <LoginPanel /> : <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui" }}>Redirigiendo al inicio de sesión...</main>;
  if (!profile || loading && !data) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui" }}>Cargando centro de trabajo...</div>;
  if (isManagerView && !canUseManager) {
    return <Layout view="mi_trabajo" profile={profile}><main style={{ padding: 28 }}><Panel><h1>Sin acceso</h1><p>Tu rol no tiene acceso a Mi Gerencia.</p></Panel></main></Layout>;
  }

  const summary = data?.summary || {};
  const management = data?.managementSummary || {};

  return (
    <Layout view={isManagerView ? "mi_gerencia" : "mi_trabajo"} profile={profile} onLogout={() => supabase.auth.signOut()}>
      <Head><title>{title} · InmoAdmin</title></Head>
      <main style={{ padding: "26px 28px 44px", width: "100%" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
            <div>
              {isPreviewUi && <Badge variant="alta">ENTORNO DEV / PREVIEW</Badge>}
              <h1 style={{ margin: "12px 0 6px", color: "#111827", fontSize: 32, fontWeight: 950 }}>{title}</h1>
              <p style={{ margin: 0, color: "#6b7280", fontSize: 14, maxWidth: 760 }}>
                {isManagerView
                  ? "Centro de trabajo comercial para priorizar intervenciones y supervisar asesores."
                  : "Centro de trabajo personal: prioridades, seguimientos, citas, oportunidades y conversaciones que requieren accion."}
              </p>
              {mode === "supervise" && <p style={{ margin: "10px 0 0", color: brand.red, fontWeight: 900 }}>Modo Supervisión — viendo a {targetName}</p>}
              {isUnassignedSelected && <p style={{ margin: "10px 0 0", color: brand.red, fontWeight: 900 }}>Revisión gerencial — contactos sin asignar</p>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {isManagerView && <a href="/ejecutivo/gerencia-ventas" style={ghostLinkStyle}>Ver análisis completo</a>}
              {canRunRespondDryRun && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <button onClick={runRespondDryRun} disabled={respondDryRunLoading} style={secondaryButtonStyle}>{respondDryRunLoading ? "Ejecutando..." : "Dry run Respond.io"}</button>
                  <span style={{ color: "#6b7280", fontSize: 11, fontWeight: 900 }}>Prueba sin escritura · 10 contactos</span>
                </div>
              )}
              {canRunRespondDryRun && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <button onClick={runRespondPilotSync} disabled={respondPilotSyncLoading} style={secondaryButtonStyle}>{respondPilotSyncLoading ? "Sincronizando..." : "Sync piloto"}</button>
                  <span style={{ color: "#6b7280", fontSize: 11, fontWeight: 900 }}>Sync piloto · 10 contactos</span>
                </div>
              )}
              {canSyncRespond && <button onClick={() => loadData({ sync: true })} disabled={syncing} style={buttonStyle}>{syncing ? "Sincronizando..." : "Sincronizar conversaciones"}</button>}
              <button onClick={() => loadData()} style={secondaryButtonStyle}>Actualizar indicadores</button>
            </div>
            <div style={{ flexBasis: "100%", color: "#6b7280", fontSize: 12, textAlign: "right" }}>
              Actualizado: {fmtDateTimeShort(lastUpdatedAt)} · Última sincronización Respond.io: {fmtDateTimeShort(lastSyncedAt)}
            </div>
          </header>

          {error && <Panel style={{ borderColor: "#fecaca", color: "#991b1b", marginBottom: 16 }}>{error}</Panel>}
          {syncNotice && <Panel style={{ borderColor: "#fde68a", background: "#fffbeb", color: "#92400e", marginBottom: 16 }}>{syncNotice}</Panel>}
          {respondDryRunResult && <RespondDryRunSummary result={respondDryRunResult} />}
          {respondPilotSyncResult && <RespondDryRunSummary result={respondPilotSyncResult} title="Sync piloto Respond.io" message="Sync piloto Respond.io completado." />}
          {loading && <Panel style={{ marginBottom: 16 }}>Actualizando datos...</Panel>}
          <EmptyModuleNotice data={data} />

          {isManagerView && (
            <section style={{ marginBottom: 16 }}>
              <h2 style={{ ...h2, marginBottom: 10 }}>Indicadores gerenciales</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
                <Card label="Meta del equipo" value={fmtMoney(management.metaEquipo)} sub="Comisión nueva mensual objetivo." />
                <Card
                  label="Cerrado nuevo estructurado"
                  value={management.closureCoverage?.structuredNew ? fmtMoney(management.cerradoNuevo) : "Sin datos estructurados"}
                  sub={management.closureCoverage?.pendingClassification ? `${management.closureCoverage.pendingClassification} cierres del periodo pendientes de clasificar.` : "Comisión nueva cerrada con asesor y tipo estructurado."}
                  strong={!!management.closureCoverage?.structuredNew}
                />
                <Card label="Pipeline comisión estimada" value={fmtMoney(management.pipeline)} sub="Comisión estimada en oportunidades abiertas." />
                <Card label="Citas efectivas acumuladas" value={`${management.citasEquipo || 0} de ${management.citasRequeridasAcumuladas || 0}`} sub="Realizadas vs requeridas acumuladas." />
                <Card label="Clientes esperando respuesta" value={management.clientesEsperandoRespuesta || 0} strong={management.clientesEsperandoRespuesta > 0} />
              </div>
            </section>
          )}

          {isManagerView && (
            <section style={{ marginBottom: 16 }}>
              <h2 style={{ ...h2, marginBottom: 10 }}>Indicadores operativos</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
                <Card label="Citas de hoy" value={`${management.citasHoy || 0} de ${management.citasRequeridasHoy || 0}`} sub="Agendadas vs requeridas hoy." />
                <Card label="Conversaciones abiertas" value={management.conversacionesAbiertas || 0} />
                <Card label="Seguimientos vencidos" value={management.seguimientosVencidos || 0} strong={management.seguimientosVencidos > 0} />
                <Card label="Oportunidades en riesgo" value={management.oportunidadesEnRiesgo || 0} strong={management.oportunidadesEnRiesgo > 0} />
                <Card label="Intervenciones" value={`${management.intervencionesPorRegistrar || 0} por registrar`} sub={`${management.intervencionesActivas || 0} activas/en seguimiento.`} />
              </div>
            </section>
          )}

          {!isManagerView && <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, marginBottom: 16 }}>
            <Card label="Citas de hoy" value={summary.todayCitas || 0} />
            <Card label="Citas efectivas acumuladas" value={summary.effectiveCitas || 0} />
            <Card label="Conversaciones abiertas" value={summary.openConversations || 0} />
            <Card label="Esperando respuesta" value={summary.waitingResponses || 0} strong={summary.waitingResponses > 0} />
            <Card label="Seguimientos vencidos" value={summary.overdueActions || 0} strong={summary.overdueActions > 0} />
            <Card label="Pipeline comisión estimada" value={fmtMoney(summary.pipeline)} />
          </section>}

          {isManagerView && (
            <Panel style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <h2 style={h2}>Supervisar</h2>
                  <p style={muted}>Desempeño operativo del equipo para decidir a quién intervenir hoy.</p>
                </div>
                <select value={selectedAdvisor} onChange={(e) => setSelectedAdvisor(e.target.value)} style={inputStyle}>
                  <option value="">Vista gerencial del equipo</option>
                  {(data?.advisorRows || []).map((advisor) => (
                    <option key={advisor.id} value={advisor.isUnassigned ? "__unassigned" : advisor.id}>{advisor.name} · {labelize(advisor.availability)}</option>
                  ))}
                </select>
              </div>
              {!selectedAdvisor && <AdvisorTable advisors={data?.advisorRows || []} onPick={setSelectedAdvisor} />}
            </Panel>
          )}

          {isManagerView && !selectedAdvisor && (
            <section style={{ marginBottom: 16 }}>
              <PeoplePriorities priorities={data?.peoplePriorities || []} onSupervise={setSelectedAdvisor} onIntervene={openIntervention} onFollowUp={openInterventionFollowUp} />
            </section>
          )}

          {isManagerView && !selectedAdvisor && (
            <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(320px, .9fr)", gap: 16, marginBottom: 16 }}>
              <OperationsAttention items={data?.operationsAttention || []} onSupervise={setSelectedAdvisor} />
              <InterventionsTable items={data?.interventions || []} onStatusChange={updateInterventionStatus} highlightedId={highlightedIntervention} />
            </section>
          )}

          <section style={{ display: "grid", gap: 16 }}>
            <Panel>
              <h2 style={h2}>{isManagerView && !selectedAdvisor ? "Prioridades generales" : "Prioridades de hoy"}</h2>
              <p style={muted}>Agregados operativos del día como soporte a las prioridades por asesor.</p>
              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                {prioritySummaries.map((group) => (
                  <PriorityGroup key={group.key} group={group} onView={() => setFilter(group.filter)} />
                ))}
                {prioritySummaries.length === 0 && <p style={muted}>Sin prioridades críticas con los datos actuales.</p>}
              </div>
            </Panel>

            <Panel>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <h2 style={h2}>Lista de trabajo</h2>
                  <p style={muted}>Cliente, propiedad, etapa, actividad, siguiente acción y riesgo.</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0" }}>
                {filters.map(([key, label]) => (
                  <button key={key} onClick={() => setFilter(key)} style={filter === key ? buttonStyle : secondaryButtonStyle}>{label}</button>
                ))}
              </div>
              <WorkTable items={visibleItems} canAudit={canRegisterSupervision} onAudit={async (item) => {
                openRowIntervention(item);
              }} onViewCita={(item) => {
                setRowInterventionMessage(null);
                setCitaDetail(item);
              }} interventions={data?.interventions || []} selectedItemId={selectedWorkItemId} onFollowUp={openInterventionFollowUp} />
            </Panel>
          </section>
        </div>
      </main>
      {interventionDraft && (
        <InterventionModal
          draft={interventionDraft}
          setDraft={setInterventionDraft}
          saving={savingIntervention}
          onClose={() => setInterventionDraft(null)}
          onSubmit={submitIntervention}
        />
      )}
      {rowInterventionDraft && (
        <RowInterventionModal
          draft={rowInterventionDraft}
          setDraft={setRowInterventionDraft}
          message={rowInterventionMessage}
          saving={savingIntervention}
          onClose={closeRowIntervention}
          onSubmit={submitRowIntervention}
        />
      )}
      {citaDetail && (
        <CitaModal item={citaDetail} onClose={() => setCitaDetail(null)} />
      )}
    </Layout>
  );
}

function Panel({ children, style }) {
  return <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 18, boxShadow: "0 1px 3px rgba(17,24,39,.05)", ...style }}>{children}</div>;
}

const h2 = { margin: 0, color: "#111827", fontSize: 18, fontWeight: 950 };
const muted = { margin: "5px 0 0", color: "#6b7280", fontSize: 12, lineHeight: 1.45 };

function PriorityGroup({ group, onView }) {
  const label = group.count === 1 ? group.singular : group.label;
  return (
    <div style={{ border: `1px solid ${tone[group.variant]?.border || "#e5e7eb"}`, borderRadius: 12, padding: 12, background: tone[group.variant]?.bg || "#fcfcfd", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: tone[group.variant]?.color || "#6b7280", flex: "0 0 auto" }} />
        <strong style={{ color: "#111827", fontSize: 14 }}>{group.count} {label}</strong>
      </div>
      <button onClick={onView} style={secondaryButtonStyle}>Ver</button>
    </div>
  );
}

function AdvisorTable({ advisors, onPick }) {
  return (
    <div style={{ overflowX: "auto", marginTop: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {["Asesor", "Citas KPI", "%", "Esperando", "Vencidos", "Riesgo", "Pipeline", "Capacidad", ""].map((h) => <th key={h} style={th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {advisors.map((row) => (
            <tr key={row.id}>
              <td style={td}><strong>{row.name}</strong><div style={muted}>{row.email}</div></td>
              <td style={td}><strong>{row.citasEffective || 0}/{row.citasRequired || 0}</strong></td>
              <td style={td}>{row.kpiCitasPct === null || row.kpiCitasPct === undefined ? <span style={{ color: "#6b7280", fontWeight: 900 }}>No evaluable</span> : <Badge variant={kpiTone(row.kpiCitasPct)}>{fmtPct(row.kpiCitasPct)}</Badge>}</td>
              <td style={td}>{row.summary.waitingResponses}</td>
              <td style={td}>{row.summary.overdueActions}</td>
              <td style={td}>{row.summary.riskOpportunities}</td>
              <td style={td}>{fmtMoney(row.summary.pipeline)}</td>
              <td style={td}><Badge variant={row.capacityWeight > 0 ? "bajo" : "alta"}>{labelize(row.availability)}</Badge></td>
              <td style={td}><button onClick={() => onPick(row.isUnassigned ? "__unassigned" : row.id)} style={secondaryButtonStyle}>Ver</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PeoplePriorities({ priorities, onSupervise, onIntervene, onFollowUp }) {
  return (
    <Panel>
      <h2 style={h2}>Quién requiere mi atención</h2>
      <p style={muted}>Acciones recomendadas según los indicadores actuales.</p>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {priorities.length === 0 && <p style={muted}>Sin asesores que requieran intervención con los datos actuales.</p>}
        {priorities.map((item) => (
          <div key={item.advisorId} style={{ border: `1px solid ${tone[item.variant]?.border || "#e5e7eb"}`, background: tone[item.variant]?.bg || "#fff", borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <strong style={{ color: "#111827", fontSize: 15 }}>{item.advisorName}</strong>
                <p style={{ ...muted, marginTop: 6 }}>{item.why.join(" + ")}</p>
                <p style={{ margin: "8px 0 0", color: "#374151", fontSize: 13 }}>Acción recomendada: <strong>{item.recommendedAction}</strong></p>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => onSupervise(item.advisorId)} style={secondaryButtonStyle}>Supervisar</button>
                {item.activeIntervention?.id ? (
                  <button onClick={() => onFollowUp(item.activeIntervention.id)} style={buttonStyle}>Ver seguimiento</button>
                ) : (
                  <button onClick={() => onIntervene(item)} style={buttonStyle}>Registrar intervención</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function OperationsAttention({ items, onSupervise }) {
  return (
    <Panel>
      <h2 style={h2}>Operaciones que requieren atención</h2>
      <p style={muted}>Solo señales confiables de oportunidades: riesgo, acción vencida o falta de actividad.</p>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {items.length === 0 && <p style={muted}>Sin operaciones atoradas detectables en Fase 2A.</p>}
        {items.map((item) => (
          <div key={item.id} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
            <strong style={{ color: "#111827" }}>{item.client}</strong>
            <p style={muted}>{item.property || item.stage} · {item.advisorName}</p>
            <p style={{ margin: "8px 0", color: "#374151", fontSize: 13 }}>{item.reason}</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => onSupervise(item.advisorId)} style={secondaryButtonStyle}>Supervisar</button>
              {item.respondDeepLink && <a href={item.respondDeepLink} target="_blank" rel="noreferrer" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>Abrir conversación</a>}
              {item.respondContactId && !item.respondDeepLink && <span style={{ color: "#6b7280", fontSize: 12, fontWeight: 900 }}>Sin enlace Respond.io configurado</span>}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function InterventionsTable({ items, onStatusChange, highlightedId }) {
  return (
    <Panel>
      <h2 style={h2}>Seguimiento de intervenciones</h2>
      <p style={muted}>Intervenciones registradas y próximas revisiones.</p>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {items.length === 0 && <p style={muted}>Aún no hay intervenciones registradas.</p>}
        {items.slice(0, 6).map((item) => (
          <div id={`intervention-${item.id}`} key={item.id} style={{ border: `1px solid ${highlightedId === item.id ? brand.red : "#e5e7eb"}`, borderRadius: 12, padding: 12, boxShadow: highlightedId === item.id ? "0 0 0 3px rgba(194,18,47,.10)" : "none" }}>
            <strong style={{ color: "#111827" }}>{item.advisor?.full_name || item.advisor?.email || "Asesor"}</strong>
            <p style={muted}>{item.reason}</p>
            <p style={{ margin: "8px 0", color: "#374151", fontSize: 13 }}>Acción: <strong>{displayAction(item.agreed_action, item)}</strong>{item.review_on ? ` · Revisión ${formatReviewDate(item.review_on)}` : ""}</p>
            <select value={item.status} onChange={(e) => onStatusChange(item.id, e.target.value)} style={{ ...inputStyle, maxWidth: 260 }}>
              {Object.entries(interventionStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function InterventionModal({ draft, setDraft, saving, onClose, onSubmit }) {
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.45)", display: "grid", placeItems: "center", zIndex: 2000, padding: 16 }}>
      <div style={{ width: "min(520px, 100%)", background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: 20, boxShadow: "0 24px 80px rgba(17,24,39,.22)" }}>
        <h2 style={{ ...h2, fontSize: 20 }}>Registrar intervención</h2>
        <p style={{ ...muted, marginBottom: 14 }}>{draft.advisorName}</p>
        <label style={labelStyle}>Motivo</label>
        <input value={draft.reason} onChange={(e) => set("reason", e.target.value)} style={inputStyle} />
        <label style={labelStyle}>Acción acordada</label>
        <input value={draft.agreedAction} onChange={(e) => set("agreedAction", e.target.value)} style={inputStyle} />
        <label style={labelStyle}>Fecha de revisión</label>
        <input type="date" value={draft.reviewOn} onChange={(e) => set("reviewOn", e.target.value)} style={inputStyle} />
        <label style={labelStyle}>Nota breve opcional</label>
        <textarea value={draft.notes} onChange={(e) => set("notes", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={secondaryButtonStyle}>Cancelar</button>
          <button onClick={onSubmit} disabled={saving} style={buttonStyle}>{saving ? "Guardando..." : "Registrar"}</button>
        </div>
      </div>
    </div>
  );
}

function RowInterventionModal({ draft, setDraft, message, saving, onClose, onSubmit }) {
  const item = draft.item;
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.45)", display: "grid", placeItems: "center", zIndex: 2100, padding: 16 }}>
      <div style={{ width: "min(680px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: 20, boxShadow: "0 24px 80px rgba(17,24,39,.22)" }}>
        <h2 style={{ ...h2, fontSize: 20 }}>Intervenir operación</h2>
        <p style={{ ...muted, marginBottom: 14 }}>Revisión ligada a una fila específica de la lista de trabajo.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginBottom: 14 }}>
          <Detail label="Cliente" value={cleanContactName(item.client)} />
          <Detail label="Propiedad" value={item.property || "Sin propiedad vinculada"} />
          <Detail label="Asesor" value={draft.advisorName} />
          <Detail label="Etapa" value={labelize(item.stage)} />
          <Detail label="Riesgo" value={labelize(item.risk || "normal")} />
          <Detail label="Próxima acción registrada" value={displayAction(item.nextAction, item)} />
        </div>
        <Detail label="Señales" value={compactSignals(item).join(" · ") || "Sin señales adicionales"} />
        <label style={labelStyle}>Acción gerencial recomendada</label>
        <input value={draft.agreedAction} onChange={(e) => set("agreedAction", e.target.value)} style={inputStyle} />
        <label style={labelStyle}>Fecha de revisión</label>
        <input type="date" value={draft.reviewOn} onChange={(e) => set("reviewOn", e.target.value)} style={inputStyle} />
        <label style={labelStyle}>Nota para la intervención</label>
        <textarea id="row-intervention-note" value={draft.notes} onChange={(e) => set("notes", e.target.value)} rows={4} placeholder="Opcional: acuerdo, instrucción o contexto para seguimiento." style={{ ...inputStyle, resize: "vertical" }} />
        {message && <p style={{ margin: "10px 0 0", color: message.type === "error" ? "#991b1b" : "#047857", fontSize: 13, fontWeight: 800 }}>{message.text}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button onClick={onClose} disabled={saving} style={secondaryButtonStyle}>Cancelar</button>
          <button onClick={onSubmit} disabled={saving} style={buttonStyle}>{saving ? "Registrando..." : "Registrar intervención"}</button>
        </div>
      </div>
    </div>
  );
}

function CitaModal({ item, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.45)", display: "grid", placeItems: "center", zIndex: 2100, padding: 16 }}>
      <div style={{ width: "min(620px, 100%)", background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: 20, boxShadow: "0 24px 80px rgba(17,24,39,.22)" }}>
        <h2 style={{ ...h2, fontSize: 20 }}>Detalle de cita</h2>
        <p style={{ ...muted, marginBottom: 14 }}>Cita vinculada por ID estable: {item.citaId}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
          <Detail label="Cliente" value={cleanContactName(item.client)} />
          <Detail label="Propiedad" value={item.property || "Sin propiedad vinculada"} />
          <Detail label="Asesor" value={item.ownerName || "Sin asignar"} />
          <Detail label="Fecha y hora" value={formatDateTime(item.dueAt)} />
          <Detail label="Estado de cita" value={labelize(item.citaEstado || item.stage)} />
          <Detail label="Confirmación" value={labelize(item.citaConfirmacionEstado || item.confirmationStatus)} />
          <Detail label="Próxima acción" value={displayAction(item.nextAction, item)} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Detail label="Notas" value={item.citaNotas || "Sin notas registradas"} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} style={buttonStyle}>Volver a Mi Gerencia</button>
        </div>
      </div>
    </div>
  );
}

function RespondDryRunSummary({ result, title = "Dry run Respond.io", message = "Dry run Respond.io completado. No se realizaron escrituras." }) {
  const coverage = result?.coverage || {};
  const metrics = [
    ["processedContacts", result?.processedContacts],
    ["contactsRead", result?.contactsRead],
    ["snapshotsUpserted", result?.snapshotsUpserted],
    ["snapshotsWouldUpsert", result?.snapshotsWouldUpsert],
    ["snapshotsWouldCreate", result?.snapshotsWouldCreate],
    ["snapshotsWouldUpdate", result?.snapshotsWouldUpdate],
    ["matchedProfiles", result?.matchedProfiles],
    ["unmatchedProfiles", result?.unmatchedProfiles],
    ["contactsUnassignedSales", coverage?.contactsUnassignedSales ?? result?.contactsUnassignedSales],
    ["contactsIgnoredOutsideSales", coverage?.contactsIgnoredOutsideSales ?? result?.contactsIgnoredOutsideSales],
    ["messagePagesRead", coverage?.messagePagesRead ?? result?.messagePagesRead],
    ["messageRequests", coverage?.messageRequests ?? result?.messageRequests],
    ["durationMs", coverage?.durationMs ?? result?.durationMs],
    ["coverageComplete", String(coverage?.coverageComplete ?? result?.coverageComplete ?? false)],
    ["stoppedReason", coverage?.stoppedReason ?? result?.stoppedReason ?? "n/d"],
  ];
  return (
    <Panel style={{ borderColor: "#bfdbfe", background: "#eff6ff", marginBottom: 16 }}>
      <h2 style={h2}>{title}</h2>
      <p style={{ ...muted, marginTop: 6 }}>{message}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginTop: 12 }}>
        {metrics.map(([label, value]) => <DryRunMetric key={label} label={label} value={value} />)}
      </div>
    </Panel>
  );
}

function DryRunMetric({ label, value }) {
  return (
    <div style={{ border: "1px solid #dbeafe", borderRadius: 10, padding: "8px 10px", background: "#fff" }}>
      <div style={{ color: "#6b7280", fontSize: 11, fontWeight: 900 }}>{label}</div>
      <div style={{ color: "#111827", fontSize: 15, fontWeight: 950, marginTop: 2 }}>{value ?? "—"}</div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, background: "#f9fafb" }}>
      <p style={{ margin: 0, color: "#6b7280", fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.35 }}>{label}</p>
      <p style={{ margin: "5px 0 0", color: "#111827", fontSize: 13, fontWeight: 800, lineHeight: 1.35 }}>{value || "n/d"}</p>
    </div>
  );
}

function actionForItem(item, canAudit) {
  if (item.types?.includes("cita")) {
    if (item.citaId) return { label: "Ver cita", kind: "cita" };
    return { label: "Cita no vinculada", kind: "info", title: "No existe un registro de cita vinculado a esta actividad." };
  }
  if (item.types?.includes("oportunidad")) return { label: "Actualizar", kind: "pending" };
  return null;
}

function compactSignals(item) {
  const labels = unique(item.signals || item.types || []).map((signal) => signalLabels[signal] || labelize(signal));
  if (item.confirmationStatus && item.types?.includes("cita")) labels.push(labelize(item.confirmationStatus));
  return unique(labels);
}

function ChannelSignals({ item }) {
  const signals = compactSignals(item);
  const visible = signals.slice(0, 3);
  const remaining = signals.length - visible.length;
  const channel = String(item.channel || "n/d")
    .split("+")
    .map((part) => labelize(part.trim()))
    .join(" + ");
  return (
    <div>
      <div style={{ color: "#374151", fontWeight: 800 }}>{channel}{item.conversationStatus ? ` · ${labelize(item.conversationStatus)}` : ""}</div>
      {signals.length > 0 && (
        <div title={signals.join(" · ")} style={{ marginTop: 5, color: "#6b7280", fontSize: 12, lineHeight: 1.35 }}>
          {visible.join(" · ")}{remaining > 0 ? ` · +${remaining}` : ""}
        </div>
      )}
    </div>
  );
}

function WorkTable({ items, onAudit, onViewCita, onFollowUp, interventions = [], selectedItemId = null, canAudit = false }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 1080, borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {["Cliente", "Asesor", "Etapa", "Última actividad", "Próxima acción", "Riesgo", "Canal / señales", "Acción"].map((h) => <th key={h} style={th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td style={td} colSpan={8}>Sin elementos para este filtro.</td></tr>
          ) : items.map((item) => {
            const action = actionForItem(item, canAudit);
            const activeIntervention = findActiveInterventionForItem(item, interventions);
            const canInterveneItem = canAudit && item.opportunityId && item.ownerId;
            return (
              <tr key={item.id} style={selectedItemId === item.id ? { background: "#fff7f7", outline: `2px solid ${brand.red}` } : undefined}>
                <td style={td}><strong>{cleanContactName(item.client)}</strong><div style={muted}>{item.property || ""}</div></td>
                <td style={td}>{item.ownerId ? (item.ownerName || "Sin asignar") : "Sin asignar"}</td>
                <td style={td}>{labelize(item.stage)}</td>
                <td style={td}>{formatDateTime(item.dueAt)}</td>
                <td style={td}>{displayAction(item.nextAction, item)}</td>
                <td style={td}><Badge variant={item.risk === "critico" ? "critica" : item.risk === "alto" ? "alta" : "normal"}>{labelize(item.risk || "normal")}</Badge></td>
                <td style={td}><ChannelSignals item={item} /></td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {item.respondDeepLink && <a href={item.respondDeepLink} target="_blank" rel="noreferrer" style={{ ...secondaryButtonStyle, display: "inline-block", textDecoration: "none" }}>Abrir conversación</a>}
                    {item.respondContactId && !item.respondDeepLink && <span style={{ color: "#6b7280", fontSize: 12, fontWeight: 900 }}>Sin enlace Respond.io configurado</span>}
                    {action?.kind === "cita" && <button onClick={() => onViewCita(item)} style={secondaryButtonStyle}>{action.label}</button>}
                    {action?.kind === "info" && <span title={action.title} style={{ color: "#6b7280", fontSize: 12, fontWeight: 900 }}>{action.label}</span>}
                    {activeIntervention?.id ? (
                      <button onClick={() => onFollowUp(activeIntervention.id)} style={secondaryButtonStyle}>Ver seguimiento</button>
                    ) : canInterveneItem ? (
                      <button onClick={() => onAudit(item)} style={secondaryButtonStyle}>Intervenir</button>
                    ) : null}
                    {action?.kind === "pending" && !activeIntervention?.id && !canInterveneItem && <span style={{ color: "#6b7280", fontSize: 12, fontWeight: 900 }}>Actualización pendiente</span>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const th = { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #e5e7eb", color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 };
const td = { padding: "11px 8px", borderBottom: "1px solid #f3f4f6", color: "#374151", verticalAlign: "top" };
const labelStyle = { display: "block", margin: "12px 0 5px", color: "#374151", fontSize: 12, fontWeight: 900 };
