import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Layout, { brand } from "../../components/Layout";
import { supabase } from "../../lib/supabase";

const ROLES = new Set(["admin", "coord_operaciones"]);
const CATEGORIES = [
  ["limpieza", "Limpieza"],
  ["jardineria", "Jardinería"],
  ["fumigacion", "Fumigación"],
  ["mantenimiento_preventivo", "Mantenimiento preventivo"],
  ["revision_equipo", "Revisión de equipo"],
  ["limpieza_agua", "Cisterna / tinacos"],
  ["supervision", "Supervisión"],
  ["pago_servicio", "Pago / servicio recurrente"],
];
const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const STATE_LABELS = { active: "Activa", suspended: "Suspendida", disabled: "Desactivada" };

const emptyForm = () => ({
  id: null,
  version: null,
  title: "",
  category: "limpieza",
  responsibleProfileId: "",
  locationType: "property",
  locationId: "",
  recurrenceUnit: "week",
  recurrenceInterval: 1,
  recurrenceWeekday: 1,
  recurrenceMonthDay: 1,
  nextDueLocal: "",
  leadDays: 7,
  providerName: "",
  instructions: "",
});

const toLocalInput = (value) => {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
};

const toMexicoTimestamp = (value) => {
  if (!value) return null;
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = desiredAsUtc;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Mexico_City",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const part = (type) => Number(parts.find((item) => item.type === type)?.value);
    const representedAsUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
    instant += desiredAsUtc - representedAsUtc;
  }
  return new Date(instant).toISOString();
};

const formatDate = (value) => {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-MX", {
    timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short",
  });
};

const recurrenceLabel = (task) => {
  if (task.recurrence_unit === "day") return `Cada ${task.recurrence_interval} día${task.recurrence_interval === 1 ? "" : "s"}`;
  if (task.recurrence_unit === "week") return `Cada ${task.recurrence_interval} semana${task.recurrence_interval === 1 ? "" : "s"}, ${WEEKDAYS[task.recurrence_weekday]}`;
  return `Cada ${task.recurrence_interval} mes${task.recurrence_interval === 1 ? "" : "es"}, día ${task.recurrence_month_day}`;
};

