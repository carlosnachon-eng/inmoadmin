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
    pagado_parcial: { bg: "#dbeafe", color: "#1e40af", label: "Parcial" },
    atrasado: { bg: "#fee2e2", color: "#991b1b", label: "Atrasado" },
    pendiente: { bg: "#fef3c7", color: "#92400e", label: "Pendiente" },
    en_revision: { bg: "#dbeafe", color: "#1e40af", label: "En revisión" },
    nuevo: { bg: "#fef3c7", color: "#92400e", label: "Nuevo" },
    en_proceso: { bg: "#dbeafe", color: "#1e40af", label: "En proceso" },
    resuelto: { bg: "#d1fae5", color: "#065f46", label: "Resuelto" },
  };
  const s = map[status] || { bg: "#f3f4f6", color: "#374151", label: status };
  return <span style={{ background: s.bg, color: s.color, padding: "2px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{s.label}</span>;
};

const OwnerLogin = ({ onLogin }) => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sendMagicLink = async () => {
    setLoading(true); setError("");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: "https://app.emporioinmobiliario.com.mx/propietario" } });
    setLoading(false);
    if (error) { setError("Error: " + error.message); return; }
    setSent(true);
  };
  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 56, objectFit: "contain", marginBottom: 24 }} />
      <div style={{ background: "#fff", borderRadius: 20, padding: 36, width: "100%", maxWidth: 400, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 800, color: "#4a4a4a", textAlign: "center" }}>Portal Propietario</h1>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: "#9ca3af", textAlign: "center" }}>Emporio Inmobiliario</p>
        {error && <div style={{ background: "#fff0f3", color: "#b91c3c", padding: "12px 16px", borderRadius: 10, marginBottom: 20, fontSize: 14, fontWeight: 600 }}>{error}</div>}
        {!sent ? (
          <>
            <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 20px", textAlign: "center" }}>Ingresa tu email para acceder a tu portal</p>
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

const calcComision = (contrato) => {
  if (!contrato?.commission_value) return 0;
  if (contrato.commission_type === "porcentaje") return (contrato.monthly_rent * contrato.commission_value) / 100;
  return contrato.commission_value;
};

const generarPDF = async (ownerName, properties, contracts, payments, liquidaciones, tickets, propertyExpenses) => {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF();
  const hoy = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
  const mes = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long" });
  const totalRenta = contracts.reduce((a, c) => a + (c.monthly_rent || 0), 0);
  const totalCom = contracts.reduce((a, c) => a + calcComision(c), 0);
  const costoMantPropietario = (tickets || []).filter(t => t.payer === "propietario" && t.charged_amount > 0).reduce((a, t) => a + (t.charged_amount || 0), 0);
  const gastosOp = (propertyExpenses || []).reduce((a, e) => a + (e.amount || 0), 0);
  const totalLiqProp = totalRenta - totalCom - costoMantPropietario - gastosOp;
  const totalPagadoProp = (liquidaciones || []).filter(l => l.status === "pagado").reduce((a, l) => a + (l.amount_paid || 0), 0);
  doc.setFillColor(185, 28, 60); doc.rect(0, 0, 210, 42, "F");
  doc.setFillColor(127, 29, 46); doc.rect(0, 36, 210, 6, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.setFont("helvetica", "bold");
  doc.text("EMPORIO", 20, 16);
  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(255, 200, 200);
  doc.text("INMOBILIARIO", 20, 23); doc.text("Reporte de Propietario", 20, 31);
  doc.setFontSize(8); doc.text(`Generado: ${hoy}`, 210 - 20, 31, { align: "right" });
  doc.setTextColor(74, 74, 74); doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text(ownerName, 20, 57);
  doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.setTextColor(122, 122, 122);
  doc.text(`Periodo: ${mes}`, 20, 65);
  let y = 78;
  const headStyle = { fillColor: [185, 28, 60], textColor: [255, 255, 255], fontStyle: "bold" };
  const altRow = { fillColor: [249, 250, 251] };
  doc.setFillColor(255, 240, 243); doc.rect(15, y, 180, 32, "F");
  doc.setDrawColor(185, 28, 60); doc.setLineWidth(0.5); doc.rect(15, y, 180, 32, "S");
  doc.setTextColor(74, 74, 74); doc.setFontSize(10); doc.setFont("helvetica", "bold");
  doc.text("RESUMEN FINANCIERO", 20, y + 8);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`Renta mensual total: ${fmt(totalRenta)}`, 20, y + 16);
  doc.text(`Comisión administración: -${fmt(totalCom)}`, 20, y + 23);
  doc.setTextColor(30, 64, 175); doc.text(`Total liquidado histórico: ${fmt(totalPagadoProp)}`, 110, y + 16);
  doc.setFont("helvetica", "bold"); doc.setTextColor(6, 95, 70);
  doc.text(`Líquido a recibir: ${fmt(totalLiqProp)}`, 20, y + 30);
  y += 42;
  doc.setTextColor(74, 74, 74); doc.setFontSize(13); doc.setFont("helvetica", "bold");
  doc.text("Mis Propiedades", 20, y); y += 6;
  autoTable(doc, { startY: y, head: [["Propiedad", "Inquilino", "Renta", "Comisión", "Líquido"]], body: properties.map(prop => { const c = contracts.find(c => c.property_name === prop.name); const com = c ? calcComision(c) : 0; return [prop.name, c?.tenant_name || "—", fmt(prop.rent_amount), fmt(com), fmt((prop.rent_amount || 0) - com)]; }), styles: { fontSize: 8, cellPadding: 3 }, headStyles: headStyle, alternateRowStyles: altRow, margin: { left: 15, right: 15 } });
  y = doc.lastAutoTable.finalY + 12; if (y > 220) { doc.addPage(); y = 20; }
  const totalPaginas = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i);
    doc.setFillColor(185, 28, 60); doc.rect(0, 285, 210, 15, "F");
    doc.setTextColor(255, 255, 255); doc.setFontSize(8);
    doc.text("Emporio Inmobiliario — app.emporioinmobiliario.com.mx", 20, 293);
    doc.setTextColor(255, 200, 200); doc.text(`Página ${i} de ${totalPaginas}`, 175, 293);
  }
  doc.save(`Reporte_${ownerName.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`);
};

