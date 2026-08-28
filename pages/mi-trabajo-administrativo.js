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

const QUALITY_CARDS = [
  ["data_quality", "Datos incompletos", "#9a3412", "#fff7ed", "#fed7aa"],
  ["historical_review", "Históricos por revisar", "#475569", "#f8fafc", "#cbd5e1"],
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
  owner_payment_receipts: "Entregas a propietarios",
  llaves: "Llaves",
  pagos_servicios: "Pagos de servicios",
  servicios_inmueble: "Servicios",
  properties: "Propiedades",
  owner_payments: "Liquidaciones",
  property_expenses: "Gastos de propiedades",
  comisiones_admin: "Comisiones administrativas",
  cash_movements: "Caja",
  administrative_case_controls: "Supervisión",
  administrative_profiles: "Responsables",
  condominios: "Condominios",
  unidades_condominio: "Unidades de condominio",
  cuotas_condominio: "Cuotas de condominio",
  firma_etapas: "Etapas de firma",
  administrative_work: "Trabajo Administrativo durable",
};

const ACTION_LABELS = {
  classification_corrected: "Clasificación corregida",
  priority_corrected: "Prioridad corregida",
  responsible_reassigned: "Responsable reasignado",
  resolved: "Caso resuelto",
  reopened: "Caso reabierto",
  automation_paused: "Automatización pausada",
  automation_resumed: "Automatización reanudada",
  manual_control_taken: "Control manual tomado",
  manual_control_released: "Control manual liberado",
  authorization_required: "Autorización requerida",
  authorization_cleared: "Autorización retirada",
  note_added: "Nota agregada",
};

const RULE_LABELS = {
  servicio_periodo_sin_control: "Control mensual no generado",
  servicio_datos_inconsistentes: "Configuración incompleta",
  servicio_historico_revisar: "Servicio posiblemente histórico",
  comprobante_servicio_pendiente: "Comprobante pendiente de revisión",
  servicio_vencido: "Pago de servicio vencido",
  servicio_proximo: "Pago de servicio próximo",
  renta_pendiente: "Cobranza de renta",
  renovacion_contrato: "Renovación contractual",
  llave_fuera_resguardo: "Llave fuera de resguardo",
  liquidacion_pendiente: "Liquidación pendiente",
  liquidacion_parcial: "Liquidación parcial",
  evidencia_entrega_incompleta: "Evidencia de entrega incompleta",
  firma_sin_avance: "Firma sin avance",
  cita_firma_pendiente: "Cita de firma pendiente",
  scheduled_occurrence_due: "Tarea recurrente programada",
};

const MISSING_FIELD_LABELS = {
  periodicidad_sin_ancla: "No existe un periodo y vencimiento previos confiables para calcular la siguiente obligación.",
  "contract_relation.missing": "No se encontró una relación contractual confiable.",
  "contract_relation.ambiguous": "Más de un contrato podría corresponder al servicio.",
  "pago.status": "El pago no tiene estado.",
  "pago.fecha_limite": "El pago no tiene fecha límite.",
  property_name: "Falta la propiedad.",
  tipo: "Falta el tipo de servicio.",
  periodicidad: "Falta la periodicidad.",
  quien_paga: "Falta definir quién paga.",
};