function TaskForm({ catalog, form, setForm, saving, onSave, onCancel }) {
  const locations = form.locationType === "property" ? catalog.properties : catalog.condominiums;
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const inputStyle = { width: "100%", boxSizing: "border-box", border: `1px solid ${brand.border}`, borderRadius: 8, padding: "9px 10px", background: "#fff" };
  return (
    <form onSubmit={onSave} style={{ background: "#fff", border: `1px solid ${brand.border}`, borderRadius: 14, padding: 18, marginBottom: 18 }}>
      <h2 style={{ margin: "0 0 14px", color: brand.gray, fontSize: 18 }}>{form.id ? "Editar programación" : "Nueva tarea recurrente"}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        <label style={{ fontSize: 12, color: brand.gray }}>Título
          <input required minLength={3} maxLength={180} value={form.title} onChange={(e) => update("title", e.target.value)} style={inputStyle} />
        </label>
        <label style={{ fontSize: 12, color: brand.gray }}>Categoría
          <select value={form.category} onChange={(e) => update("category", e.target.value)} style={inputStyle}>
            {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: brand.gray }}>Responsable activo
          <select required value={form.responsibleProfileId} onChange={(e) => update("responsibleProfileId", e.target.value)} style={inputStyle}>
            <option value="">Seleccionar…</option>
            {catalog.responsibleProfiles.filter((profile) => profile.active).map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.full_name || profile.id} · {profile.role_id}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: brand.gray }}>Tipo de ubicación
          <select value={form.locationType} onChange={(e) => setForm((current) => ({ ...current, locationType: e.target.value, locationId: "" }))} style={inputStyle}>
            <option value="property">Inmueble</option>
            <option value="condominium">Condominio</option>
          </select>
        </label>
        <label style={{ fontSize: 12, color: brand.gray }}>Ubicación
          <select required value={form.locationId} onChange={(e) => update("locationId", e.target.value)} style={inputStyle}>
            <option value="">Seleccionar…</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.id}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: brand.gray }}>Frecuencia
          <select value={form.recurrenceUnit} onChange={(e) => update("recurrenceUnit", e.target.value)} style={inputStyle}>
            <option value="day">Cada X días</option>
            <option value="week">Semanal</option>
            <option value="month">Mensual</option>
          </select>
        </label>
        <label style={{ fontSize: 12, color: brand.gray }}>Intervalo
          <input required type="number" min="1" max="120" value={form.recurrenceInterval} onChange={(e) => update("recurrenceInterval", Number(e.target.value))} style={inputStyle} />
        </label>
        {form.recurrenceUnit === "week" && (
          <label style={{ fontSize: 12, color: brand.gray }}>Día semanal
            <select value={form.recurrenceWeekday} onChange={(e) => update("recurrenceWeekday", Number(e.target.value))} style={inputStyle}>
              {WEEKDAYS.map((label, value) => <option key={label} value={value}>{label}</option>)}
            </select>
          </label>
        )}
        {form.recurrenceUnit === "month" && (
          <label style={{ fontSize: 12, color: brand.gray }}>Día del mes
            <input required type="number" min="1" max="31" value={form.recurrenceMonthDay} onChange={(e) => update("recurrenceMonthDay", Number(e.target.value))} style={inputStyle} />
          </label>
        )}
        <label style={{ fontSize: 12, color: brand.gray }}>Próximo vencimiento · hora CDMX
          <input required type="datetime-local" value={form.nextDueLocal} onChange={(e) => update("nextDueLocal", e.target.value)} style={inputStyle} />
        </label>
        <label style={{ fontSize: 12, color: brand.gray }}>Anticipación (días)
          <input required type="number" min="0" max="365" value={form.leadDays} onChange={(e) => update("leadDays", Number(e.target.value))} style={inputStyle} />
        </label>
        <label style={{ fontSize: 12, color: brand.gray }}>Proveedor opcional
          <input maxLength={180} value={form.providerName} onChange={(e) => update("providerName", e.target.value)} style={inputStyle} />
        </label>
      </div>
      <label style={{ display: "block", fontSize: 12, color: brand.gray, marginTop: 12 }}>Instrucciones operativas
        <textarea maxLength={1000} rows={3} value={form.instructions} onChange={(e) => update("instructions", e.target.value)} style={inputStyle} />
      </label>
      <p style={{ margin: "10px 0", color: brand.grayLight, fontSize: 12 }}>Timezone fija: America/Mexico_City. Una tarea debe tener exactamente un inmueble o un condominio.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={saving} style={{ border: 0, background: brand.red, color: "#fff", borderRadius: 8, padding: "9px 14px", fontWeight: 800 }}>{saving ? "Guardando…" : "Guardar"}</button>
        <button type="button" onClick={onCancel} disabled={saving} style={{ border: `1px solid ${brand.border}`, background: "#fff", color: brand.gray, borderRadius: 8, padding: "9px 14px", fontWeight: 700 }}>Cancelar</button>
      </div>
    </form>
  );
}

