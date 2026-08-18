import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Layout, { brand } from "../components/Layout";
import { supabase } from "../lib/supabase";

const BUCKETS = [
  ["critico", "Críticos", "#991b1b", "#fef2f2", "#fecaca"],
  ["vencido", "Vencidos", "#9f1239", "#fff1f2", "#fecdd3"],
  ["para_hoy", "Para hoy", "#92400e", "#fffbeb", "#fde68a"],
  ["esperando_tercero", "Esperando tercero", "#1d4ed8", "#eff6ff", "#bfdbfe"],
  ["requiere_autorizacion", "Requiere autorización", "#6b21a8", "#faf5ff", "#e9d5ff"],
  ["proximo", "Próximos", "#166534", "#f0fdf4", "#bbf7d0"],
];

const BUCKET_STYLE = Object.fromEntries(BUCKETS.map(([key, label, color, bg, border]) => [key, {
  label, color, bg, border,
}]));

const SOURCE_LABELS = {
  payments: "Cobranza",
  contracts: "Contratos",
  maintenance_tickets: "Mantenimiento",
  maintenance_quotes: "Cotizaciones",
  firmas: "Firmas",
  firmas_citas: "Citas de firma",
  inspecciones: "Inspecciones",
  poliza_expedientes: "Pólizas",
  condominio_cobranza: "Condominios",
  operational_recurring_task: "Mantenimiento programado",
  servicios: "Servicios",
  owner_liquidations: "Liquidaciones",
  llaves: "Llaves",
};

const formatDate = (value) => {
  if (!value) return "Sin fecha límite";
  const rawValue = String(value);
  const date = new Date(rawValue.length === 10 ? `${rawValue}T12:00:00-06:00` : rawValue);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return date.toLocaleString("es-MX", rawValue.length === 10
    ? { dateStyle: "medium" }
    : { dateStyle: "medium", timeStyle: "short" });
};

