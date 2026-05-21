import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

// ── ETAPAS DEL FLUJO ────────────────────────────────────────────────────────
const ETAPAS = [
  { key: "nuevo",      label: "Nuevo",      icon: "🆕", color: "#6b7280" },
  { key: "revisado",   label: "Revisado",   icon: "👀", color: "#1e40af" },
  { key: "cotizado",   label: "Cotizado",   icon: "🔍", color: "#7c3aed" },
  { key: "aprobado",   label: "Aprobado",   icon: "✅", color: "#059669" },
  { key: "en_proceso", label: "En proceso", icon: "🔧", color: "#d97706" },
  { key: "terminado",  label: "Terminado",  icon: "✔️",  color: "#0891b2" },
  { key: "cerrado",    label: "Cerrado",    icon: "⭐", color: "#065f46" },
  { key: "cancelado",  label: "Cancelado",  icon: "❌", color: "#dc2626" },
];

const etapaIndex = (key) => ETAPAS.findIndex(e => e.key === key);
const etapaInfo  = (key) => ETAPAS.find(e => e.key === key) || ETAPAS[0];

// ── SEMÁFORO ────────────────────────────────────────────────────────────────
const getSemaforo = (ticket) => {
  if (["cerrado", "cancelado"].includes(ticket.status)) return null;
  const horasDesdeCreacion = (Date.now() - new Date(ticket.created_at)) / 36e5;
  const esNuevo = ticket.status === "nuevo";
  if (esNuevo && horasDesdeCreacion > 48) return { color: "#dc2626", bg: "#fee2e2", label: "🔴 Sin atender +48h" };
  if (esNuevo && horasDesdeCreacion > 24) return { color: "#d97706", bg: "#fef3c7", label: "🟡 Sin atender +24h" };
  if (esNuevo) return { color: "#065f46", bg: "#d1fae5", label: "🟢 Reciente" };
  const horasEnEtapa = (Date.now() - new Date(ticket.updated_at || ticket.created_at)) / 36e5;
  if (horasEnEtapa > 72) return { color: "#dc2626", bg: "#fee2e2", label: "🔴 Estancado +72h" };
  if (horasEnEtapa > 24) return { color: "#d97706", bg: "#fef3c7", label: "🟡 Sin mover +24h" };
  return { color: "#065f46", bg: "#d1fae5", label: "🟢 Al día" };
};