export default function OperationalRecurringTasksPage() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [catalog, setCatalog] = useState({ tasks: [], executions: [], responsibleProfiles: [], properties: [], condominiums: [] });
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: current } }) => { setSession(current); setAuthReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, current) => { setSession(current); setAuthReady(true); });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!session?.user?.id) { setLoading(false); return; }
    supabase.from("profiles").select("id, role_id, active").eq("id", session.user.id).maybeSingle()
      .then(({ data }) => setProfile(data || null));
  }, [authReady, session?.user?.id]);

  const authorized = profile?.active && ROLES.has(profile.role_id);

  const loadData = useCallback(async () => {
    if (!session?.access_token || !authorized) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/operaciones/recurring-tasks", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "No se pudo cargar la programación.");
      setCatalog(json);
    } catch (loadError) { setError(loadError.message); } finally { setLoading(false); }
  }, [authorized, session?.access_token]);

  useEffect(() => {
    if (profile && !authorized) setLoading(false);
    if (authorized) loadData();
  }, [authorized, loadData, profile]);

  useEffect(() => {
    if (loading || typeof window === "undefined") return;
    const taskId = new URLSearchParams(window.location.search).get("task");
    if (taskId) document.getElementById(`task-${taskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [catalog.tasks, loading]);

  const profilesById = useMemo(() => new Map(catalog.responsibleProfiles.map((item) => [item.id, item])), [catalog.responsibleProfiles]);
  const executionsByTask = useMemo(() => {
    const map = new Map();
    catalog.executions.forEach((execution) => {
      const list = map.get(execution.task_id) || [];
      list.push(execution); map.set(execution.task_id, list);
    });
    return map;
  }, [catalog.executions]);

  const callAction = async (action, params) => {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/operaciones/recurring-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action, params }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "No se pudo completar la acción.");
      setNotice("Acción registrada correctamente.");
      setForm(null);
      await loadData();
    } catch (actionError) { setError(actionError.message); } finally { setSaving(false); }
  };

  const saveForm = async (event) => {
    event.preventDefault();
    const common = {
      p_title: form.title,
      p_category: form.category,
      p_responsible_profile_id: form.responsibleProfileId,
      p_recurrence_unit: form.recurrenceUnit,
      p_recurrence_interval: Number(form.recurrenceInterval),
      p_next_due_at: toMexicoTimestamp(form.nextDueLocal),
      p_property_id: form.locationType === "property" ? form.locationId : null,
      p_condominium_id: form.locationType === "condominium" ? form.locationId : null,
      p_recurrence_weekday: form.recurrenceUnit === "week" ? Number(form.recurrenceWeekday) : null,
      p_recurrence_month_day: form.recurrenceUnit === "month" ? Number(form.recurrenceMonthDay) : null,
      p_lead_days: Number(form.leadDays),
      p_timezone: "America/Mexico_City",
      p_provider_name: form.providerName || null,
      p_instructions: form.instructions || null,
    };
    await callAction(form.id ? "edit" : "create", form.id
      ? { p_task_id: form.id, p_expected_version: form.version, ...common }
      : common);
  };

  const editTask = (task) => setForm({
    id: task.id,
    version: task.version,
    title: task.title,
    category: task.category,
    responsibleProfileId: task.responsible_profile_id,
    locationType: task.property_id ? "property" : "condominium",
    locationId: task.property_id || task.condominium_id,
    recurrenceUnit: task.recurrence_unit,
    recurrenceInterval: task.recurrence_interval,
    recurrenceWeekday: task.recurrence_weekday ?? 1,
    recurrenceMonthDay: task.recurrence_month_day ?? 1,
    nextDueLocal: toLocalInput(task.next_due_at),
    leadDays: task.lead_days,
    providerName: task.provider_name || "",
    instructions: task.instructions || "",
  });

  const completeTask = async (task) => {
    const note = window.prompt("Nota opcional de ejecución (no adjunte evidencia ni datos sensibles):", "");
    if (note === null) return;
    await callAction("complete", {
      p_task_id: task.id,
      p_expected_due_at: task.next_due_at,
      p_completion_note: note || null,
      p_evidence_storage_path: null,
    });
  };

  const suspendTask = async (task) => {
    const reason = window.prompt("Motivo de suspensión:", "");
    if (!reason?.trim()) return;
    await callAction("suspend", { p_task_id: task.id, p_expected_version: task.version, p_reason: reason.trim() });
  };

  const disableTask = async (task) => {
    const reason = window.prompt("Motivo de desactivación (el historial se conserva):", "");
    if (!reason?.trim()) return;
    await callAction("disable", { p_task_id: task.id, p_expected_version: task.version, p_reason: reason.trim() });
  };

  const reactivateTask = async (task, mode) => {
    let newDue = null;
    if (mode === "new_due") {
      const value = window.prompt("Nuevo vencimiento (AAAA-MM-DDTHH:mm, hora CDMX):", toLocalInput(task.next_due_at));
      if (!value) return;
      newDue = toMexicoTimestamp(value);
    }
    await callAction("reactivate", { p_task_id: task.id, p_expected_version: task.version, p_mode: mode, p_new_next_due_at: newDue });
  };

  const logout = async () => { await supabase.auth.signOut(); window.location.href = "/"; };

  if (authReady && (!session || (profile && !authorized))) {
    return <Layout view="tareas_recurrentes" profile={profile} onLogout={logout}><main style={{ padding: 28 }}><h1>Acceso no autorizado</h1><p>Disponible únicamente para Admin y Coordinación de Operaciones.</p></main></Layout>;
  }

  return (
    <Layout view="tareas_recurrentes" profile={profile} onLogout={logout}>
      <Head><title>Mantenimiento Programado · InmoAdmin</title></Head>
      <main style={{ padding: "24px clamp(16px, 3vw, 34px) 44px", maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
          <div><p style={{ margin: "0 0 5px", color: brand.red, fontWeight: 800, fontSize: 12 }}>OPERACIONES</p><h1 style={{ margin: 0, color: brand.gray }}>Mantenimiento Programado</h1><p style={{ color: brand.grayLight }}>Programación preventiva. Las incidencias se registran manualmente como tickets separados.</p></div>
          <button type="button" onClick={() => setForm(emptyForm())} disabled={!authorized || saving} style={{ border: 0, background: brand.red, color: "#fff", borderRadius: 9, padding: "10px 15px", fontWeight: 800 }}>Nueva tarea</button>
        </div>

        {form && <TaskForm catalog={catalog} form={form} setForm={setForm} saving={saving} onSave={saveForm} onCancel={() => setForm(null)} />}
        {error && <div role="alert" style={{ marginBottom: 12, padding: 12, background: "#fef2f2", color: "#991b1b", borderRadius: 9 }}>{error}</div>}
        {notice && <div role="status" style={{ marginBottom: 12, padding: 12, background: "#f0fdf4", color: "#166534", borderRadius: 9 }}>{notice}</div>}

        <section style={{ display: "grid", gap: 10 }}>
          {loading && <div>Cargando programación…</div>}
          {!loading && catalog.tasks.length === 0 && <div style={{ background: "#fff", padding: 20, borderRadius: 12 }}>No hay tareas recurrentes.</div>}
          {catalog.tasks.map((task) => {
            const responsible = profilesById.get(task.responsible_profile_id);
            const responsibleInactive = !responsible?.active;
            const executions = executionsByTask.get(task.id) || [];
            return (
              <article id={`task-${task.id}`} key={task.id} style={{ background: "#fff", border: `1px solid ${responsibleInactive ? "#fca5a5" : brand.border}`, borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 6 }}><strong style={{ color: brand.gray }}>{task.title}</strong><span>{STATE_LABELS[task.state] || task.state}</span>{responsibleInactive && <span style={{ color: "#991b1b", fontWeight: 800 }}>Responsable inactivo</span>}</div>
                    <div style={{ fontSize: 13, color: brand.grayLight }}>{recurrenceLabel(task)} · próxima: {formatDate(task.next_due_at)} · anticipación: {task.lead_days} días</div>
                    <div style={{ fontSize: 12, color: brand.grayLight, marginTop: 5 }}>Responsable: {responsible?.full_name || task.responsible_profile_id} · ubicación: {task.property_id ? "inmueble" : "condominio"}</div>
                    {executions[0] && <div style={{ fontSize: 12, color: brand.grayLight, marginTop: 5 }}>Última confirmación: {formatDate(executions[0].completed_at)} · omitidas por atraso: {executions[0].missed_occurrences_count}</div>}
                    {executions.length > 0 && (
                      <details style={{ marginTop: 8, fontSize: 12, color: brand.grayLight }}>
                        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Historial de ejecuciones ({executions.length})</summary>
                        <div style={{ display: "grid", gap: 5, marginTop: 6 }}>
                          {executions.map((execution) => (
                            <div key={execution.id}>
                              {formatDate(execution.completed_at)} · programada {formatDate(execution.scheduled_due_at)} · atraso acumulado {execution.missed_occurrences_count}
                              {execution.completion_note ? ` · ${execution.completion_note}` : ""}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
                    {task.state === "active" && <button type="button" disabled={saving} onClick={() => completeTask(task)}>Completar</button>}
                    {task.state !== "disabled" && <button type="button" disabled={saving} onClick={() => editTask(task)}>Editar</button>}
                    {task.state === "active" && <button type="button" disabled={saving} onClick={() => suspendTask(task)}>Suspender</button>}
                    {task.state === "suspended" && <><button type="button" disabled={saving || responsibleInactive} onClick={() => reactivateTask(task, "preserve_due")}>Reactivar conservando</button><button type="button" disabled={saving || responsibleInactive} onClick={() => reactivateTask(task, "skip_to_next")}>Reactivar futura</button></>}
                    {task.state === "disabled" && profile?.role_id === "admin" && <button type="button" disabled={saving || responsibleInactive} onClick={() => reactivateTask(task, "new_due")}>Reactivar con fecha</button>}
                    {task.state !== "disabled" && <button type="button" disabled={saving} onClick={() => disableTask(task)}>Desactivar</button>}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </main>
    </Layout>
  );
}
