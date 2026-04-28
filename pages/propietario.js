import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const StatusBadge = ({ status }) => {
  const map = {
    pagado: { bg: "#d1fae5", color: "#065f46", label: "Pagado" },
    pagado_parcial: { bg: "#dbeafe", color: "#1e40af", label: "Parcial" },
    atrasado: { bg: "#fee2e2", color: "#991b1b", label: "Atrasado" },
    pendiente: { bg: "#fef3c7", color: "#92400e", label: "Pendiente" },
    en_revision: { bg: "#dbeafe", color: "#1e40af", label: "En revisión" },
    ocupada: { bg: "#d1fae5", color: "#065f46", label: "Ocupada" },
    disponible: { bg: "#e0e7ff", color: "#3730a3", label: "Disponible" },
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
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: "https://app.emporioinmobiliario.com.mx/propietario" }
    });
    setLoading(false);
    if (error) { setError("Error: " + error.message); return; }
    setSent(true);
  };
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #1a1a2e, #2d2d5e)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: 40, width: "100%", maxWidth: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏠</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#1a1a2e" }}>Portal Propietario</h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "#6b7280" }}>Emporio Inmobiliario</p>
        </div>
        {error && <div style={{ background: "#fee2e2", color: "#991b1b", padding: "12px 16px", borderRadius: 10, marginBottom: 20, fontSize: 14, fontWeight: 600 }}>{error}</div>}
        {!sent ? (
          <>
            <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 20px", textAlign: "center" }}>Ingresa tu email para acceder a tu portal</p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Tu email</label>
              <input type="email" placeholder="tu@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMagicLink()} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 15, boxSizing: "border-box" }} />
            </div>
            <button onClick={sendMagicLink} disabled={loading || !email} style={{ width: "100%", background: "#c8a96e", color: "#fff", border: "none", borderRadius: 12, padding: "13px", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontSize: 15, opacity: loading ? 0.6 : 1 }}>
              {loading ? "Enviando..." : "Enviar enlace de acceso →"}
            </button>
          </>
        ) : (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>📧</div>
            <h3 style={{ margin: "0 0 12px", color: "#1a1a2e", fontSize: 18, fontWeight: 800 }}>¡Revisa tu email!</h3>
            <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 8px" }}>Enviamos un enlace a:</p>
            <p style={{ color: "#1a1a2e", fontWeight: 700, fontSize: 15, margin: "0 0 20px" }}>{email}</p>
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

const generarPDF = async (ownerName, properties, contracts, payments, liquidaciones, tickets) => {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF();
  const hoy = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
  const mes = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long" });

  // Header
  doc.setFillColor(26, 26, 46);
  doc.rect(0, 0, 210, 40, "F");
  doc.setTextColor(200, 169, 110);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("Emporio Inmobiliario", 20, 18);
  doc.setFontSize(11);
  doc.setTextColor(200, 200, 200);
  doc.text("Reporte de Propietario", 20, 28);
  doc.text(`Generado: ${hoy}`, 20, 35);

  // Propietario
  doc.setTextColor(26, 26, 46);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`${ownerName}`, 20, 55);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text(`Periodo: ${mes}`, 20, 63);

  let y = 75;

  // Resumen financiero
  doc.setFillColor(240, 253, 244);
  doc.rect(15, y, 180, 35, "F");
  doc.setDrawColor(200, 169, 110);
  doc.rect(15, y, 180, 35, "S");

  const totalRenta = contracts.reduce((a, c) => a + (c.monthly_rent || 0), 0);
  const totalCom = contracts.reduce((a, c) => a + calcComision(c), 0);
  const totalLiq = totalRenta - totalCom;
  const totalPagado = liquidaciones.filter(l => l.status === "pagado").reduce((a, l) => a + (l.amount_paid || 0), 0);

  doc.setTextColor(26, 26, 46);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("RESUMEN FINANCIERO", 20, y + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Renta mensual total: ${fmt(totalRenta)}`, 20, y + 16);
  doc.text(`Comisión administración: ${fmt(totalCom)}`, 20, y + 23);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(6, 95, 70);
  doc.text(`Líquido mensual: ${fmt(totalLiq)}`, 20, y + 30);
  doc.setTextColor(30, 64, 175);
  doc.text(`Total liquidado histórico: ${fmt(totalPagado)}`, 110, y + 23);

  y += 45;

  // Propiedades
  doc.setTextColor(26, 26, 46);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Mis Propiedades", 20, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [["Propiedad", "Inquilino", "Renta", "Comisión", "Líquido", "Día pago"]],
    body: properties.map(prop => {
      const contrato = contracts.find(c => c.property_name === prop.name);
      const com = contrato ? calcComision(contrato) : 0;
      return [
        prop.name,
        contrato?.tenant_name || "—",
        fmt(prop.rent_amount),
        fmt(com),
        fmt((prop.rent_amount || 0) - com),
        contrato ? `Día ${contrato.payment_day}` : "—"
      ];
    }),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [26, 26, 46], textColor: [200, 169, 110], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    margin: { left: 15, right: 15 },
  });

  y = doc.lastAutoTable.finalY + 12;

  // Nueva página si necesario
  if (y > 220) { doc.addPage(); y = 20; }

  // Pagos del mes
  doc.setTextColor(26, 26, 46);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Pagos del Mes", 20, y);
  y += 6;

  const pagosMes = payments.filter(p => {
    if (!p.due_date) return false;
    const d = new Date(p.due_date);
    const hoyD = new Date();
    return d.getMonth() === hoyD.getMonth() && d.getFullYear() === hoyD.getFullYear();
  });

  autoTable(doc, {
    startY: y,
    head: [["Inquilino", "Propiedad", "Monto", "Vencimiento", "Estado"]],
    body: pagosMes.length > 0 ? pagosMes.map(p => [
      p.tenant_name || "—",
      p.property_name || "—",
      fmt(p.amount),
      p.due_date || "—",
      p.status === "pagado" ? "Pagado" : p.status === "atrasado" ? "Atrasado" : "Pendiente"
    ]) : [["Sin pagos registrados este mes", "", "", "", ""]],
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [26, 26, 46], textColor: [200, 169, 110], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    bodyStyles: { textColor: [55, 65, 81] },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 4) {
        if (data.cell.raw === "Pagado") data.cell.styles.textColor = [6, 95, 70];
        if (data.cell.raw === "Atrasado") data.cell.styles.textColor = [153, 27, 27];
        if (data.cell.raw === "Pendiente") data.cell.styles.textColor = [146, 64, 14];
      }
    },
    margin: { left: 15, right: 15 },
  });

  y = doc.lastAutoTable.finalY + 12;
  if (y > 220) { doc.addPage(); y = 20; }

  // Liquidaciones
  doc.setTextColor(26, 26, 46);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Historial de Liquidaciones", 20, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [["Periodo", "Renta", "Comisión", "Te pagamos", "Fecha", "Estado"]],
    body: liquidaciones.length > 0 ? liquidaciones.map(l => [
      l.period_description || "—",
      fmt(l.total_rent),
      fmt(l.total_commission),
      fmt(l.amount_paid),
      l.payment_date || "—",
      l.status === "pagado" ? "Pagado" : l.status === "pagado_parcial" ? "Parcial" : "Pendiente"
    ]) : [["Sin liquidaciones registradas", "", "", "", "", ""]],
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [26, 26, 46], textColor: [200, 169, 110], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    margin: { left: 15, right: 15 },
  });

  y = doc.lastAutoTable.finalY + 12;
  if (y > 220) { doc.addPage(); y = 20; }

  // Mantenimiento
  doc.setTextColor(26, 26, 46);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Mantenimiento", 20, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [["Título", "Propiedad", "Categoría", "Costo", "Estado", "Fecha"]],
    body: tickets.length > 0 ? tickets.map(t => [
      t.title || "—",
      t.property_name || "—",
      t.category || "—",
      t.provider_cost > 0 ? fmt(t.provider_cost) : "—",
      t.status === "resuelto" ? "Resuelto" : t.status === "en_proceso" ? "En proceso" : "Nuevo",
      new Date(t.created_at).toLocaleDateString("es-MX")
    ]) : [["Sin reportes de mantenimiento", "", "", "", "", ""]],
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [26, 26, 46], textColor: [200, 169, 110], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    margin: { left: 15, right: 15 },
  });

  // Footer en todas las páginas
  const totalPaginas = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i);
    doc.setFillColor(26, 26, 46);
    doc.rect(0, 285, 210, 15, "F");
    doc.setTextColor(200, 169, 110);
    doc.setFontSize(8);
    doc.text("Emporio Inmobiliario — app.emporioinmobiliario.com.mx", 20, 293);
    doc.setTextColor(150, 150, 150);
    doc.text(`Página ${i} de ${totalPaginas}`, 175, 293);
  }

  const nombreArchivo = `Reporte_${ownerName.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`;
  doc.save(nombreArchivo);
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
  const [loading, setLoading] = useState(false);
  const [generandoPDF, setGenerandoPDF] = useState(false);
  const [ownerName, setOwnerName] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setAuthLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { setSession(session); });
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
      const { data: contractsData } = await supabase.from("contracts").select("*").in("property_name", propNames).eq("status", "activo");
      setContracts(contractsData || []);
      if (contractsData && contractsData.length > 0) {
        const contractIds = contractsData.map(c => c.id);
        const { data: paymentsData } = await supabase.from("payments").select("*").in("contract_id", contractIds).order("due_date", { ascending: false });
        setPayments(paymentsData || []);
        if (contractsData[0].owner_name) setOwnerName(contractsData[0].owner_name);
        else setOwnerName(email.split("@")[0]);
      } else {
        setOwnerName(email.split("@")[0]);
      }
      const { data: ticketsData } = await supabase.from("maintenance_tickets").select("*").in("property_name", propNames).order("created_at", { ascending: false });
      setTickets(ticketsData || []);
      const { data: liqData } = await supabase.from("owner_payments").select("*").eq("owner_email", email).order("created_at", { ascending: false });
      setLiquidaciones(liqData || []);
    } else {
      setOwnerName(email.split("@")[0]);
    }
    setLoading(false);
  };

  const logout = async () => { await supabase.auth.signOut(); setSession(null); };

  const handleGenerarPDF = async () => {
    setGenerandoPDF(true);
    try {
      await generarPDF(ownerName, properties, contracts, payments, liquidaciones, tickets);
    } catch (e) {
      console.error("Error generando PDF:", e);
    }
    setGenerandoPDF(false);
  };

  const totalRenta = contracts.reduce((a, c) => a + (c.monthly_rent || 0), 0);
  const totalComisiones = contracts.reduce((a, c) => a + calcComision(c), 0);
  const totalLiquido = totalRenta - totalComisiones;
  const totalCobrado = payments.filter(p => p.status === "pagado").reduce((a, p) => a + (p.amount || 0), 0);
  const totalPendiente = payments.filter(p => ["pendiente", "atrasado"].includes(p.status)).reduce((a, p) => a + (p.amount || 0), 0);
  const totalLiquidado = liquidaciones.filter(l => l.status === "pagado").reduce((a, l) => a + (l.amount_paid || 0), 0);
  const hoy = new Date();

  if (authLoading) return <div style={{ minHeight: "100vh", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "#c8a96e", fontSize: 18, fontWeight: 700 }}>Cargando...</p></div>;
  if (!session) return <OwnerLogin onLogin={() => loadOwnerData()} />;
  if (loading) return <div style={{ minHeight: "100vh", background: "#f4f5f7", display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "#6b7280" }}>Cargando tu información...</p></div>;

  if (properties.length === 0) return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", padding: 40 }}>
        <p style={{ fontSize: 48, margin: "0 0 16px" }}>🔍</p>
        <h2 style={{ color: "#1a1a2e", margin: "0 0 8px" }}>No encontramos tus propiedades</h2>
        <p style={{ color: "#6b7280", margin: "0 0 20px" }}>Asegúrate de usar el email registrado con tu inmobiliaria</p>
        <button onClick={logout} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 600 }}>Cerrar sesión</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ background: "linear-gradient(135deg, #1a1a2e, #2d2d5e)", padding: "24px 20px 0" }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: "#c8a96e", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>Portal Propietario</p>
              <h2 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: "#fff" }}>Hola, {ownerName} 👋</h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.6)" }}>{properties.length} propiedad{properties.length !== 1 ? "es" : ""} administrada{properties.length !== 1 ? "s" : ""}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Líquido mensual</p>
              <p style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 800, color: "#c8a96e" }}>{fmt(totalLiquido)}</p>
              <button onClick={handleGenerarPDF} disabled={generandoPDF} style={{ marginTop: 8, background: generandoPDF ? "rgba(255,255,255,0.1)" : "#c8a96e", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px", cursor: generandoPDF ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>
                {generandoPDF ? "Generando..." : "📄 Descargar PDF"}
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
            {[
              { id: "inicio", label: "📊 Resumen" },
              { id: "propiedades", label: "🏠 Propiedades" },
              { id: "pagos", label: "💰 Pagos" },
              { id: "liquidaciones", label: "🏦 Liquidaciones" },
              { id: "mantenimiento", label: "🔧 Mantenimiento" },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "8px 16px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", background: tab === t.id ? "#fff" : "rgba(255,255,255,0.1)", color: tab === t.id ? "#1a1a2e" : "rgba(255,255,255,0.7)" }}>
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
                { label: "Renta mensual", value: fmt(totalRenta), color: "#1a1a2e" },
                { label: "Tu líquido/mes", value: fmt(totalLiquido), color: "#065f46" },
                { label: "Total cobrado", value: fmt(totalCobrado), color: "#1e40af" },
                { label: "Por cobrar", value: fmt(totalPendiente), color: "#92400e" },
                { label: "Total liquidado", value: fmt(totalLiquidado), color: "#065f46" },
                { label: "Tickets abiertos", value: tickets.filter(t => t.status !== "resuelto").length, color: "#dc2626" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
                  <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>Estado de este mes</h3>
            {properties.map(prop => {
              const contrato = contracts.find(c => c.property_name === prop.name);
              const pagoMes = payments.find(p => {
                if (!p.due_date) return false;
                const d = new Date(p.due_date);
                return d.getMonth() === hoy.getMonth() && d.getFullYear() === hoy.getFullYear() && p.property_name === prop.name;
              });
              const comision = contrato ? calcComision(contrato) : 0;
              const liquido = contrato ? (contrato.monthly_rent - comision) : 0;
              return (
                <div key={prop.id} style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{prop.name}</h4>
                      {contrato && <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>👤 {contrato.tenant_name} · Día {contrato.payment_day}</p>}
                    </div>
                    {pagoMes && <StatusBadge status={pagoMes.status} />}
                  </div>
                  {contrato && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      <div style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 10px" }}>
                        <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>Renta</p>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#1a1a2e" }}>{fmt(contrato.monthly_rent)}</p>
                      </div>
                      <div style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 10px" }}>
                        <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>Comisión</p>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#7c3aed" }}>{fmt(comision)}</p>
                      </div>
                      <div style={{ background: "#f0fdf4", borderRadius: 8, padding: "8px 10px" }}>
                        <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>Tu líquido</p>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#065f46" }}>{fmt(liquido)}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <button onClick={logout} style={{ width: "100%", background: "#f3f4f6", border: "none", borderRadius: 10, padding: "12px", cursor: "pointer", fontSize: 14, color: "#6b7280", fontWeight: 600, marginTop: 8 }}>Cerrar sesión</button>
          </div>
        )}

        {tab === "propiedades" && (
          <div>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>Mis propiedades</h3>
            {properties.map(prop => {
              const contrato = contracts.find(c => c.property_name === prop.name);
              const comision = contrato ? calcComision(contrato) : 0;
              const diasRestantes = contrato ? Math.ceil((new Date(contrato.end_date) - new Date()) / (1000 * 60 * 60 * 24)) : null;
              return (
                <div key={prop.id} style={{ background: "#fff", borderRadius: 14, overflow: "hidden", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <div style={{ background: "linear-gradient(135deg, #1a1a2e, #2d2d5e)", height: 60, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                    {prop.property_type === "casa" ? "🏠" : "🏢"}
                  </div>
                  <div style={{ padding: "16px 18px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{prop.name}</h4>
                      <StatusBadge status={prop.status} />
                    </div>
                    {prop.address && <p style={{ margin: "0 0 12px", fontSize: 12, color: "#6b7280" }}>📍 {prop.address}</p>}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, paddingTop: 12, borderTop: "1px solid #f3f4f6" }}>
                      <div>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Renta</p>
                        <p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 800, color: "#1a1a2e" }}>{fmt(prop.rent_amount)}</p>
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Comisión</p>
                        <p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 800, color: "#7c3aed" }}>{fmt(comision)}</p>
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Tu líquido</p>
                        <p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 800, color: "#065f46" }}>{fmt((prop.rent_amount || 0) - comision)}</p>
                      </div>
                    </div>
                    {contrato && (
                      <div style={{ marginTop: 12, background: "#f9fafb", borderRadius: 8, padding: "10px 14px" }}>
                        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                          👤 <strong>{contrato.tenant_name}</strong> · Paga el día {contrato.payment_day} · Hasta {contrato.end_date}
                          {diasRestantes !== null && <span style={{ color: diasRestantes <= 30 ? "#dc2626" : "#9ca3af", fontWeight: 700 }}> ({diasRestantes}d)</span>}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "pagos" && (
          <div>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>Historial de pagos</h3>
            {payments.length === 0 && <p style={{ color: "#9ca3af", fontSize: 14 }}>No hay pagos registrados aún</p>}
            {payments.map(p => (
              <div key={p.id} style={{ background: "#fff", borderRadius: 14, padding: "14px 18px", marginBottom: 10, border: p.status === "atrasado" ? "2px solid #fca5a5" : "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: "#1a1a2e" }}>{fmt(p.amount)}</p>
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
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>Mis liquidaciones</h3>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#6b7280" }}>Historial de pagos que te ha hecho Emporio Inmobiliario</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Total liquidado", value: fmt(liquidaciones.filter(l => l.status === "pagado").reduce((a, l) => a + (l.amount_paid || 0), 0)), color: "#065f46" },
                { label: "Pendiente", value: fmt(liquidaciones.filter(l => l.status === "pendiente").reduce((a, l) => a + (l.amount_paid || 0), 0)), color: "#92400e" },
                { label: "Liquidaciones", value: liquidaciones.length, color: "#1e40af" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 10, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
                  <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>
            {liquidaciones.length === 0 && (
              <div style={{ background: "#fff", borderRadius: 14, padding: 40, textAlign: "center" }}>
                <p style={{ fontSize: 32, margin: "0 0 8px" }}>🏦</p>
                <p style={{ color: "#6b7280", fontSize: 14, margin: 0 }}>Aún no hay liquidaciones registradas</p>
              </div>
            )}
            {liquidaciones.map(l => (
              <div key={l.id} style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", borderLeft: `4px solid ${l.status === "pagado" ? "#065f46" : l.status === "pagado_parcial" ? "#1e40af" : "#92400e"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: "#1a1a2e" }}>{l.period_description}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>Pagado el {l.payment_date} · {l.payment_method}</p>
                  </div>
                  <StatusBadge status={l.status} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  <div style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 12px" }}>
                    <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>Renta cobrada</p>
                    <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 800, color: "#1a1a2e" }}>{fmt(l.total_rent)}</p>
                  </div>
                  <div style={{ background: "#faf5ff", borderRadius: 8, padding: "8px 12px" }}>
                    <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>Comisión admin</p>
                    <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 800, color: "#7c3aed" }}>{fmt(l.total_commission)}</p>
                  </div>
                  <div style={{ background: "#f0fdf4", borderRadius: 8, padding: "8px 12px" }}>
                    <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>Te pagamos</p>
                    <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 800, color: "#065f46" }}>{fmt(l.amount_paid)}</p>
                  </div>
                </div>
                {l.notes && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#6b7280" }}>📝 {l.notes}</p>}
              </div>
            ))}
          </div>
        )}

        {tab === "mantenimiento" && (
          <div>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>Historial de mantenimiento</h3>
            {tickets.length === 0 && (
              <div style={{ background: "#fff", borderRadius: 14, padding: 40, textAlign: "center" }}>
                <p style={{ fontSize: 32, margin: "0 0 8px" }}>✅</p>
                <p style={{ color: "#6b7280", fontSize: 14, margin: 0 }}>No hay reportes de mantenimiento</p>
              </div>
            )}
            {tickets.map(t => (
              <div key={t.id} style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t.title}</h4>
                  <StatusBadge status={t.status} />
                </div>
                <p style={{ margin: "0 0 6px", fontSize: 12, color: "#6b7280" }}>📍 {t.property_name}</p>
                {t.description && <p style={{ margin: "0 0 8px", fontSize: 13, color: "#374151" }}>{t.description}</p>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {t.provider_cost > 0 && <span style={{ fontSize: 12, color: "#dc2626", background: "#fff5f5", padding: "2px 8px", borderRadius: 6 }}>Costo: {fmt(t.provider_cost)}</span>}
                  {t.charged_amount > 0 && <span style={{ fontSize: 12, color: "#065f46", background: "#f0fdf4", padding: "2px 8px", borderRadius: 6 }}>Cobrado: {fmt(t.charged_amount)}</span>}
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
