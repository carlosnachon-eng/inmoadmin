import { useState, useEffect, useRef } from "react";
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

const savePDF = (doc, filename) => {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isIOS || isSafari) {
    // iOS/Safari bloquea data URIs en iframes — usar blob URL en pestaña nueva
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else {
    doc.save(filename);
  }
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

const Modal = ({ title, onClose, children, wide }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: wide ? 620 : 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
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

const FirmaCanvas = ({ canvasRef, onFirma }) => {
  const drawing = useRef(false);
  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  };
  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { x, y } = getPos(e, canvas);
    ctx.beginPath(); ctx.moveTo(x, y);
  };
  const draw = (e) => {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = "#1a1a2e";
    const { x, y } = getPos(e, canvas);
    ctx.lineTo(x, y); ctx.stroke();
    onFirma(true);
  };
  const stop = (e) => { e.preventDefault(); drawing.current = false; };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={460} height={140}
        onMouseDown={start} onMouseMove={draw} onMouseUp={stop} onMouseLeave={stop}
        onTouchStart={start} onTouchMove={draw} onTouchEnd={stop}
        style={{ border: "2px dashed #d1d5db", borderRadius: 8, width: "100%", height: 140, cursor: "crosshair", touchAction: "none", background: "#fafafa" }}
      />
      <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>Firme arriba con el dedo o el mouse</p>
    </div>
  );
};

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
  const mesAnterior = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  const [mesCorte, setMesCorte] = useState(mesAnterior);

  const [expediente, setExpediente] = useState(null);
  const [expedienteData, setExpedienteData] = useState(null);
  const [expedienteLoading, setExpedienteLoading] = useState(false);
  const [expedienteTab, setExpedienteTab] = useState("resumen");
  const [descargandoRecibo, setDescargandoRecibo] = useState(null);

  const openExpediente = async (owner) => {
    setExpediente(owner);
    setExpedienteTab("resumen");
    setExpedienteLoading(true);
    const propsProp = properties.filter(p => p.owner_email === owner.email);
    const propNames = propsProp.map(p => p.name);
    const contratosProp = contracts.filter(c => propNames.includes(c.property_name) && c.status === "activo");
    const contractIds = contratosProp.map(c => c.id);
    const [anio, mes] = mesCorte.split("-").map(Number);
    const [
      { data: pagosMes },
      { data: ticketsProp },
      { data: liqProp },
      { data: recibosProp },
    ] = await Promise.all([
      supabase.from("payments").select("*").in("contract_id", contractIds.length ? contractIds : ["none"]).order("due_date", { ascending: false }),
      supabase.from("maintenance_tickets").select("*").in("property_name", propNames.length ? propNames : ["none"]).order("created_at", { ascending: false }),
      supabase.from("owner_payments").select("*").eq("owner_email", owner.email).order("created_at", { ascending: false }),
      supabase.from("owner_payment_receipts").select("*").eq("owner_email", owner.email).order("fecha", { ascending: false }),
    ]);
    const pagosMesFiltrados = (pagosMes || []).filter(p => {
      if (!p.due_date) return false;
      const d = new Date(p.due_date + "T12:00:00");
      return d.getMonth() === (mes - 1) && d.getFullYear() === anio;
    });
    setExpedienteData({
      propsProp,
      contratosProp,
      pagosMes: pagosMesFiltrados,
      todosLosPagos: pagosMes || [],
      ticketsProp: ticketsProp || [],
      liqProp: liqProp || [],
      recibosProp: recibosProp || [],
    });
    setExpedienteLoading(false);
  };

  const verReciboExpediente = async (recibo) => {
    setDescargandoRecibo(recibo.id);
    try {
      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF({ format: "a5" });
      const hoy = new Date(recibo.fecha).toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
      const conceptoMap = { adelanto: "Adelanto de renta", parcial: "Pago parcial de liquidación", total: "Liquidación total", mantenimiento: "Pago de mantenimiento" };
      const concepto = conceptoMap[recibo.concepto] || recibo.concepto;
      const folio = recibo.id.slice(0, 8).toUpperCase();
      let logoDataUrl = null;
      try {
        const res = await fetch("https://www.emporioinmobiliario.com.mx/logo.png");
        const blob = await res.blob();
        logoDataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      } catch (e) { /* sin logo */ }
      doc.setFillColor(185, 28, 60); doc.rect(0, 0, 6, 210, "F");
      doc.setFillColor(26, 26, 46); doc.rect(6, 0, 142, 30, "F");
      if (logoDataUrl) { doc.addImage(logoDataUrl, "PNG", 10, 5, 24, 10); }
      else { doc.setTextColor(255,255,255); doc.setFontSize(11); doc.setFont("helvetica","bold"); doc.text("EMPORIO INMOBILIARIO", 12, 14); }
      doc.setTextColor(255,255,255); doc.setFontSize(14); doc.setFont("helvetica","bold");
      doc.text("RECIBO DE ENTREGA", 108, 13, { align: "right" });
      doc.setFontSize(8); doc.setFont("helvetica","normal");
      doc.text(`Folio: ${folio}`, 108, 20, { align: "right" });
      doc.text(`Fecha: ${hoy}`, 108, 25, { align: "right" });
      let y = 38;
      doc.setFillColor(248,248,248); doc.rect(8, y, 132, 24, "F");
      doc.setDrawColor(220,220,220); doc.setLineWidth(0.3); doc.rect(8, y, 132, 24, "S");
      doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(122,122,122);
      doc.text("PROPIETARIO", 12, y + 6);
      doc.setTextColor(26,26,46); doc.setFontSize(11); doc.setFont("helvetica","bold");
      doc.text(recibo.owner_name, 12, y + 14);
      doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(122,122,122);
      doc.text(recibo.owner_email, 12, y + 20);
      y += 30;
      [["Concepto", concepto], ["Periodo", recibo.periodo || "—"], ["Propiedad", recibo.property_name || "Todas"], ["Forma de pago", recibo.forma_pago === "efectivo" ? "Efectivo" : "Transferencia"]].forEach(([lbl, val]) => {
        doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(122,122,122); doc.text(lbl, 10, y);
        doc.setFont("helvetica","bold"); doc.setTextColor(26,26,46); doc.text(val, 80, y); y += 8;
      });
      y += 4;
      doc.setFillColor(6, 95, 70); doc.rect(8, y, 132, 16, "F");
      doc.setTextColor(255,255,255); doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.text("MONTO ENTREGADO", 12, y + 7);
      doc.setFont("helvetica","bold"); doc.setFontSize(14); doc.text(fmt(recibo.monto), 136, y + 10, { align: "right" });
      y += 24;
      if (recibo.forma_pago === "efectivo" && recibo.firma_url) {
        y += 4;
        doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(26,26,46); doc.text("FIRMA DE RECIBIDO", 10, y); y += 4;
        try {
          const res = await fetch(recibo.firma_url); const blob = await res.blob();
          const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
          doc.addImage(b64, "PNG", 8, y, 80, 25); doc.setDrawColor(200,200,200); doc.rect(8, y, 80, 25, "S");
        } catch(e) { doc.setDrawColor(200,200,200); doc.rect(8, y, 80, 25, "S"); }
        doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(122,122,122); doc.text(recibo.owner_name, 10, y + 31); y += 36;
      }
      if (recibo.forma_pago === "transferencia" && recibo.comprobante_url) {
        y += 4; doc.setFillColor(235,245,255); doc.rect(8, y, 132, 10, "F");
        doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(30,64,175);
        doc.text("Comprobante de transferencia adjunto en el sistema", 12, y + 6);
      }
      doc.setDrawColor(220,220,220); doc.line(8, 192, 140, 192);
      doc.setFillColor(185,28,60); doc.rect(0, 192, 6, 18, "F");
      doc.setTextColor(122,122,122); doc.setFontSize(7); doc.setFont("helvetica","normal");
      doc.text("Emporio Inmobiliario — Puebla, México", 10, 198);
      doc.text("222 257 3237  ·  ventas@emporioinmobiliario.mx", 10, 203);
      doc.setTextColor(185,28,60); doc.setFont("helvetica","bold"); doc.text("app.emporioinmobiliario.com.mx", 10, 208);
      savePDF(doc, `Recibo_${recibo.concepto}_${recibo.fecha}_${folio}.pdf`);
    } catch(e) { showToast("Error al generar recibo", false); }
    setDescargandoRecibo(null);
  };

  const [showModalPago, setShowModalPago] = useState(false);
  const [propietarioPago, setPropietarioPago] = useState(null);
  const [savingPago, setSavingPago] = useState(false);
  const [firmaTrazada, setFirmaTrazada] = useState(false);
  const [archivoComprobante, setArchivoComprobante] = useState(null);
  const canvasRef = useRef(null);
  const emptyFormPago = {
    concepto: "adelanto",
    property_name: "",
    monto: "",
    forma_pago: "transferencia",
    periodo: "",
    fecha: new Date().toISOString().split("T")[0],
    ticket_id: "",
  };
  const [formPago, setFormPago] = useState(emptyFormPago);
  const [pagoYaAbonado, setPagoYaAbonado] = useState(0);

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

  // ── Tickets de mantenimiento con saldo pendiente del propietario, de meses ANTERIORES al periodo, no descontados aún ──
  const getTicketsPendientesAnteriores = (propNames, anio, mes) => {
    return tickets.filter(t => {
      if (!propNames.includes(t.property_name)) return false;
      if (t.payer !== "propietario") return false;
      if (!t.charged_amount || t.charged_amount <= 0) return false;
      if (t.descontado_de_liquidacion) return false; // ya se descontó en una liquidación previa
      if (!t.created_at) return false;
      const d = new Date(t.created_at);
      const esMesActual = d.getMonth() === (mes - 1) && d.getFullYear() === anio;
      const esFuturo = d.getFullYear() > anio || (d.getFullYear() === anio && d.getMonth() > mes - 1);
      if (esMesActual || esFuturo) return false;
      const saldo = (t.charged_amount || 0) - (t.advance_paid ? (t.advance_amount || 0) : 0);
      return saldo > 0;
    });
  };

  const calcPendienteMes = (ownerEmail) => {
    const [anio, mes] = mesCorte.split("-").map(Number);
    const fechaCorte = new Date(anio, mes - 1, 1);
    const propsProp = properties.filter(p => p.owner_email === ownerEmail);
    const contratosProp = contracts.filter(c => propsProp.some(p => p.name === c.property_name) && c.status === "activo");
    const contractIds = contratosProp.map(c => c.id);
    const pagosMes = payments.filter(p => {
      if (p.status !== "pagado" || !p.due_date) return false;
      if (!contractIds.includes(p.contract_id)) return false;
      const d = new Date(p.due_date + "T12:00:00");
      return d.getMonth() === (mes - 1) && d.getFullYear() === anio;
    });
    const totalRenta = pagosMes.reduce((a, p) => a + (p.amount || 0), 0);
    const contratosPagados = contratosProp.filter(c => pagosMes.some(p => p.contract_id === c.id));
    const totalCom = contratosPagados.reduce((a, c) => a + calcComision(c), 0);
    const liqDelMes = ownerPayments.filter(l => {
      const desc = (l.period_description || "").toLowerCase();
      const mesMes = fechaCorte.toLocaleDateString("es-MX", { month: "long" }).toLowerCase();
      return l.owner_email === ownerEmail && desc.includes(mesMes) && desc.includes(String(anio));
    });
    const totalAdelanto = liqDelMes.reduce((a, l) => a + (l.amount_paid || 0), 0);
    // Si ya existe una liquidación "pagado" completa, el pendiente es 0
    const yaLiquidadoCompleto = liqDelMes.some(l => l.status === "pagado");
    if (yaLiquidadoCompleto) return 0;
    // Tickets de meses anteriores con saldo pendiente (no descontados aún de una liquidación)
    const propNamesCalc = propsProp.map(p => p.name);
    const saldoMantAnt = getTicketsPendientesAnteriores(propNamesCalc, anio, mes).reduce((a, t) => {
      const saldo = (t.charged_amount || 0) - (t.advance_paid ? (t.advance_amount || 0) : 0);
      return a + saldo;
    }, 0);
    return Math.max(0, totalRenta - totalCom - totalAdelanto + saldoMantAnt);
  };

  const openModalPago = (owner) => {
    const pendienteTotal = calcPendienteMes(owner.email);
    const [anio, mes] = mesCorte.split("-").map(Number);
    const fechaCorte = new Date(anio, mes - 1, 1);
    const periodoLabel = fechaCorte.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
    // Calcular ya abonado en este periodo (parciales sin un "pagado" en el mismo periodo)
    const liqDelPeriodo = ownerPayments.filter(l => 
      l.owner_email === owner.email && (l.period_description || "") === periodoLabel
    );
    const tieneCompleto = liqDelPeriodo.some(l => l.status === "pagado");
    const yaAbonado = tieneCompleto ? 0 : liqDelPeriodo.filter(l => l.status === "pagado_parcial")
      .reduce((a, l) => a + (l.amount_paid || 0), 0);
    const saldoReal = Math.max(0, pendienteTotal - yaAbonado);
    setPropietarioPago(owner);
    setPagoYaAbonado(yaAbonado);
    setFormPago({
      ...emptyFormPago,
      monto: saldoReal > 0 ? saldoReal.toString() : "",
      periodo: periodoLabel,
      fecha: today,
    });
    setFirmaTrazada(false);
    setArchivoComprobante(null);
    setShowModalPago(true);
  };

  const limpiarFirma = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setFirmaTrazada(false);
  };

  const guardarPago = async () => {
    if (!formPago.monto || parseFloat(formPago.monto) <= 0) {
      showToast("Ingresa un monto válido", false); return;
    }
    const pendienteActual = calcPendienteMes(propietarioPago.email);
    const saldoMaximo = Math.max(0, pendienteActual - pagoYaAbonado);
    if (formPago.concepto === "total" && parseFloat(formPago.monto) > pendienteActual + 1) {
      showToast(`⚠️ El monto ($${parseFloat(formPago.monto).toLocaleString()}) excede el pendiente del mes ($${pendienteActual.toLocaleString()}). Verifica el monto.`, false); return;
    }
    if (formPago.concepto === "mantenimiento" && !formPago.ticket_id) {
      showToast("Selecciona qué mantenimiento se está cobrando", false); return;
    }
    if (formPago.forma_pago === "efectivo" && !firmaTrazada) {
      showToast("El propietario debe firmar de recibido", false); return;
    }
    if (formPago.forma_pago === "transferencia" && !archivoComprobante) {
      showToast("Sube el comprobante de transferencia", false); return;
    }

    setSavingPago(true);

    let firma_url = null;
    let firmaBase64 = null;
    let comprobante_url = null;

    if (formPago.forma_pago === "efectivo" && canvasRef.current) {
      try {
        firmaBase64 = canvasRef.current.toDataURL("image/png");
      } catch (e) { console.warn("Error leyendo canvas:", e); }
    }

    if (formPago.forma_pago === "efectivo" && firmaBase64) {
      try {
        const canvas = canvasRef.current;
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        const fileName = `firmas/${propietarioPago.email.replace("@","_")}_${Date.now()}.png`;
        const { error: upErr } = await supabase.storage
          .from("documentos")
          .upload(fileName, blob, { contentType: "image/png", upsert: true });
        if (!upErr) {
          const { data: urlData } = supabase.storage.from("documentos").getPublicUrl(fileName);
          firma_url = urlData?.publicUrl || null;
        }
      } catch (e) { console.warn("Error subiendo firma:", e); }
    }

    if (formPago.forma_pago === "transferencia" && archivoComprobante) {
      try {
        const ext = archivoComprobante.name.split(".").pop();
        const fileName = `comprobantes-propietarios/${propietarioPago.email.replace("@","_")}_${Date.now()}.${ext}`;
        const { data: upData, error: upErr } = await supabase.storage
          .from("documentos")
          .upload(fileName, archivoComprobante, { upsert: true });
        if (!upErr) {
          const { data: urlData } = supabase.storage.from("documentos").getPublicUrl(fileName);
          comprobante_url = urlData?.publicUrl || null;
        }
      } catch (e) { console.warn("Error subiendo comprobante:", e); }
    }

    const { data: recibo, error } = await supabase.from("owner_payment_receipts").insert([{
      owner_name: propietarioPago.name,
      owner_email: propietarioPago.email,
      property_name: formPago.property_name || null,
      concepto: formPago.concepto,
      monto: parseFloat(formPago.monto),
      forma_pago: formPago.forma_pago,
      comprobante_url,
      firma_url,
      periodo: formPago.periodo,
      fecha: formPago.fecha,
      created_by: profile?.email || session.user.email,
    }]).select().single();

    if (error) {
      setSavingPago(false);
      showToast("Error al registrar: " + error.message, false);
      return;
    }

    const statusLiquidacion = formPago.concepto === "total" ? "pagado" : "pagado_parcial";
    // Para pagos de mantenimiento específico, no afecta el balance de liquidación mensual — solo se registra como referencia/recibo
    if (formPago.concepto !== "mantenimiento") {
      await supabase.from("owner_payments").insert([{
        owner_name: propietarioPago.name,
        owner_email: propietarioPago.email,
        period_description: formPago.periodo,
        total_rent: 0,
        total_commission: 0,
        total_liquid: parseFloat(formPago.monto),
        amount_paid: parseFloat(formPago.monto),
        payment_method: formPago.forma_pago,
        payment_date: formPago.fecha,
        status: statusLiquidacion,
        notes: `${formPago.concepto === "adelanto" ? "Adelanto" : formPago.concepto === "parcial" ? "Pago parcial" : "Liquidación total"}${formPago.property_name ? ` — ${formPago.property_name}` : ""} · Recibo: ${recibo.id.slice(0,8).toUpperCase()}`,
        rent_receiver: "inmobiliaria",
      }]);
    }

    // Si esto fue una liquidación TOTAL, marcar los tickets de mantenimiento pendientes de meses anteriores como ya descontados
    if (formPago.concepto === "total") {
      const [anioP, mesP] = mesCorte.split("-").map(Number);
      const propsPropPago = properties.filter(p => p.owner_email === propietarioPago.email);
      const propNamesPago = propsPropPago.map(p => p.name);
      const ticketsADescontar = getTicketsPendientesAnteriores(propNamesPago, anioP, mesP);
      if (ticketsADescontar.length > 0) {
        await supabase.from("maintenance_tickets")
          .update({ descontado_de_liquidacion: true })
          .in("id", ticketsADescontar.map(t => t.id));
      }
    }

    // Si esto fue un pago de mantenimiento puntual, marcar SOLO ese ticket como descontado y guardar evidencia
    if (formPago.concepto === "mantenimiento" && formPago.ticket_id) {
      await supabase.from("maintenance_tickets")
        .update({
          descontado_de_liquidacion: true,
          fecha_cobro_propietario: formPago.fecha,
          forma_cobro_propietario: formPago.forma_pago,
          recibo_cobro_id: recibo.id,
        })
        .eq("id", formPago.ticket_id);
    }

    await generarPDFRecibo({
      ...formPago,
      owner_name: propietarioPago.name,
      owner_email: propietarioPago.email,
      firmaBase64,
      firma_url,
      comprobante_url,
      folio: recibo.id.slice(0, 8).toUpperCase(),
    });

    setSavingPago(false);
    setShowModalPago(false);
    setFormPago(emptyFormPago);
    setFirmaTrazada(false);
    setArchivoComprobante(null);
    showToast("Pago registrado y recibo generado");
    loadData();
  };

  const generarPDFRecibo = async (datos) => {
    const { default: jsPDF } = await import("jspdf");
    const doc = new jsPDF({ format: "a5" });
    const hoy = new Date(datos.fecha).toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
    const concepto = { adelanto: "Adelanto de renta", parcial: "Pago parcial de liquidación", total: "Liquidación total", mantenimiento: "Pago de mantenimiento" }[datos.concepto] || datos.concepto;

    let logoDataUrl = null;
    try {
      const res = await fetch("https://www.emporioinmobiliario.com.mx/logo.png");
      const blob = await res.blob();
      logoDataUrl = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (e) { /* sin logo */ }

    doc.setFillColor(185, 28, 60); doc.rect(0, 0, 6, 210, "F");
    doc.setFillColor(26, 26, 46); doc.rect(6, 0, 142, 30, "F");
    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "PNG", 10, 5, 24, 10);
    } else {
      doc.setTextColor(255,255,255); doc.setFontSize(11); doc.setFont("helvetica","bold");
      doc.text("EMPORIO INMOBILIARIO", 12, 14);
    }
    doc.setTextColor(255,255,255); doc.setFontSize(14); doc.setFont("helvetica","bold");
    doc.text("RECIBO DE ENTREGA", 108, 13, { align: "right" });
    doc.setFontSize(8); doc.setFont("helvetica","normal");
    doc.text(`Folio: ${datos.folio}`, 108, 20, { align: "right" });
    doc.text(`Fecha: ${hoy}`, 108, 25, { align: "right" });

    let y = 38;
    doc.setTextColor(26,26,46); doc.setFontSize(9); doc.setFont("helvetica","normal");

    doc.setFillColor(248,248,248); doc.rect(8, y, 132, 24, "F");
    doc.setDrawColor(220,220,220); doc.setLineWidth(0.3); doc.rect(8, y, 132, 24, "S");
    doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(122,122,122);
    doc.text("PROPIETARIO", 12, y + 6);
    doc.setTextColor(26,26,46); doc.setFontSize(11); doc.setFont("helvetica","bold");
    doc.text(datos.owner_name, 12, y + 14);
    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(122,122,122);
    doc.text(datos.owner_email, 12, y + 20);
    y += 30;

    const rows = [
      ["Concepto", concepto],
      ["Periodo", datos.periodo || "—"],
      ["Propiedad", datos.property_name || "Todas las propiedades"],
      ["Forma de pago", datos.forma_pago === "efectivo" ? "Efectivo" : "Transferencia bancaria"],
    ];
    rows.forEach(([lbl, val]) => {
      doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(122,122,122);
      doc.text(lbl, 10, y);
      doc.setFont("helvetica","bold"); doc.setTextColor(26,26,46);
      doc.text(val, 80, y);
      y += 8;
    });

    y += 4;
    doc.setFillColor(6, 95, 70); doc.rect(8, y, 132, 16, "F");
    doc.setTextColor(255,255,255); doc.setFont("helvetica","normal"); doc.setFontSize(9);
    doc.text("MONTO ENTREGADO", 12, y + 7);
    doc.setFont("helvetica","bold"); doc.setFontSize(14);
    doc.text(fmt(parseFloat(datos.monto)), 136, y + 10, { align: "right" });
    y += 24;

    if (datos.forma_pago === "efectivo") {
      y += 4;
      doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(26,26,46);
      doc.text("FIRMA DE RECIBIDO — PROPIETARIO", 10, y);
      y += 4;
      const firmaData = datos.firmaBase64 || null;
      if (firmaData) {
        try {
          doc.addImage(firmaData, "PNG", 8, y, 80, 25);
          doc.setDrawColor(200,200,200); doc.setLineWidth(0.3);
          doc.rect(8, y, 80, 25, "S");
        } catch(e) {
          doc.setDrawColor(200,200,200); doc.rect(8, y, 80, 25, "S");
          doc.setTextColor(180,180,180); doc.setFontSize(8);
          doc.text("(firma no disponible)", 12, y + 13);
        }
      } else if (datos.firma_url) {
        try {
          const res = await fetch(datos.firma_url);
          const blob = await res.blob();
          const firmaB64 = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
          doc.addImage(firmaB64, "PNG", 8, y, 80, 25);
          doc.setDrawColor(200,200,200); doc.setLineWidth(0.3);
          doc.rect(8, y, 80, 25, "S");
        } catch(e) {
          doc.setDrawColor(200,200,200); doc.rect(8, y, 80, 25, "S");
          doc.setTextColor(180,180,180); doc.setFontSize(8);
          doc.text("(firma no disponible)", 12, y + 13);
        }
      } else {
        doc.setDrawColor(200,200,200); doc.rect(8, y, 80, 25, "S");
      }
      doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(122,122,122);
      doc.text(datos.owner_name, 10, y + 31);
      y += 36;
    }

    if (datos.forma_pago === "transferencia" && datos.comprobante_url) {
      y += 4;
      doc.setFillColor(235,245,255); doc.rect(8, y, 132, 10, "F");
      doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(30,64,175);
      doc.text("Comprobante de transferencia adjunto en el sistema", 12, y + 6);
      y += 14;
    }

    doc.setDrawColor(220,220,220); doc.setLineWidth(0.3); doc.line(8, 192, 140, 192);
    doc.setFillColor(185,28,60); doc.rect(0, 192, 6, 18, "F");
    doc.setTextColor(122,122,122); doc.setFontSize(7); doc.setFont("helvetica","normal");
    doc.text("Emporio Inmobiliario — Puebla, México", 10, 198);
    doc.text("222 257 3237  ·  ventas@emporioinmobiliario.mx", 10, 203);
    doc.setTextColor(185,28,60); doc.setFont("helvetica","bold");
    doc.text("app.emporioinmobiliario.com.mx", 10, 208);

    savePDF(doc, `Recibo_Pago_${datos.owner_name.replace(/\s+/g,"_")}_${datos.fecha}.pdf`);
  };

  const openLiquidar = (ownerName, ownerEmail) => {
    const [anioLiq, mesLiq] = mesCorte.split("-").map(Number);
    const propsProp = properties.filter(p => p.owner_email === ownerEmail);
    const contratosProp = contracts.filter(c => propsProp.some(p => p.name === c.property_name) && c.status === "activo");
    const contractIds = contratosProp.map(c => c.id);
    // Solo rentas efectivamente cobradas (pagadas) en el mes del corte
    const pagosCobradosMes = payments.filter(p => {
      if (p.status !== "pagado" || !p.due_date) return false;
      if (!contractIds.includes(p.contract_id)) return false;
      const d = new Date(p.due_date + "T12:00:00");
      return d.getMonth() === (mesLiq - 1) && d.getFullYear() === anioLiq;
    });
    const totalRent = pagosCobradosMes.reduce((a, p) => a + (p.amount || 0), 0);
    const contratosPagados = contratosProp.filter(c => pagosCobradosMes.some(p => p.contract_id === c.id));
    const totalCom  = contratosPagados.reduce((a, c) => a + calcComision(c), 0);
    const totalLiq  = totalRent - totalCom;
    // Descontar anticipos ya entregados en este periodo
    const periodoLabel = new Date(anioLiq, mesLiq - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
    const anticiposPeriodo = ownerPayments.filter(l =>
      l.owner_email === ownerEmail &&
      (l.period_description || "") === periodoLabel &&
      l.status === "pagado_parcial"
    ).reduce((a, l) => a + (l.amount_paid || 0), 0);
    const montoFinal = Math.max(0, totalLiq - anticiposPeriodo);
    // Solo propiedades con renta cobrada este mes
    const propsCobradas = propsProp.filter(p => pagosCobradosMes.some(pago => {
      const c = contratosProp.find(c => c.id === pago.contract_id);
      return c && c.property_name === p.name;
    }));
    const propNames = propsCobradas.length > 0 ? propsCobradas.map(p => p.name).join(", ") : propsProp.map(p => p.name).join(", ");
    const rentReceivers = [...new Set(contratosProp.map(c => c.rent_receiver || "inmobiliaria"))];
    const dominant = rentReceivers.length === 1 ? rentReceivers[0] : "inmobiliaria";
    setForm({
      owner_name: ownerName, owner_email: ownerEmail,
      period_description: periodoLabel,
      total_rent: totalRent.toString(), total_commission: totalCom.toString(),
      total_liquid: totalLiq.toString(), amount_paid: montoFinal.toString(),
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

    // ── Bloquear doble liquidación total del mismo periodo ──
    if (form.status === "pagado") {
      const { data: existentes } = await supabase.from("owner_payments")
        .select("id, status")
        .eq("owner_email", form.owner_email)
        .eq("period_description", form.period_description)
        .eq("status", "pagado");
      if (existentes && existentes.length > 0) {
        setSaving(false);
        showToast("⚠️ Este periodo ya fue liquidado completamente. No se puede liquidar dos veces.", false);
        return;
      }
    }

    const { error } = await supabase.from("owner_payments").insert([data]);
    if (error) { setSaving(false); showToast("Error: " + error.message, false); return; }

    // ── Marcar tickets de mantenimiento de meses anteriores (con saldo a cargo del propietario) como ya descontados ──
    // Esto evita que sigan apareciendo como "pendientes" en reportes de meses futuros una vez liquidados.
    if (form.status === "pagado") {
      const [anioForm, mesForm] = (() => {
        // period_description viene como "mayo de 2026" — usar mesCorte como fuente confiable de mes/año
        return mesCorte.split("-").map(Number);
      })();
      const propsPropForm = properties.filter(p => p.owner_email === form.owner_email);
      const propNamesForm = propsPropForm.map(p => p.name);
      const ticketsADescontar = getTicketsPendientesAnteriores(propNamesForm, anioForm, mesForm);
      if (ticketsADescontar.length > 0) {
        await supabase.from("maintenance_tickets")
          .update({ descontado_de_liquidacion: true })
          .in("id", ticketsADescontar.map(t => t.id));
      }
    }

    if (form.rent_receiver === "inmobiliaria") {
      const comisionRetenida = parseFloat(form.total_commission) || 0;
      const montoLiquidado   = parseFloat(form.amount_paid) || 0;

      // 1. Salida: lo que le pagamos al propietario
      await supabase.from("cash_movements").insert([{
        type: "salida", category: "liquidacion_propietario",
        description: `Liquidación ${form.owner_name} - ${form.period_description}`,
        amount: montoLiquidado,
        payment_method: form.payment_method,
        date: form.payment_date || today,
        notes: `Comisión retenida: ${fmt(comisionRetenida)}`,
        created_by: profile?.email, created_at: new Date().toISOString()
      }]);

      // 2. Entrada: la comisión que se queda Emporio
      if (comisionRetenida > 0) {
        await supabase.from("cash_movements").insert([{
          type: "entrada", category: "comision_cobrada",
          description: `Comisión administración ${form.owner_name} - ${form.period_description}`,
          amount: comisionRetenida,
          payment_method: form.payment_method,
          date: form.payment_date || today,
          notes: `Retenida de liquidación. Renta total: ${fmt(parseFloat(form.total_rent) || 0)}`,
          created_by: profile?.email, created_at: new Date().toISOString()
        }]);
      }

      // Marcar comisiones automáticas del periodo como cobradas
      const meses = { enero:"01",febrero:"02",marzo:"03",abril:"04",mayo:"05",junio:"06",julio:"07",agosto:"08",septiembre:"09",octubre:"10",noviembre:"11",diciembre:"12" };
      const desc = (form.period_description || "").toLowerCase();
      const anio = desc.match(/\d{4}/)?.[0];
      const mes = Object.keys(meses).find(m => desc.includes(m));
      const periodo = anio && mes ? `${anio}-${meses[mes]}` : null;

      if (periodo) {
        const propsProp = properties.filter(p => p.owner_email === form.owner_email);
        const contratosProp = contracts.filter(c =>
          propsProp.some(p => p.name === c.property_name) &&
          c.status === "activo" &&
          c.rent_receiver === "inmobiliaria"
        );
        const contractIds = contratosProp.map(c => c.id);
        if (contractIds.length > 0) {
          await supabase.from("comisiones_admin")
            .update({ status: "cobrada", fecha_cobro: form.payment_date || today })
            .in("contract_id", contractIds)
            .eq("periodo", periodo)
            .eq("tipo", "automatica")
            .eq("status", "pendiente");
        }
      }
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

  const descargarPDF = async (ownerName, ownerEmail, mesCorteParam) => {
    const fmt = (n) => {
      const v = n || 0;
      const dec = v % 1 === 0 ? 0 : 2;
      return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
    };
    const fmtFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f.includes("T") ? f : f + "T12:00:00");
      return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
    };
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    const [anioCorte, mesNumCorte] = (mesCorteParam || mesCorte).split("-").map(Number);
    const fechaCorte = new Date(anioCorte, mesNumCorte - 1, 1);
    const hoy = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
    const mes = fechaCorte.toLocaleDateString("es-MX", { year: "numeric", month: "long" });

    const propsProp = properties.filter(p => p.owner_email === ownerEmail);
    const contratosProp = contracts.filter(c => propsProp.some(p => p.name === c.property_name) && c.status === "activo");
    const liqProp = ownerPayments.filter(l => l.owner_email === ownerEmail);
    const ticketsProp = tickets.filter(t => {
      if (!propsProp.some(p => p.name === t.property_name)) return false;
      if (!t.created_at) return true;
      const d = new Date(t.created_at);
      return d.getMonth() === (mesNumCorte - 1) && d.getFullYear() === anioCorte;
    });

    // Tickets de meses anteriores con saldo pendiente, EXCLUYENDO los ya descontados en una liquidación previa
    const ticketsPendientesAnteriores = getTicketsPendientesAnteriores(propsProp.map(p => p.name), anioCorte, mesNumCorte);
    const saldoPendienteAnteriores = ticketsPendientesAnteriores.reduce((a, t) => {
      const saldo = (t.charged_amount || 0) - (t.advance_paid ? (t.advance_amount || 0) : 0);
      return a + saldo;
    }, 0);
    const gastosProp = propertyExpenses.filter(e => {
      if (!propsProp.some(p => p.name === e.property_name)) return false;
      if (e.paid_by !== "propietario") return false;
      if (!e.date) return true;
      const d = new Date(e.date + "T12:00:00");
      return d.getMonth() === (mesNumCorte - 1) && d.getFullYear() === anioCorte;
    });
    const contractIds = contratosProp.map(c => c.id);
    const { data: pagosMesCalc } = await supabase.from("payments").select("*").in("contract_id", contractIds.length > 0 ? contractIds : ["none"]);
    const pagosPagadosMes = (pagosMesCalc || []).filter(p => {
      if (p.status !== "pagado") return false;
      if (!p.due_date) return false;
      const d = new Date(p.due_date + "T12:00:00");
      return d.getMonth() === (mesNumCorte - 1) && d.getFullYear() === anioCorte;
    });
    const totalRentaProp = pagosPagadosMes.reduce((a, p) => a + (p.amount || 0), 0);

    // ── Clasificar rentas: directo a cuenta del propietario vs cobradas por Emporio ──
    const { data: entradasCajaMes } = await supabase.from("cash_movements")
      .select("description, amount, date, type, category")
      .eq("type", "entrada").eq("category", "renta_cobrada");
    const entradasDelMes = (entradasCajaMes || []).filter(mv => {
      if (!mv.date) return false;
      const d = new Date(mv.date + "T12:00:00");
      return d.getMonth() === (mesNumCorte - 1) && d.getFullYear() === anioCorte;
    });
    const cobradaPorEmporio = (pago) => {
      if (pago.recibido_por === "emporio") return true;
      if (pago.recibido_por === "propietario") return false;
      const c = contratosProp.find(c => c.id === pago.contract_id);
      if (!c) return false;
      if ((c.rent_receiver || "inmobiliaria") === "inmobiliaria") return true;
      return entradasDelMes.some(mv => (mv.description || "").toLowerCase().includes((pago.property_name || "").toLowerCase()) && pago.property_name);
    };
    const rentaEmporio = pagosPagadosMes.filter(p => cobradaPorEmporio(p)).reduce((a, p) => a + (p.amount || 0), 0);
    const rentaDirecta = totalRentaProp - rentaEmporio;

    const contratosPagados = contratosProp.filter(c => pagosPagadosMes.some(p => p.contract_id === c.id));

    // Comisión: solo contratos cuya comisión NO esté ya cobrada en comisiones_admin para este periodo
    const { data: comisionesAdminMes } = await supabase.from("comisiones_admin")
      .select("contract_id, status")
      .in("contract_id", contratosProp.map(c => c.id))
      .eq("periodo", `${anioCorte}-${String(mesNumCorte).padStart(2, "0")}`)
      .eq("status", "cobrada");
    const contratosComisionPendiente = contratosPagados.filter(c =>
      !(comisionesAdminMes || []).some(ca => ca.contract_id === c.id)
    );
    const totalComProp = contratosComisionPendiente.reduce((a, c) => a + calcComision(c), 0);
    const totalComYaCobrada = contratosPagados.reduce((a, c) => a + calcComision(c), 0) - totalComProp;
    const ticketsMantProp = ticketsProp.filter(t => t.payer === "propietario" && t.charged_amount > 0);
    const costoMantPropTotal = ticketsMantProp.reduce((a, t) => a + (t.charged_amount || 0), 0);
    const anticipoMantProp   = ticketsMantProp.reduce((a, t) => a + (t.advance_amount || 0), 0);
    const costoMantProp      = costoMantPropTotal - anticipoMantProp;
    const gastosOpProp   = gastosProp.reduce((a, e) => a + (e.amount || 0), 0);
    const totalLiqProp   = totalRentaProp - totalComProp - costoMantProp - gastosOpProp - saldoPendienteAnteriores;
    // Balance real considerando solo el dinero que Emporio tiene en su poder
    const balanceEmporio = rentaEmporio - totalComProp - costoMantProp - gastosOpProp - saldoPendienteAnteriores;
    const liqDelMes = liqProp.filter(l => {
      const desc = (l.period_description || "").toLowerCase();
      const mesMes = fechaCorte.toLocaleDateString("es-MX", { month: "long" }).toLowerCase();
      const anioStr = String(anioCorte);
      return desc.includes(mesMes) && desc.includes(anioStr);
    });
    const totalAdelanto = liqDelMes.reduce((a, l) => a + (l.amount_paid || 0), 0);
    const totalPendiente = totalLiqProp - totalAdelanto;

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

    doc.setFillColor(255, 255, 255); doc.rect(0, 0, 210, 44, "F");
    doc.setFillColor(185, 28, 60); doc.rect(0, 0, 6, 44, "F");
    doc.setFillColor(185, 28, 60); doc.rect(0, 41, 210, 3, "F");
    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "PNG", 14, 5, 34, 15);
    } else {
      doc.setTextColor(185, 28, 60); doc.setFontSize(16); doc.setFont("helvetica", "bold");
      doc.text("EMPORIO", 14, 16);
      doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(122, 122, 122);
      doc.text("INMOBILIARIO", 14, 22);
    }
    doc.setTextColor(185, 28, 60); doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text("REPORTE DE PROPIETARIO", 195, 12, { align: "right" });
    doc.setTextColor(122, 122, 122); doc.setFontSize(8); doc.setFont("helvetica", "normal");
    doc.text(`Generado: ${hoy}`, 195, 19, { align: "right" });
    doc.text("app.emporioinmobiliario.com.mx", 195, 25, { align: "right" });

    doc.setFillColor(248, 248, 248); doc.rect(0, 44, 210, 20, "F");
    doc.setTextColor(74, 74, 74); doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text(ownerName, 14, 55);
    doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(122, 122, 122);
    doc.text(`Periodo: ${mes}  ·  ${propsProp.length} propiedad${propsProp.length !== 1 ? "es" : ""}  ·  ${contratosProp.length} contrato${contratosProp.length !== 1 ? "s" : ""} activo${contratosProp.length !== 1 ? "s" : ""}`, 14, 61);

    let y = 84;
    const yaLiquidadoPre = liqProp.some(l => {
      const desc = (l.period_description || "").toLowerCase();
      const mesMes2 = fechaCorte.toLocaleDateString("es-MX", { month: "long" }).toLowerCase();
      return desc.includes(mesMes2) && desc.includes(String(anioCorte)) && l.status === "pagado";
    });
    const extraLines = (costoMantPropTotal > 0 ? 1 : 0) + (anticipoMantProp > 0 ? 2 : 0) + (saldoPendienteAnteriores > 0 ? 1 : 0) + (gastosOpProp > 0 ? 1 : 0) + (totalAdelanto > 0 && !yaLiquidadoPre ? 1 : 0) + (rentaDirecta > 0 ? 1 : 0) + (totalComYaCobrada > 0 ? 1 : 0) + (totalComProp > 0 ? 1 : 0);
    const boxH = 28 + extraLines * 7;

    doc.setFillColor(185, 28, 60); doc.rect(14, y, 182, 7, "F");
    doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text("RESUMEN FINANCIERO", 18, y + 5);
    doc.setFillColor(255, 245, 247); doc.rect(14, y + 7, 182, boxH, "F");
    doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3);
    doc.rect(14, y + 7, 182, boxH, "S");
    const pagosTotalesMesResumen = (pagosMesCalc || []).filter(p => {
      if (!p.due_date) return false;
      const d = new Date(p.due_date + "T12:00:00");
      return d.getMonth() === (mesNumCorte - 1) && d.getFullYear() === anioCorte;
    });
    const numPagados = pagosTotalesMesResumen.filter(p => p.status === "pagado").length;
    let lineY = y + 14;
    if (rentaDirecta > 0) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(74, 74, 74);
      doc.text(`Rentas cobradas directo en tu cuenta:`, 18, lineY);
      doc.setFont("helvetica", "bold");
      doc.text(fmt(rentaDirecta), 105, lineY);
      lineY += 7;
      doc.setFont("helvetica", "normal"); doc.setTextColor(74, 74, 74);
      doc.text(`Rentas cobradas por Emporio:`, 18, lineY);
      doc.setFont("helvetica", "bold");
      doc.text(fmt(rentaEmporio), 105, lineY);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(122, 122, 122);
      doc.text(`(${numPagados} de ${pagosTotalesMesResumen.length} rentas pagadas)`, 140, lineY);
      doc.setFontSize(9);
      lineY += 7;
    } else {
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(74, 74, 74);
      doc.text(`Renta cobrada del mes:`, 18, lineY);
      doc.setFont("helvetica", "bold");
      doc.text(fmt(totalRentaProp), 105, lineY);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(122, 122, 122);
      doc.text(`(${numPagados} de ${pagosTotalesMesResumen.length} rentas pagadas)`, 140, lineY);
      doc.setFontSize(9);
      lineY += 7;
    }
    doc.setFont("helvetica", "normal"); doc.setTextColor(74, 74, 74);
    if (totalComProp > 0) {
      doc.text(`Comisión administración:`, 18, lineY);
      doc.setFont("helvetica", "bold"); doc.setTextColor(185, 28, 60);
      doc.text(`-${fmt(totalComProp)}`, 105, lineY);
      lineY += 7;
    }
    if (totalComYaCobrada > 0) {
      doc.setFont("helvetica", "normal"); doc.setTextColor(74, 74, 74);
      doc.text(`Comisión ya cobrada (incluida en renta):`, 18, lineY);
      doc.setFont("helvetica", "bold"); doc.setTextColor(6, 95, 70);
      doc.text(`${fmt(totalComYaCobrada)} (ya cobrada)`, 105, lineY);
      lineY += 7;
    }
    if (costoMantPropTotal > 0) {
      doc.setFont("helvetica", "normal"); doc.setTextColor(74, 74, 74);
      doc.text("Mantenimiento:", 18, lineY);
      doc.setFont("helvetica", "bold"); doc.setTextColor(185, 28, 60);
      doc.text(`-${fmt(costoMantPropTotal)}`, 105, lineY);
      lineY += 7;
      if (anticipoMantProp > 0) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(74, 74, 74);
        doc.text(`  Anticipo pagado:`, 18, lineY);
        doc.setFont("helvetica", "bold"); doc.setTextColor(6, 95, 70);
        doc.text(`+${fmt(anticipoMantProp)}`, 105, lineY);
        doc.setFontSize(9);
        lineY += 7;
        doc.setFont("helvetica", "normal"); doc.setTextColor(74, 74, 74);
        doc.text(`  Saldo mantenimiento:`, 18, lineY);
        doc.setFont("helvetica", "bold"); doc.setTextColor(185, 28, 60);
        doc.text(`-${fmt(costoMantProp)}`, 105, lineY);
        lineY += 7;
      }
    }
    if (saldoPendienteAnteriores > 0) {
      doc.setFont("helvetica", "normal"); doc.setTextColor(74, 74, 74);
      doc.text("Mantenimiento meses anteriores:", 18, lineY);
      doc.setFont("helvetica", "bold"); doc.setTextColor(185, 28, 60);
      doc.text(`-${fmt(saldoPendienteAnteriores)}`, 105, lineY);
      lineY += 7;
    }
    if (gastosOpProp > 0) {
      doc.setFont("helvetica", "normal"); doc.setTextColor(74, 74, 74);
      doc.text("Gastos operativos:", 18, lineY);
      doc.setFont("helvetica", "bold"); doc.setTextColor(185, 28, 60);
      doc.text(`-${fmt(gastosOpProp)}`, 105, lineY);
      lineY += 7;
    }
    const mesYaLiquidado = liqDelMes.some(l => l.status === "pagado");
    if (totalAdelanto > 0 && !mesYaLiquidado) {
      doc.setFont("helvetica", "normal"); doc.setTextColor(74, 74, 74);
      doc.text("Adelanto pagado:", 18, lineY);
      doc.setFont("helvetica", "bold"); doc.setTextColor(185, 28, 60);
      doc.text(`-${fmt(totalAdelanto)}`, 105, lineY);
      lineY += 7;
    }

    let labelLiq, montoLiq, boxColor;
    const liqPagadaCompleta = liqDelMes.find(l => l.status === "pagado");
    const periodoYaLiquidado = !!liqPagadaCompleta && totalAdelanto > 0;
    if (periodoYaLiquidado) {
      labelLiq = "Periodo liquidado — pagado:";
      montoLiq = liqDelMes.reduce((a, l) => a + (l.amount_paid || 0), 0);
      boxColor = [6, 95, 70];
    } else if (rentaDirecta > 0) {
      const balanceFinal = balanceEmporio - liqDelMes.reduce((a, l) => a + (l.amount_paid || 0), 0);
      if (balanceFinal >= 0) {
        labelLiq = totalAdelanto > 0 ? "Pendiente por pagarte:" : "Emporio te entrega:";
        montoLiq = balanceFinal;
        boxColor = [6, 95, 70];
      } else {
        labelLiq = "Saldo a pagar a Emporio:";
        montoLiq = Math.abs(balanceFinal);
        boxColor = [185, 28, 60];
      }
    } else {
      labelLiq = totalAdelanto > 0 ? "Pendiente por pagar:" : "Líquido a recibir:";
      montoLiq = totalAdelanto > 0 ? totalPendiente : totalLiqProp;
      boxColor = [6, 95, 70];
    }
    doc.setFillColor(boxColor[0], boxColor[1], boxColor[2]); doc.rect(105, lineY - 5, 91, 10, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text(labelLiq, 108, lineY + 1);
    doc.text(fmt(montoLiq), 190, lineY + 1, { align: "right" });
    if (periodoYaLiquidado) {
      y += boxH + 14;
      doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); doc.setTextColor(122, 122, 122);
      doc.text("Este periodo ya fue liquidado y pagado. El detalle del pago aparece en el Historial de Liquidaciones.", 14, y - 8, { maxWidth: 182 });
    } else if (rentaDirecta > 0) {
      y += boxH + 14;
      doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); doc.setTextColor(122, 122, 122);
      doc.text("Las rentas con depósito directo ya fueron recibidas en tu cuenta bancaria; este balance considera únicamente el dinero en poder de Emporio.", 14, y - 8, { maxWidth: 182 });
    } else {
      y += boxH + 14;
    }

    const headStyle = { fillColor: [74, 74, 74], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 };
    const altRow = { fillColor: [250, 250, 250] };
    const tableMargin = { left: 14, right: 14 };
    const sectionTitle = (titulo, yPos) => {
      doc.setFillColor(185, 28, 60); doc.rect(14, yPos, 4, 8, "F");
      doc.setTextColor(74, 74, 74); doc.setFontSize(11); doc.setFont("helvetica", "bold");
      doc.text(titulo, 22, yPos + 6);
      return yPos + 10;
    };

    y = sectionTitle("Propiedades y cobranza del mes", y);
    const contractIdsMes = contratosProp.map(c => c.id);
    const { data: pagosFrescos } = await supabase.from("payments").select("*").in("contract_id", contractIdsMes.length > 0 ? contractIdsMes : ["none"]);
    const pagosMesPDF = (pagosFrescos || []).filter(p => {
      if (!p.due_date) return false;
      const d = new Date(p.due_date + "T12:00:00");
      return d.getMonth() === (mesNumCorte - 1) && d.getFullYear() === anioCorte;
    });
    autoTable(doc, {
      startY: y,
      head: [["Propiedad", "Inquilino", "Renta", "Comisión", "Líquido", "Vence", "Estado"]],
      body: propsProp.map(prop => {
        const c = contratosProp.find(c => c.property_name === prop.name);
        const com = c ? calcComision(c) : 0;
        const pago = pagosMesPDF.find(p => p.property_name === prop.name);
        const estado = pago ? (pago.status === "pagado" ? "Pagado" : pago.status === "atrasado" ? "Atrasado" : "Pendiente") : "—";
        return [
          prop.name,
          c?.tenant_name || "—",
          fmt(prop.rent_amount),
          fmt(com),
          fmt((prop.rent_amount || 0) - com),
          pago?.due_date ? fmtFecha(pago.due_date) : (c ? `Día ${c.payment_day}` : "—"),
          estado,
        ];
      }),
      styles: { fontSize: 8, cellPadding: 3 }, headStyles: headStyle, alternateRowStyles: altRow,
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 6) {
          if (data.cell.raw === "Pagado") { data.cell.styles.textColor = [6, 95, 70]; data.cell.styles.fontStyle = "bold"; }
          if (data.cell.raw === "Atrasado") { data.cell.styles.textColor = [185, 28, 60]; data.cell.styles.fontStyle = "bold"; }
          if (data.cell.raw === "Pendiente") { data.cell.styles.textColor = [146, 64, 14]; data.cell.styles.fontStyle = "bold"; }
        }
      },
      margin: tableMargin,
    });
    y = doc.lastAutoTable.finalY + 12;
    if (y > 230) { doc.addPage(); y = 15; }

    y = sectionTitle("Historial de Liquidaciones", y);
    autoTable(doc, {
      startY: y,
      head: [["Periodo", "Renta", "Comisión", "Pagado", "Fecha", "Estado"]],
      body: (() => {
        const ultimoDiaMes = new Date(anioCorte, mesNumCorte, 0);
        const liqHastaMes = liqProp.filter(l => {
          if (!l.payment_date) return l.status !== "pagado";
          const fechaPago = new Date(l.payment_date + "T12:00:00");
          return fechaPago <= ultimoDiaMes;
        }).sort((a, b) => {
          if (a.period_description !== b.period_description) {
            return (a.period_description || "").localeCompare(b.period_description || "");
          }
          if (a.status === "pagado_parcial" && b.status === "pagado") return -1;
          if (a.status === "pagado" && b.status === "pagado_parcial") return 1;
          return new Date(a.payment_date) - new Date(b.payment_date);
        });
        return liqHastaMes.length > 0 ? liqHastaMes.map(l => [
          l.period_description || "—", fmt(l.total_rent), fmt(l.total_commission),
          fmt(l.amount_paid), fmtFecha(l.payment_date),
          (() => {
            const hayPagadoEnPeriodo = liqHastaMes.some(x => x.period_description === l.period_description && x.status === "pagado");
            if (l.status === "pagado") return hayPagadoEnPeriodo && liqHastaMes.filter(x => x.period_description === l.period_description).length > 1 ? "Finiquito" : "Pagado";
            if (l.status === "pagado_parcial") return hayPagadoEnPeriodo ? "Anticipo" : "Parcial";
            return "Pendiente";
          })()
        ]) : [["Sin liquidaciones registradas", "", "", "", "", ""]];
      })(),
      styles: { fontSize: 8, cellPadding: 3 }, headStyles: headStyle, alternateRowStyles: altRow, margin: tableMargin,
    });
    y = doc.lastAutoTable.finalY + 12;
    if (y > 230) { doc.addPage(); y = 15; }

    y = sectionTitle("Mantenimiento", y);
    const todosTicketsPDF = [
      ...ticketsProp,
      ...ticketsPendientesAnteriores.map(t => ({ ...t, _esPendienteAnterior: true }))
    ];
    autoTable(doc, {
      startY: y,
      head: [["Título", "Propiedad", "Quién paga", "Costo", "Estado", "Fecha"]],
      body: todosTicketsPDF.length > 0 ? todosTicketsPDF.map(t => [
        t.title || "—", t.property_name || "—",
        t.payer === "propietario" ? "Propietario" : t.payer === "inquilino" ? "Inquilino" : "Inmobiliaria",
        t.payer === "propietario" && t.charged_amount > 0 ? fmt(t.charged_amount) : "—",
        t.status === "cerrado" || t.status === "resuelto" ? "Resuelto" : t.status === "en_proceso" ? "En proceso" : "Abierto",
        fmtFecha(t.created_at)
      ]) : [["Sin reportes de mantenimiento", "", "", "", "", ""]],
      styles: { fontSize: 8, cellPadding: 3 }, headStyles: headStyle, alternateRowStyles: altRow, margin: tableMargin,
    });

    if (gastosProp.length > 0) {
      y = doc.lastAutoTable.finalY + 12;
      if (y > 230) { doc.addPage(); y = 15; }
      y = sectionTitle("Gastos Operativos", y);
      autoTable(doc, {
        startY: y,
        head: [["Concepto", "Propiedad", "Descripción", "Monto", "Quién paga", "Fecha"]],
        body: gastosProp.map(e => {
          const catLabels = { condominio: "Condominio", predial: "Predial", agua: "Agua", luz: "Luz", gas: "Gas", seguro: "Seguro", mantenimiento_comun: "Mantenimiento común", otro: "Otro" };
          return [catLabels[e.category] || e.category || "—", e.property_name || "—", e.description || "—", fmt(e.amount), e.paid_by === "propietario" ? "Propietario" : "Emporio", fmtFecha(e.date)];
        }),
        styles: { fontSize: 8, cellPadding: 3 }, headStyles: headStyle, alternateRowStyles: altRow, margin: tableMargin,
      });
    }

    const totalPaginas = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPaginas; i++) {
      doc.setPage(i);
      doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3);
      doc.line(14, 284, 196, 284);
      doc.setFillColor(185, 28, 60); doc.rect(0, 284, 6, 13, "F");
      doc.setTextColor(122, 122, 122); doc.setFontSize(7); doc.setFont("helvetica", "normal");
      doc.text("Emporio Inmobiliario — Puebla, México", 14, 290);
      doc.text("222 257 3237  ·  ventas@emporioinmobiliario.mx", 14, 294);
      doc.setTextColor(185, 28, 60); doc.setFont("helvetica", "bold");
      doc.text(`${i} / ${totalPaginas}`, 196, 292, { align: "right" });
    }

    savePDF(doc, `Liquidacion_${ownerName.replace(/\s+/g, "_")}_${today}.pdf`);
  };

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} />
    </div>
  );
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }

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
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, padding: "10px 16px", marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 12, color: "#92400e", fontWeight: 600 }}>
            Si la renta va directo al propietario: registra como referencia pero NO afecta la caja de Emporio. La comisión se registra en Comisiones cuando la recibes.
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 48 }}><p style={{ color: "#6b7280" }}>Cargando...</p></div>
        ) : (
          <>
            {propietariosUnicos.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>Propietarios activos</h2>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Periodo del corte:</span>
                    <input type="month" value={mesCorte} onChange={e => setMesCorte(e.target.value)}
                      style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                  {propietariosUnicos.map((owner, i) => {
                    const propsProp = properties.filter(p => p.owner_email === owner.email);
                    const contratosProp = contracts.filter(c => propsProp.some(p => p.name === c.property_name) && c.status === "activo");
                    const liquidoProp = contratosProp.reduce((a, c) => a + (c.monthly_rent || 0) - calcComision(c), 0);
                    const pagosDelPropietario = payments.filter(p => propsProp.some(pr => pr.name === p.property_name) && p.status === "pagado");
                    const totalPagado = pagosDelPropietario.reduce((a, p) => a + (p.amount || 0), 0);
                    const pendienteMes = calcPendienteMes(owner.email);
                    return (
                      <div key={i} style={{ background: "#fff", borderRadius: 14, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                          <div>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{owner.name}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>{propsProp.length} propiedad{propsProp.length !== 1 ? "es" : ""}</p>
                          </div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <Btn small color="#4b5563" onClick={() => openExpediente(owner)}>👤 Expediente</Btn>
                            <Btn small color="#065f46" onClick={() => openLiquidar(owner.name, owner.email)}>Liquidar</Btn>
                            <Btn small color="#1e40af" onClick={() => descargarPDF(owner.name, owner.email, mesCorte)}>PDF</Btn>
                            <Btn small color="#b45309" onClick={() => openModalPago(owner)}>💳 Pago</Btn>
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <div style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 12px" }}>
                            <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Líquido/mes</p>
                            <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#065f46" }}>{fmt(liquidoProp)}</p>
                          </div>
                          <div style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 12px" }}>
                            <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Pendiente mes</p>
                            <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: pendienteMes > 0 ? "#b45309" : "#065f46" }}>{fmt(pendienteMes)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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

      {showModalPago && propietarioPago && (
        <Modal title={`💳 Registrar pago — ${propietarioPago.name}`} onClose={() => { setShowModalPago(false); setFormPago(emptyFormPago); setFirmaTrazada(false); setArchivoComprobante(null); }} wide>
          <div style={{ background: "#f9fafb", borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a1a2e" }}>{propietarioPago.name}</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>{propietarioPago.email}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Pendiente del mes</p>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#b45309" }}>{fmt(calcPendienteMes(propietarioPago.email))}</p>
              {pagoYaAbonado > 0 && (
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#1e40af", fontWeight: 600 }}>Ya abonado: {fmt(pagoYaAbonado)} · Saldo: {fmt(Math.max(0, calcPendienteMes(propietarioPago.email) - pagoYaAbonado))}</p>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Concepto">
              <Sel value={formPago.concepto} onChange={e => {
                const nuevoConcepto = e.target.value;
                if (nuevoConcepto === "mantenimiento") {
                  setFormPago({ ...formPago, concepto: nuevoConcepto, monto: "", ticket_id: "" });
                } else {
                  setFormPago({ ...formPago, concepto: nuevoConcepto });
                }
              }}>
                <option value="adelanto">Adelanto</option>
                <option value="parcial">Pago parcial</option>
                <option value="total">Liquidación total</option>
                <option value="mantenimiento">🔧 Pago de mantenimiento</option>
              </Sel>
            </Field>
            <Field label="Monto a entregar">
              <Input type="number" value={formPago.monto} onChange={e => setFormPago({ ...formPago, monto: e.target.value })} placeholder="0" disabled={formPago.concepto === "mantenimiento" && !!formPago.ticket_id} />
            </Field>
          </div>

          {formPago.concepto === "mantenimiento" && (() => {
            const ticketsPendientesProp = tickets.filter(t =>
              t.payer === "propietario" &&
              properties.some(p => p.owner_email === propietarioPago.email && p.name === t.property_name) &&
              t.charged_amount > 0 &&
              !t.descontado_de_liquidacion
            );
            return (
              <Field label="¿Qué mantenimiento se está cobrando?">
                <Sel value={formPago.ticket_id} onChange={e => {
                  const tk = ticketsPendientesProp.find(t => t.id === e.target.value);
                  const saldo = tk ? (tk.charged_amount || 0) - (tk.advance_paid ? (tk.advance_amount || 0) : 0) : "";
                  setFormPago({ ...formPago, ticket_id: e.target.value, monto: saldo ? saldo.toString() : "", property_name: tk?.property_name || "" });
                }}>
                  <option value="">— Selecciona el ticket —</option>
                  {ticketsPendientesProp.map(t => {
                    const saldo = (t.charged_amount || 0) - (t.advance_paid ? (t.advance_amount || 0) : 0);
                    return <option key={t.id} value={t.id}>{t.title} — {t.property_name} — {fmt(saldo)}</option>;
                  })}
                </Sel>
                {ticketsPendientesProp.length === 0 && (
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "#9ca3af" }}>Este propietario no tiene mantenimientos pendientes de cobro.</p>
                )}
              </Field>
            );
          })()}

          <Field label="Propiedad que aplica (opcional — dejar vacío si es pago general)">
            <Sel value={formPago.property_name} onChange={e => setFormPago({ ...formPago, property_name: e.target.value })}>
              <option value="">— Todas las propiedades —</option>
              {properties.filter(p => p.owner_email === propietarioPago.email).map(p => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </Sel>
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Periodo">
              <Input value={formPago.periodo} onChange={e => setFormPago({ ...formPago, periodo: e.target.value })} placeholder="Ej: mayo de 2026" />
            </Field>
            <Field label="Fecha de entrega">
              <Input type="date" value={formPago.fecha} onChange={e => setFormPago({ ...formPago, fecha: e.target.value })} />
            </Field>
          </div>

          <Field label="Forma de pago">
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setFormPago({ ...formPago, forma_pago: "efectivo" })} style={{ flex: 1, padding: "10px 8px", borderRadius: 8, border: `2px solid ${formPago.forma_pago === "efectivo" ? "#b45309" : "#e5e7eb"}`, background: formPago.forma_pago === "efectivo" ? "#fffbeb" : "#fff", color: formPago.forma_pago === "efectivo" ? "#b45309" : "#6b7280", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                💵 Efectivo
              </button>
              <button onClick={() => setFormPago({ ...formPago, forma_pago: "transferencia" })} style={{ flex: 1, padding: "10px 8px", borderRadius: 8, border: `2px solid ${formPago.forma_pago === "transferencia" ? "#1e40af" : "#e5e7eb"}`, background: formPago.forma_pago === "transferencia" ? "#eff6ff" : "#fff", color: formPago.forma_pago === "transferencia" ? "#1e40af" : "#6b7280", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                🏦 Transferencia
              </button>
            </div>
          </Field>

          {formPago.forma_pago === "efectivo" && (
            <Field label="Firma de recibido — propietario">
              <FirmaCanvas canvasRef={canvasRef} onFirma={setFirmaTrazada} />
              {firmaTrazada && (
                <button onClick={limpiarFirma} style={{ marginTop: 6, background: "none", border: "none", color: "#dc2626", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                  ✕ Borrar firma
                </button>
              )}
              {!firmaTrazada && (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "#dc2626", fontWeight: 600 }}>⚠ Se requiere firma para continuar</p>
              )}
            </Field>
          )}

          {formPago.forma_pago === "transferencia" && (
            <Field label="Comprobante de transferencia">
              <div style={{ border: "2px dashed #d1d5db", borderRadius: 8, padding: "16px", textAlign: "center", background: "#fafafa" }}>
                <input type="file" accept="image/*,application/pdf" onChange={e => setArchivoComprobante(e.target.files[0] || null)} style={{ display: "none" }} id="comprobante-input" />
                <label htmlFor="comprobante-input" style={{ cursor: "pointer" }}>
                  {archivoComprobante ? (
                    <div>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#065f46" }}>✓ {archivoComprobante.name}</p>
                      <p style={{ margin: "4px 0 0", fontSize: 11, color: "#6b7280" }}>Clic para cambiar</p>
                    </div>
                  ) : (
                    <div>
                      <p style={{ margin: 0, fontSize: 24 }}>📎</p>
                      <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>Toca para subir el comprobante</p>
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>JPG, PNG o PDF</p>
                    </div>
                  )}
                </label>
              </div>
              {!archivoComprobante && (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "#dc2626", fontWeight: 600 }}>⚠ Se requiere comprobante para continuar</p>
              )}
            </Field>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
            <button onClick={() => { setShowModalPago(false); setFormPago(emptyFormPago); setFirmaTrazada(false); setArchivoComprobante(null); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>
              Cancelar
            </button>
            <Btn onClick={guardarPago} disabled={savingPago || !formPago.monto || (formPago.concepto === "mantenimiento" && !formPago.ticket_id) || (formPago.forma_pago === "efectivo" && !firmaTrazada) || (formPago.forma_pago === "transferencia" && !archivoComprobante)} color="#b45309">
              {savingPago ? "Guardando…" : "Registrar pago y generar recibo"}
            </Btn>
          </div>
        </Modal>
      )}

      {expediente && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex" }}>
          <div onClick={() => setExpediente(null)} style={{ flex: 1, background: "rgba(0,0,0,0.5)" }} />
          <div style={{ width: "100%", maxWidth: 560, background: "#fff", overflowY: "auto", display: "flex", flexDirection: "column", boxShadow: "-4px 0 30px rgba(0,0,0,0.15)" }}>
            <div style={{ background: "#1a1a2e", padding: "20px 24px", position: "sticky", top: 0, zIndex: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1 }}>Expediente</p>
                  <h2 style={{ margin: "4px 0 2px", fontSize: 20, fontWeight: 800, color: "#fff" }}>{expediente.name}</h2>
                  <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{expediente.email}</p>
                </div>
                <button onClick={() => setExpediente(null)} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", color: "#fff", fontSize: 16 }}>✕</button>
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 16, overflowX: "auto" }}>
                {[
                  { id: "resumen", label: "📊 Resumen" },
                  { id: "propiedades", label: "🏠 Propiedades" },
                  { id: "pagos", label: "💰 Pagos" },
                  { id: "liquidaciones", label: "🏦 Liquidaciones" },
                  { id: "comprobantes", label: "📄 Comprobantes" },
                  { id: "mantenimiento", label: "🔧 Mantenimiento" },
                ].map(t => (
                  <button key={t.id} onClick={() => setExpedienteTab(t.id)} style={{ padding: "6px 12px", borderRadius: "6px 6px 0 0", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", background: expedienteTab === t.id ? "#fff" : "rgba(255,255,255,0.1)", color: expedienteTab === t.id ? "#1a1a2e" : "rgba(255,255,255,0.7)" }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ padding: "20px 24px", flex: 1 }}>
              {expedienteLoading ? (
                <div style={{ textAlign: "center", padding: 48, color: "#9ca3af" }}>Cargando expediente…</div>
              ) : expedienteData ? (() => {
                const { propsProp, contratosProp, pagosMes, todosLosPagos, ticketsProp, liqProp, recibosProp } = expedienteData;
                const liquidoMensual = contratosProp.reduce((a, c) => a + (c.monthly_rent || 0) - calcComision(c), 0);
                const pendienteMes = calcPendienteMes(expediente.email);
                const ticketsAbiertos = ticketsProp.filter(t => !["cerrado","resuelto"].includes(t.status));
                const periodosConPagado = new Set(
                  liqProp.filter(l => l.status === "pagado").map(l => l.period_description)
                );
                const totalLiquidado = liqProp.reduce((a, l) => {
                  if (l.status !== "pagado" && periodosConPagado.has(l.period_description)) return a;
                  return a + (l.amount_paid || 0);
                }, 0);
                const conceptoLabel = { adelanto: "Adelanto", parcial: "Pago parcial", total: "Liquidación total", mantenimiento: "Mantenimiento" };

                return (
                  <>
                    {expedienteTab === "resumen" && (
                      <div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
                          {[
                            { label: "Líquido/mes", value: fmt(liquidoMensual), color: "#065f46" },
                            { label: "Pendiente mes", value: fmt(pendienteMes), color: pendienteMes > 0 ? "#b45309" : "#065f46" },
                            { label: "Total liquidado", value: fmt(totalLiquidado), color: "#1e40af" },
                            { label: "Propiedades", value: propsProp.length, color: "#4a4a4a" },
                            { label: "Contratos activos", value: contratosProp.length, color: "#7c3aed" },
                            { label: "Tickets abiertos", value: ticketsAbiertos.length, color: ticketsAbiertos.length > 0 ? "#b91c3c" : "#065f46" },
                          ].map((s, i) => (
                            <div key={i} style={{ background: "#f9fafb", borderRadius: 10, padding: "12px 14px" }}>
                              <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase", fontWeight: 600 }}>{s.label}</p>
                              <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</p>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <Btn small color="#065f46" onClick={() => { setExpediente(null); setTimeout(() => openLiquidar(expediente.name, expediente.email), 100); }}>💳 Liquidar</Btn>
                          <Btn small color="#b45309" onClick={() => { setExpediente(null); setTimeout(() => openModalPago(expediente), 100); }}>💵 Registrar pago</Btn>
                          <Btn small color="#1e40af" onClick={() => descargarPDF(expediente.name, expediente.email, mesCorte)}>📄 Descargar PDF</Btn>
                        </div>
                      </div>
                    )}

                    {expedienteTab === "propiedades" && (
                      <div>
                        {propsProp.length === 0 && <p style={{ color: "#9ca3af" }}>Sin propiedades registradas.</p>}
                        {propsProp.map(prop => {
                          const c = contratosProp.find(c => c.property_name === prop.name);
                          const com = c ? calcComision(c) : 0;
                          const dias = c ? Math.ceil((new Date(c.end_date) - new Date()) / (1000*60*60*24)) : null;
                          return (
                            <div key={prop.id} style={{ background: "#f9fafb", borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                                <div>
                                  <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a1a2e" }}>{prop.name}</p>
                                  {prop.address && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>📍 {prop.address}</p>}
                                </div>
                                <span style={{ fontSize: 20 }}>{prop.property_type === "casa" ? "🏠" : "🏢"}</span>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                                {[
                                  { label: "Renta", value: fmt(prop.rent_amount || c?.monthly_rent || 0), color: "#1a1a2e" },
                                  { label: "Comisión", value: fmt(com), color: "#7c3aed" },
                                  { label: "Líquido", value: fmt((prop.rent_amount || c?.monthly_rent || 0) - com), color: "#065f46" },
                                ].map((s, i) => (
                                  <div key={i} style={{ background: "#fff", borderRadius: 8, padding: "6px 10px" }}>
                                    <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>{s.label}</p>
                                    <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: s.color }}>{s.value}</p>
                                  </div>
                                ))}
                              </div>
                              {c && (
                                <div style={{ background: "#fff", borderRadius: 8, padding: "8px 12px" }}>
                                  <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                                    👤 <strong>{c.tenant_name}</strong> · Día {c.payment_day} · Hasta {c.end_date}
                                    {dias !== null && <span style={{ color: dias <= 30 ? "#b91c3c" : "#9ca3af", fontWeight: 700 }}> ({dias}d)</span>}
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {expedienteTab === "pagos" && (
                      <div>
                        <p style={{ margin: "0 0 12px", fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>
                          Mostrando pagos del periodo {mesCorte} · {pagosMes.length} registro{pagosMes.length !== 1 ? "s" : ""}
                        </p>
                        {pagosMes.length === 0 && <div style={{ background: "#f9fafb", borderRadius: 10, padding: 24, textAlign: "center" }}><p style={{ color: "#9ca3af", margin: 0 }}>Sin pagos en este periodo</p></div>}
                        {pagosMes.map(p => (
                          <div key={p.id} style={{ background: "#f9fafb", borderRadius: 10, padding: "12px 14px", marginBottom: 8, borderLeft: `3px solid ${p.status === "pagado" ? "#065f46" : p.status === "atrasado" ? "#b91c3c" : "#92400e"}` }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                              <div>
                                <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a1a2e" }}>{fmt(p.amount)}</p>
                                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>{p.property_name} · 👤 {p.tenant_name}</p>
                                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>Vence: {p.due_date}</p>
                              </div>
                              <StatusBadge status={p.status} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {expedienteTab === "liquidaciones" && (
                      <div>
                        {liqProp.length === 0 && <div style={{ background: "#f9fafb", borderRadius: 10, padding: 24, textAlign: "center" }}><p style={{ color: "#9ca3af", margin: 0 }}>Sin liquidaciones registradas</p></div>}
                        {liqProp.map(l => (
                          <div key={l.id} style={{ background: "#f9fafb", borderRadius: 10, padding: "12px 14px", marginBottom: 8, borderLeft: `3px solid ${l.status === "pagado" ? "#065f46" : "#92400e"}` }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                              <div>
                                <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1a1a2e" }}>{l.period_description}</p>
                                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>{l.payment_date} · {l.payment_method}</p>
                              </div>
                              <StatusBadge status={l.status} />
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                              {[
                                { label: "Renta", value: fmt(l.total_rent), color: "#1a1a2e" },
                                { label: "Comisión", value: fmt(l.total_commission), color: "#7c3aed" },
                                { label: "Pagado", value: fmt(l.amount_paid), color: "#065f46" },
                              ].map((s, i) => (
                                <div key={i} style={{ background: "#fff", borderRadius: 6, padding: "6px 8px" }}>
                                  <p style={{ margin: 0, fontSize: 9, color: "#9ca3af" }}>{s.label}</p>
                                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: s.color }}>{s.value}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {expedienteTab === "comprobantes" && (
                      <div>
                        {recibosProp.length === 0 && (
                          <div style={{ background: "#f9fafb", borderRadius: 10, padding: 24, textAlign: "center" }}>
                            <p style={{ color: "#9ca3af", margin: 0 }}>Sin comprobantes de entrega aún</p>
                          </div>
                        )}
                        {recibosProp.map(r => (
                          <div key={r.id} style={{ background: "#f9fafb", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                                  <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: "#b91c3c", background: "#fff0f3", padding: "1px 6px", borderRadius: 4 }}>#{r.id.slice(0,8).toUpperCase()}</span>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: r.concepto === "total" ? "#065f46" : "#1e40af", background: r.concepto === "total" ? "#d1fae5" : "#dbeafe", padding: "1px 6px", borderRadius: 99 }}>{conceptoLabel[r.concepto] || r.concepto}</span>
                                  <span style={{ fontSize: 10, color: "#9ca3af" }}>{r.forma_pago === "efectivo" ? "💵" : "🏦"} {r.forma_pago}</span>
                                </div>
                                <p style={{ margin: "0 0 2px", fontWeight: 800, fontSize: 16, color: "#065f46" }}>{fmt(r.monto)}</p>
                                <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{r.fecha} · {r.periodo}{r.property_name ? ` · ${r.property_name}` : ""}</p>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end", marginLeft: 10 }}>
                                <button onClick={() => verReciboExpediente(r)} disabled={descargandoRecibo === r.id} style={{ background: "#b91c3c", color: "#fff", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 700, cursor: descargandoRecibo === r.id ? "not-allowed" : "pointer", opacity: descargandoRecibo === r.id ? 0.6 : 1 }}>
                                  {descargandoRecibo === r.id ? "⏳" : "📄 PDF"}
                                </button>
                                {r.forma_pago === "efectivo" && r.firma_url && (
                                  <a href={r.firma_url} target="_blank" rel="noreferrer" style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 600, color: "#374151", textDecoration: "none" }}>🖊 Firma</a>
                                )}
                                {r.forma_pago === "transferencia" && r.comprobante_url && (
                                  <a href={r.comprobante_url} target="_blank" rel="noreferrer" style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 600, color: "#1e40af", textDecoration: "none" }}>📎 Comp.</a>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {expedienteTab === "mantenimiento" && (
                      <div>
                        {ticketsProp.length === 0 && (
                          <div style={{ background: "#f9fafb", borderRadius: 10, padding: 24, textAlign: "center" }}>
                            <p style={{ fontSize: 24, margin: "0 0 6px" }}>✅</p>
                            <p style={{ color: "#9ca3af", margin: 0 }}>Sin reportes de mantenimiento</p>
                          </div>
                        )}
                        {ticketsProp.map(t => (
                          <div key={t.id} style={{ background: "#f9fafb", borderRadius: 10, padding: "12px 14px", marginBottom: 8, borderLeft: `3px solid ${t.payer === "propietario" ? "#fca5a5" : "#e5e7eb"}` }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                              <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1a1a2e" }}>{t.title}</p>
                              <StatusBadge status={t.status} />
                            </div>
                            <p style={{ margin: "0 0 4px", fontSize: 11, color: "#9ca3af" }}>📍 {t.property_name}</p>
                            {t.description && <p style={{ margin: "0 0 6px", fontSize: 12, color: "#374151" }}>{t.description}</p>}
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 11, background: "#fff", color: "#374151", padding: "2px 8px", borderRadius: 6, border: "1px solid #e5e7eb" }}>Paga: {t.payer}</span>
                              {t.payer === "propietario" && t.charged_amount > 0 && (
                                <span style={{ fontSize: 11, color: "#b91c3c", background: "#fff0f3", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>Cargo: {fmt(t.charged_amount)}</span>
                              )}
                              {t.descontado_de_liquidacion && (
                                <span style={{ fontSize: 11, color: "#065f46", background: "#d1fae5", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>✓ Descontado de liquidación</span>
                              )}
                              <span style={{ fontSize: 11, color: "#9ca3af" }}>{new Date(t.created_at).toLocaleDateString("es-MX")}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })() : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
