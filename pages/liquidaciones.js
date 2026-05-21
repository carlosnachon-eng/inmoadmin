import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";
import { PageHeader, brand } from "../components/Layout";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const calcComision = (c) => {
  if (!c.commission_value) return 0;
  if (c.commission_type === "porcentaje") return (c.monthly_rent * c.commission_value) / 100;
  return c.commission_value;
};

const StatusBadge = ({ status }) => {
  const map = {
    pagado:        { bg: "#d1fae5", color: "#065f46", label: "Pagado" },
    pagado_parcial:{ bg: "#dbeafe", color: "#1e40af", label: "Pagado parcial" },
    pendiente:     { bg: "#fef3c7", color: "#92400e", label: "Pendiente" },
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

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>{label}</label>
    {children}
  </div>
);

const Input = (props) => (
  <input {...props} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", ...props.style }} />
);

const Sel = ({ children, ...props }) => (
  <select {...props} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff", boxSizing: "border-box" }}>
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

export default function Liquidaciones() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [properties, setProperties] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [ownerPayments, setOwnerPayments] = useState([]);
  const [propertyExpenses, setPropertyExpenses] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterPropietario, setFilterPropietario] = useState("");

  const today = new Date().toISOString().split("T")[0];
  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };
  const isAdmin = profile?.role === "admin";

  const emptyForm = {
    owner_name: "", owner_email: "", period_description: "",
    total_rent: "", total_commission: "", total_liquid: "", amount_paid: "",
    payment_method: "transferencia", payment_date: today, status: "pagado",
    notes: "", rent_receiver: "inmobiliaria"
  };
  const [form, setForm] = useState(emptyForm);

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

  const loadData = async () => {
    setLoading(true);
    const [p, c, pay, op, pe, t] = await Promise.all([
      supabase.from("properties").select("*").order("name"),
      supabase.from("contracts").select("*").order("created_at", { ascending: false }),
      supabase.from("payments").select("*").order("due_date", { ascending: true }),
      supabase.from("owner_payments").select("*").order("created_at", { ascending: false }),
      supabase.from("property_expenses").select("*").order("date", { ascending: false }),
      supabase.from("maintenance_tickets").select("*").order("created_at", { ascending: false }),
    ]);
    setProperties(p.data || []);
    setContracts(c.data || []);
    setPayments(pay.data || []);
    setOwnerPayments(op.data || []);
    setPropertyExpenses(pe.data || []);
    setTickets(t.data || []);
    setLoading(false);
  };

  useEffect(() => { if (session) loadData(); }, [session]);

  const openLiquidar = (ownerName, ownerEmail) => {
    const propsProp = properties.filter(p => p.owner_email === ownerEmail);
    const contratosProp = contracts.filter(c => propsProp.some(p => p.name === c.property_name) && c.status === "activo");
    const totalRent = contratosProp.reduce((a, c) => a + (c.monthly_rent || 0), 0);
    const totalCom  = contratosProp.reduce((a, c) => a + calcComision(c), 0);
    const totalLiq  = totalRent - totalCom;
    const propNames = propsProp.map(p => p.name).join(", ");
    const rentReceivers = [...new Set(contratosProp.map(c => c.rent_receiver || "inmobiliaria"))];
    const dominant = rentReceivers.length === 1 ? rentReceivers[0] : "inmobiliaria";
    setForm({
      owner_name: ownerName, owner_email: ownerEmail,
      period_description: new Date().toLocaleDateString("es-MX", { month: "long", year: "numeric" }),
      total_rent: totalRent.toString(), total_commission: totalCom.toString(),
      total_liquid: totalLiq.toString(), amount_paid: totalLiq.toString(),
      payment_method: "transferencia", payment_date: today, status: "pagado",
      notes: `Propiedades: ${propNames}`, rent_receiver: dominant
    });
    setShowModal(true);
  };

  const save = async () => {
    setSaving(true);
    const data = {
      ...form,
      total_rent:       parseFloat(form.total_rent)       || 0,
      total_commission: parseFloat(form.total_commission) || 0,
      total_liquid:     parseFloat(form.total_liquid)     || 0,
      amount_paid:      parseFloat(form.amount_paid)      || 0,
    };
    const { error } = await supabase.from("owner_payments").insert([data]);
    if (error) { setSaving(false); showToast("Error: " + error.message, false); return; }
    if (form.rent_receiver === "inmobiliaria") {
      await supabase.from("cash_movements").insert([{
        type: "salida", category: "liquidacion_propietario",
        description: `Liquidación ${form.owner_name} - ${form.period_description}`,
        amount: parseFloat(form.amount_paid) || 0,
        payment_method: form.payment_method,
        date: form.payment_date || today,
        notes: `Comisión retenida: ${fmt(parseFloat(form.total_commission) || 0)}`,
        created_by: profile?.email, created_at: new Date().toISOString()
      }]);
    }
    setSaving(false);
    showToast("Liquidación registrada");
    setShowModal(false);
    setForm(emptyForm);
    loadData();
  };

  const eliminar = async (id, nombre) => {
    if (!isAdmin) { showToast("Solo el admin puede eliminar", false); return; }
    if (!confirm(`¿Eliminar liquidación de ${nombre}?`)) return;
    await supabase.from("owner_payments").delete().eq("id", id);
    showToast("Eliminado"); loadData();
  };

  const descargarPDF = async (ownerName, ownerEmail) => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    const hoy = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
    const mes = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long" });

    // Datos
    const propsProp = properties.filter(p => p.owner_email === ownerEmail);
    const contratosProp = contracts.filter(c => propsProp.some(p => p.name === c.property_name) && c.status === "activo");
    const liqProp = ownerPayments.filter(l => l.owner_email === ownerEmail);
    const ticketsProp = tickets.filter(t => propsProp.some(p => p.name === t.property_name));
    const gastosProp = propertyExpenses.filter(e => propsProp.some(p => p.name === e.property_name) && e.paid_by === "propietario");
    const totalRentaProp = contratosProp.reduce((a, c) => a + (c.monthly_rent || 0), 0);
    const totalComProp   = contratosProp.reduce((a, c) => a + calcComision(c), 0);
    const costoMantProp  = ticketsProp.filter(t => t.payer === "propietario" && t.charged_amount > 0).reduce((a, t) => a + (t.charged_amount || 0), 0);
    const gastosOpProp   = gastosProp.reduce((a, e) => a + (e.amount || 0), 0);
    const totalLiqProp   = totalRentaProp - totalComProp - costoMantProp - gastosOpProp;

    // ── Cargar logo desde el navegador ──
    let logoDataUrl = null;
    try {
      const res = await fetch("https://www.emporioinmobiliario.com.mx/logo.png");
      const blob = await res.blob();
      logoDataUrl = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (e) { console.warn("Logo no disponible:", e); }

    // ── HEADER ──────────────────────────────────────────────────────────────
    // Fondo blanco limpio con acento lateral rojo
    doc.setFillColor(255, 255, 255); doc.rect(0, 0, 210, 55, "F");
    // Barra lateral izquierda roja
    doc.setFillColor(185, 28, 60); doc.rect(0, 0, 6, 55, "F");
    // Línea inferior roja delgada
    doc.setFillColor(185, 28, 60); doc.rect(0, 52, 210, 3, "F");

    // Logo o texto
    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "PNG", 14, 6, 40, 18);
    } else {
      doc.setTextColor(185, 28, 60); doc.setFontSize(16); doc.setFont("helvetica", "bold");
      doc.text("EMPORIO", 14, 16);
      doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(122, 122, 122);
      doc.text("INMOBILIARIO", 14, 22);
    }

    // Tipo de documento — derecha
    doc.setTextColor(185, 28, 60); doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text("REPORTE DE PROPIETARIO", 195, 14, { align: "right" });
    doc.setTextColor(122, 122, 122); doc.setFontSize(8); doc.setFont("helvetica", "normal");
    doc.text(`Generado: ${hoy}`, 195, 21, { align: "right" });
    doc.text("app.emporioinmobiliario.com.mx", 195, 27, { align: "right" });

    // ── DATOS PROPIETARIO ────────────────────────────────────────────────────
    doc.setFillColor(248, 248, 248); doc.rect(0, 55, 210, 22, "F");
    doc.setTextColor(74, 74, 74); doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text(ownerName, 14, 66);
    doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(122, 122, 122);
    doc.text(`Periodo: ${mes}  ·  ${propsProp.length} propiedad${propsProp.length !== 1 ? "es" : ""}  ·  ${contratosProp.length} contrato${contratosProp.length !== 1 ? "s" : ""} activo${contratosProp.length !== 1 ? "s" : ""}`, 14, 73);

    // ── RESUMEN FINANCIERO ───────────────────────────────────────────────────
    let y = 84;
    const extraLines = (costoMantProp > 0 ? 1 : 0) + (gastosOpProp > 0 ? 1 : 0);
    const boxH = 28 + extraLines * 7;

    // Fondo del resumen
    doc.setFillColor(185, 28, 60); doc.rect(14, y, 182, 7, "F");
    doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text("RESUMEN FINANCIERO", 18, y + 5);

    doc.setFillColor(255, 245, 247); doc.rect(14, y + 7, 182, boxH, "F");
    doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3);
    doc.rect(14, y + 7, 182, boxH, "S");

    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(74, 74, 74);
    doc.text(`Renta mensual total:`, 18, y + 14);
    doc.setFont("helvetica", "bold");
    doc.text(fmt(totalRentaProp), 105, y + 14);

    doc.setFont("helvetica", "normal"); doc.setTextColor(74, 74, 74);
    doc.text(`Comisión administración:`, 18, y + 21);
    doc.setFont("helvetica", "bold"); doc.setTextColor(185, 28, 60);
    doc.text(`-${fmt(totalComProp)}`, 105, y + 21);

    let lineY = y + 28;
    if (costoMantProp > 0) {
      doc.setFont("helvetica", "normal"); doc.setTextColor(74, 74, 74);
      doc.text("Mantenimiento:", 18, lineY);
      doc.setFont("helvetica", "bold"); doc.setTextColor(185, 28, 60);
      doc.text(`-${fmt(costoMantProp)}`, 105, lineY);
      lineY += 7;
    }
    if (gastosOpProp > 0) {
      doc.setFont("helvetica", "normal"); doc.setTextColor(74, 74, 74);
      doc.text("Gastos operativos:", 18, lineY);
      doc.setFont("helvetica", "bold"); doc.setTextColor(185, 28, 60);
      doc.text(`-${fmt(gastosOpProp)}`, 105, lineY);
      lineY += 7;
    }

    // Líquido destacado
    doc.setFillColor(6, 95, 70); doc.rect(105, lineY - 5, 91, 10, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text("Líquido a recibir:", 108, lineY + 1);
    doc.text(fmt(totalLiqProp), 190, lineY + 1, { align: "right" });

    y += boxH + 14;

    // ── ESTILOS DE TABLAS ────────────────────────────────────────────────────
    const headStyle = { fillColor: [74, 74, 74], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 };
    const altRow = { fillColor: [250, 250, 250] };
    const tableMargin = { left: 14, right: 14 };

    const sectionTitle = (titulo, yPos) => {
      doc.setFillColor(185, 28, 60); doc.rect(14, yPos, 4, 8, "F");
      doc.setTextColor(74, 74, 74); doc.setFontSize(11); doc.setFont("helvetica", "bold");
      doc.text(titulo, 22, yPos + 6);
      return yPos + 10;
    };

    // ── PROPIEDADES ──────────────────────────────────────────────────────────
    y = sectionTitle("Propiedades", y);
    autoTable(doc, {
      startY: y,
      head: [["Propiedad", "Inquilino", "Renta", "Comisión", "Líquido", "Día pago"]],
      body: propsProp.map(prop => {
        const c = contratosProp.find(c => c.property_name === prop.name);
        const com = c ? calcComision(c) : 0;
        return [prop.name, c?.tenant_name || "—", fmt(prop.rent_amount), fmt(com), fmt((prop.rent_amount || 0) - com), c ? `Día ${c.payment_day}` : "—"];
      }),
      styles: { fontSize: 8, cellPadding: 3 }, headStyles: headStyle, alternateRowStyles: altRow, margin: tableMargin,
    });
    y = doc.lastAutoTable.finalY + 12;
    if (y > 230) { doc.addPage(); y = 15; }

    // ── PAGOS DEL MES ────────────────────────────────────────────────────────
    y = sectionTitle("Pagos del Mes", y);
    const contractIds = contratosProp.map(c => c.id);
    const { data: pagosFrescos } = await supabase.from("payments").select("*").in("contract_id", contractIds.length > 0 ? contractIds : ["none"]);
    const pagosProp = (pagosFrescos || []);
    const hoyDate = new Date();
    const pagosMesPDF = pagosProp.filter(p => {
      if (!p.due_date) return false;
      const d = new Date(p.due_date + "T12:00:00");
      return d.getMonth() === hoyDate.getMonth() && d.getFullYear() === hoyDate.getFullYear();
    });
    autoTable(doc, {
      startY: y,
      head: [["Inquilino", "Propiedad", "Monto", "Vencimiento", "Estado"]],
      body: pagosMesPDF.length > 0 ? pagosMesPDF.map(p => [
        p.tenant_name || "—", p.property_name || "—", fmt(p.amount), p.due_date || "—",
        p.status === "pagado" ? "Pagado" : p.status === "atrasado" ? "Atrasado" : "Pendiente"
      ]) : [["Sin pagos registrados este mes", "", "", "", ""]],
      styles: { fontSize: 8, cellPadding: 3 }, headStyles: headStyle, alternateRowStyles: altRow,
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 4) {
          if (data.cell.raw === "Pagado") data.cell.styles.textColor = [6, 95, 70];
          if (data.cell.raw === "Atrasado") data.cell.styles.textColor = [185, 28, 60];
          if (data.cell.raw === "Pendiente") data.cell.styles.textColor = [146, 64, 14];
        }
      },
      margin: tableMargin,
    });
    y = doc.lastAutoTable.finalY + 12;
    if (y > 230) { doc.addPage(); y = 15; }

    // ── LIQUIDACIONES ────────────────────────────────────────────────────────
    y = sectionTitle("Historial de Liquidaciones", y);
    autoTable(doc, {
      startY: y,
      head: [["Periodo", "Renta", "Comisión", "Te pagamos", "Fecha", "Estado"]],
      body: liqProp.length > 0 ? liqProp.map(l => [
        l.period_description || "—", fmt(l.total_rent), fmt(l.total_commission),
        fmt(l.amount_paid), l.payment_date || "—",
        l.status === "pagado" ? "Pagado" : l.status === "pagado_parcial" ? "Parcial" : "Pendiente"
      ]) : [["Sin liquidaciones registradas", "", "", "", "", ""]],
      styles: { fontSize: 8, cellPadding: 3 }, headStyles: headStyle, alternateRowStyles: altRow, margin: tableMargin,
    });
    y = doc.lastAutoTable.finalY + 12;
    if (y > 230) { doc.addPage(); y = 15; }

    // ── MANTENIMIENTO ────────────────────────────────────────────────────────
    y = sectionTitle("Mantenimiento", y);
    autoTable(doc, {
      startY: y,
      head: [["Título", "Propiedad", "Quién paga", "Costo", "Estado", "Fecha"]],
      body: ticketsProp.length > 0 ? ticketsProp.map(t => [
        t.title || "—", t.property_name || "—",
        t.payer === "propietario" ? "Propietario" : t.payer === "inquilino" ? "Inquilino" : "Inmobiliaria",
        t.payer === "propietario" && t.charged_amount > 0 ? fmt(t.charged_amount) : "—",
        t.status === "cerrado" || t.status === "resuelto" ? "Resuelto" : t.status === "en_proceso" ? "En proceso" : "Abierto",
        new Date(t.created_at).toLocaleDateString("es-MX")
      ]) : [["Sin reportes de mantenimiento", "", "", "", "", ""]],
      styles: { fontSize: 8, cellPadding: 3 }, headStyles: headStyle, alternateRowStyles: altRow, margin: tableMargin,
    });

    // ── GASTOS OPERATIVOS ────────────────────────────────────────────────────
    if (gastosProp.length > 0) {
      y = doc.lastAutoTable.finalY + 12;
      if (y > 230) { doc.addPage(); y = 15; }
      y = sectionTitle("Gastos Operativos", y);
      autoTable(doc, {
        startY: y,
        head: [["Concepto", "Propiedad", "Descripción", "Monto", "Quién paga", "Fecha"]],
        body: gastosProp.map(e => [e.category || "—", e.property_name || "—", e.description || "—", fmt(e.amount), e.paid_by === "propietario" ? "Propietario" : "Emporio", e.date || "—"]),
        styles: { fontSize: 8, cellPadding: 3 }, headStyles: headStyle, alternateRowStyles: altRow, margin: tableMargin,
      });
    }

    // ── FOOTER EN TODAS LAS PÁGINAS ──────────────────────────────────────────
    const totalPaginas = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPaginas; i++) {
      doc.setPage(i);
      // Línea separadora
      doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3);
      doc.line(14, 284, 196, 284);
      // Barra lateral roja
      doc.setFillColor(185, 28, 60); doc.rect(0, 284, 6, 13, "F");
      // Texto footer
      doc.setTextColor(122, 122, 122); doc.setFontSize(7); doc.setFont("helvetica", "normal");
      doc.text("Emporio Inmobiliario — Puebla, México", 14, 290);
      doc.text("222 257 3237  ·  ventas@emporioinmobiliario.mx", 14, 294);
      doc.setTextColor(185, 28, 60); doc.setFont("helvetica", "bold");
      doc.text(`${i} / ${totalPaginas}`, 196, 292, { align: "right" });
    }

    doc.save(`Liquidacion_${ownerName.replace(/\s+/g, "_")}_${today}.pdf`);
  };

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} />
    </div>
  );

  if (!session) {
    if (typeof window !== "undefined") window.location.href = "/";
    return null;
  }

  // ── PROPIETARIOS ÚNICOS ──
  const propietariosUnicos = [...new Map(
    properties.filter(p => p.owner_email).map(p => [
      p.owner_email,
      { name: contracts.find(c => c.property_name === p.name)?.owner_name || p.owner_email.split("@")[0], email: p.owner_email }
    ])
  ).values()];

  const historialFiltrado = filterPropietario
    ? ownerPayments.filter(op => op.owner_email === filterPropietario)
    : ownerPayments;

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: 320 }}>
          {toast.msg}
        </div>
      )}

      <PageHeader title="Liquidaciones" icon="🏦" actions={<Btn color={brand.red} onClick={() => { setForm(emptyForm); setShowModal(true); }}>+ Nueva</Btn>} />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {/* NOTA */}
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, padding: "10px 16px", marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 12, color: "#92400e", fontWeight: 600 }}>
            Si la renta va directo al propietario: registra como referencia pero NO afecta la caja de Emporio. La comisión se registra en Comisiones cuando la recibes.
          </p>
        </div>

        {/* PROPIETARIOS ACTIVOS */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 48 }}><p style={{ color: "#6b7280" }}>Cargando...</p></div>
        ) : (
          <>
            {propietariosUnicos.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>Propietarios activos</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                  {propietariosUnicos.map((owner, i) => {
                    const propsProp = properties.filter(p => p.owner_email === owner.email);
                    const contratosProp = contracts.filter(c => propsProp.some(p => p.name === c.property_name) && c.status === "activo");
                    const liquidoProp = contratosProp.reduce((a, c) => a + (c.monthly_rent || 0) - calcComision(c), 0);
                    const pagosDelPropietario = payments.filter(p => propsProp.some(pr => pr.name === p.property_name) && p.status === "pagado");
                    const totalPagado = pagosDelPropietario.reduce((a, p) => a + (p.amount || 0), 0);
                    return (
                      <div key={i} style={{ background: "#fff", borderRadius: 14, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                          <div>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{owner.name}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>{propsProp.length} propiedad{propsProp.length !== 1 ? "es" : ""}</p>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <Btn small color="#065f46" onClick={() => openLiquidar(owner.name, owner.email)}>Liquidar</Btn>
                            <Btn small color="#1e40af" onClick={() => descargarPDF(owner.name, owner.email)}>PDF</Btn>
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <div style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 12px" }}>
                            <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Líquido/mes</p>
                            <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#065f46" }}>{fmt(liquidoProp)}</p>
                          </div>
                          <div style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 12px" }}>
                            <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Total pagado</p>
                            <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#1e40af" }}>{fmt(totalPagado)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* HISTORIAL */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>Historial</h2>
              <select value={filterPropietario} onChange={e => setFilterPropietario(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
                <option value="">Todos los propietarios</option>
                {propietariosUnicos.map(o => <option key={o.email} value={o.email}>{o.name}</option>)}
              </select>
            </div>

            {historialFiltrado.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center" }}>
                <p style={{ color: "#6b7280" }}>No hay liquidaciones aún</p>
              </div>
            ) : (
              <div style={{ background: "#fff", borderRadius: 14, overflowX: "auto", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {["Propietario", "Periodo", "Renta", "Comisión", "Líquido", "Pagado", "Fecha", "Estado", ""].map(h => (
                        <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {historialFiltrado.map(op => (
                      <tr key={op.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "11px 14px", fontWeight: 600, fontSize: 14 }}>{op.owner_name}</td>
                        <td style={{ padding: "11px 14px", fontSize: 13, color: "#6b7280" }}>{op.period_description}</td>
                        <td style={{ padding: "11px 14px", fontWeight: 700 }}>{fmt(op.total_rent)}</td>
                        <td style={{ padding: "11px 14px", color: "#7c3aed" }}>{fmt(op.total_commission)}</td>
                        <td style={{ padding: "11px 14px", fontWeight: 700, color: "#065f46" }}>{fmt(op.total_liquid)}</td>
                        <td style={{ padding: "11px 14px", fontWeight: 700, color: "#1e40af" }}>{fmt(op.amount_paid)}</td>
                        <td style={{ padding: "11px 14px", fontSize: 13, color: "#6b7280" }}>{op.payment_date}</td>
                        <td style={{ padding: "11px 14px" }}><StatusBadge status={op.status} /></td>
                        <td style={{ padding: "11px 14px" }}>
                          {isAdmin && <Btn small color="#dc2626" onClick={() => eliminar(op.id, op.owner_name)}>X</Btn>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* MODAL */}
      {showModal && (
        <Modal title="Registrar Liquidación" onClose={() => { setShowModal(false); setForm(emptyForm); }}>
          <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 12px", marginBottom: 16 }}>
            <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "#92400e" }}>La renta llega a:</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setForm({ ...form, rent_receiver: "inmobiliaria" })} style={{ flex: 1, padding: 8, borderRadius: 6, border: `2px solid ${form.rent_receiver === "inmobiliaria" ? "#065f46" : "#e5e7eb"}`, background: form.rent_receiver === "inmobiliaria" ? "#f0fdf4" : "#fff", color: form.rent_receiver === "inmobiliaria" ? "#065f46" : "#6b7280", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Emporio primero</button>
              <button onClick={() => setForm({ ...form, rent_receiver: "propietario" })} style={{ flex: 1, padding: 8, borderRadius: 6, border: `2px solid ${form.rent_receiver === "propietario" ? "#7c3aed" : "#e5e7eb"}`, background: form.rent_receiver === "propietario" ? "#faf5ff" : "#fff", color: form.rent_receiver === "propietario" ? "#7c3aed" : "#6b7280", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Directo al propietario</button>
            </div>
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "#92400e" }}>
              {form.rent_receiver === "inmobiliaria" ? "Registrará salida de caja por el monto líquido" : "Solo referencia, NO mueve la caja de Emporio"}
            </p>
          </div>
          <Field label="Propietario"><Input value={form.owner_name} onChange={e => setForm({ ...form, owner_name: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={form.owner_email} onChange={e => setForm({ ...form, owner_email: e.target.value })} /></Field>
          <Field label="Periodo"><Input placeholder="Ej: Mayo 2026" value={form.period_description} onChange={e => setForm({ ...form, period_description: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Renta total">
              <Input type="number" value={form.total_rent} onChange={e => {
                const r = parseFloat(e.target.value) || 0;
                const com = parseFloat(form.total_commission) || 0;
                setForm({ ...form, total_rent: e.target.value, total_liquid: (r - com).toString(), amount_paid: (r - com).toString() });
              }} />
            </Field>
            <Field label="Comisión">
              <Input type="number" value={form.total_commission} onChange={e => {
                const com = parseFloat(e.target.value) || 0;
                const r = parseFloat(form.total_rent) || 0;
                setForm({ ...form, total_commission: e.target.value, total_liquid: (r - com).toString(), amount_paid: (r - com).toString() });
              }} />
            </Field>
            <Field label="Líquido"><Input type="number" value={form.total_liquid} readOnly style={{ background: "#f9fafb" }} /></Field>
          </div>
          <Field label="Monto que le pagas"><Input type="number" value={form.amount_paid} onChange={e => setForm({ ...form, amount_paid: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Fecha"><Input type="date" value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })} /></Field>
            <Field label="Método">
              <Sel value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })}>
                <option value="transferencia">Transferencia</option>
                <option value="efectivo">Efectivo</option>
              </Sel>
            </Field>
          </div>
          <Field label="Estado">
            <Sel value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="pagado">Pagado completo</option>
              <option value="pagado_parcial">Pagado parcial</option>
              <option value="pendiente">Pendiente</option>
            </Sel>
          </Field>
          <Field label="Notas"><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={() => { setShowModal(false); setForm(emptyForm); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={save} disabled={saving || !form.owner_name || !form.amount_paid}>{saving ? "Guardando..." : "Registrar liquidación"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
