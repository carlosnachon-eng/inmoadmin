import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n || 0);

const SERVICIOS_CONFIG = [
  { tipo: "luz",           label: "⚡ Luz (CFE)",       periodicidad: "bimestral" },
  { tipo: "agua",          label: "💧 Agua",            periodicidad: "mensual"   },
  { tipo: "gas_mensual",   label: "🔥 Gas (mensual)",   periodicidad: "mensual"   },
  { tipo: "gas_recarga",   label: "🔥 Gas (recarga)",   periodicidad: "recarga"   },
  { tipo: "mantenimiento", label: "🏢 Mantenimiento",   periodicidad: "mensual"   },
  { tipo: "internet",      label: "🌐 Internet",        periodicidad: "mensual"   },
  { tipo: "predial",       label: "🏛️ Predial/Limpia",  periodicidad: "anual"     },
];

const semaforo = (status) => {
  if (status === "pagado")      return { color: "#065f46", bg: "#d1fae5", label: "✅ Pagado" };
  if (status === "en_revision") return { color: "#1e40af", bg: "#dbeafe", label: "🔍 En revisión" };
  if (status === "atrasado")    return { color: "#991b1b", bg: "#fee2e2", label: "🔴 Atrasado" };
  return { color: "#92400e", bg: "#fef3c7", label: "⏳ Pendiente" };
};