const tiempoTranscurrido = (fecha) => {
  const h = Math.floor((Date.now() - new Date(fecha)) / 36e5);
  if (h < 1)  return "hace menos de 1h";
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d > 1 ? "s" : ""}`;
};

// ── COMPONENTES ─────────────────────────────────────────────────────────────
const Modal = ({ title, onClose, children }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{title}</h2>
        <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

const Field = ({ label, hint, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>{label}</label>
    {hint && <p style={{ margin: "0 0 4px", fontSize: 11, color: "#9ca3af" }}>{hint}</p>}
    {children}
  </div>
);

const Input = (props) => (
  <input {...props} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", ...props.style }} />
);

const Sel = ({ children, ...props }) => (
  <select {...props} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff", boxSizing: "border-box", ...props.style }}>
    {children}
  </select>
);

const Btn = ({ children, onClick, color = "#1a1a2e", disabled, small }) => (
  <button onClick={onClick} disabled={disabled} style={{
    background: color, color: "#fff", border: "none",
    borderRadius: small ? 6 : 10, padding: small ? "5px 10px" : "11px 20px",
    fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
    fontSize: small ? 12 : 14, opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap"
  }}>
    {children}
  </button>
);

// ── DIAGRAMA DE FLUJO ────────────────────────────────────────────────────────
const DiagramaFlujo = ({ statusActual }) => {
  const etapasLineales = ETAPAS.filter(e => e.key !== "cancelado");
  const idx = etapaIndex(statusActual);
  return (
    <div style={{ overflowX: "auto", paddingBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 0, minWidth: "max-content" }}>
        {etapasLineales.map((e, i) => {
          const activo  = e.key === statusActual;
          const pasado  = idx > i;
          const futuro  = idx < i;
          return (
            <div key={e.key} style={{ display: "flex", alignItems: "center" }}>
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                padding: "6px 10px", borderRadius: 10,
                background: activo ? e.color + "22" : pasado ? "#f0fdf4" : "#f9fafb",
                border: `2px solid ${activo ? e.color : pasado ? "#86efac" : "#e5e7eb"}`,
                minWidth: 72,
              }}>
                <span style={{ fontSize: activo ? 20 : 16 }}>{e.icon}</span>
                <span style={{ fontSize: 10, fontWeight: activo ? 800 : 500, color: activo ? e.color : pasado ? "#065f46" : "#9ca3af", textAlign: "center" }}>
                  {e.label}
                </span>
                {activo && <div style={{ width: 6, height: 6, borderRadius: "50%", background: e.color }} />}
              </div>
              {i < etapasLineales.length - 1 && (
                <div style={{ width: 20, height: 2, background: pasado ? "#86efac" : "#e5e7eb", flexShrink: 0 }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── PÁGINA PRINCIPAL ────────────────────────────────────────────────────────
export default function Mantenimiento() {
  const router = useRouter();
  const [session, setSession]   = useState(null);
  const [profile, setProfile]   = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tickets, setTickets]   = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [saving, setSaving]     = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterProperty, setFilterProperty] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const emptyTicket = {
    property_name: "", tenant_name: "", title: "", description: "",
    category: "otro", priority: "media", payer: "propietario",
    provider_cost: "", charged_amount: "", advance_amount: "", advance_paid: false,
    status: "nuevo",
  };
  const [form, setForm] = useState(emptyTicket);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };
  const isAdmin = profile?.role === "admin";
  const today = new Date().toISOString().split("T")[0];

  // ── AUTH ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) loadProfile(s.user.id);
      else { setProfile(null); setAuthLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (uid) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).single();
    setProfile(data); setAuthLoading(false);
  };

  // ── DATA ──
  const loadData = async () => {
    setLoading(true);
    const [t, p] = await Promise.all([
      supabase.from("maintenance_tickets").select("*").order("created_at", { ascending: false }),
      supabase.from("properties").select("id, name").order("name"),
    ]);
    setTickets(t.data || []);
    setProperties(p.data || []);
    setLoading(false);
  };

  useEffect(() => { if (session) loadData(); }, [session]);

  // ── GUARDAR ──
  const saveTicket = async () => {
    setSaving(true);
    const data = {
      ...form,
      provider_cost:  parseFloat(form.provider_cost)  || 0,
      charged_amount: parseFloat(form.charged_amount) || 0,
      advance_amount: parseFloat(form.advance_amount) || 0,
      status: editing ? form.status : "nuevo",
      created_by: profile?.email,
    };

    if (editing) {
      const { error } = await supabase.from("maintenance_tickets").update({ ...data, updated_at: new Date().toISOString() }).eq("id", editing);
      if (error) { showToast("Error: " + error.message, false); setSaving(false); return; }
      showToast("Ticket actualizado");
    } else {
      const { error } = await supabase.from("maintenance_tickets").insert([data]);
      if (error) { showToast("Error: " + error.message, false); setSaving(false); return; }
      // Notificación por email
      try {
        await fetch("/api/send-email", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: ["carlos.nachon@emporioinmobiliario.mx", "administracion@emporioinmobiliario.com.mx"],
            subject: `🔧 Nuevo ticket de mantenimiento — ${data.property_name}`,
            html: `
              <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;background:#f9fafb;">
                <div style="background:#1a1a2e;padding:20px;border-radius:12px;margin-bottom:20px;">
                  <h2 style="color:#c8a96e;margin:0;">🔧 Nuevo Ticket de Mantenimiento</h2>
                  <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">Emporio Inmobiliario</p>
                </div>
                <div style="background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
                  <table style="width:100%;border-collapse:collapse;">
                    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:120px;">Propiedad</td><td style="padding:8px 0;font-weight:700;font-size:14px;">${data.property_name}</td></tr>
                    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Inquilino</td><td style="padding:8px 0;font-size:14px;">${data.tenant_name || "—"}</td></tr>
                    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Título</td><td style="padding:8px 0;font-weight:700;font-size:14px;">${data.title}</td></tr>
                    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Categoría</td><td style="padding:8px 0;font-size:14px;">${data.category}</td></tr>
                    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Prioridad</td><td style="padding:8px 0;font-size:14px;font-weight:700;color:${data.priority === "urgente" ? "#dc2626" : data.priority === "alta" ? "#d97706" : "#374151"};">${data.priority.toUpperCase()}</td></tr>
                    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Descripción</td><td style="padding:8px 0;font-size:13px;color:#374151;">${data.description || "—"}</td></tr>
                    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Quién paga</td><td style="padding:8px 0;font-size:14px;">${data.payer}</td></tr>
                    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Creado por</td><td style="padding:8px 0;font-size:13px;">${data.created_by || "Portal inquilino"}</td></tr>
                  </table>
                </div>
                <p style="text-align:center;margin-top:16px;font-size:12px;color:#9ca3af;">
                  <a href="https://app.emporioinmobiliario.com.mx/mantenimiento" style="color:#c8a96e;">Ver en InmoAdmin →</a>
                </p>
              </div>
            `
          })
        });
      } catch (e) { console.error("Email error:", e); }
      showToast("Ticket creado — notificación enviada");
    }
    setSaving(false);
    setShowModal(false);
    setEditing(null);
    setForm(emptyTicket);
    loadData();
  };

  // ── CAMBIAR ETAPA ──
  const cambiarEtapa = async (id, status) => {
    await supabase.from("maintenance_tickets").update({ status }).eq("id", id);
    // Si se cierra, registrar movimiento de caja si aplica
    if (status === "cerrado") {
      const t = tickets.find(t => t.id === id);
      if (t && t.provider_cost > 0) {
        await supabase.from("cash_movements").insert([{
          type: "salida", category: "pago_proveedor",
          description: `Proveedor: ${t.title} — ${t.property_name}`,
          amount: t.provider_cost, payment_method: "transferencia",
          date: today, created_by: profile?.email,
          created_at: new Date().toISOString()
        }]);
      }
      if (t && t.charged_amount > 0 && t.payer !== "inmobiliaria") {
        await supabase.from("cash_movements").insert([{
          type: "entrada", category: "mantenimiento_cobrado",
          description: `Cobro mant: ${t.title} — ${t.property_name}`,
          amount: t.charged_amount, payment_method: "transferencia",
          date: today, created_by: profile?.email,
          created_at: new Date().toISOString()
        }]);
      }
    }
    showToast("Etapa actualizada");
    loadData();
  };

  const eliminar = async (id, title) => {
    if (!isAdmin) { showToast("Solo el admin puede eliminar", false); return; }
    if (!confirm(`¿Eliminar "${title}"?`)) return;
    await supabase.from("maintenance_tickets").delete().eq("id", id);
    showToast("Ticket eliminado");
    loadData();
  };

  const openEdit = (t) => {
    setForm({
      property_name: t.property_name || "", tenant_name: t.tenant_name || "",
      title: t.title || "", description: t.description || "",
      category: t.category || "otro", priority: t.priority || "media",
      payer: t.payer || "propietario", provider_cost: t.provider_cost || "",
      charged_amount: t.charged_amount || "", advance_amount: t.advance_amount || "",
      advance_paid: t.advance_paid || false, status: t.status || "nuevo",
    });
    setEditing(t.id);
    setShowModal(true);
  };

  // ── FILTROS ──
  const ticketsFiltrados = tickets.filter(t => {
    if (filterStatus && t.status !== filterStatus) return false;
    if (filterPriority && t.priority !== filterPriority) return false;
    if (filterProperty && t.property_name !== filterProperty) return false;
    return true;
  });

  // ── STATS ──
  const totalAbiertos   = tickets.filter(t => !["cerrado","cancelado"].includes(t.status)).length;
  const urgentes        = tickets.filter(t => t.priority === "urgente" && !["cerrado","cancelado"].includes(t.status)).length;
  const sinAtender      = tickets.filter(t => t.status === "nuevo").length;
  const cerradosMes     = tickets.filter(t => {
    if (t.status !== "cerrado") return false;
    const d = new Date(t.updated_at || t.created_at);
    const h = new Date();
    return d.getMonth() === h.getMonth() && d.getFullYear() === h.getFullYear();
  }).length;

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#c8a96e", fontSize: 18, fontWeight: 700 }}>Cargando...</p>
    </div>
  );

  if (!session) {
    if (typeof window !== "undefined") window.location.href = "/";
    return null;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "system-ui, sans-serif" }}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: 320 }}>
          {toast.msg}
        </div>
      )}

      {/* HEADER */}
      <div style={{ background: "#1a1a2e", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={() => router.push("/")} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8, padding: "8px 14px", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>← Panel</button>
          <div>
            <p style={{ margin: 0, fontSize: 11, color: "#c8a96e", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>InmoAdmin</p>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#fff" }}>🔧 Mantenimiento</h1>
          </div>
        </div>
        <Btn color="#c8a96e" onClick={() => { setForm(emptyTicket); setEditing(null); setShowModal(true); }}>+ Nuevo ticket</Btn>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {/* STATS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Abiertos",     value: totalAbiertos, color: "#1e40af", bg: "#eff6ff" },
            { label: "Sin atender",  value: sinAtender,    color: sinAtender > 0 ? "#dc2626" : "#065f46", bg: sinAtender > 0 ? "#fff5f5" : "#f0fdf4" },
            { label: "Urgentes",     value: urgentes,      color: urgentes > 0 ? "#dc2626" : "#065f46",   bg: urgentes > 0 ? "#fff5f5" : "#f0fdf4" },
            { label: "Cerrados/mes", value: cerradosMes,   color: "#065f46", bg: "#f0fdf4" },
          ].map((s, i) => (
            <div key={i} style={{ background: s.bg, borderRadius: 14, padding: "14px 16px" }}>
              <p style={{ margin: "0 0 4px", fontSize: 10, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
              <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* FILTROS */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Todas las etapas</option>
            {ETAPAS.map(e => <option key={e.key} value={e.key}>{e.icon} {e.label}</option>)}
          </select>
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Toda prioridad</option>
            <option value="urgente">🔴 Urgente</option>
            <option value="alta">🟠 Alta</option>
            <option value="media">🟡 Media</option>
            <option value="baja">🟢 Baja</option>
          </select>
          <select value={filterProperty} onChange={e => setFilterProperty(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Todas las propiedades</option>
            {properties.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
          {(filterStatus || filterPriority || filterProperty) && (
            <button onClick={() => { setFilterStatus(""); setFilterPriority(""); setFilterProperty(""); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Limpiar</button>
          )}
          <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: "auto" }}>{ticketsFiltrados.length} tickets</span>
        </div>

        {/* LISTA */}
        {loading && <div style={{ textAlign: "center", padding: 48 }}><p style={{ color: "#6b7280" }}>Cargando...</p></div>}

        {!loading && ticketsFiltrados.length === 0 && (
          <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center" }}>
            <p style={{ fontSize: 32 }}>🔧</p>
            <p style={{ color: "#6b7280", fontWeight: 600 }}>No hay tickets</p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {ticketsFiltrados.map(t => {
            const etapa    = etapaInfo(t.status);
            const semaforo = getSemaforo(t);
            const expanded = expandedId === t.id;
            const utilidad = (t.charged_amount || 0) - (t.provider_cost || 0);

            return (
              <div key={t.id} style={{
                background: "#fff", borderRadius: 14,
                border: `2px solid ${t.priority === "urgente" ? "#fca5a5" : t.priority === "alta" ? "#fcd34d" : "#f0f0f0"}`,
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden",
              }}>
                {/* CABECERA */}
                <div style={{ padding: "14px 18px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>

                    {/* INFO PRINCIPAL */}
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>{t.title}</h3>
                        {semaforo && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: semaforo.color, background: semaforo.bg, padding: "2px 8px", borderRadius: 99 }}>
                            {semaforo.label}
                          </span>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                        📍 {t.property_name || "—"} · 👤 {t.tenant_name || "—"}
                      </p>
                      <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>
                        Creado {tiempoTranscurrido(t.created_at)}
                        {(() => {
                          const equipoEmails = [
                            "carlos.nachon@emporioinmobiliario.mx",
                            "guillermo@emporioinmobiliario.com.mx",
                            "administracion@emporioinmobiliario.com.mx",
                            "ariannet81@gmail.com","angelicamomox@gmail.com",
                            "rddd298@gmail.com","ivanmtzco@gmail.com","nextelmoto2@gmail.com"
                          ];
                          if (!t.created_by) return <span style={{color:"#1e40af",fontWeight:700}}> · 📱 Portal inquilino</span>;
                          if (equipoEmails.includes(t.created_by)) return ` · por ${t.created_by.split("@")[0]}`;
                          return <span style={{color:"#1e40af",fontWeight:700}}> · 📱 Reportado por inquilino</span>;
                        })()}
                      </p>
                    </div>

                    {/* ETAPA + ACCIONES */}
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: etapa.color, background: etapa.color + "18", padding: "4px 10px", borderRadius: 99 }}>
                        {etapa.icon} {etapa.label}
                      </span>
                      <select key={t.status} value={t.status} onChange={e => cambiarEtapa(t.id, e.target.value)}
                        style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12, cursor: "pointer", background: "#fff" }}>
                        {ETAPAS.map(e => <option key={e.key} value={e.key}>{e.icon} {e.label}</option>)}
                      </select>
                      <Btn small color="#6b7280" onClick={() => openEdit(t)}>Editar</Btn>
                      {isAdmin && <Btn small color="#dc2626" onClick={() => eliminar(t.id, t.title)}>X</Btn>}
                      <button onClick={() => setExpandedId(expanded ? null : t.id)}
                        style={{ background: "#f3f4f6", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#6b7280" }}>
                        {expanded ? "▲" : "▼"}
                      </button>
                    </div>
                  </div>

                  {/* TAGS */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                    <span style={{ fontSize: 11, background: "#f3f4f6", color: "#374151", padding: "2px 8px", borderRadius: 6 }}>{t.category}</span>
                    <span style={{ fontSize: 11, background: t.priority === "urgente" ? "#fee2e2" : t.priority === "alta" ? "#fef3c7" : "#f3f4f6", color: t.priority === "urgente" ? "#991b1b" : t.priority === "alta" ? "#92400e" : "#374151", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>
                      {t.priority === "urgente" ? "🔴" : t.priority === "alta" ? "🟠" : t.priority === "media" ? "🟡" : "🟢"} {t.priority}
                    </span>
                    {t.payer && <span style={{ fontSize: 11, background: "#eff6ff", color: "#1e40af", padding: "2px 8px", borderRadius: 6 }}>Paga: {t.payer}</span>}
                    {t.provider_cost > 0 && <span style={{ fontSize: 11, background: "#fff5f5", color: "#dc2626", padding: "2px 8px", borderRadius: 6 }}>Costo: {fmt(t.provider_cost)}</span>}
                    {t.charged_amount > 0 && <span style={{ fontSize: 11, background: "#f0fdf4", color: "#065f46", padding: "2px 8px", borderRadius: 6 }}>Cobrado: {fmt(t.charged_amount)}</span>}
                    {t.advance_amount > 0 && <span style={{ fontSize: 11, background: "#eff6ff", color: "#1e40af", padding: "2px 8px", borderRadius: 6 }}>Anticipo: {fmt(t.advance_amount)} {t.advance_paid ? "✓" : "pendiente"}</span>}
                    {t.provider_cost > 0 && t.charged_amount > 0 && (
                      <span style={{ fontSize: 11, background: "#faf5ff", color: "#7c3aed", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>Utilidad: {fmt(utilidad)}</span>
                    )}
                  </div>
                </div>

                {/* DETALLE EXPANDIDO */}
                {expanded && (
                  <div style={{ borderTop: "1px solid #f3f4f6", padding: "14px 18px", background: "#fafafa" }}>
                    {/* DIAGRAMA */}
                    <div style={{ marginBottom: 14 }}>
                      <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>Flujo del ticket</p>
                      <DiagramaFlujo statusActual={t.status} />
                    </div>
                    {t.description && (
                      <div style={{ marginTop: 12 }}>
                        <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>Descripción</p>
                        <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.5 }}>{t.description}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* MODAL TICKET */}
      {showModal && (
        <Modal title={editing ? "Editar Ticket" : "Nuevo Ticket"} onClose={() => { setShowModal(false); setEditing(null); setForm(emptyTicket); }}>
          <Field label="Título *"><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Ej: Fuga en baño" /></Field>
          <Field label="Propiedad">
            <Sel value={form.property_name} onChange={e => setForm({ ...form, property_name: e.target.value })}>
              <option value="">-- Selecciona --</option>
              {properties.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </Sel>
          </Field>
          <Field label="Inquilino"><Input value={form.tenant_name} onChange={e => setForm({ ...form, tenant_name: e.target.value })} placeholder="Nombre del inquilino" /></Field>
          <Field label="Descripción">
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="Describe el problema..." rows={3}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Categoría">
              <Sel value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                <option value="plomeria">🚿 Plomería</option>
                <option value="electricidad">⚡ Electricidad</option>
                <option value="pintura">🎨 Pintura</option>
                <option value="carpinteria">🪚 Carpintería</option>
                <option value="otro">🔧 Otro</option>
              </Sel>
            </Field>
            <Field label="Prioridad">
              <Sel value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value="baja">🟢 Baja</option>
                <option value="media">🟡 Media</option>
                <option value="alta">🟠 Alta</option>
                <option value="urgente">🔴 Urgente</option>
              </Sel>
            </Field>
          </div>
          {editing && (
            <Field label="Etapa actual">
              <Sel value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                {ETAPAS.map(e => <option key={e.key} value={e.key}>{e.icon} {e.label}</option>)}
              </Sel>
            </Field>
          )}
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, marginBottom: 4 }}>
            <p style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "#374151" }}>💰 Costos y pagos</p>
            <Field label="¿Quién paga?">
              <Sel value={form.payer} onChange={e => setForm({ ...form, payer: e.target.value })}>
                <option value="propietario">El propietario</option>
                <option value="inquilino">El inquilino</option>
                <option value="inmobiliaria">Nosotros</option>
              </Sel>
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Costo proveedor"><Input type="number" placeholder="0" value={form.provider_cost} onChange={e => setForm({ ...form, provider_cost: e.target.value })} /></Field>
              <Field label="Lo que cobramos"><Input type="number" placeholder="0" value={form.charged_amount} onChange={e => setForm({ ...form, charged_amount: e.target.value })} /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Anticipo cobrado"><Input type="number" placeholder="0" value={form.advance_amount} onChange={e => setForm({ ...form, advance_amount: e.target.value })} /></Field>
              <Field label="¿Ya recibiste el anticipo?">
                <Sel value={form.advance_paid ? "si" : "no"} onChange={e => setForm({ ...form, advance_paid: e.target.value === "si" })}>
                  <option value="no">No todavía</option>
                  <option value="si">Sí, ya lo tengo</option>
                </Sel>
              </Field>
            </div>
            {parseFloat(form.provider_cost) > 0 && parseFloat(form.charged_amount) > 0 && (
              <div style={{ background: "#fff", borderRadius: 8, padding: "8px 12px", marginTop: 4 }}>
                <p style={{ margin: 0, fontSize: 13, color: "#7c3aed", fontWeight: 700 }}>
                  Utilidad: {fmt((parseFloat(form.charged_amount) || 0) - (parseFloat(form.provider_cost) || 0))}
                </p>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={() => { setShowModal(false); setEditing(null); setForm(emptyTicket); }}
              style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>
              Cancelar
            </button>
            <Btn onClick={saveTicket} disabled={saving || !form.title}>{saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear ticket"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