export default function PropietarioPortal() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState("inicio");
  const [properties, setProperties] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [liquidaciones, setLiquidaciones] = useState([]);
  const [propertyExpenses, setPropertyExpenses] = useState([]);
  const [serviciosPorPropiedad, setServiciosPorPropiedad] = useState({});
  const [pagosPorPropiedad, setPagosPorPropiedad] = useState({});
  const [loading, setLoading] = useState(false);
  const [generandoPDF, setGenerandoPDF] = useState(false);
  const [ownerName, setOwnerName] = useState("");

  const periodoActual = () => {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setAuthLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => { setSession(session); });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadOwnerData(); }, [session]);

  const loadOwnerData = async () => {
    setLoading(true);
    const email = session.user.email;
    const { data: propsData } = await supabase.from("properties").select("*").eq("owner_email", email);
    if (propsData && propsData.length > 0) {
      setProperties(propsData);
      const propNames = propsData.map(p => p.name);
      const [{ data: contractsData }, { data: ticketsData }, { data: liqData }, { data: expData }, { data: servData }, { data: pagosServData }] = await Promise.all([
        supabase.from("contracts").select("*").in("property_name", propNames).eq("status", "activo"),
        supabase.from("maintenance_tickets").select("*").in("property_name", propNames).order("created_at", { ascending: false }),
        supabase.from("owner_payments").select("*").eq("owner_email", email).order("created_at", { ascending: false }),
        supabase.from("property_expenses").select("*").in("property_name", propNames).order("date", { ascending: false }),
        supabase.from("servicios_inmueble").select("*").in("property_name", propNames).eq("aplica", true),
        supabase.from("pagos_servicios").select("*").in("property_name", propNames).eq("periodo", periodoActual()),
      ]);
      setContracts(contractsData || []);
      setTickets(ticketsData || []);
      setLiquidaciones(liqData || []);
      setPropertyExpenses(expData || []);
      setOwnerName(contractsData?.[0]?.owner_name || email.split("@")[0]);

      if (contractsData && contractsData.length > 0) {
        const contractIds = contractsData.map(c => c.id);
        const { data: paymentsData } = await supabase.from("payments").select("*").in("contract_id", contractIds).order("due_date", { ascending: false });
        setPayments(paymentsData || []);
      }

      // Organizar servicios y pagos por propiedad
      const servPorProp = {};
      const pagosPorProp = {};
      propNames.forEach(name => {
        servPorProp[name] = (servData || []).filter(s => s.property_name === name);
        pagosPorProp[name] = (pagosServData || []).filter(p => p.property_name === name);
      });
      setServiciosPorPropiedad(servPorProp);
      setPagosPorPropiedad(pagosPorProp);
    } else {
      setOwnerName(email.split("@")[0]);
    }
    setLoading(false);
  };

  const logout = async () => { await supabase.auth.signOut(); setSession(null); };
  const handlePDF = async () => { setGenerandoPDF(true); try { await generarPDF(ownerName, properties, contracts, payments, liquidaciones, tickets, propertyExpenses); } catch (e) { console.error(e); } setGenerandoPDF(false); };

  const totalRenta = contracts.reduce((a, c) => a + (c.monthly_rent || 0), 0);
  const totalComisiones = contracts.reduce((a, c) => a + calcComision(c), 0);
  const costoMant = tickets.filter(t => t.payer === "propietario" && t.charged_amount > 0).reduce((a, t) => a + (t.charged_amount || 0), 0);
  const totalLiquido = totalRenta - totalComisiones - costoMant;
  const totalCobrado = payments.filter(p => p.status === "pagado").reduce((a, p) => a + (p.amount || 0), 0);
  const totalLiquidado = liquidaciones.filter(l => l.status === "pagado").reduce((a, l) => a + (l.amount_paid || 0), 0);
  const hoy = new Date();

  if (authLoading) return <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center" }}><img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} /></div>;
  if (!session) return <OwnerLogin onLogin={() => loadOwnerData()} />;
  if (loading) return <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "#9ca3af" }}>Cargando tu información...</p></div>;

  if (properties.length === 0) return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", padding: 40 }}>
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, marginBottom: 20 }} />
        <h2 style={{ color: "#4a4a4a", margin: "0 0 8px" }}>No encontramos tus propiedades</h2>
        <p style={{ color: "#9ca3af", margin: "0 0 20px" }}>Usa el email registrado con tu inmobiliaria</p>
        <button onClick={logout} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 600 }}>Cerrar sesión</button>
      </div>
    </div>
  );

  const TABS = [
    { id: "inicio", label: "📊 Resumen" },
    { id: "propiedades", label: "🏠 Propiedades" },
    { id: "servicios", label: "🔌 Servicios" },
    { id: "pagos", label: "💰 Pagos" },
    { id: "liquidaciones", label: "🏦 Liquidaciones" },
    { id: "mantenimiento", label: "🔧 Mantenimiento" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "14px 20px" }}>
        <div style={{ maxWidth: 700, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 36, objectFit: "contain" }} />
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>Portal Propietario</p>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#4a4a4a" }}>{ownerName}</p>
          </div>
        </div>
      </div>

      <div style={{ background: "#b91c3c", padding: "20px 20px 0" }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.8)", fontWeight: 600 }}>Hola, {ownerName} 👋</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{properties.length} propiedad{properties.length !== 1 ? "es" : ""} administrada{properties.length !== 1 ? "s" : ""}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Líquido mensual</p>
              <p style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 800, color: "#fff" }}>{fmt(totalLiquido)}</p>
              <button onClick={handlePDF} disabled={generandoPDF} style={{ marginTop: 8, background: "rgba(255,255,255,0.2)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 8, padding: "6px 14px", cursor: generandoPDF ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>
                {generandoPDF ? "Generando..." : "📄 Descargar PDF"}
              </button>
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

      <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 20px" }}>

        {tab === "inicio" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Renta mensual", value: fmt(totalRenta), color: "#4a4a4a" },
                { label: "Tu líquido/mes", value: fmt(totalLiquido), color: "#065f46" },
                { label: "Total cobrado", value: fmt(totalCobrado), color: "#1e40af" },
                { label: "Total liquidado", value: fmt(totalLiquidado), color: "#065f46" },
                { label: "Tickets abiertos", value: tickets.filter(t => !["cerrado","resuelto"].includes(t.status)).length, color: "#b91c3c" },
                { label: "Contratos activos", value: contracts.length, color: "#7c3aed" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #f0f0f0" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
                  <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#4a4a4a" }}>Estado de este mes</h3>
            {properties.map(prop => {
              const contrato = contracts.find(c => c.property_name === prop.name);
              const pagoMes = payments.find(p => { if (!p.due_date) return false; const d = new Date(p.due_date); return d.getMonth() === hoy.getMonth() && d.getFullYear() === hoy.getFullYear() && p.property_name === prop.name; });
              const comision = contrato ? calcComision(contrato) : 0;
              // Semáforo servicios de esta propiedad
              const servs = serviciosPorPropiedad[prop.name] || [];
              const pagos = pagosPorPropiedad[prop.name] || [];
              const servAtrasados = servs.filter(s => { const p = pagos.find(p => p.tipo === s.tipo); return !p || p.status === "pendiente" || p.status === "atrasado"; }).length;
              return (
                <div key={prop.id} style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #f0f0f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#4a4a4a" }}>{prop.name}</h4>
                      {contrato && <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>👤 {contrato.tenant_name} · Día {contrato.payment_day}</p>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                      {pagoMes && <StatusBadge status={pagoMes.status} />}
                      {servs.length > 0 && (
                        <span style={{ background: servAtrasados > 0 ? "#fee2e2" : "#d1fae5", color: servAtrasados > 0 ? "#991b1b" : "#065f46", padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600 }}>
                          {servAtrasados > 0 ? `⚠️ ${servAtrasados} servicios pend.` : "✅ Servicios al día"}
                        </span>
                      )}
                    </div>
                  </div>
                  {contrato && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      {[
                        { label: "Renta", value: fmt(contrato.monthly_rent), color: "#4a4a4a" },
                        { label: "Comisión", value: fmt(comision), color: "#7c3aed" },
                        { label: "Tu líquido", value: fmt(contrato.monthly_rent - comision), color: "#065f46" },
                      ].map((s, i) => (
                        <div key={i} style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 10px" }}>
                          <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>{s.label}</p>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: s.color }}>{s.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <button onClick={logout} style={{ width: "100%", background: "#f3f4f6", border: "none", borderRadius: 10, padding: "12px", cursor: "pointer", fontSize: 14, color: "#9ca3af", fontWeight: 600, marginTop: 8 }}>Cerrar sesión</button>
          </div>
        )}

        {tab === "propiedades" && (
          <div>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#4a4a4a" }}>Mis propiedades</h3>
            {properties.map(prop => {
              const contrato = contracts.find(c => c.property_name === prop.name);
              const comision = contrato ? calcComision(contrato) : 0;
              const dias = contrato ? Math.ceil((new Date(contrato.end_date) - new Date()) / (1000 * 60 * 60 * 24)) : null;
              return (
                <div key={prop.id} style={{ background: "#fff", borderRadius: 14, overflow: "hidden", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #f0f0f0" }}>
                  <div style={{ background: "linear-gradient(135deg, #b91c3c, #7f1d2e)", height: 56, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                    {prop.property_type === "casa" ? "🏠" : "🏢"}
                  </div>
                  <div style={{ padding: "16px 18px" }}>
                    <h4 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: "#4a4a4a" }}>{prop.name}</h4>
                    {prop.address && <p style={{ margin: "0 0 12px", fontSize: 12, color: "#9ca3af" }}>📍 {prop.address}</p>}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, paddingTop: 12, borderTop: "1px solid #f3f4f6" }}>
                      {[
                        { label: "Renta", value: fmt(prop.rent_amount), color: "#4a4a4a" },
                        { label: "Comisión", value: fmt(comision), color: "#7c3aed" },
                        { label: "Tu líquido", value: fmt((prop.rent_amount || 0) - comision), color: "#065f46" },
                      ].map((s, i) => (
                        <div key={i}>
                          <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{s.label}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</p>
                        </div>
                      ))}
                    </div>
                    {contrato && (
                      <div style={{ marginTop: 12, background: "#f9fafb", borderRadius: 8, padding: "10px 14px" }}>
                        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                          👤 <strong>{contrato.tenant_name}</strong> · Día {contrato.payment_day} · Hasta {contrato.end_date}
                          {dias !== null && <span style={{ color: dias <= 30 ? "#b91c3c" : "#9ca3af", fontWeight: 700 }}> ({dias}d)</span>}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── TAB SERVICIOS ── */}
        {tab === "servicios" && (
          <div>
            <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#4a4a4a" }}>Estado de servicios</h3>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#9ca3af" }}>Periodo actual: {periodoActual()}</p>
            {properties.map(prop => {
              const servs = serviciosPorPropiedad[prop.name] || [];
              const pagos = pagosPorPropiedad[prop.name] || [];
              if (servs.length === 0) return (
                <div key={prop.id} style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 12, border: "1px solid #f0f0f0" }}>
                  <h4 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: "#4a4a4a" }}>{prop.name}</h4>
                  <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>Sin servicios configurados</p>
                </div>
              );
              return (
                <div key={prop.id} style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 16, border: "1px solid #f0f0f0" }}>
                  <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#4a4a4a" }}>{prop.name}</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {servs.map(serv => {
                      const config = SERVICIOS_CONFIG.find(c => c.tipo === serv.tipo);
                      const pago = pagos.find(p => p.tipo === serv.tipo);
                      const sem = semaforo(pago?.status);
                      const quienPaga = serv.quien_paga || "inquilino";
                      return (
                        <div key={serv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f9fafb", borderRadius: 8, padding: "10px 14px" }}>
                          <div>
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#374151" }}>{config?.label || serv.tipo}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>
                              {quienPaga === "incluido" ? "Incluido en renta" : quienPaga === "propietario" ? "A tu cargo" : "Cargo del inquilino"}
                              {serv.dia_limite_pago ? ` · Límite: día ${serv.dia_limite_pago}` : ""}
                            </p>
                            {serv.numero_cuenta && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#6b7280" }}>No. cuenta: {serv.numero_cuenta}</p>}
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <span style={{ background: sem.bg, color: sem.color, padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{sem.label}</span>
                            {pago?.comprobante_url && (
                              <a href={pago.comprobante_url} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: 11, color: "#1e40af", marginTop: 4 }}>📄 Ver comprobante</a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "pagos" && (
          <div>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#4a4a4a" }}>Historial de pagos</h3>
            {payments.map(p => (
              <div key={p.id} style={{ background: "#fff", borderRadius: 14, padding: "14px 18px", marginBottom: 10, border: p.status === "atrasado" ? "2px solid #fca5a5" : "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: "#4a4a4a" }}>{fmt(p.amount)}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>{p.property_name} · Vence {p.due_date}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>👤 {p.tenant_name}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "liquidaciones" && (
          <div>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "#4a4a4a" }}>Mis liquidaciones</h3>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#9ca3af" }}>Historial de pagos que te ha hecho Emporio Inmobiliario</p>
            {liquidaciones.length === 0 && <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center", border: "1px solid #f0f0f0" }}><p style={{ color: "#9ca3af" }}>Aún no hay liquidaciones registradas</p></div>}
            {liquidaciones.map(l => (
              <div key={l.id} style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", borderLeft: `4px solid ${l.status === "pagado" ? "#065f46" : "#92400e"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: "#4a4a4a" }}>{l.period_description}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>{l.payment_date} · {l.payment_method}</p>
                  </div>
                  <StatusBadge status={l.status} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {[
                    { label: "Renta cobrada", value: fmt(l.total_rent), color: "#4a4a4a", bg: "#f9fafb" },
                    { label: "Comisión admin", value: fmt(l.total_commission), color: "#7c3aed", bg: "#faf5ff" },
                    { label: "Te pagamos", value: fmt(l.amount_paid), color: "#065f46", bg: "#f0fdf4" },
                  ].map((s, i) => (
                    <div key={i} style={{ background: s.bg, borderRadius: 8, padding: "8px 12px" }}>
                      <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>{s.label}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 800, color: s.color }}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "mantenimiento" && (
          <div>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#4a4a4a" }}>Historial de mantenimiento</h3>
            {tickets.length === 0 && <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center", border: "1px solid #f0f0f0" }}><p style={{ fontSize: 32, margin: "0 0 8px" }}>✅</p><p style={{ color: "#9ca3af" }}>No hay reportes de mantenimiento</p></div>}
            {tickets.map(t => (
              <div key={t.id} style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 10, border: "1px solid #f0f0f0", borderLeft: t.payer === "propietario" ? "4px solid #fca5a5" : "4px solid #e5e7eb" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#4a4a4a" }}>{t.title}</h4>
                  <StatusBadge status={t.status} />
                </div>
                <p style={{ margin: "0 0 6px", fontSize: 12, color: "#9ca3af" }}>📍 {t.property_name}</p>
                {t.description && <p style={{ margin: "0 0 8px", fontSize: 13, color: "#374151" }}>{t.description}</p>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, background: "#f3f4f6", color: "#374151", padding: "2px 8px", borderRadius: 6 }}>Paga: {t.payer}</span>
                  {t.payer === "propietario" && t.charged_amount > 0 && <span style={{ fontSize: 12, color: "#b91c3c", background: "#fff0f3", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>A tu cargo: {fmt(t.charged_amount)}</span>}
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>{new Date(t.created_at).toLocaleDateString("es-MX")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