const StatusBadge = ({ status }) => {
  const map = {
    pagado: { bg: "#d1fae5", color: "#065f46", label: "Pagado" },
    atrasado: { bg: "#fee2e2", color: "#991b1b", label: "Atrasado" },
    pendiente: { bg: "#fef3c7", color: "#92400e", label: "Pendiente" },
    en_revision: { bg: "#dbeafe", color: "#1e40af", label: "En revisión" },
    nuevo: { bg: "#fef3c7", color: "#92400e", label: "Nuevo" },
    en_proceso: { bg: "#dbeafe", color: "#1e40af", label: "En proceso" },
    resuelto: { bg: "#d1fae5", color: "#065f46", label: "Resuelto" },
    cotizado: { bg: "#faf5ff", color: "#7c3aed", label: "Cotizado" },
    aprobado: { bg: "#d1fae5", color: "#065f46", label: "Aprobado" },
  };
  const s = map[status] || { bg: "#f3f4f6", color: "#374151", label: status };
  return <span style={{ background: s.bg, color: s.color, padding: "2px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{s.label}</span>;
};

const TenantLogin = ({ onLogin }) => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sendMagicLink = async () => {
    setLoading(true); setError("");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: "https://app.emporioinmobiliario.com.mx/inquilino" } });
    setLoading(false);
    if (error) { setError("Error al enviar el enlace: " + error.message); return; }
    setSent(true);
  };
  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 56, objectFit: "contain", marginBottom: 24 }} />
      <div style={{ background: "#fff", borderRadius: 20, padding: 36, width: "100%", maxWidth: 400, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 800, color: "#4a4a4a", textAlign: "center" }}>Portal Inquilino</h1>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: "#9ca3af", textAlign: "center" }}>Emporio Inmobiliario</p>
        {error && <div style={{ background: "#fff0f3", color: "#b91c3c", padding: "12px 16px", borderRadius: 10, marginBottom: 20, fontSize: 14, fontWeight: 600 }}>{error}</div>}
        {!sent ? (
          <>
            <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 20px", textAlign: "center" }}>Ingresa tu email y te mandamos un enlace para entrar</p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Tu email</label>
              <input type="email" placeholder="tu@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMagicLink()} style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }} />
            </div>
            <button onClick={sendMagicLink} disabled={loading || !email} style={{ width: "100%", background: "#b91c3c", color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontSize: 15, opacity: loading ? 0.6 : 1 }}>
              {loading ? "Enviando..." : "Enviar enlace de acceso →"}
            </button>
          </>
        ) : (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
            <h3 style={{ margin: "0 0 12px", color: "#4a4a4a", fontSize: 18, fontWeight: 800 }}>¡Revisa tu email!</h3>
            <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 8px" }}>Enviamos un enlace a:</p>
            <p style={{ color: "#4a4a4a", fontWeight: 700, fontSize: 15, margin: "0 0 20px" }}>{email}</p>
            <p style={{ color: "#9ca3af", fontSize: 13 }}>Revisa también tu carpeta de spam</p>
            <button onClick={() => { setSent(false); setEmail(""); }} style={{ background: "transparent", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 14, textDecoration: "underline", marginTop: 12 }}>Usar otro email</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default function InquilinoPortal() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState("inicio");
  const [contract, setContract] = useState(null);
  const [payments, setPayments] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [servicios, setServicios] = useState([]);
  const [pagosServicios, setPagosServicios] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [ticketForm, setTicketForm] = useState({ title: "", description: "", category: "otro", priority: "media" });
  const [saving, setSaving] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(null);
  const [uploadingServicio, setUploadingServicio] = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const periodoActual = () => { const hoy = new Date(); return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`; };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setAuthLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => { setSession(session); });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadTenantData(); }, [session]);

  const loadTenantData = async () => {
    setLoading(true);
    const email = session.user.email;
    const { data: contractData } = await supabase.from("contracts").select("*").eq("tenant_email", email).eq("status", "activo").single();
    if (contractData) {
      setContract(contractData);
      const [{ data: paymentsData }, { data: ticketsData }, { data: servData }, { data: pagosServData }, { data: quotesData }] = await Promise.all([
        supabase.from("payments").select("*").eq("contract_id", contractData.id).order("due_date", { ascending: true }),
        supabase.from("maintenance_tickets").select("*").eq("tenant_name", contractData.tenant_name).order("created_at", { ascending: false }),
        supabase.from("servicios_inmueble").select("*").eq("property_name", contractData.property_name).eq("aplica", true),
        supabase.from("pagos_servicios").select("*").eq("property_name", contractData.property_name).order("created_at", { ascending: false }),
        supabase.from("maintenance_quotes").select("*").eq("tenant_email", email).eq("payer", "inquilino"),
      ]);
      setPayments(paymentsData || []);
      setTickets(ticketsData || []);
      setServicios((servData || []).filter(s => s.quien_paga === "inquilino"));
      setPagosServicios(pagosServData || []);
      setQuotes(quotesData || []);
    }
    setLoading(false);
  };

  const submitTicket = async () => {
    if (!contract) return;
    setSaving(true);
    const { error } = await supabase.from("maintenance_tickets").insert([{
      property_name: contract.property_name, tenant_name: contract.tenant_name,
      title: ticketForm.title, description: ticketForm.description,
      category: ticketForm.category, priority: ticketForm.priority, status: "nuevo",
      created_by: session.user.email,
    }]);
    setSaving(false);
    if (error) { showToast("Error al enviar: " + error.message, false); return; }
    showToast("✅ Reporte enviado, te contactaremos pronto");
    setTicketForm({ title: "", description: "", category: "otro", priority: "media" });
    setTab("mantenimiento"); loadTenantData();
  };

  const uploadReceipt = async (paymentId, file) => {
    setUploadingFile(paymentId);
    try {
      const ext = file.name.split(".").pop();
      const fileName = `comprobantes/${paymentId}_${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("receipts").upload(fileName, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("receipts").getPublicUrl(fileName);
      await supabase.from("payments").update({ receipt_url: publicUrl, status: "en_revision" }).eq("id", paymentId);
      showToast("✅ Comprobante enviado, lo revisaremos pronto");
      loadTenantData();
    } catch (e) { showToast("❌ Error al subir: " + e.message, false); }
    setUploadingFile(null);
  };

  const uploadComprobanteServicio = async (servicio, file) => {
    setUploadingServicio(servicio.tipo);
    try {
      const ext = file.name.split(".").pop();
      const fileName = `servicios/${contract.property_name}_${servicio.tipo}_${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("receipts").upload(fileName, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("receipts").getPublicUrl(fileName);
      const periodo = periodoActual();
      const pagoExistente = pagosServicios.find(p => p.tipo === servicio.tipo && p.periodo === periodo);
      if (pagoExistente) {
        await supabase.from("pagos_servicios").update({ comprobante_url: publicUrl, status: "en_revision" }).eq("id", pagoExistente.id);
      } else {
        await supabase.from("pagos_servicios").insert({ property_name: contract.property_name, tipo: servicio.tipo, periodo, status: "en_revision", comprobante_url: publicUrl, subido_por: session.user.email });
      }
      showToast("✅ Comprobante enviado, lo revisaremos pronto");
      loadTenantData();
    } catch (e) { showToast("❌ Error al subir: " + e.message, false); }
    setUploadingServicio(null);
  };

  const logout = async () => { await supabase.auth.signOut(); setSession(null); };

  const hoy = new Date();
  const pagosMes = payments.filter(p => { if (!p.due_date) return false; const d = new Date(p.due_date); return d.getMonth() === hoy.getMonth() && d.getFullYear() === hoy.getFullYear(); });
  const pagoPendiente = pagosMes.find(p => ["pendiente", "atrasado"].includes(p.status));
  const totalPagado = payments.filter(p => p.status === "pagado").length;
  const serviciosConEstado = servicios.map(s => { const periodo = periodoActual(); const pago = pagosServicios.find(p => p.tipo === s.tipo && p.periodo === periodo); return { ...s, pago }; });
  const serviciosPendientes = serviciosConEstado.filter(s => !s.pago || s.pago.status === "pendiente" || s.pago.status === "atrasado").length;
  const cotizacionesPendientes = quotes.filter(q => q.status === "pendiente");

  if (authLoading) return <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center" }}><img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} /></div>;
  if (!session) return <TenantLogin onLogin={() => loadTenantData()} />;
  if (loading) return <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "#9ca3af" }}>Cargando tu información...</p></div>;

  if (!contract) return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", padding: 40 }}>
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, marginBottom: 20 }} />
        <h2 style={{ color: "#4a4a4a", margin: "0 0 8px" }}>No encontramos tu contrato</h2>
        <p style={{ color: "#9ca3af", margin: "0 0 20px" }}>Usa el mismo email que registraste con tu inmobiliaria</p>
        <button onClick={logout} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 600 }}>Cerrar sesión</button>
      </div>
    </div>
  );

  const TABS = [
    { id: "inicio", label: "🏠 Inicio" },
    { id: "pagos", label: "💰 Pagos" },
    { id: "servicios", label: `🔌 Servicios${serviciosPendientes > 0 ? ` (${serviciosPendientes})` : ""}` },
    { id: "mantenimiento", label: `🔧 Mantenimiento${cotizacionesPendientes.length > 0 ? ` (${cotizacionesPendientes.length})` : ""}` },
    { id: "contrato", label: "📋 Contrato" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", fontFamily: "system-ui, sans-serif" }}>
      {toast && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, background: toast.ok ? "#065f46" : "#b91c3c", color: "#fff", padding: "16px 20px", fontWeight: 700, fontSize: 15, zIndex: 2000, textAlign: "center" }}>
          {toast.msg}
        </div>
      )}

      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "14px 20px" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 36, objectFit: "contain" }} />
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>Portal Inquilino</p>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#4a4a4a" }}>{contract.tenant_name.split(" ")[0]}</p>
          </div>
        </div>
      </div>

      <div style={{ background: "#b91c3c", padding: "20px 20px 0" }}>
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.8)", fontWeight: 600 }}>Hola, {contract.tenant_name.split(" ")[0]} 👋</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "rgba(255,255,255,0.6)" }}>📍 {contract.property_name}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Renta mensual</p>
              <p style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 800, color: "#fff" }}>{fmt(contract.monthly_rent)}</p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Día {contract.payment_day} de cada mes</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "8px 14px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", background: tab === t.id ? "#fff" : "rgba(255,255,255,0.15)", color: tab === t.id ? "#b91c3c" : "rgba(255,255,255,0.8)" }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 600, margin: "0 auto", padding: "24px 20px" }}>

        {tab === "inicio" && (
          <div>
            {cotizacionesPendientes.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 16, padding: 16, marginBottom: 16, border: "2px solid #7c3aed", cursor: "pointer" }} onClick={() => setTab("mantenimiento")}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>🔧 Tienes {cotizacionesPendientes.length} cotización{cotizacionesPendientes.length > 1 ? "es" : ""} de mantenimiento pendiente{cotizacionesPendientes.length > 1 ? "s" : ""} de aprobar</p>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca3af" }}>Toca aquí para revisar y responder →</p>
              </div>
            )}
            {pagoPendiente ? (
              <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 16, border: "2px solid #fcd34d" }}>
                <p style={{ margin: "0 0 4px", fontSize: 12, color: "#92400e", fontWeight: 700, textTransform: "uppercase" }}>⚠️ Pago pendiente este mes</p>
                <p style={{ margin: "0 0 16px", fontSize: 26, fontWeight: 800, color: "#4a4a4a" }}>{fmt(pagoPendiente.amount)}</p>
                <p style={{ margin: "0 0 16px", fontSize: 13, color: "#6b7280" }}>Vence el {pagoPendiente.due_date}</p>
                <label style={{ display: "flex", alignItems: "center", gap: 10, background: "#b91c3c", color: "#fff", padding: "12px 20px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14, width: "fit-content" }}>
                  {uploadingFile === pagoPendiente.id ? "Subiendo..." : "📎 Subir comprobante"}
                  <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={e => e.target.files[0] && uploadReceipt(pagoPendiente.id, e.target.files[0])} disabled={!!uploadingFile} />
                </label>
              </div>
            ) : (
              <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 16, border: "2px solid #6ee7b7" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span style={{ fontSize: 40 }}>✅</span>
                  <div>
                    <p style={{ margin: 0, fontWeight: 800, fontSize: 16, color: "#065f46" }}>¡Estás al corriente con la renta!</p>
                    <p style={{ margin: "4px 0 0", fontSize: 13, color: "#047857" }}>No tienes pagos pendientes este mes</p>
                  </div>
                </div>
              </div>
            )}
            {serviciosPendientes > 0 && (
              <div style={{ background: "#fff", borderRadius: 16, padding: 16, marginBottom: 16, border: "2px solid #fcd34d", cursor: "pointer" }} onClick={() => setTab("servicios")}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#92400e" }}>⚠️ Tienes {serviciosPendientes} servicio{serviciosPendientes > 1 ? "s" : ""} pendiente{serviciosPendientes > 1 ? "s" : ""} de comprobar</p>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca3af" }}>Toca aquí para subir tus comprobantes →</p>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div style={{ background: "#fff", borderRadius: 14, padding: 18 }}>
                <p style={{ margin: "0 0 4px", fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase" }}>Pagos realizados</p>
                <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#065f46" }}>{totalPagado}</p>
              </div>
              <div style={{ background: "#fff", borderRadius: 14, padding: 18 }}>
                <p style={{ margin: "0 0 4px", fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase" }}>Tickets abiertos</p>
                <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#b91c3c" }}>{tickets.filter(t => t.status !== "resuelto").length}</p>
              </div>
            </div>
            <button onClick={logout} style={{ width: "100%", background: "#f3f4f6", border: "none", borderRadius: 10, padding: "12px", cursor: "pointer", fontSize: 14, color: "#9ca3af", fontWeight: 600 }}>Cerrar sesión</button>
          </div>
        )}

        {tab === "pagos" && (
          <div>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#4a4a4a" }}>Historial de pagos</h3>
            {payments.map(p => (
              <div key={p.id} style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 10, border: p.status === "atrasado" ? "2px solid #fca5a5" : "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: "#4a4a4a" }}>{fmt(p.amount)}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>Vence {p.due_date}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                {["pendiente", "atrasado"].includes(p.status) && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, background: "#f9fafb", padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151", border: "1px dashed #d1d5db" }}>
                    {uploadingFile === p.id ? "⏳ Subiendo..." : "📎 Subir comprobante"}
                    <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={e => e.target.files[0] && uploadReceipt(p.id, e.target.files[0])} disabled={!!uploadingFile} />
                  </label>
                )}
                {p.status === "en_revision" && <div style={{ background: "#dbeafe", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#1e40af", fontWeight: 600 }}>🔍 Tu comprobante está en revisión</div>}
                {p.receipt_url && ["en_revision", "pagado"].includes(p.status) && (
                  <a href={p.receipt_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#065f46", textDecoration: "none", display: "inline-block", background: "#d1fae5", padding: "6px 12px", borderRadius: 8, fontWeight: 600, marginTop: 6 }}>📄 Ver comprobante</a>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "servicios" && (
          <div>
            <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#4a4a4a" }}>Mis servicios</h3>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#9ca3af" }}>Sube tus comprobantes de pago de servicios</p>
            {serviciosConEstado.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 16, padding: 48, textAlign: "center", border: "1px solid #f0f0f0" }}>
                <p style={{ fontSize: 32, margin: "0 0 8px" }}>✅</p>
                <p style={{ color: "#9ca3af" }}>No tienes servicios asignados por el momento</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {serviciosConEstado.map(serv => {
                  const config = SERVICIOS_CONFIG.find(c => c.tipo === serv.tipo);
                  const sem = semaforo(serv.pago?.status);
                  const esPendiente = !serv.pago || serv.pago.status === "pendiente" || serv.pago.status === "atrasado";
                  return (
                    <div key={serv.id} style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", border: esPendiente ? "2px solid #fcd34d" : "1px solid #f0f0f0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: "#4a4a4a" }}>{config?.label || serv.tipo}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>{serv.periodicidad}{serv.dia_limite_pago ? ` · Límite: día ${serv.dia_limite_pago}` : ""}</p>
                          {serv.numero_cuenta && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#6b7280" }}>No. cuenta: {serv.numero_cuenta}</p>}
                        </div>
                        <span style={{ background: sem.bg, color: sem.color, padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{sem.label}</span>
                      </div>
                      {serv.pago?.comprobante_url && (
                        <a href={serv.pago.comprobante_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#065f46", textDecoration: "none", display: "inline-block", background: "#d1fae5", padding: "6px 12px", borderRadius: 8, fontWeight: 600, marginBottom: 8 }}>📄 Ver comprobante enviado</a>
                      )}
                      {serv.pago?.status === "en_revision" && (
                        <div style={{ background: "#dbeafe", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#1e40af", fontWeight: 600, marginBottom: 8 }}>🔍 Tu comprobante está en revisión</div>
                      )}
                      {esPendiente && (
                        <label style={{ display: "flex", alignItems: "center", gap: 8, background: "#f9fafb", padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151", border: "1px dashed #d1d5db" }}>
                          {uploadingServicio === serv.tipo ? "⏳ Subiendo..." : "📎 Subir comprobante de pago"}
                          <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={e => e.target.files[0] && uploadComprobanteServicio(serv, e.target.files[0])} disabled={!!uploadingServicio} />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "mantenimiento" && (
          <div>
            {/* ── Cotizaciones pendientes ── */}
            {cotizacionesPendientes.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#7c3aed" }}>🔧 Cotizaciones pendientes de aprobación</h3>
                {cotizacionesPendientes.map(q => (
                  <div key={q.id} style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", marginBottom: 12, border: "2px solid #a78bfa" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <div>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: "#1a1a2e" }}>{q.descripcion}</p>
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>📍 {q.property_name}</p>
                      </div>
                      <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#7c3aed" }}>{fmt(q.monto_final)}</p>
                    </div>
                    <a
                      href={`/cotizacion/${q.id}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: "block", width: "100%", background: "#7c3aed", color: "#fff", textAlign: "center", padding: "12px", borderRadius: 10, textDecoration: "none", fontWeight: 700, fontSize: 14, boxSizing: "border-box" }}
                    >
                      Ver y responder cotización →
                    </a>
                  </div>
                ))}
              </div>
            )}

            {/* ── Reportar problema ── */}
            <div style={{ background: "#fff", borderRadius: 16, padding: 22, marginBottom: 16, border: "1px solid #e5e7eb" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "#4a4a4a" }}>Reportar un problema</h3>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>¿Qué ocurre? *</label>
                <input placeholder="Ej: Fuga de agua en baño" value={ticketForm.title} onChange={e => setTicketForm({ ...ticketForm, title: e.target.value })} style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Descripción</label>
                <textarea placeholder="Describe el problema..." value={ticketForm.description} onChange={e => setTicketForm({ ...ticketForm, description: e.target.value })} style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", minHeight: 80, resize: "vertical", fontFamily: "inherit" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Tipo</label>
                  <select value={ticketForm.category} onChange={e => setTicketForm({ ...ticketForm, category: e.target.value })} style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff" }}>
                    <option value="plomería">🚿 Plomería</option><option value="electricidad">⚡ Electricidad</option>
                    <option value="pintura">🎨 Pintura</option><option value="carpintería">🪚 Carpintería</option><option value="otro">🔧 Otro</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Urgencia</label>
                  <select value={ticketForm.priority} onChange={e => setTicketForm({ ...ticketForm, priority: e.target.value })} style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff" }}>
                    <option value="baja">🟢 Baja</option><option value="media">🟡 Media</option><option value="alta">🟠 Alta</option><option value="urgente">🔴 Urgente</option>
                  </select>
                </div>
              </div>
              <button onClick={submitTicket} disabled={saving || !ticketForm.title} style={{ width: "100%", background: "#b91c3c", color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontSize: 15, opacity: saving ? 0.6 : 1 }}>
                {saving ? "Enviando..." : "Enviar reporte"}
              </button>
            </div>

            {tickets.length > 0 && (
              <div>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#4a4a4a" }}>Mis reportes</h3>
                {tickets.map(t => {
                  const cotizacion = quotes.find(q => q.ticket_id === t.id);
                  return (
                    <div key={t.id} style={{ background: "#fff", borderRadius: 14, padding: "14px 18px", marginBottom: 10, border: "1px solid #f0f0f0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#4a4a4a" }}>{t.title}</p>
                        <StatusBadge status={t.status} />
                      </div>
                      <p style={{ margin: "0 0 6px", fontSize: 12, color: "#9ca3af" }}>{t.category} · {new Date(t.created_at).toLocaleDateString("es-MX")}</p>
                      {cotizacion && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: cotizacion.status === "aprobada" ? "#d1fae5" : cotizacion.status === "rechazada" ? "#fee2e2" : "#fef3c7", color: cotizacion.status === "aprobada" ? "#065f46" : cotizacion.status === "rechazada" ? "#991b1b" : "#92400e" }}>
                            Cotización {cotizacion.status}: {fmt(cotizacion.monto_final)}
                          </span>
                          {cotizacion.status === "pendiente" && (
                            <a href={`/cotizacion/${cotizacion.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700, textDecoration: "underline" }}>Responder →</a>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "contrato" && (
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #e5e7eb" }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 15, fontWeight: 700, color: "#4a4a4a" }}>Mi contrato</h3>
            {[
              ["Propiedad", contract.property_name],
              ["Inquilino", contract.tenant_name],
              ["Inicio", contract.start_date],
              ["Fin", contract.end_date],
              ["Renta mensual", fmt(contract.monthly_rent)],
              ["Depósito", fmt(contract.deposit_amount)],
              ["Día de pago", `Día ${contract.payment_day} de cada mes`],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #f9fafb" }}>
                <span style={{ fontSize: 14, color: "#9ca3af" }}>{k}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#4a4a4a" }}>{v}</span>
              </div>
            ))}
            {contract.contrato_url && (
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #f3f4f6" }}>
                <button
                  onClick={async () => { const { data } = await supabase.storage.from("contratos").createSignedUrl(contract.contrato_url, 60); if (data?.signedUrl) window.open(data.signedUrl, "_blank"); }}
                  style={{ width: "100%", background: "#b91c3c", color: "#fff", border: "none", borderRadius: 10, padding: "12px", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                  📄 Ver mi contrato PDF
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
