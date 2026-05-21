import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const StatusBadge = ({ status }) => {
  const map = {
    pagado:        { bg: "#d1fae5", color: "#065f46", label: "Pagado" },
    atrasado:      { bg: "#fee2e2", color: "#991b1b", label: "Atrasado" },
    pendiente:     { bg: "#fef3c7", color: "#92400e", label: "Pendiente" },
    en_revision:   { bg: "#dbeafe", color: "#1e40af", label: "En revision" },
    ocupada:       { bg: "#d1fae5", color: "#065f46", label: "Ocupada" },
    disponible:    { bg: "#e0e7ff", color: "#3730a3", label: "Disponible" },
    mantenimiento: { bg: "#fce7f3", color: "#9d174d", label: "Mantenimiento" },
  };
  const s = map[status] || { bg: "#f3f4f6", color: "#374151", label: status };
  return <span style={{ background: s.bg, color: s.color, padding: "2px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{s.label}</span>;
};

const Modal = ({ title, onClose, children }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{title}</h2>
        <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

const ConfirmModal = ({ message, onConfirm, onCancel }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: "100%", maxWidth: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <p style={{ fontSize: 16, fontWeight: 700, color: "#1a1a2e", margin: "0 0 8px" }}>¿Estás seguro?</p>
      <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 24px" }}>{message}</p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
        <button onClick={onConfirm} style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 700 }}>Sí, eliminar</button>
      </div>
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
  <select {...props} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", background: "#fff", ...props.style }}>
    {children}
  </select>
);

const Btn = ({ children, onClick, color = "#1a1a2e", disabled, small }) => (
  <button onClick={onClick} disabled={disabled} style={{
    background: color, color: "#fff", border: "none", borderRadius: small ? 6 : 10,
    padding: small ? "5px 10px" : "11px 20px", fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer", fontSize: small ? 12 : 14,
    opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap"
  }}>
    {children}
  </button>
);

const calcComision = (c) => {
  if (!c.commission_value) return 0;
  if (c.commission_type === "porcentaje") return (c.monthly_rent * c.commission_value) / 100;
  return c.commission_value;
};

const expenseCategoryLabels = {
  condominio: "Condominio", predial: "Predial", agua: "Agua", luz: "Luz",
  gas: "Gas", seguro: "Seguro", mantenimiento_comun: "Mantenimiento comun", otro: "Otro",
};

const categoryLabels = {
  renta_cobrada: "Renta cobrada", comision_cobrada: "Comisión cobrada",
  mantenimiento_cobrado: "Mantenimiento cobrado", anticipo_mantenimiento: "Anticipo mantenimiento",
  liquidacion_propietario: "Liquidación propietario", gasto_operativo: "Gasto operativo",
  pago_proveedor: "Pago proveedor", material: "Material/Refacción", otro: "Otro",
};

const LoginScreen = ({ onLogin }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const handleLogin = async () => {
    setLoading(true); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError("Email o contraseña incorrectos");
    else onLogin();
  };
  return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 40, width: "100%", maxWidth: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏢</div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#1a1a2e" }}>InmoAdmin</h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "#6b7280" }}>Emporio Inmobiliario</p>
        </div>
        {error && <div style={{ background: "#fee2e2", color: "#991b1b", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 14, fontWeight: 600 }}>{error}</div>}
        <Field label="Email"><Input type="email" placeholder="tu@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} /></Field>
        <Field label="Contraseña"><Input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} /></Field>
        <button onClick={handleLogin} disabled={loading || !email || !password} style={{ width: "100%", background: "#c8a96e", color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontWeight: 800, cursor: loading ? "not-allowed" : "pointer", fontSize: 16, marginTop: 8, opacity: loading ? 0.7 : 1 }}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </div>
    </div>
  );
};

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [properties, setProperties] = useState([]);
  const [payments, setPayments] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [cashMovements, setCashMovements] = useState([]);
  const [propertyExpenses, setPropertyExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [uploadingContrato, setUploadingContrato] = useState(null);

  const emptyProp = { name: "", address: "", property_type: "depto", rent_amount: "", status: "disponible", notes: "", owner_email: "", owner_phone: "" };
  const emptyExpense = { property_name: "", category: "condominio", description: "", amount: "", paid_by: "propietario", payment_method: "transferencia", date: new Date().toISOString().split("T")[0], notes: "" };
  const [propForm, setPropForm] = useState(emptyProp);
  const [expenseForm, setExpenseForm] = useState(emptyExpense);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };
  const isAdmin = profile?.role === "admin";
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else { setProfile(null); setAuthLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (userId) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    setProfile(data); setAuthLoading(false);
  };

  const logout = async () => { await supabase.auth.signOut(); setSession(null); setProfile(null); };

  const loadData = async () => {
    setLoading(true);
    const [p, pay, c, cm, pe] = await Promise.all([
      supabase.from("properties").select("*").order("created_at", { ascending: false }),
      supabase.from("payments").select("*").order("due_date", { ascending: true }),
      supabase.from("contracts").select("*").order("created_at", { ascending: false }),
      supabase.from("cash_movements").select("*").order("date", { ascending: false }),
      supabase.from("property_expenses").select("*").order("date", { ascending: false }),
    ]);
    setProperties(p.data || []);
    setPayments(pay.data || []);
    setContracts(c.data || []);
    setCashMovements(cm.data || []);
    setPropertyExpenses(pe.data || []);
    setLoading(false);
  };

  useEffect(() => { if (session) loadData(); }, [session]);

  const closeModal = () => {
    setShowModal(null); setEditing(null);
    setPropForm(emptyProp); setExpenseForm(emptyExpense);
  };

  const saveProperty = async () => {
    setSaving(true);
    const data = { ...propForm, rent_amount: parseFloat(propForm.rent_amount) || 0 };
    const { error } = editing?.type === "property"
      ? await supabase.from("properties").update(data).eq("id", editing.id)
      : await supabase.from("properties").insert([data]);
    setSaving(false);
    if (error) { showToast("Error: " + error.message, false); return; }
    showToast(editing ? "Propiedad actualizada" : "Propiedad guardada");
    closeModal(); loadData();
  };

  const saveExpense = async () => {
    setSaving(true);
    const amount = parseFloat(expenseForm.amount) || 0;
    const data = { ...expenseForm, amount, created_by: profile?.email };
    const { error } = await supabase.from("property_expenses").insert([data]);
    if (error) { setSaving(false); showToast("Error: " + error.message, false); return; }
    if (expenseForm.paid_by === "inmobiliaria") {
      await supabase.from("cash_movements").insert([{
        type: "salida", category: "gasto_operativo",
        description: `${expenseCategoryLabels[expenseForm.category]}: ${expenseForm.description} - ${expenseForm.property_name}`,
        amount, payment_method: expenseForm.payment_method, date: expenseForm.date,
        created_by: profile?.email, created_at: new Date().toISOString()
      }]);
    }
    setSaving(false);
    showToast("Gasto registrado"); closeModal(); loadData();
  };

  const subirContrato = async (propertyId, propertyName, file) => {
    if (!file) return;
    if (file.type !== "application/pdf") { showToast("Solo se permiten archivos PDF", false); return; }
    if (file.size > 10 * 1024 * 1024) { showToast("El archivo es muy grande (max 10MB)", false); return; }
    setUploadingContrato(propertyId);
    try {
      const fileName = `${propertyId}_${Date.now()}.pdf`;
      const { error: uploadError } = await supabase.storage.from("contratos").upload(fileName, file, { upsert: true, contentType: "application/pdf" });
      if (uploadError) throw uploadError;
      await supabase.from("properties").update({ contrato_url: fileName }).eq("id", propertyId);
      showToast(`Contrato subido para ${propertyName}`);
      loadData();
    } catch (e) { showToast("Error al subir: " + e.message, false); }
    setUploadingContrato(null);
  };

  const verContrato = async (contratoUrl) => {
    try {
      const { data, error } = await supabase.storage.from("contratos").createSignedUrl(contratoUrl, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank");
    } catch (e) { showToast("Error al abrir contrato: " + e.message, false); }
  };

  const eliminarContrato = async (propertyId, contratoUrl) => {
    try {
      await supabase.storage.from("contratos").remove([contratoUrl]);
      await supabase.from("properties").update({ contrato_url: null }).eq("id", propertyId);
      showToast("Contrato eliminado"); loadData();
    } catch (e) { showToast("Error: " + e.message, false); }
  };

  const deleteItem = (type, id, msg) => {
    if (!isAdmin) { showToast("Solo el admin puede eliminar", false); return; }
    setConfirm({
      message: msg,
      onConfirm: async () => {
        setConfirm(null);
        if (type === "property") await supabase.from("properties").delete().eq("id", id);
        if (type === "expense") await supabase.from("property_expenses").delete().eq("id", id);
        showToast("Eliminado"); loadData();
      }
    });
  };

  // ── CÁLCULOS DASHBOARD ────────────────────────────────────────────────────
  const totalEntradas = cashMovements.filter(m => m.type === "entrada").reduce((a, m) => a + (m.amount || 0), 0);
  const totalSalidas  = cashMovements.filter(m => m.type === "salida").reduce((a, m) => a + (m.amount || 0), 0);
  const saldoCaja     = totalEntradas - totalSalidas;
  const totalRent     = properties.filter(p => p.status === "ocupada").reduce((a, p) => a + (p.rent_amount || 0), 0);
  const paid          = payments.filter(p => p.status === "pagado").reduce((a, p) => a + (p.amount || 0), 0);
  const overdue       = payments.filter(p => p.status === "atrasado").reduce((a, p) => a + (p.amount || 0), 0);
  const pending       = payments.filter(p => p.status === "pendiente").reduce((a, p) => a + (p.amount || 0), 0);
  const totalComisiones   = contracts.filter(c => c.status === "activo").reduce((a, c) => a + calcComision(c), 0);
  const comisionesPendientes = contracts.filter(c => c.status === "activo" && c.rent_receiver === "propietario" && (!c.commission_status || c.commission_status === "pendiente_cobro")).reduce((a, c) => a + calcComision(c), 0);
  const hoy = new Date();
  const pagosMes = payments.filter(p => {
    if (!p.due_date) return false;
    const d = new Date(p.due_date);
    return d.getMonth() === hoy.getMonth() && d.getFullYear() === hoy.getFullYear();
  });

  const nav = [
    { id: "dashboard",    label: "Panel",         icon: "📊" },
    { id: "caja",         label: "Caja",           icon: "💵", link: "/caja" },
    { id: "contracts",    label: "Contratos",      icon: "📋", link: "/contratos" },
    { id: "properties",   label: "Propiedades",    icon: "🏠" },
    { id: "payments",     label: "Cobranza",       icon: "💰", link: "/cobranza" },
    { id: "owner_payments",label: "Liquidaciones", icon: "🏦", link: "/liquidaciones" },
    { id: "tickets",      label: "Mantenimiento",  icon: "🔧", link: "/mantenimiento" },
    { id: "reports",      label: "Reportes",       icon: "📈", link: "/reportes" },
    { id: "commissions",  label: "Comisiones",     icon: "💼", link: "/comisiones" },
    { id: "cierres",      label: "Cierres",        icon: "📊", link: "/cierres" },
    { id: "firmas",       label: "Firmas",         icon: "📝", link: "/firmas" },
    { id: "poliza",       label: "Póliza",         icon: "⚖️", link: "/poliza" },
  ];

  const handleNavClick = (n) => {
    if (n.link) { window.location.href = n.link; }
    else { setView(n.id); setSidebarOpen(false); }
  };

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#c8a96e", fontSize: 18, fontWeight: 700 }}>Cargando...</p>
    </div>
  );
  if (!session) return <LoginScreen onLogin={() => loadData()} />;

  const currentNavLabel = nav.find(n => n.id === view)?.label || "Panel";

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif", background: "#f4f5f7" }}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: 300 }}>
          {toast.msg}
        </div>
      )}
      {confirm && <ConfirmModal message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}

      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 150 }} />
      )}

      {/* SIDEBAR */}
      <div style={{
        width: 220, background: "#1a1a2e", display: "flex", flexDirection: "column", flexShrink: 0,
        position: isMobile ? "fixed" : "relative", top: 0, left: 0, height: "100vh",
        transform: isMobile ? (sidebarOpen ? "translateX(0)" : "translateX(-220px)") : "none",
        transition: "transform 0.25s ease", zIndex: 200,
      }}>
        <div style={{ padding: "20px 16px", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#c8a96e", fontWeight: 800, fontSize: 16 }}>🏢 InmoAdmin</span>
          {isMobile && <button onClick={() => setSidebarOpen(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", fontSize: 20, cursor: "pointer", padding: 4 }}>✕</button>}
        </div>
        <nav style={{ padding: "12px", flex: 1, overflowY: "auto" }}>
          {nav.map(n => (
            <button key={n.id} onClick={() => handleNavClick(n)} style={{
              width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 8, border: "none",
              cursor: "pointer", marginBottom: 2, fontSize: 14, fontWeight: 600,
              background: view === n.id ? "rgba(200,169,110,0.15)" : "transparent",
              color: view === n.id ? "#c8a96e" : "rgba(255,255,255,0.6)",
            }}>
              {n.icon} {n.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: 14, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <p style={{ margin: "0 0 2px", color: "#fff", fontSize: 12, fontWeight: 600 }}>{profile?.email?.split("@")[0]}</p>
          <p style={{ margin: "0 0 8px", color: "rgba(255,255,255,0.4)", fontSize: 10, textTransform: "uppercase" }}>{profile?.role === "admin" ? "Admin" : "Staff"}</p>
          <button onClick={logout} style={{ width: "100%", background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)", border: "none", borderRadius: 8, padding: "8px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Cerrar sesión</button>
        </div>
      </div>

      {/* CONTENIDO */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        {isMobile && (
          <div style={{ background: "#1a1a2e", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, position: "sticky", top: 0, zIndex: 100 }}>
            <button onClick={() => setSidebarOpen(true)} style={{ background: "none", border: "none", color: "#c8a96e", fontSize: 24, cursor: "pointer", padding: 0, lineHeight: 1 }}>☰</button>
            <span style={{ color: "#c8a96e", fontWeight: 700, fontSize: 15 }}>🏢 {currentNavLabel}</span>
          </div>
        )}

        <div style={{ flex: 1, padding: isMobile ? 14 : 32, overflowY: "auto" }}>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200 }}>
              <p style={{ color: "#6b7280" }}>Cargando...</p>
            </div>
          )}

          {/* DASHBOARD */}
          {!loading && view === "dashboard" && (
            <div>
              <h1 style={{ margin: "0 0 20px", fontSize: isMobile ? 20 : 26, fontWeight: 800, color: "#1a1a2e" }}>Panel de Control</h1>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
                {[
                  { label: "Renta mensual",    value: fmt(totalRent),         color: "#1a1a2e" },
                  { label: "Cobrado",          value: fmt(paid),              color: "#065f46" },
                  { label: "Pendiente",        value: fmt(pending),           color: "#92400e" },
                  { label: "Atrasado",         value: fmt(overdue),           color: "#991b1b" },
                  { label: "Comisiones/mes",   value: fmt(totalComisiones),   color: "#7c3aed" },
                  { label: "Com. pendientes",  value: fmt(comisionesPendientes), color: "#92400e" },
                  { label: "Saldo caja",       value: fmt(saldoCaja),         color: saldoCaja >= 0 ? "#065f46" : "#dc2626" },
                ].map((s, i) => (
                  <div key={i} style={{ background: "#fff", borderRadius: 14, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                    <p style={{ margin: "0 0 6px", fontSize: 10, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
                    <p style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 800, color: s.color }}>{s.value}</p>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
                <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Cobros este mes ({pagosMes.length})</h3>
                  {pagosMes.length === 0 && <p style={{ color: "#9ca3af", fontSize: 13 }}>No hay cobros este mes</p>}
                  {pagosMes.map(p => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                      <div>
                        <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{p.tenant_name || "-"}</p>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{p.property_name} · {p.due_date}</p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{fmt(p.amount)}</span>
                        <StatusBadge status={p.status} />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Últimos movimientos de caja</h3>
                  {cashMovements.slice(0, 6).map(m => (
                    <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.description}</p>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{categoryLabels[m.category]} · {m.date}</p>
                      </div>
                      <span style={{ fontWeight: 700, fontSize: 13, color: m.type === "entrada" ? "#065f46" : "#dc2626", marginLeft: 8, whiteSpace: "nowrap" }}>
                        {m.type === "entrada" ? "+" : "-"}{fmt(m.amount)}
                      </span>
                    </div>
                  ))}
                  {cashMovements.length === 0 && <p style={{ color: "#9ca3af", fontSize: 13 }}>No hay movimientos aún</p>}
                </div>
              </div>
            </div>
          )}

          {/* PROPIEDADES */}
          {!loading && view === "properties" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
                <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 26, fontWeight: 800, color: "#1a1a2e" }}>Propiedades ({properties.length})</h1>
                <Btn color="#c8a96e" small={isMobile} onClick={() => { setEditing(null); setShowModal("property"); }}>+ Nueva</Btn>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
                {properties.map(p => {
                  const gastosPropiedad = propertyExpenses.filter(e => e.property_name === p.name);
                  const totalGastos = gastosPropiedad.reduce((a, e) => a + (e.amount || 0), 0);
                  return (
                    <div key={p.id} style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                      <div style={{ background: "linear-gradient(135deg, #1a1a2e, #2d2d5e)", height: 60, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>
                        {p.property_type === "casa" ? "🏠" : p.property_type === "depto" ? "🏢" : p.property_type === "local" ? "🏪" : p.property_type === "bodega" ? "🏭" : "💼"}
                      </div>
                      <div style={{ padding: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{p.name}</h3>
                          <StatusBadge status={p.status} />
                        </div>
                        <p style={{ margin: "0 0 4px", fontSize: 11, color: "#6b7280" }}>📍 {p.address || "Sin dirección"}</p>
                        {p.owner_email && <p style={{ margin: "0 0 8px", fontSize: 11, color: "#9ca3af" }}>{p.owner_email}</p>}
                        <div style={{ paddingTop: 8, borderTop: "1px solid #f3f4f6", marginBottom: 10 }}>
                          <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{fmt(p.rent_amount)}</p>
                          {totalGastos > 0 && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#dc2626" }}>Gastos: {fmt(totalGastos)}</p>}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <Btn small color="#6b7280" onClick={() => {
                            setEditing({ type: "property", id: p.id });
                            setPropForm({ name: p.name || "", address: p.address || "", property_type: p.property_type || "depto", rent_amount: p.rent_amount || "", status: p.status || "disponible", notes: p.notes || "", owner_email: p.owner_email || "", owner_phone: p.owner_phone || "" });
                            setShowModal("property");
                          }}>Editar</Btn>
                          <Btn small color="#f59e0b" onClick={() => { setExpenseForm({ ...emptyExpense, property_name: p.name }); setShowModal("expense"); }}>Gasto</Btn>
                          {isAdmin && <Btn small color="#dc2626" onClick={() => deleteItem("property", p.id, `Eliminar "${p.name}"`)}>X</Btn>}
                        </div>
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f3f4f6" }}>
                          {p.contrato_url ? (
                            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              <span style={{ fontSize: 11, color: "#065f46", fontWeight: 600 }}>Contrato OK</span>
                              <Btn small color="#1e40af" onClick={() => verContrato(p.contrato_url)}>Ver</Btn>
                              <label style={{ cursor: "pointer" }}>
                                <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => subirContrato(p.id, p.name, e.target.files[0])} />
                                <span style={{ background: "#f59e0b", color: "#fff", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                  {uploadingContrato === p.id ? "Subiendo..." : "Actualizar"}
                                </span>
                              </label>
                              {isAdmin && <Btn small color="#dc2626" onClick={() => eliminarContrato(p.id, p.contrato_url)}>X</Btn>}
                            </div>
                          ) : (
                            <label style={{ cursor: "pointer", display: "inline-block" }}>
                              <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => subirContrato(p.id, p.name, e.target.files[0])} />
                              <span style={{ background: uploadingContrato === p.id ? "#9ca3af" : "#7c3aed", color: "#fff", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                {uploadingContrato === p.id ? "Subiendo..." : "Subir contrato PDF"}
                              </span>
                            </label>
                          )}
                        </div>
                        {gastosPropiedad.length > 0 && (
                          <div style={{ marginTop: 8, borderTop: "1px solid #f3f4f6", paddingTop: 8 }}>
                            {gastosPropiedad.slice(0, 3).map(e => (
                              <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "#6b7280", padding: "2px 0" }}>
                                <span>{expenseCategoryLabels[e.category]} · {e.description}</span>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <span style={{ color: "#dc2626", fontWeight: 600 }}>{fmt(e.amount)}</span>
                                  {isAdmin && <button onClick={() => deleteItem("expense", e.id, "Eliminar gasto")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, padding: "0 2px", color: "#dc2626" }}>X</button>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL PROPIEDAD */}
      {showModal === "property" && (
        <Modal title={editing ? "Editar Propiedad" : "Nueva Propiedad"} onClose={closeModal}>
          <Field label="Nombre"><Input value={propForm.name} onChange={e => setPropForm({ ...propForm, name: e.target.value })} /></Field>
          <Field label="Dirección"><Input value={propForm.address} onChange={e => setPropForm({ ...propForm, address: e.target.value })} /></Field>
          <Field label="Tipo">
            <Sel value={propForm.property_type} onChange={e => setPropForm({ ...propForm, property_type: e.target.value })}>
              <option value="depto">Departamento</option>
              <option value="casa">Casa</option>
              <option value="local">Local comercial</option>
              <option value="bodega">Bodega</option>
              <option value="oficina">Oficina</option>
            </Sel>
          </Field>
          <Field label="Renta mensual"><Input type="number" value={propForm.rent_amount} onChange={e => setPropForm({ ...propForm, rent_amount: e.target.value })} /></Field>
          <Field label="Estado">
            <Sel value={propForm.status} onChange={e => setPropForm({ ...propForm, status: e.target.value })}>
              <option value="disponible">Disponible</option>
              <option value="ocupada">Ocupada</option>
              <option value="mantenimiento">En mantenimiento</option>
            </Sel>
          </Field>
          <Field label="Email propietario"><Input type="email" value={propForm.owner_email} onChange={e => setPropForm({ ...propForm, owner_email: e.target.value })} /></Field>
          <Field label="Teléfono propietario"><Input value={propForm.owner_phone} onChange={e => setPropForm({ ...propForm, owner_phone: e.target.value })} /></Field>
          <Field label="Notas"><Input value={propForm.notes} onChange={e => setPropForm({ ...propForm, notes: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={closeModal} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={saveProperty} disabled={saving || !propForm.name}>{saving ? "Guardando..." : editing ? "Guardar cambios" : "Guardar"}</Btn>
          </div>
        </Modal>
      )}

      {/* MODAL GASTO */}
      {showModal === "expense" && (
        <Modal title="Registrar Gasto Operativo" onClose={closeModal}>
          <Field label="Propiedad">
            <Sel value={expenseForm.property_name} onChange={e => setExpenseForm({ ...expenseForm, property_name: e.target.value })}>
              <option value="">-- Selecciona --</option>
              {properties.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </Sel>
          </Field>
          <Field label="Concepto">
            <Sel value={expenseForm.category} onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value })}>
              <option value="condominio">Condominio</option>
              <option value="predial">Predial</option>
              <option value="agua">Agua</option>
              <option value="luz">Luz</option>
              <option value="gas">Gas</option>
              <option value="seguro">Seguro</option>
              <option value="mantenimiento_comun">Mantenimiento común</option>
              <option value="otro">Otro</option>
            </Sel>
          </Field>
          <Field label="Descripción"><Input placeholder="Ej: Cuota condominio enero 2026" value={expenseForm.description} onChange={e => setExpenseForm({ ...expenseForm, description: e.target.value })} /></Field>
          <Field label="Monto"><Input type="number" placeholder="0" value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} /></Field>
          <Field label="¿Quién paga?">
            <Sel value={expenseForm.paid_by} onChange={e => setExpenseForm({ ...expenseForm, paid_by: e.target.value })}>
              <option value="propietario">El propietario (se descuenta de su liquidación)</option>
              <option value="inmobiliaria">Nosotros (sale de nuestra caja)</option>
            </Sel>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Método">
              <Sel value={expenseForm.payment_method} onChange={e => setExpenseForm({ ...expenseForm, payment_method: e.target.value })}>
                <option value="transferencia">Transferencia</option>
                <option value="efectivo">Efectivo</option>
              </Sel>
            </Field>
            <Field label="Fecha"><Input type="date" value={expenseForm.date} onChange={e => setExpenseForm({ ...expenseForm, date: e.target.value })} /></Field>
          </div>
          <Field label="Notas"><Input placeholder="Observaciones" value={expenseForm.notes} onChange={e => setExpenseForm({ ...expenseForm, notes: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={closeModal} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={saveExpense} color="#f59e0b" disabled={saving || !expenseForm.description || !expenseForm.amount || !expenseForm.property_name}>
              {saving ? "Guardando..." : "Registrar gasto"}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