export default function MiTrabajoAdministrativo() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sourceFilter, setSourceFilter] = useState("todos");
  const [responsibleFilter, setResponsibleFilter] = useState("todos");
  const [supervisionFilter, setSupervisionFilter] = useState("todos");
  const [history, setHistory] = useState({ contextKey: null, actions: [], loading: false });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: current } }) => {
      setSession(current);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, current) => {
      setSession(current);
      setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!session?.user?.id) {
      setProfile(null);
      setLoading(false);
      const timer = setTimeout(() => { window.location.href = "/"; }, 400);
      return () => clearTimeout(timer);
    }
    supabase
      .from("profiles")
      .select("id, role_id, active")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data: nextProfile, error: profileError }) => {
        if (profileError || !nextProfile) {
          setError("No se pudo validar el perfil.");
          setLoading(false);
        }
        setProfile(nextProfile || null);
      });
  }, [authReady, session?.user?.id]);

  const authorized = profile?.active && ["admin", "coord_operaciones"].includes(profile?.role_id);

  const loadData = useCallback(async () => {
    if (!session?.access_token || !authorized) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/operaciones/work-center", {
        method: "GET",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "No se pudo cargar la bandeja.");
      setData(json);
    } catch (loadError) {
      setError(loadError.message || "No se pudo cargar la bandeja.");
    } finally {
      setLoading(false);
    }
  }, [authorized, session?.access_token]);

  useEffect(() => {
    if (profile && !authorized) setLoading(false);
    if (authorized) loadData();
  }, [authorized, loadData, profile]);

  const summaries = useMemo(() => BUCKETS.map(([key, label, color, bg, border]) => ({
    key, label, color, bg, border, count: Number(data?.summary?.[key] || 0),
  })), [data?.summary]);

  const visibleItems = useMemo(() => (data?.items || []).filter((item) => {
    if (sourceFilter !== "todos" && item.sourceType !== sourceFilter) return false;
    if (responsibleFilter === "asignado" && !item.responsibleProfileId) return false;
    if (responsibleFilter === "sin_asignar" && item.responsibleProfileId) return false;
    if (supervisionFilter === "autorizacion" && !(item.supervision?.requiresAuthorization || item.bucket === "requiere_autorizacion")) return false;
    if (supervisionFilter === "manual" && !item.supervision?.manualControl) return false;
    if (supervisionFilter === "corregido" && item.supervision?.status !== "modified") return false;
    return true;
  }), [data?.items, responsibleFilter, sourceFilter, supervisionFilter]);

  const supervise = async (item, actionType, value = {}) => {
    const response = await fetch("/api/operaciones/administrative-cases", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contextKey: item.contextKey, actionType, value }),
    });
    const json = await response.json();
    if (!response.ok) { setError(json.error || "No se pudo guardar la supervisión."); return; }
    await loadData();
  };

  const loadHistory = async (contextKey) => {
    if (history.contextKey === contextKey) { setHistory({ contextKey: null, actions: [], loading: false }); return; }
    setHistory({ contextKey, actions: [], loading: true });
    const response = await fetch(`/api/operaciones/administrative-cases?contextKey=${encodeURIComponent(contextKey)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await response.json();
    setHistory({ contextKey, actions: response.ok ? json.actions || [] : [], loading: false });
  };

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  if (authReady && profile && !authorized) {
    return (
      <Layout view="mi_trabajo_administrativo" profile={profile} onLogout={logout}>
        <main style={{ padding: 28 }}>
          <div style={{ maxWidth: 720, background: "#fff", border: `1px solid ${brand.border}`, borderRadius: 14, padding: 24 }}>
            <h1 style={{ margin: "0 0 8px", color: brand.gray }}>Acceso no autorizado</h1>
            <p style={{ margin: 0, color: brand.grayLight }}>Esta bandeja está disponible únicamente para Administración y Coordinación de Operaciones.</p>
          </div>
        </main>
      </Layout>
    );
  }

  return (
    <Layout view="mi_trabajo_administrativo" profile={profile} onLogout={logout}>
      <Head><title>Mi Trabajo Administrativo · InmoAdmin</title></Head>
      <main style={{ padding: "24px clamp(16px, 3vw, 34px) 44px", maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
          <div>
            <p style={{ margin: "0 0 6px", color: brand.red, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>Centro Operativo</p>
            <h1 style={{ margin: 0, color: brand.gray, fontSize: 28 }}>Mi Trabajo Administrativo</h1>
            <p style={{ margin: "8px 0 0", color: brand.grayLight }}>Una sola bandeja priorizada, en modo consulta.</p>
          </div>
          <button type="button" onClick={loadData} disabled={loading || !authorized} style={{
            border: `1px solid ${brand.border}`, background: "#fff", color: brand.gray,
            borderRadius: 9, padding: "9px 14px", fontWeight: 700,
            cursor: loading ? "wait" : "pointer", opacity: loading ? 0.65 : 1,
          }}>
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 18 }}>
          {summaries.map((item) => (
            <div key={item.key} style={{ background: item.bg, border: `1px solid ${item.border}`, borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ fontSize: 26, fontWeight: 900, color: item.color }}>{item.count}</div>
              <div style={{ fontSize: 12, fontWeight: 750, color: item.color }}>{item.label}</div>
            </div>
          ))}
        </section>

        {data?.sourcesWithError?.length > 0 && (
          <div role="status" style={{ marginBottom: 16, padding: "12px 14px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, color: "#92400e", fontSize: 13 }}>
            La bandeja se cargó parcialmente. Fuentes no disponibles: {data.sourcesWithError.map((source) => source.sourceType).join(", ")}.
          </div>
        )}

        {error && (
          <div role="alert" style={{ marginBottom: 16, padding: "12px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, color: "#991b1b" }}>{error}</div>
        )}

        <section aria-label="Filtros" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <select aria-label="Filtrar por origen" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} style={{ padding: "8px 10px", border: `1px solid ${brand.border}`, borderRadius: 8, background: "#fff" }}>
            <option value="todos">Todos los orígenes</option>
            {[...new Set((data?.items || []).map((item) => item.sourceType))].map((source) => <option key={source} value={source}>{SOURCE_LABELS[source] || source}</option>)}
          </select>
          <select aria-label="Filtrar por responsable" value={responsibleFilter} onChange={(e) => setResponsibleFilter(e.target.value)} style={{ padding: "8px 10px", border: `1px solid ${brand.border}`, borderRadius: 8, background: "#fff" }}>
            <option value="todos">Todos los responsables</option><option value="asignado">Con responsable</option><option value="sin_asignar">Sin responsable</option>
          </select>
          <select aria-label="Filtrar por supervisión" value={supervisionFilter} onChange={(e) => setSupervisionFilter(e.target.value)} style={{ padding: "8px 10px", border: `1px solid ${brand.border}`, borderRadius: 8, background: "#fff" }}>
            <option value="todos">Toda supervisión</option><option value="autorizacion">Requiere autorización</option><option value="manual">Tomado manualmente</option><option value="corregido">Corregido</option>
          </select>
        </section>

        <section aria-label="Pendientes administrativos" style={{ display: "grid", gap: 10 }}>
          {!loading && !error && data?.items?.length === 0 && (
            <div style={{ background: "#fff", border: `1px solid ${brand.border}`, borderRadius: 12, padding: 24, color: brand.grayLight }}>
              No hay pendientes determinísticos para mostrar.
            </div>
          )}
          {visibleItems.map((item) => {
            const style = BUCKET_STYLE[item.bucket] || BUCKET_STYLE.proximo;
            const owner = item.waitingOn
              ? `Esperando: ${String(item.waitingOn).replace(/_/g, " ")}`
              : item.responsibleProfileId
                ? `Responsable: ${item.responsibleArea} (asignado)`
                : `Responsable: ${item.responsibleArea}`;
            return (
              <article key={item.contextKey} style={{ background: "#fff", border: `1px solid ${brand.border}`, borderRadius: 12, padding: 16, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 16, alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: brand.grayLight, textTransform: "uppercase" }}>{SOURCE_LABELS[item.sourceType] || item.sourceType}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: style.color, background: style.bg, border: `1px solid ${style.border}`, borderRadius: 999, padding: "3px 8px" }}>{style.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: brand.grayLight }}>{item.priority}</span>
                    {(item.supervision?.requiresAuthorization || item.bucket === "requiere_autorizacion") && <span style={{ fontSize: 11, fontWeight: 800, color: "#6b21a8" }}>Requiere autorización</span>}
                    {item.supervision?.manualControl && <span style={{ fontSize: 11, fontWeight: 800, color: "#1d4ed8" }}>Control manual</span>}
                  </div>
                  <h2 style={{ margin: "0 0 5px", fontSize: 17, color: brand.gray }}>{item.title}</h2>
                  <p style={{ margin: "0 0 8px", color: brand.gray, fontSize: 13 }}><strong>Motivo:</strong> {item.reason}</p>
                  <p style={{ margin: "0 0 9px", color: brand.gray, fontSize: 13 }}><strong>Acción:</strong> {item.recommendedAction}</p>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: brand.grayLight, fontSize: 12 }}>
                    <span>{owner}</span>
                    <span>Fecha: {formatDate(item.dueAt || item.lastActivityAt)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
                    <select aria-label="Corregir clasificación" value="" onChange={(e) => e.target.value && supervise(item, "classification_corrected", { bucket: e.target.value })} style={{ border: `1px solid ${brand.border}`, background: "#fff", borderRadius: 7, padding: "5px 8px" }}>
                      <option value="">Corregir clasificación…</option>{BUCKETS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    <select aria-label="Corregir prioridad" value="" onChange={(e) => e.target.value && supervise(item, "priority_corrected", { priority: e.target.value })} style={{ border: `1px solid ${brand.border}`, background: "#fff", borderRadius: 7, padding: "5px 8px" }}>
                      <option value="">Corregir prioridad…</option><option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option>
                    </select>
                    <select aria-label="Reasignar responsable" value="" onChange={(e) => e.target.value && supervise(item, "responsible_reassigned", { profileId: e.target.value })} style={{ border: `1px solid ${brand.border}`, background: "#fff", borderRadius: 7, padding: "5px 8px" }}>
                      <option value="">Reasignar…</option>{(data?.responsibleOptions || []).map((option) => <option key={option.id} value={option.id}>{option.name} · {option.roleId}</option>)}
                    </select>
                    <button type="button" onClick={() => supervise(item, item.supervision?.manualControl ? "manual_control_released" : "manual_control_taken")} style={{ border: `1px solid ${brand.border}`, background: "#fff", borderRadius: 7, padding: "5px 8px", cursor: "pointer" }}>{item.supervision?.manualControl ? "Liberar control" : "Tomar control"}</button>
                    <button type="button" onClick={() => supervise(item, item.supervision?.automationPaused ? "automation_resumed" : "automation_paused")} style={{ border: `1px solid ${brand.border}`, background: "#fff", borderRadius: 7, padding: "5px 8px", cursor: "pointer" }}>{item.supervision?.automationPaused ? "Reanudar automatización" : "Pausar automatización"}</button>
                    <button type="button" onClick={() => supervise(item, item.supervision?.requiresAuthorization ? "authorization_cleared" : "authorization_required")} style={{ border: `1px solid ${brand.border}`, background: "#fff", borderRadius: 7, padding: "5px 8px", cursor: "pointer" }}>{item.supervision?.requiresAuthorization ? "Quitar autorización" : "Requiere autorización"}</button>
                    <button type="button" onClick={() => supervise(item, "resolved")} style={{ border: `1px solid ${brand.border}`, background: "#fff", borderRadius: 7, padding: "5px 8px", cursor: "pointer" }}>Marcar resuelto</button>
                    <button type="button" onClick={() => loadHistory(item.contextKey)} style={{ border: `1px solid ${brand.border}`, background: "#fff", borderRadius: 7, padding: "5px 8px", cursor: "pointer" }}>Historial</button>
                  </div>
                  {history.contextKey === item.contextKey && <div style={{ marginTop: 10, padding: 10, background: "#f9fafb", borderRadius: 8, fontSize: 12, color: brand.grayLight }}>
                    {history.loading ? "Cargando historial…" : history.actions.length ? history.actions.map((action) => <div key={action.id}>{new Date(action.created_at).toLocaleString("es-MX")}: {action.action_type} ({action.actor_type})</div>) : "Sin correcciones registradas."}
                  </div>}
                </div>
                <a href={item.href} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", background: brand.red, color: "#fff", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 800 }}>
                  Abrir
                </a>
              </article>
            );
          })}
        </section>
      </main>
    </Layout>
  );
}