const CONTRACT_RELATION_LABELS = {
  active: "Contrato activo",
  ended: "Contrato terminado",
  missing: "Sin contrato identificable",
  ambiguous: "Relación contractual ambigua",
  legacy_match: "Contrato activo inferido (legacy)",
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
  const [qualityFilter, setQualityFilter] = useState("todos");
  const [caseView, setCaseView] = useState("active");
  const [history, setHistory] = useState({ contextKey: null, actions: [], loading: false });
  const [noteEditor, setNoteEditor] = useState({ contextKey: null, text: "", saving: false });
  const [feedback, setFeedback] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);

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
      const suffix = caseView === "resolved" ? "?status=resolved" : "";
      const response = await fetch(`/api/operaciones/work-center${suffix}`, {
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
  }, [authorized, caseView, session?.access_token]);

  useEffect(() => {
    if (profile && !authorized) setLoading(false);
    if (authorized) loadData();
  }, [authorized, loadData, profile]);

  const summaries = useMemo(() => [...BUCKETS, ...QUALITY_CARDS].map(([key, label, color, bg, border]) => ({
    key, label, color, bg, border, count: Number(data?.summary?.[key] || 0),
  })), [data?.summary]);

  const visibleItems = useMemo(() => (data?.items || []).filter((item) => {
    if (sourceFilter !== "todos" && item.sourceType !== sourceFilter) return false;
    if (responsibleFilter === "asignado" && !item.responsibleProfileId) return false;
    if (responsibleFilter === "sin_asignar" && item.responsibleProfileId) return false;
    if (supervisionFilter === "autorizacion" && !(item.supervision?.requiresAuthorization || (item.bucket === "requiere_autorizacion" && !["data_quality", "historical_review"].includes(item.presentationCategory)))) return false;
    if (supervisionFilter === "manual" && !item.supervision?.manualControl) return false;
    if (supervisionFilter === "corregido" && item.supervision?.status !== "modified") return false;
    if (qualityFilter === "data_quality" && item.presentationCategory !== "data_quality") return false;
    if (qualityFilter === "historical_review" && item.presentationCategory !== "historical_review") return false;
    if (qualityFilter === "operational" && ["data_quality", "historical_review"].includes(item.presentationCategory)) return false;
    return true;
  }), [data?.items, qualityFilter, responsibleFilter, sourceFilter, supervisionFilter]);

  const loadHistory = async (contextKey, toggle = true) => {
    if (toggle && history.contextKey === contextKey) { setHistory({ contextKey: null, actions: [], loading: false }); return; }
    setHistory({ contextKey, actions: [], loading: true });
    const response = await fetch(`/api/operaciones/administrative-cases?contextKey=${encodeURIComponent(contextKey)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await response.json();
    setHistory({ contextKey, actions: response.ok ? json.actions || [] : [], loading: false });
  };

  const supervise = async (item, actionType, value = {}, notes = "") => {
    setFeedback("");
    setError("");
    const response = await fetch("/api/operaciones/administrative-cases", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contextKey: item.contextKey, actionType, value, notes }),
    });
    const json = await response.json();
    if (!response.ok) {
      setNoteEditor((current) => ({ ...current, saving: false }));
      setError(json.error || "No se pudo guardar la supervisión.");
      return;
    }
    setFeedback(actionType === "note_added" ? "Nota guardada correctamente." : actionType === "reopened" ? "Caso reabierto correctamente." : "Supervisión guardada correctamente.");
    if (actionType === "note_added") {
      setNoteEditor({ contextKey: null, text: "", saving: false });
      await loadHistory(item.contextKey, false);
    }
    if (actionType === "reopened") {
      setCaseView("active");
      return;
    }
    await loadData();
  };

  const saveNote = async (item) => {
    const notes = noteEditor.text.trim();
    if (!notes) { setError("Escribe una nota antes de guardar."); return; }
    setNoteEditor((current) => ({ ...current, saving: true }));
    await supervise(item, "note_added", {}, notes);
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
            La bandeja se cargó parcialmente. Fuentes no disponibles: {data.sourcesWithError.map((source) => SOURCE_LABELS[source.sourceType] || source.sourceType).join(", ")}.
          </div>
        )}

        {error && (
          <div role="alert" style={{ marginBottom: 16, padding: "12px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, color: "#991b1b" }}>{error}</div>
        )}
        {feedback && <div role="status" style={{ marginBottom: 16, padding: "12px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, color: "#166534" }}>{feedback}</div>}

        <section aria-label="Vista de casos" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button type="button" aria-pressed={caseView === "active"} onClick={() => setCaseView("active")} style={{ border: `1px solid ${brand.border}`, background: caseView === "active" ? brand.gray : "#fff", color: caseView === "active" ? "#fff" : brand.gray, borderRadius: 8, padding: "8px 12px", fontWeight: 750, cursor: "pointer" }}>Activos</button>
          <button type="button" aria-pressed={caseView === "resolved"} onClick={() => setCaseView("resolved")} style={{ border: `1px solid ${brand.border}`, background: caseView === "resolved" ? brand.gray : "#fff", color: caseView === "resolved" ? "#fff" : brand.gray, borderRadius: 8, padding: "8px 12px", fontWeight: 750, cursor: "pointer" }}>Resueltos</button>
        </section>

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
          <select aria-label="Filtrar por calidad" value={qualityFilter} onChange={(e) => setQualityFilter(e.target.value)} style={{ padding: "8px 10px", border: `1px solid ${brand.border}`, borderRadius: 8, background: "#fff" }}>
            <option value="todos">Toda calidad operativa</option><option value="operational">Trabajo operativo</option><option value="data_quality">Datos incompletos</option><option value="historical_review">Históricos por revisar</option>
          </select>
        </section>

        <section aria-label={caseView === "resolved" ? "Casos resueltos" : "Pendientes administrativos"} style={{ display: "grid", gap: 10 }}>
          {!loading && !error && data?.items?.length === 0 && (
            <div style={{ background: "#fff", border: `1px solid ${brand.border}`, borderRadius: 12, padding: 24, color: brand.grayLight }}>
              {caseView === "resolved" ? "No hay casos resueltos para mostrar." : "No hay pendientes determinísticos para mostrar."}
            </div>
          )}
          {visibleItems.map((item) => {
            const qualityStyle = item.presentationCategory === "data_quality"
              ? { label: "Datos incompletos", color: "#9a3412", bg: "#fff7ed", border: "#fed7aa" }
              : item.presentationCategory === "historical_review"
                ? { label: "Histórico por revisar", color: "#475569", bg: "#f8fafc", border: "#cbd5e1" }
                : null;
            const style = qualityStyle || BUCKET_STYLE[item.bucket] || BUCKET_STYLE.proximo;
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
                    {(item.supervision?.requiresAuthorization || (item.bucket === "requiere_autorizacion" && !qualityStyle)) && <span style={{ fontSize: 11, fontWeight: 800, color: "#6b21a8" }}>Requiere autorización</span>}
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
                    {item.durableWorkItemId ? <span style={{ padding: "5px 8px", color: brand.grayLight, fontSize: 12 }}>R1 {data?.capabilities?.r1Enabled ? "habilitado bajo guardas" : "apagado · sólo lectura"}</span> : caseView === "active" ? <>
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
                    <button type="button" onClick={() => setNoteEditor({ contextKey: item.contextKey, text: "", saving: false })} style={{ border: `1px solid ${brand.border}`, background: "#fff", borderRadius: 7, padding: "5px 8px", cursor: "pointer" }}>Agregar nota</button>
                    </> : <button type="button" onClick={() => supervise(item, "reopened")} style={{ border: `1px solid ${brand.border}`, background: "#fff", borderRadius: 7, padding: "5px 8px", cursor: "pointer" }}>Reabrir</button>}
                    <button type="button" onClick={() => loadHistory(item.contextKey)} style={{ border: `1px solid ${brand.border}`, background: "#fff", borderRadius: 7, padding: "5px 8px", cursor: "pointer" }}>Historial</button>
                  </div>
                  {noteEditor.contextKey === item.contextKey && <div style={{ marginTop: 10, display: "grid", gap: 7, maxWidth: 680 }}>
                    <textarea aria-label="Nota del caso" maxLength={1000} value={noteEditor.text} onChange={(event) => setNoteEditor((current) => ({ ...current, text: event.target.value }))} rows={3} placeholder="Escribe una nota operativa…" style={{ width: "100%", resize: "vertical", border: `1px solid ${brand.border}`, borderRadius: 8, padding: 9, font: "inherit" }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button type="button" disabled={noteEditor.saving || !noteEditor.text.trim()} onClick={() => saveNote(item)} style={{ border: 0, background: brand.red, color: "#fff", borderRadius: 7, padding: "6px 10px", fontWeight: 750, cursor: "pointer" }}>{noteEditor.saving ? "Guardando…" : "Guardar nota"}</button>
                      <button type="button" onClick={() => setNoteEditor({ contextKey: null, text: "", saving: false })} style={{ border: `1px solid ${brand.border}`, background: "#fff", borderRadius: 7, padding: "6px 10px", cursor: "pointer" }}>Cancelar</button>
                      <span style={{ color: brand.grayLight, fontSize: 12 }}>{noteEditor.text.length}/1000</span>
                    </div>
                  </div>}
                  {history.contextKey === item.contextKey && <div style={{ marginTop: 10, padding: 10, background: "#f9fafb", borderRadius: 8, fontSize: 12, color: brand.grayLight }}>
                    {history.loading ? "Cargando historial…" : history.actions.length ? history.actions.map((action) => {
                      const actor = (data?.responsibleOptions || []).find((option) => option.id === action.actor_profile_id)?.name || action.actor_type;
                      return <div key={action.id} style={{ marginBottom: 5 }}><strong>{ACTION_LABELS[action.action_type] || action.action_type}</strong> · {actor} · {new Date(action.created_at).toLocaleString("es-MX")}{action.notes ? <div style={{ color: brand.gray, marginTop: 2 }}>{action.notes}</div> : null}</div>;
                    }) : "Sin correcciones registradas."}
                  </div>}
                </div>
                <div style={{ display: "grid", gap: 7 }}>
                  <button type="button" onClick={() => { setSelectedItem(item); loadHistory(item.contextKey, false); }} style={{ border: `1px solid ${brand.border}`, background: "#fff", color: brand.gray, borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>Ver detalle</button>
                  <a href={item.href} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", background: brand.red, color: "#fff", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 800 }}>Ir al módulo</a>
                </div>
              </article>
            );
          })}
        </section>
        {selectedItem && <div role="dialog" aria-modal="true" aria-label="Detalle del caso" style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(15,23,42,.38)", display: "flex", justifyContent: "flex-end" }} onClick={() => setSelectedItem(null)}>
          <aside style={{ width: "min(520px, 94vw)", height: "100%", overflowY: "auto", background: "#fff", boxShadow: "-12px 0 30px rgba(15,23,42,.18)", padding: 24 }} onClick={(event) => event.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}><div><div style={{ color: brand.red, fontWeight: 850, fontSize: 12, textTransform: "uppercase" }}>{SOURCE_LABELS[selectedItem.sourceType] || selectedItem.sourceType}</div><h2 style={{ color: brand.gray, margin: "6px 0 0" }}>{selectedItem.title}</h2></div><button type="button" aria-label="Cerrar detalle" onClick={() => setSelectedItem(null)} style={{ border: 0, background: "transparent", fontSize: 24, cursor: "pointer" }}>×</button></div>
            <dl style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "10px 14px", marginTop: 22, fontSize: 13 }}>
              <dt>Prioridad</dt><dd style={{ margin: 0 }}>{selectedItem.priority}</dd>
              <dt>Categoría</dt><dd style={{ margin: 0 }}>{selectedItem.presentationCategory === "data_quality" ? "Datos incompletos" : selectedItem.presentationCategory === "historical_review" ? "Histórico por revisar" : BUCKET_STYLE[selectedItem.bucket]?.label}</dd>
              <dt>Regla</dt><dd style={{ margin: 0 }}>{RULE_LABELS[selectedItem.ruleKey] || selectedItem.ruleKey.replace(/_/g, " ")}</dd>
              {selectedItem.metadata?.propertyLabel && <><dt>Propiedad</dt><dd style={{ margin: 0 }}>{selectedItem.metadata.propertyLabel}</dd></>}
              {selectedItem.metadata?.period && <><dt>Periodo</dt><dd style={{ margin: 0 }}>{selectedItem.metadata.period}</dd></>}
              <dt>Fecha</dt><dd style={{ margin: 0 }}>{formatDate(selectedItem.dueAt || selectedItem.lastActivityAt)}</dd>
              {selectedItem.metadata?.appointmentContext && <><dt>Cita contextual</dt><dd style={{ margin: 0 }}>{formatDate(selectedItem.metadata.appointmentContext.dueAt)} · Vencida</dd></>}
              <dt>Responsable</dt><dd style={{ margin: 0 }}>{selectedItem.responsibleArea || "Sin asignar"}</dd>
              {selectedItem.waitingOn && <><dt>Esperando</dt><dd style={{ margin: 0 }}>{String(selectedItem.waitingOn).replace(/_/g, " ")}</dd></>}
              {selectedItem.metadata?.contractRelation && <><dt>Contrato</dt><dd style={{ margin: 0 }}>{CONTRACT_RELATION_LABELS[selectedItem.metadata.contractRelation] || selectedItem.metadata.contractRelation}</dd></>}
              {selectedItem.durableWorkItemId && <><dt>Estado durable</dt><dd style={{ margin: 0 }}>{selectedItem.metadata?.status}</dd><dt>Evidencias</dt><dd style={{ margin: 0 }}>{selectedItem.metadata?.evidenceCount || 0}</dd><dt>Aprobaciones</dt><dd style={{ margin: 0 }}>{selectedItem.metadata?.approvals?.length || 0} pendientes</dd></>}
            </dl>
            <div style={{ marginTop: 20 }}><strong>Motivo</strong><p>{selectedItem.reason}</p><strong>Acción recomendada</strong><p>{selectedItem.recommendedAction}</p></div>
            {selectedItem.dataQuality?.missingFields?.length > 0 && <section style={{ marginTop: 18, padding: 14, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10 }}><strong>Datos necesarios</strong><ul>{selectedItem.dataQuality.missingFields.map((field) => <li key={field}>{MISSING_FIELD_LABELS[field] || field.replace(/_/g, " ")}</li>)}</ul></section>}
            {selectedItem.metadata?.requiresFinancialAuthorization && ["admin", "coord_operaciones"].includes(profile?.role_id) && <section style={{ marginTop: 18, padding: 14, background: "#faf5ff", borderRadius: 10 }}><strong>Revisión financiera requerida</strong><p style={{ marginBottom: 0 }}>Los importes permanecen sujetos a autorización humana. Esta vista no ejecuta movimientos.</p></section>}
            <section style={{ marginTop: 20 }}><strong>Supervisión</strong><p>{selectedItem.supervision?.manualControl ? "Control manual activo" : "Sin control manual"} · {selectedItem.supervision?.automationPaused ? "Automatización pausada" : "Automatización no pausada"}</p></section>
            <section style={{ marginTop: 20 }}><strong>Historial y notas</strong><div style={{ marginTop: 8, fontSize: 12 }}>{history.loading ? "Cargando…" : history.actions.length ? history.actions.map((action) => <div key={action.id} style={{ marginBottom: 8 }}><strong>{ACTION_LABELS[action.action_type] || action.action_type}</strong> · {new Date(action.created_at).toLocaleString("es-MX")}{action.notes && <div>{action.notes}</div>}</div>) : "Sin acciones registradas."}</div></section>
            <a href={selectedItem.href} style={{ marginTop: 22, display: "inline-flex", textDecoration: "none", background: brand.red, color: "#fff", padding: "10px 14px", borderRadius: 8, fontWeight: 800 }}>Ir al módulo</a>
          </aside>
        </div>}
      </main>
    </Layout>
  );
}
