import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Layout, { brand } from "../Layout";
import { supabase } from "../../lib/supabase";

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
  return labelize(text);
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

function LoginPanel() {
  const [email, setEmail] = useState("ari.dev@emporio.test");
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
        <Badge variant="alta">ENTORNO DEV</Badge>
        <h1 style={{ margin: "14px 0 8px", fontSize: 26, color: "#111827" }}>Iniciar sesión DEV</h1>
        <p style={{ margin: "0 0 18px", color: "#6b7280", fontSize: 13 }}>Usa los usuarios sintéticos de inmoadmin-dev para probar Mi Trabajo y Mi Gerencia.</p>
        <label style={{ display: "block", fontSize: 12, fontWeight: 900, color: "#374151", marginBottom: 6 }}>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        <label style={{ display: "block", fontSize: 12, fontWeight: 900, color: "#374151", margin: "12px 0 6px" }}>Contraseña DEV</label>
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
  const [auditNote, setAuditNote] = useState("");
  const [interventionDraft, setInterventionDraft] = useState(null);
  const [savingIntervention, setSavingIntervention] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [highlightedIntervention, setHighlightedIntervention] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: current } }) => setSession(current));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, current) => setSession(current));
    return () => subscription.unsubscribe();
  }, []);

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
  const canRegisterSupervision = isManagerView && mode === "supervise" && canUseManager;

  const loadData = async ({ sync = false } = {}) => {
    if (!session?.access_token || !profile) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (isManagerView) params.set("mode", selectedAdvisor ? "supervise" : "management");
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
      if (sync) {
        setSyncing(true);
        const syncRes = await fetch("/api/ejecutivo/respond-sync", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const syncJson = await syncRes.json();
        if (!syncRes.ok) setError(syncJson.error || "No se pudo sincronizar Respond.io.");
        else {
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
    if (profile) loadData({ sync: true });
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

  if (!session) return <LoginPanel />;
  if (!profile || loading && !data) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui" }}>Cargando centro de trabajo DEV...</div>;
  if (isManagerView && !canUseManager) {
    return <Layout view="mi_trabajo" profile={profile}><main style={{ padding: 28 }}><Panel><h1>Sin acceso</h1><p>Tu rol no tiene acceso a Mi Gerencia.</p></Panel></main></Layout>;
  }

  const summary = data?.summary || {};
  const management = data?.managementSummary || {};

  return (
    <Layout view={isManagerView ? "mi_gerencia" : "mi_trabajo"} profile={profile} onLogout={() => supabase.auth.signOut()}>
      <Head><title>{title} · InmoAdmin DEV</title></Head>
      <main style={{ padding: "26px 28px 44px", width: "100%" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
            <div>
              <Badge variant="alta">ENTORNO DEV · inmoadmin-dev</Badge>
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
              <button onClick={() => loadData({ sync: true })} disabled={syncing} style={buttonStyle}>{syncing ? "Sincronizando..." : "Sincronizar conversaciones"}</button>
              <button onClick={() => loadData()} style={secondaryButtonStyle}>Actualizar indicadores</button>
            </div>
            <div style={{ flexBasis: "100%", color: "#6b7280", fontSize: 12, textAlign: "right" }}>
              Actualizado: {fmtDateTimeShort(lastUpdatedAt)} · Última sincronización Respond.io: {fmtDateTimeShort(lastSyncedAt)}
            </div>
          </header>

          {error && <Panel style={{ borderColor: "#fecaca", color: "#991b1b", marginBottom: 16 }}>{error}</Panel>}
          {loading && <Panel style={{ marginBottom: 16 }}>Actualizando datos DEV...</Panel>}

          {isManagerView && (
            <section style={{ marginBottom: 16 }}>
              <h2 style={{ ...h2, marginBottom: 10 }}>Indicadores gerenciales</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
                <Card label="Meta del equipo" value={fmtMoney(management.metaEquipo)} sub="Comisión nueva mensual objetivo." />
                <Card label="Cerrado ganado del periodo" value={fmtMoney(management.cerradoNuevo)} sub="Comisión nueva cerrada." strong />
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
                if (!item.opportunityId) return;
                const res = await fetch("/api/ejecutivo/work-center-event", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
                  body: JSON.stringify({ opportunityId: item.opportunityId, actedAsProfileId: item.ownerId, notes: auditNote || `Intervencion desde ${title}` }),
                });
                if (!res.ok) setError("No se pudo registrar la intervención.");
                else {
                  setAuditNote("");
                  await loadData();
                }
              }} />
              {canRegisterSupervision && (
                <input value={auditNote} onChange={(e) => setAuditNote(e.target.value)} placeholder="Nota breve para intervención gerencial" style={{ ...inputStyle, marginTop: 12 }} />
              )}
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

function actionForItem(item, canAudit) {
  if (canAudit && item.opportunityId) return { label: "Intervenir", kind: "audit" };
  if (item.types?.includes("oportunidad")) return { label: "Actualizar", kind: "pending" };
  if (item.types?.includes("cita")) return { label: "Ver cita", kind: "pending" };
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
  return (
    <div>
      <div style={{ color: "#374151", fontWeight: 800 }}>{labelize(item.channel)}{item.conversationStatus ? ` · ${labelize(item.conversationStatus)}` : ""}</div>
      {signals.length > 0 && (
        <div title={signals.join(" · ")} style={{ marginTop: 5, color: "#6b7280", fontSize: 12, lineHeight: 1.35 }}>
          {visible.join(" · ")}{remaining > 0 ? ` · +${remaining}` : ""}
        </div>
      )}
    </div>
  );
}

function WorkTable({ items, onAudit, canAudit = false }) {
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
            return (
              <tr key={item.id}>
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
                    {action?.kind === "audit" && <button onClick={() => onAudit(item)} style={secondaryButtonStyle}>{action.label}</button>}
                    {action?.kind === "pending" && <button type="button" disabled style={{ ...secondaryButtonStyle, opacity: 0.55, cursor: "not-allowed" }}>{action.label}</button>}
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
