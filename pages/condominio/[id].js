import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabase";
import { brand } from "../../components/Layout";

const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n || 0);

const periodoActual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const periodoLabel = (p) => {
  if (!p) return "—";
  const [y, m] = p.split("-");
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
};

const CATEGORIAS = {
  agua:          { label: "Agua",          icon: "💧" },
  luz:           { label: "Luz",           icon: "⚡" },
  limpieza:      { label: "Limpieza",      icon: "🧹" },
  mantenimiento: { label: "Mantenimiento", icon: "🔧" },
  vigilancia:    { label: "Vigilancia",    icon: "👮" },
  jardineria:    { label: "Jardinería",    icon: "🌿" },
  otro:          { label: "Otro",          icon: "📦" },
};

const savePDF = (doc, filename) => {
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) || /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isSafari) {
    const uri = doc.output("datauristring");
    const win = window.open();
    if (win) win.document.write(`<iframe src="${uri}" style="width:100%;height:100%;border:none;" title="${filename}"></iframe>`);
    else { const a = document.createElement("a"); a.href = uri; a.download = filename; a.click(); }
  } else { doc.save(filename); }
};

const Modal = ({ title, onClose, children, wide }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: wide ? 640 : 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
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

const StatusBadge = ({ status }) => {
  const map = {
    pagado:   { bg: "#d1fae5", color: "#065f46", label: "Pagado" },
    pendiente:{ bg: "#fef3c7", color: "#92400e", label: "Pendiente" },
    atrasado: { bg: "#fee2e2", color: "#991b1b", label: "Atrasado" },
    abierto:  { bg: "#fef3c7", color: "#92400e", label: "Abierto" },
    en_proceso:{ bg: "#dbeafe", color: "#1e40af", label: "En proceso" },
    resuelto: { bg: "#d1fae5", color: "#065f46", label: "Resuelto" },
  };
  const s = map[status] || { bg: "#f3f4f6", color: "#374151", label: status };
  return <span style={{ background: s.bg, color: s.color, padding: "2px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{s.label}</span>;
};

export default function CondominioDetalle() {
  const router = useRouter();
  const { id } = router.query;
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState("unidades");
  const [cond, setCond] = useState(null);
  const [unidades, setUnidades] = useState([]);
  const [cuotas, setCuotas] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [periodoVer, setPeriodoVer] = useState(periodoActual());

  // Modales
  const [modalUnidad, setModalUnidad] = useState(null); // null | unidad
  const [modalGasto, setModalGasto] = useState(false);
  const [modalTicket, setModalTicket] = useState(false);
  const [modalCuota, setModalCuota] = useState(null); // cuota seleccionada
  const [archivoComprobante, setArchivoComprobante] = useState(null);
  const [fechaPagoCuota, setFechaPagoCuota] = useState(new Date().toISOString().split("T")[0]);

  const emptyUnidad = { numero: "", piso: "", propietario_nombre: "", propietario_email: "", propietario_telefono: "", residente_nombre: "", residente_email: "", residente_telefono: "", residente_es_propietario: true, notas: "" };
  const [formUnidad, setFormUnidad] = useState(emptyUnidad);

  const emptyGasto = { concepto: "", categoria: "mantenimiento", monto: "", fecha: new Date().toISOString().split("T")[0], notas: "" };
  const [formGasto, setFormGasto] = useState(emptyGasto);

  const emptyTicket = { title: "", description: "", status: "abierto", payer: "condominio", charged_amount: "" };
  const [formTicket, setFormTicket] = useState(emptyTicket);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); });
    return () => subscription.unsubscribe();
  }, []);

  const loadData = async () => {
    if (!id) return;
    setLoading(true);
    const [
      { data: condData },
      { data: unidadesData },
      { data: cuotasData },
      { data: gastosData },
      { data: ticketsData },
    ] = await Promise.all([
      supabase.from("condominios").select("*").eq("id", id).single(),
      supabase.from("unidades_condominio").select("*").eq("condominio_id", id).eq("activo", true).order("numero"),
      supabase.from("cuotas_condominio").select("*, unidades_condominio(numero, propietario_nombre, propietario_email, propietario_telefono)").eq("condominio_id", id).order("periodo", { ascending: false }),
      supabase.from("gastos_condominio").select("*").eq("condominio_id", id).order("fecha", { ascending: false }),
      supabase.from("maintenance_tickets").select("*").eq("condominio_id", id).order("created_at", { ascending: false }),
    ]);
    setCond(condData);
    setUnidades(unidadesData || []);
    setCuotas(cuotasData || []);
    setGastos(gastosData || []);
    setTickets(ticketsData || []);
    setLoading(false);
  };

  useEffect(() => { if (session && id) loadData(); }, [session, id]);

  // ── Cálculos financieros ──────────────────────────────────────────────────
  const cuotasPeriodo = cuotas.filter(q => q.periodo === periodoVer);
  const totalCuotasPeriodo = cuotasPeriodo.reduce((a, q) => a + (q.monto || 0), 0);
  const cobradoPeriodo = cuotasPeriodo.filter(q => q.status === "pagado").reduce((a, q) => a + (q.monto || 0), 0);
  const pendientePeriodo = cuotasPeriodo.filter(q => q.status !== "pagado").reduce((a, q) => a + (q.monto || 0), 0);
  const totalGastos = gastos.filter(g => !g.concepto?.toLowerCase().includes("saldo inicial")).reduce((a, g) => a + (g.monto || 0), 0);
  const totalCobradoHistorico = cuotas.filter(q => q.status === "pagado").reduce((a, q) => a + (q.monto || 0), 0);
  const honorariosAcumulados = gastos.filter(g => g.concepto?.toUpperCase().includes("ADMINISTRACION EMPORIO")).reduce((a, g) => a + (g.monto || 0), 0);
  const saldoInicial = Math.abs(gastos.filter(g => g.concepto?.toLowerCase().includes("saldo inicial")).reduce((a, g) => a + (g.monto || 0), 0));
  const fondoDisponible = totalCobradoHistorico + saldoInicial - totalGastos;

  // ── Guardar unidad ────────────────────────────────────────────────────────
  const guardarUnidad = async () => {
    if (!formUnidad.propietario_nombre.trim()) { showToast("El nombre del propietario es requerido", false); return; }
    setSaving(true);
    const data = {
      condominio_id: id,
      numero: formUnidad.numero,
      piso: parseInt(formUnidad.piso) || null,
      propietario_nombre: formUnidad.propietario_nombre,
      propietario_email: formUnidad.propietario_email || null,
      propietario_telefono: formUnidad.propietario_telefono || null,
      residente_nombre: formUnidad.residente_es_propietario ? null : formUnidad.residente_nombre || null,
      residente_email: formUnidad.residente_es_propietario ? null : formUnidad.residente_email || null,
      residente_telefono: formUnidad.residente_es_propietario ? null : formUnidad.residente_telefono || null,
      residente_es_propietario: formUnidad.residente_es_propietario,
      notas: formUnidad.notas || null,
    };
    if (modalUnidad?.id) {
      await supabase.from("unidades_condominio").update(data).eq("id", modalUnidad.id);
    } else {
      await supabase.from("unidades_condominio").insert([data]);
    }
    setSaving(false);
    setModalUnidad(null);
    showToast(modalUnidad?.id ? "Unidad actualizada" : "Unidad creada");
    loadData();
  };

  // ── Registrar pago de cuota + generar recibo PDF + enviar email ──────────
  const registrarPagoCuota = async () => {
    if (!modalCuota) return;
    setSaving(true);
    let comprobante_url = null;
    if (archivoComprobante) {
      const ext = archivoComprobante.name.split(".").pop();
      const fileName = `cuotas-condominio/${id}_${modalCuota.id}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("documentos").upload(fileName, archivoComprobante, { upsert: true });
      if (!upErr) {
        const { data: urlData } = supabase.storage.from("documentos").getPublicUrl(fileName);
        comprobante_url = urlData?.publicUrl || null;
      }
    }

    // Generar folio
    const folio = `TC-${new Date().getFullYear()}-${String(modalCuota.unidades_condominio?.numero || "").padStart(3, "0")}-${Date.now().toString().slice(-4)}`;

    await supabase.from("cuotas_condominio").update({
      status: "pagado",
      fecha_pago: fechaPagoCuota,
      comprobante_url,
      pagado_por: modalCuota.unidades_condominio?.propietario_nombre || "—",
    }).eq("id", modalCuota.id);

    // Generar PDF con diseño igual al recibo de apartado
    try {
      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "a5", orientation: "portrait" });
      const W = 419, H = 595, M = 32;
      const RED = [185, 28, 60], DARK = [26, 26, 46], GRAY = [120, 120, 120];
      const LGRAY = [247, 247, 247], LINE = [220, 220, 220];
      const fmtMXN = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 }).format(n || 0);
      const periodoLbl = (p) => { if (!p) return "—"; const [y, m] = p.split("-"); return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" }); };

      // TOP BAR
      doc.setFillColor(...RED); doc.rect(0, 0, W, 5, "F");

      // LOGO
      try {
        const logoRes = await fetch("https://www.emporioinmobiliario.com.mx/logo.png");
        const logoBlob = await logoRes.blob();
        const logoB64 = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(logoBlob); });
        doc.addImage(logoB64, "PNG", M, 8, 70, Math.round(70 * (959 / 1801)));
      } catch (e) { /* sin logo */ }

      // TÍTULO
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...DARK);
      doc.text("RECIBO DE CUOTA", M + 78, 18);
      doc.setTextColor(...RED); doc.setFontSize(8);
      doc.text("MANTENIMIENTO DE CONDOMINIO", M + 78, 28);

      // FECHA/FOLIO top right
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...GRAY);
      doc.text("Fecha:", W - M - 100, 16);
      doc.setFont("helvetica", "bold"); doc.setTextColor(...DARK);
      doc.text(fechaPagoCuota, W - M - 72, 16);
      doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
      doc.text("Folio:", W - M - 100, 26);
      doc.setFont("helvetica", "bold"); doc.setTextColor(...RED);
      doc.text(folio, W - M - 72, 26);

      // LÍNEA ROJA
      const divY = 42;
      doc.setDrawColor(...RED); doc.setLineWidth(1.5); doc.line(M, divY, W - M, divY);

      // BARRA FECHA/FOLIO
      let y = divY + 6;
      doc.setFillColor(...LGRAY); doc.rect(M, y, W - 2 * M, 18, "F");
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...GRAY);
      doc.text("Fecha:", M + 6, y + 12); doc.setFont("helvetica", "bold"); doc.setTextColor(...DARK); doc.text(fechaPagoCuota, M + 26, y + 12);
      doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY); doc.text("Lugar:", M + 110, y + 12);
      doc.setFont("helvetica", "bold"); doc.setTextColor(...DARK); doc.text("Puebla, Pue.", M + 132, y + 12);
      doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY); doc.text("Folio:", W - M - 60, y + 12);
      doc.setFont("helvetica", "bold"); doc.setTextColor(...RED); doc.text(folio, W - M - 38, y + 12);
      y += 26;

      // BLOQUE RECEPTOR
      doc.setFillColor(...RED); doc.rect(M, y, 3, 52, "F");
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...GRAY);
      doc.text("Condómino:", M + 8, y + 10);
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...DARK);
      doc.text(modalCuota.unidades_condominio?.propietario_nombre || "—", M + 52, y + 10);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...GRAY);
      doc.text("Condominio:", M + 8, y + 22);
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...DARK);
      doc.text(cond?.nombre || "—", M + 52, y + 22);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...GRAY);
      doc.text("Unidad:", M + 8, y + 34);
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...DARK);
      doc.text(`Depto ${modalCuota.unidades_condominio?.numero || "—"}`, M + 52, y + 34);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...GRAY);
      doc.text("Periodo:", M + 8, y + 46);
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...RED);
      doc.text(periodoLbl(modalCuota.periodo), M + 52, y + 46);
      y += 62;

      // SEPARADOR
      doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 10;

      // MONTO DESTACADO
      doc.setFillColor(...RED); doc.rect(M, y, W - 2 * M, 20, "F");
      doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text("MONTO PAGADO:", M + 8, y + 13);
      doc.setFontSize(12);
      doc.text(fmtMXN(modalCuota.monto), W - M - 8, y + 13, { align: "right" });
      y += 30;

      // DETALLES
      doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
      const detalles = [
        ["Concepto:", "Cuota de mantenimiento mensual"],
        ["Periodo:", periodoLbl(modalCuota.periodo)],
        ["Fecha de pago:", fechaPagoCuota],
        ["Método de pago:", comprobante_url ? "Transferencia / Depósito bancario" : "Efectivo"],
        ["Recibió:", "Emporio Inmobiliario"],
      ];
      detalles.forEach(([label, value], i) => {
        const yy = y + i * 14;
        if (i % 2 === 0) { doc.setFillColor(250, 250, 250); doc.rect(M, yy - 3, W - 2 * M, 14, "F"); }
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...GRAY);
        doc.text(label, M + 6, yy + 8);
        doc.setFont("helvetica", "normal"); doc.setTextColor(...DARK);
        doc.text(value, M + 80, yy + 8);
      });
      y += detalles.length * 14 + 16;

      // SEPARADOR FIRMAS
      doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 10;

      // FIRMAS
      const sigW = 130;
      doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...RED);
      doc.text("Por Emporio Inmobiliario", M, y);

      // Firma de Carlos
      try {
        const { FIRMA_CARLOS_B64 } = await import("../../lib/firmaCarlos");
        doc.addImage(FIRMA_CARLOS_B64, "PNG", M, y + 2, 65, 36);
      } catch (e) { /* sin firma */ }

      doc.setDrawColor(204, 204, 204); doc.setLineWidth(0.8);
      doc.line(M, y + 40, M + sigW, y + 40);
      doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...DARK);
      doc.text("Carlos Nachón — Emporio Inmobiliario", M, y + 48);

      doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...DARK);
      doc.text("Firma y nombre del condómino", W / 2 + 10, y);
      doc.setDrawColor(204, 204, 204);
      doc.line(W / 2 + 10, y + 28, W / 2 + 10 + sigW, y + 28);
      doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...DARK);
      doc.text(modalCuota.unidades_condominio?.propietario_nombre || "—", W / 2 + 10, y + 36);

      // QR
      try {
        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent("https://www.emporioinmobiliario.com.mx/verificar/" + folio)}&size=60&margin=1`;
        const qrRes = await fetch(qrUrl);
        const qrBlob = await qrRes.blob();
        const qrB64 = await new Promise(r => { const fr = new FileReader(); fr.onloadend = () => r(fr.result); fr.readAsDataURL(qrBlob); });
        doc.addImage(qrB64, "PNG", W - M - 44, H - 56, 44, 44);
        doc.setFont("helvetica", "normal"); doc.setFontSize(5.5); doc.setTextColor(...GRAY);
        doc.text("Verificar", W - M - 22, H - 8, { align: "center" });
      } catch (e) { /* sin QR */ }

      // BOTTOM BAR
      doc.setFillColor(...RED); doc.rect(0, H - 5, W, 5, "F");
      doc.setFont("helvetica", "normal"); doc.setFontSize(6); doc.setTextColor(...GRAY);
      doc.text("Emporio Inmobiliario  —  Puebla, México  —  222 257 3237  |  emporioinmobiliario.com.mx", W / 2, H - 9, { align: "center" });

      // Subir PDF al Storage
      let recibo_url = null;
      try {
        const pdfBlob = doc.output("blob");
        const fileName = `${folio}.pdf`;
        const { error: upErr } = await supabase.storage.from("recibos-condominio").upload(fileName, pdfBlob, { contentType: "application/pdf", upsert: true });
        if (!upErr) {
          const { data: urlData } = supabase.storage.from("recibos-condominio").getPublicUrl(fileName);
          recibo_url = urlData?.publicUrl || null;
          // Guardar URL en la cuota
          await supabase.from("cuotas_condominio").update({ recibo_url }).eq("id", modalCuota.id);
        }
      } catch (e) { console.error("Error subiendo PDF:", e); }

      // Enviar por email si hay email registrado
      const emailDestino = modalCuota.unidades_condominio?.propietario_email || modalCuota.unidades_condominio?.residente_email;
      if (emailDestino) {
        const pdfBase64 = doc.output("datauristring").split(",")[1];
        await fetch("/api/enviar-recibo-condominio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emailDestino,
            nombreCondómino: modalCuota.unidades_condominio?.propietario_nombre || "—",
            numeroDepto: modalCuota.unidades_condominio?.numero || "—",
            condominio: cond?.nombre || "Condominio",
            periodo: periodoLbl(modalCuota.periodo),
            monto: fmtMXN(modalCuota.monto),
            fechaPago: fechaPagoCuota,
            folio,
            pdfBase64,
          }),
        });
        showToast("Pago registrado y recibo enviado por email ✉️");
      } else {
        showToast("Pago registrado — sin email para enviar recibo");
      }

      // Descargar PDF (Safari-safe)
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) || /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isSafari) {
        const uri = doc.output("datauristring");
        const win = window.open();
        if (win) win.document.write(`<iframe src="${uri}" style="width:100%;height:100%;border:none;"></iframe>`);
      } else {
        doc.save(`Recibo_${folio}.pdf`);
      }

    } catch (e) {
      console.error("Error generando recibo:", e);
      showToast("Pago registrado (error al generar recibo)", false);
    }

    setSaving(false);
    setModalCuota(null);
    setArchivoComprobante(null);
    setFechaPagoCuota(new Date().toISOString().split("T")[0]);
    loadData();
  };

  // ── Registrar gasto ───────────────────────────────────────────────────────
  const guardarGasto = async () => {
    if (!formGasto.concepto.trim() || !formGasto.monto) { showToast("Concepto y monto son requeridos", false); return; }
    setSaving(true);
    let comprobante_url = null;
    if (archivoComprobante) {
      const ext = archivoComprobante.name.split(".").pop();
      const fileName = `gastos-condominio/${id}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("documentos").upload(fileName, archivoComprobante, { upsert: true });
      if (!upErr) {
        const { data: urlData } = supabase.storage.from("documentos").getPublicUrl(fileName);
        comprobante_url = urlData?.publicUrl || null;
      }
    }
    await supabase.from("gastos_condominio").insert([{
      condominio_id: id,
      concepto: formGasto.concepto,
      categoria: formGasto.categoria,
      monto: parseFloat(formGasto.monto),
      fecha: formGasto.fecha,
      comprobante_url,
      notas: formGasto.notas || null,
    }]);
    setSaving(false);
    setModalGasto(false);
    setFormGasto(emptyGasto);
    setArchivoComprobante(null);
    showToast("Gasto registrado");
    loadData();
  };

  // ── Registrar ticket ──────────────────────────────────────────────────────
  const guardarTicket = async () => {
    if (!formTicket.title.trim()) { showToast("El título es requerido", false); return; }
    setSaving(true);
    await supabase.from("maintenance_tickets").insert([{
      condominio_id: id,
      property_name: cond?.nombre || "",
      title: formTicket.title,
      description: formTicket.description,
      status: formTicket.status,
      payer: formTicket.payer,
      charged_amount: parseFloat(formTicket.charged_amount) || 0,
    }]);
    setSaving(false);
    setModalTicket(false);
    setFormTicket(emptyTicket);
    showToast("Ticket creado");
    loadData();
  };

  // ── PDF estado de cuenta ──────────────────────────────────────────────────
  const generarEstadoCuenta = async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    const hoy = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
    const headStyle = { fillColor: [185, 28, 60], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 };
    const altRow = { fillColor: [249, 250, 251] };

    // Header
    doc.setFillColor(26, 26, 46); doc.rect(0, 0, 210, 38, "F");
    doc.setFillColor(185, 28, 60); doc.rect(0, 38, 210, 4, "F");
    doc.setTextColor(255,255,255); doc.setFontSize(18); doc.setFont("helvetica","bold");
    doc.text("EMPORIO INMOBILIARIO", 20, 16);
    doc.setFontSize(10); doc.setFont("helvetica","normal"); doc.setTextColor(200,200,200);
    doc.text("Estado de Cuenta — Condominio", 20, 24);
    doc.setFontSize(8); doc.text(`Generado: ${hoy}`, 190, 24, { align: "right" });

    doc.setTextColor(26,26,46); doc.setFontSize(15); doc.setFont("helvetica","bold");
    doc.text(cond?.nombre || "Condominio", 20, 55);
    if (cond?.direccion) { doc.setFontSize(9); doc.setFont("helvetica","normal"); doc.setTextColor(122,122,122); doc.text(cond.direccion, 20, 62); }

    let y = 72;

    // Resumen financiero
    doc.setFillColor(248,248,248); doc.rect(15, y, 180, 40, "F");
    doc.setDrawColor(220,220,220); doc.setLineWidth(0.3); doc.rect(15, y, 180, 40, "S");
    doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(122,122,122);
    doc.text("RESUMEN FINANCIERO GLOBAL", 20, y + 8);
    const kpis = [
      [`Total cobrado histórico:`, fmt(totalCobradoHistorico)],
      [`Honorarios Emporio:`, fmt(honorariosAcumulados)],
      [`Total gastos comunes:`, fmt(totalGastos)],
      [`Fondo disponible:`, fmt(Math.max(0, fondoDisponible))],
    ];
    kpis.forEach(([lbl, val], i) => {
      const col = i < 2 ? 0 : 1;
      const row = i % 2;
      const x = col === 0 ? 20 : 110;
      const yy = y + 16 + row * 10;
      doc.setFont("helvetica","normal"); doc.setTextColor(74,74,74); doc.setFontSize(8);
      doc.text(lbl, x, yy);
      doc.setFont("helvetica","bold"); doc.setTextColor(26,26,46);
      doc.text(val, x + 55, yy);
    });
    y += 50;

    // Cuotas por periodo — últimos 6 meses
    doc.setFont("helvetica","bold"); doc.setFontSize(12); doc.setTextColor(26,26,46);
    doc.text("Cobranza por periodo", 20, y); y += 6;
    const periodos = [...new Set(cuotas.map(q => q.periodo))].sort().reverse().slice(0, 6);
    autoTable(doc, {
      startY: y,
      head: [["Periodo", "Total esperado", "Cobrado", "Pendiente", "Morosos"]],
      body: periodos.map(p => {
        const qs = cuotas.filter(q => q.periodo === p);
        const total = qs.reduce((a, q) => a + (q.monto || 0), 0);
        const cobrado = qs.filter(q => q.status === "pagado").reduce((a, q) => a + (q.monto || 0), 0);
        const pendiente = total - cobrado;
        const morosos = qs.filter(q => q.status === "atrasado").length;
        return [periodoLabel(p), fmt(total), fmt(cobrado), fmt(pendiente), morosos > 0 ? `${morosos} unidad${morosos !== 1 ? "es" : ""}` : "—"];
      }),
      styles: { fontSize: 8, cellPadding: 3 }, headStyles: headStyle, alternateRowStyles: altRow, margin: { left: 15, right: 15 },
    });
    y = doc.lastAutoTable.finalY + 12;
    if (y > 220) { doc.addPage(); y = 20; }

    // Unidades con estatus actual
    doc.setFont("helvetica","bold"); doc.setFontSize(12); doc.setTextColor(26,26,46);
    doc.text(`Estado de unidades — ${periodoLabel(periodoVer)}`, 20, y); y += 6;
    autoTable(doc, {
      startY: y,
      head: [["Unidad", "Propietario", "Residente", "Monto", "Estatus", "Fecha pago"]],
      body: unidades.map(u => {
        const cuota = cuotasPeriodo.find(q => q.unidad_id === u.id);
        return [
          u.numero,
          u.propietario_nombre,
          u.residente_es_propietario ? "(mismo)" : (u.residente_nombre || "—"),
          cuota ? fmt(cuota.monto) : fmt(cond?.cuota_mensual || 0),
          cuota ? (cuota.status === "pagado" ? "Pagado" : cuota.status === "atrasado" ? "Atrasado" : "Pendiente") : "Sin cuota",
          cuota?.fecha_pago || "—",
        ];
      }),
      styles: { fontSize: 8, cellPadding: 3 }, headStyles: headStyle, alternateRowStyles: altRow,
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 4) {
          if (data.cell.raw === "Atrasado") data.cell.styles.textColor = [185, 28, 60];
          if (data.cell.raw === "Pagado") data.cell.styles.textColor = [6, 95, 70];
        }
      },
      margin: { left: 15, right: 15 },
    });
    y = doc.lastAutoTable.finalY + 12;
    if (y > 220) { doc.addPage(); y = 20; }

    // Gastos recientes
    if (gastos.length > 0) {
      doc.setFont("helvetica","bold"); doc.setFontSize(12); doc.setTextColor(26,26,46);
      doc.text("Gastos comunes", 20, y); y += 6;
      autoTable(doc, {
        startY: y,
        head: [["Concepto", "Categoría", "Monto", "Fecha"]],
        body: gastos.slice(0, 20).map(g => [g.concepto, CATEGORIAS[g.categoria]?.label || g.categoria, fmt(g.monto), g.fecha]),
        styles: { fontSize: 8, cellPadding: 3 }, headStyles: headStyle, alternateRowStyles: altRow, margin: { left: 15, right: 15 },
      });
    }

    // Footer
    const totalPags = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPags; i++) {
      doc.setPage(i);
      doc.setFillColor(185,28,60); doc.rect(0, 284, 210, 13, "F");
      doc.setTextColor(255,255,255); doc.setFontSize(7); doc.setFont("helvetica","normal");
      doc.text("Emporio Inmobiliario — Puebla, México  ·  222 257 3237  ·  app.emporioinmobiliario.com.mx", 20, 291);
      doc.text(`${i} / ${totalPags}`, 190, 291, { align: "right" });
    }
    savePDF(doc, `EstadoCuenta_${(cond?.nombre || "Condominio").replace(/\s+/g,"_")}_${new Date().toISOString().split("T")[0]}.pdf`);
  };

  if (authLoading || loading) return (
    <div style={{ minHeight: "100vh", background: brand.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#9ca3af" }}>{authLoading ? "" : "Cargando…"}</p>
    </div>
  );
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }
  if (!cond) return <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Condominio no encontrado</div>;

  const TABS = [
    { id: "unidades",       label: "🏠 Unidades" },
    { id: "cobranza",       label: "💰 Cobranza" },
    { id: "gastos",         label: "📤 Gastos" },
    { id: "estado_cuenta",  label: "📊 Estado de cuenta" },
    { id: "mantenimiento",  label: "🔧 Mantenimiento" },
  ];

  const morosos = cuotasPeriodo.filter(q => q.status === "atrasado").length;

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: 320 }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background: "#1a1a2e", padding: "0 0 0 0" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <button onClick={() => router.push("/condominios")} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "rgba(255,255,255,0.6)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12, marginBottom: 8 }}>← Condominios</button>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#fff" }}>{cond.nombre}</h1>
              {cond.direccion && <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>📍 {cond.direccion}</p>}
            </div>
            <div style={{ textAlign: "right" }}>
              {morosos > 0 && <span style={{ background: "#fee2e2", color: "#991b1b", fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 99, display: "block", marginBottom: 8 }}>⚠️ {morosos} moroso{morosos !== 1 ? "s" : ""}</span>}
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.1)", borderRadius: 8, padding: "6px 12px" }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Periodo:</span>
                  <input type="month" value={periodoVer} onChange={e => setPeriodoVer(e.target.value)} style={{ background: "transparent", border: "none", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", outline: "none" }} />
                </div>
                <button onClick={generarEstadoCuenta} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>📄 PDF</button>
              </div>
            </div>
          </div>
          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "8px 14px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", background: tab === t.id ? "#fff" : "rgba(255,255,255,0.1)", color: tab === t.id ? "#1a1a2e" : "rgba(255,255,255,0.7)" }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {/* ── TAB: UNIDADES ── */}
        {tab === "unidades" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>{unidades.length} unidades</h2>
              <button onClick={() => { setFormUnidad(emptyUnidad); setModalUnidad({}); }} style={{ background: brand.red, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>+ Agregar unidad</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {unidades.map(u => {
                const cuotaMes = cuotasPeriodo.find(q => q.unidad_id === u.id);
                return (
                  <div key={u.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", borderLeft: `4px solid ${cuotaMes?.status === "pagado" ? "#065f46" : cuotaMes?.status === "atrasado" ? "#b91c3c" : "#e5e7eb"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div>
                        <span style={{ fontSize: 11, fontWeight: 800, color: "#9ca3af", textTransform: "uppercase" }}>Unidad</span>
                        <h3 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{u.numero}</h3>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {cuotaMes && <StatusBadge status={cuotaMes.status} />}
                        <button onClick={() => { setFormUnidad({ ...u, residente_es_propietario: u.residente_es_propietario ?? true }); setModalUnidad(u); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11 }}>✏️</button>
                      </div>
                    </div>
                    <p style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 700, color: "#374151" }}>👤 {u.propietario_nombre}</p>
                    {u.propietario_email && <p style={{ margin: "0 0 2px", fontSize: 11, color: "#9ca3af" }}>{u.propietario_email}</p>}
                    {u.propietario_telefono && <p style={{ margin: "0 0 6px", fontSize: 11, color: "#9ca3af" }}>📱 {u.propietario_telefono}</p>}
                    {!u.residente_es_propietario && u.residente_nombre && (
                      <div style={{ background: "#eff6ff", borderRadius: 6, padding: "6px 10px", marginTop: 6 }}>
                        <p style={{ margin: 0, fontSize: 11, color: "#1e40af", fontWeight: 600 }}>Residente: {u.residente_nombre}</p>
                        {u.residente_email && <p style={{ margin: "2px 0 0", fontSize: 10, color: "#1e40af" }}>{u.residente_email}</p>}
                      </div>
                    )}
                    {cuotaMes && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: "1px solid #f3f4f6" }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: "#1a1a2e" }}>{fmt(cuotaMes.monto)}</span>
                        {cuotaMes.status !== "pagado" && (
                          <button onClick={() => { setModalCuota(cuotaMes); setArchivoComprobante(null); }} style={{ background: "#065f46", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                            ✓ Registrar pago
                          </button>
                        )}
                        {cuotaMes.status === "pagado" && cuotaMes.comprobante_url && (
                          <a href={cuotaMes.comprobante_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#1e40af", fontWeight: 600 }}>📄 Comprobante</a>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── TAB: COBRANZA ── */}
        {tab === "cobranza" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>Cobranza</h2>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="month" value={periodoVer} onChange={e => setPeriodoVer(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }} />
              </div>
            </div>

            {/* KPIs del periodo */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 20 }}>
              {[
                { label: "Esperado",  value: fmt(totalCuotasPeriodo), color: "#1a1a2e" },
                { label: "Cobrado",   value: fmt(cobradoPeriodo),     color: "#065f46" },
                { label: "Pendiente", value: fmt(pendientePeriodo),   color: pendientePeriodo > 0 ? "#b45309" : "#065f46" },
                { label: "Morosos",   value: morosos,                  color: morosos > 0 ? "#b91c3c" : "#065f46" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase", fontWeight: 600 }}>{s.label}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* ── Sección morosos — todos los meses atrasados ── */}
            {(() => {
              const todasAtrasadas = cuotas.filter(q => q.status === "atrasado");
              if (todasAtrasadas.length === 0) return null;

              // Agrupar por unidad
              const porUnidad = {};
              todasAtrasadas.forEach(q => {
                const uid = q.unidad_id;
                if (!porUnidad[uid]) porUnidad[uid] = { unidad: q.unidades_condominio, cuotas: [] };
                porUnidad[uid].cuotas.push(q);
              });

              const totalAdeudo = todasAtrasadas.reduce((a, q) => a + (q.monto || 0), 0);

              return (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ width: 4, height: 20, background: "#b91c3c", borderRadius: 2 }} />
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#b91c3c" }}>
                      ⚠️ Adeudos históricos — {todasAtrasadas.length} mes{todasAtrasadas.length !== 1 ? "es" : ""} sin pagar · {fmt(totalAdeudo)} total
                    </h3>
                  </div>
                  {Object.values(porUnidad).map(({ unidad, cuotas: cs }) => {
                    const totalUnidad = cs.reduce((a, q) => a + (q.monto || 0), 0);
                    const tel = (unidad?.propietario_telefono || "").replace(/\D/g, "");
                    const mesesTexto = cs.sort((a, b) => a.periodo.localeCompare(b.periodo)).map(q => periodoLabel(q.periodo)).join(", ");
                    const msgWA = encodeURIComponent(
                      `Hola ${unidad?.propietario_nombre?.split(" ")[0] || ""}, te contactamos de Emporio Inmobiliario respecto al condominio ${cond?.nombre || ""}.\n\nTienes ${cs.length} mes${cs.length !== 1 ? "es" : ""} de cuota de mantenimiento pendiente${cs.length !== 1 ? "s" : ""} (${mesesTexto}) por un total de ${fmt(totalUnidad)}.\n\nPor favor regulariza tu situación a la brevedad. Quedamos en contacto.`
                    );
                    return (
                      <div key={unidad?.numero} style={{ background: "#fff", borderRadius: 12, overflow: "hidden", marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", border: "1px solid #fca5a5" }}>
                        {/* Header unidad */}
                        <div style={{ background: "#fff5f5", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                          <div>
                            <span style={{ fontWeight: 800, fontSize: 14, color: "#b91c3c" }}>Depto {unidad?.numero}</span>
                            <span style={{ fontSize: 13, color: "#6b7280", marginLeft: 10 }}>{unidad?.propietario_nombre}</span>
                            {tel && <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 8 }}>📱 {unidad?.propietario_telefono}</span>}
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <div style={{ textAlign: "right" }}>
                              <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{cs.length} mes{cs.length !== 1 ? "es" : ""} atrasado{cs.length !== 1 ? "s" : ""}</p>
                              <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#b91c3c" }}>{fmt(totalUnidad)}</p>
                            </div>
                            {tel && (
                              <a
                                href={`https://wa.me/52${tel}?text=${msgWA}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ background: "#25D366", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}
                              >
                                📲 WhatsApp
                              </a>
                            )}
                          </div>
                        </div>
                        {/* Lista de meses atrasados */}
                        <div style={{ padding: "8px 16px" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingBottom: 8 }}>
                            {cs.sort((a, b) => a.periodo.localeCompare(b.periodo)).map(q => (
                              <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff5f5", border: "1px solid #fca5a5", borderRadius: 8, padding: "4px 10px" }}>
                                <span style={{ fontSize: 12, color: "#b91c3c", fontWeight: 600 }}>{periodoLabel(q.periodo)}</span>
                                <span style={{ fontSize: 12, color: "#6b7280" }}>{fmt(q.monto)}</span>
                                <button onClick={() => { setModalCuota(q); setArchivoComprobante(null); }} style={{ background: "#065f46", color: "#fff", border: "none", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 10, fontWeight: 700 }}>✓</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Tabla de cuotas del periodo */}
            <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>Cuotas de {periodoLabel(periodoVer)}</h3>
            {cuotasPeriodo.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 12, padding: 32, textAlign: "center" }}>
                <p style={{ color: "#9ca3af" }}>No hay cuotas generadas para {periodoLabel(periodoVer)}</p>
                <p style={{ color: "#9ca3af", fontSize: 12 }}>Ve a la pantalla principal de condominios y usa "Generar cuotas del mes"</p>
              </div>
            ) : (
              <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {["Unidad", "Propietario", "Monto", "Vencimiento", "Estatus", "Fecha pago", "Comprobante", ""].map(h => (
                        <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cuotasPeriodo.map(q => (
                      <tr key={q.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "10px 12px", fontWeight: 800, color: "#1a1a2e" }}>{q.unidades_condominio?.numero || "—"}</td>
                        <td style={{ padding: "10px 12px", fontSize: 13 }}>{q.unidades_condominio?.propietario_nombre || "—"}</td>
                        <td style={{ padding: "10px 12px", fontWeight: 700 }}>{fmt(q.monto)}</td>
                        <td style={{ padding: "10px 12px", fontSize: 12, color: "#6b7280" }}>{q.fecha_vencimiento || "—"}</td>
                        <td style={{ padding: "10px 12px" }}><StatusBadge status={q.status} /></td>
                        <td style={{ padding: "10px 12px", fontSize: 12, color: "#6b7280" }}>{q.fecha_pago || "—"}</td>
                        <td style={{ padding: "10px 12px" }}>
                          {q.comprobante_url
                            ? <a href={q.comprobante_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#1e40af", fontWeight: 600 }}>Ver</a>
                            : q.status === "pagado"
                              ? <label style={{ cursor: "pointer" }}>
                                  <input type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={async e => {
                                    const file = e.target.files[0];
                                    if (!file) return;
                                    const ext = file.name.split(".").pop();
                                    const fileName = `cuotas-condominio/${id}_${q.id}_${Date.now()}.${ext}`;
                                    const { error: upErr } = await supabase.storage.from("documentos").upload(fileName, file, { upsert: true });
                                    if (!upErr) {
                                      const { data: urlData } = supabase.storage.from("documentos").getPublicUrl(fileName);
                                      await supabase.from("cuotas_condominio").update({ comprobante_url: urlData.publicUrl }).eq("id", q.id);
                                      showToast("Comprobante guardado");
                                      loadData();
                                    } else { showToast("Error al subir", false); }
                                  }} />
                                  <span style={{ fontSize: 12, color: "#1e40af", fontWeight: 600, cursor: "pointer" }}>📎 Agregar</span>
                                </label>
                              : <span style={{ color: "#d1d5db", fontSize: 12 }}>—</span>
                          }
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          {q.status !== "pagado" && (
                            <button onClick={() => { setModalCuota(q); setArchivoComprobante(null); }} style={{ background: "#065f46", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>✓ Pago</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: GASTOS ── */}
        {tab === "gastos" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>Gastos comunes</h2>
              <button onClick={() => { setFormGasto(emptyGasto); setArchivoComprobante(null); setModalGasto(true); }} style={{ background: brand.red, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>+ Registrar gasto</button>
            </div>

            {/* Saldo inicial separado */}
            {(() => {
              const saldoInicial = gastos.find(g => g.concepto?.toLowerCase().includes("saldo inicial"));
              if (!saldoInicial) return null;
              return (
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#1e40af" }}>📌 Saldo inicial al arrancar el sistema</p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "#6b7280" }}>{saldoInicial.fecha} · {saldoInicial.notas}</p>
                  </div>
                  <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#065f46" }}>{fmt(Math.abs(saldoInicial.monto))}</p>
                </div>
              );
            })()}

            {/* KPIs de gastos reales (excluye saldo inicial) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 20 }}>
              {Object.entries(CATEGORIAS).map(([key, { label, icon }]) => {
                const total = gastos.filter(g => !g.concepto?.toLowerCase().includes("saldo inicial") && g.categoria === key).reduce((a, g) => a + (g.monto || 0), 0);
                if (total === 0) return null;
                return (
                  <div key={key} style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                    <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{icon} {label}</p>
                    <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 800, color: "#7c3aed" }}>{fmt(total)}</p>
                  </div>
                );
              }).filter(Boolean)}
              <div style={{ background: "#1a1a2e", borderRadius: 12, padding: "12px 14px" }}>
                <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Total gastos</p>
                <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 800, color: "#fff" }}>{fmt(gastos.filter(g => !g.concepto?.toLowerCase().includes("saldo inicial")).reduce((a, g) => a + (g.monto || 0), 0))}</p>
              </div>
            </div>

            {/* Tabla de gastos reales (excluye saldo inicial, filtra por periodo) */}
            {(() => {
              const gastosFiltrados = gastos.filter(g =>
                !g.concepto?.toLowerCase().includes("saldo inicial") &&
                g.fecha && g.fecha.startsWith(periodoVer)
              );
              return gastosFiltrados.length === 0 ? (
                <div style={{ background: "#fff", borderRadius: 12, padding: 32, textAlign: "center" }}>
                  <p style={{ color: "#9ca3af" }}>Sin gastos en {periodoLabel(periodoVer)}</p>
                </div>
              ) : (
                <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f9fafb" }}>
                        {["Concepto", "Categoría", "Monto", "Fecha", "Comprobante", ""].map(h => (
                          <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {gastosFiltrados.map(g => (
                        <tr key={g.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 600, fontSize: 13 }}>{g.concepto}</td>
                          <td style={{ padding: "10px 12px", fontSize: 12, color: "#6b7280" }}>{CATEGORIAS[g.categoria]?.icon} {CATEGORIAS[g.categoria]?.label || g.categoria}</td>
                          <td style={{ padding: "10px 12px", fontWeight: 700, color: "#7c3aed" }}>{fmt(g.monto)}</td>
                          <td style={{ padding: "10px 12px", fontSize: 12, color: "#6b7280" }}>{g.fecha}</td>
                          <td style={{ padding: "10px 12px" }}>
                            {g.comprobante_url
                              ? <a href={g.comprobante_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#1e40af", fontWeight: 600 }}>📄 Ver</a>
                              : <span style={{ color: "#d1d5db", fontSize: 12 }}>—</span>
                            }
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <button onClick={async () => { if (confirm("¿Eliminar este gasto?")) { await supabase.from("gastos_condominio").delete().eq("id", g.id); showToast("Gasto eliminado"); loadData(); } }} style={{ background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── TAB: ESTADO DE CUENTA ── */}
        {tab === "estado_cuenta" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>Estado de cuenta general</h2>
              <button onClick={generarEstadoCuenta} style={{ background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>📄 Descargar PDF</button>
            </div>

            {/* Resumen global */}
            <div style={{ background: "#1a1a2e", borderRadius: 14, padding: "20px 24px", marginBottom: 20 }}>
              <p style={{ margin: "0 0 16px", fontSize: 12, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", fontWeight: 600 }}>Resumen financiero global</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                {[
                  { label: "Total cobrado", value: fmt(totalCobradoHistorico), color: "#4ade80" },
                  { label: "Honorarios Emporio", value: fmt(honorariosAcumulados), color: "#fb923c" },
                  { label: "Total gastos", value: fmt(totalGastos), color: "#f87171" },
                  { label: "Fondo disponible", value: fmt(Math.max(0, fondoDisponible)), color: fondoDisponible >= 0 ? "#4ade80" : "#f87171" },
                ].map((s, i) => (
                  <div key={i} style={{ background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "12px 14px" }}>
                    <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>{s.label}</p>
                    <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Resumen por periodo seleccionado */}
            <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>Detalle de {periodoLabel(periodoVer)}</h3>
            {(() => {
              const ingPeriodo = cuotas.filter(q => q.status === "pagado" && q.periodo === periodoVer).reduce((a, q) => a + (q.monto || 0), 0);
              const gastPeriodo = gastos.filter(g => !g.concepto?.toLowerCase().includes("saldo inicial") && g.fecha?.startsWith(periodoVer)).reduce((a, g) => a + (g.monto || 0), 0);
              const ticketsPeriodo = tickets.filter(t => { if (!t.created_at) return false; const d = new Date(t.created_at); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}` === periodoVer; });
              const costoMant = ticketsPeriodo.filter(t => t.charged_amount > 0).reduce((a, t) => a + (t.charged_amount || 0), 0);
              return (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 20 }}>
                  {[
                    { label: "Ingresos del mes",  value: fmt(ingPeriodo),   color: "#4ade80", show: true },
                    { label: "Gastos del mes",    value: fmt(gastPeriodo),  color: "#f87171", show: true },
                    { label: "Mantenimiento",     value: fmt(costoMant),    color: "#fb923c", show: costoMant > 0 },
                    { label: "Balance del mes",   value: fmt(ingPeriodo - gastPeriodo - costoMant), color: (ingPeriodo - gastPeriodo - costoMant) >= 0 ? "#4ade80" : "#f87171", show: true },
                  ].filter(s => s.show).map((s, i) => (
                    <div key={i} style={{ background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "12px 14px" }}>
                      <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>{s.label}</p>
                      <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</p>
                    </div>
                  ))}
                </div>
              );
            })()}
            <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", marginBottom: 20 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    {["Periodo", "Esperado", "Cobrado", "Pendiente", "Morosos", "Progreso"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...new Set(cuotas.map(q => q.periodo))].sort().reverse().map(p => {
                    const qs = cuotas.filter(q => q.periodo === p);
                    const total = qs.reduce((a, q) => a + (q.monto || 0), 0);
                    const cobrado = qs.filter(q => q.status === "pagado").reduce((a, q) => a + (q.monto || 0), 0);
                    const pendiente = total - cobrado;
                    const morososP = qs.filter(q => q.status === "atrasado").length;
                    const pct = total > 0 ? Math.round((cobrado / total) * 100) : 0;
                    return (
                      <tr key={p} style={{ borderTop: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "10px 12px", fontWeight: 600 }}>{periodoLabel(p)}</td>
                        <td style={{ padding: "10px 12px" }}>{fmt(total)}</td>
                        <td style={{ padding: "10px 12px", color: "#065f46", fontWeight: 700 }}>{fmt(cobrado)}</td>
                        <td style={{ padding: "10px 12px", color: pendiente > 0 ? "#b45309" : "#065f46", fontWeight: 700 }}>{fmt(pendiente)}</td>
                        <td style={{ padding: "10px 12px" }}>
                          {morososP > 0 ? <span style={{ color: "#b91c3c", fontWeight: 700 }}>{morososP}</span> : <span style={{ color: "#065f46" }}>—</span>}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ background: "#e5e7eb", borderRadius: 99, height: 6, width: 80, overflow: "hidden" }}>
                              <div style={{ background: pct === 100 ? "#065f46" : "#b91c3c", height: "100%", width: `${pct}%`, borderRadius: 99 }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: pct === 100 ? "#065f46" : "#b45309" }}>{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Gastos por categoría */}
            <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>Gastos por categoría</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
              {Object.entries(CATEGORIAS).map(([key, { label, icon }]) => {
                const total = gastos.filter(g => !g.concepto?.toLowerCase().includes("saldo inicial") && g.categoria === key).reduce((a, g) => a + (g.monto || 0), 0);
                if (total === 0) return null;
                return (
                  <div key={key} style={{ background: "#fff", borderRadius: 10, padding: "12px 14px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                    <p style={{ margin: 0, fontSize: 20 }}>{icon}</p>
                    <p style={{ margin: "4px 0 2px", fontSize: 12, color: "#6b7280" }}>{label}</p>
                    <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#7c3aed" }}>{fmt(total)}</p>
                  </div>
                );
              }).filter(Boolean)}
            </div>
          </div>
        )}

        {/* ── TAB: MANTENIMIENTO ── */}
        {tab === "mantenimiento" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>Tickets de mantenimiento</h2>
              <button onClick={() => { setFormTicket(emptyTicket); setModalTicket(true); }} style={{ background: brand.red, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>+ Nuevo ticket</button>
            </div>
            {(() => {
              const ticketsFiltrados = tickets.filter(t => {
                if (!t.created_at) return false;
                const d = new Date(t.created_at);
                const tp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                return tp === periodoVer;
              });
              const hayFiltro = ticketsFiltrados.length !== tickets.length;
              return (
                <>
                  {hayFiltro && tickets.length > 0 && (
                    <p style={{ margin: "0 0 12px", fontSize: 12, color: "#9ca3af" }}>
                      Mostrando {ticketsFiltrados.length} ticket{ticketsFiltrados.length !== 1 ? "s" : ""} de {periodoLabel(periodoVer)} · <button onClick={() => setPeriodoVer("")} style={{ background: "none", border: "none", color: "#1e40af", cursor: "pointer", fontSize: 12, padding: 0 }}>Ver todos</button>
                    </p>
                  )}
                  {ticketsFiltrados.length === 0 ? (
                    <div style={{ background: "#fff", borderRadius: 12, padding: 48, textAlign: "center" }}>
                      <p style={{ fontSize: 32, margin: "0 0 8px" }}>✅</p>
                      <p style={{ color: "#9ca3af" }}>Sin tickets en {periodoLabel(periodoVer)}</p>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {ticketsFiltrados.map(t => (
                        <div key={t.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", borderLeft: `4px solid ${t.status === "resuelto" ? "#065f46" : t.status === "en_proceso" ? "#1e40af" : "#b91c3c"}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>{t.title}</h4>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <StatusBadge status={t.status} />
                              <select value={t.status} onChange={async e => { await supabase.from("maintenance_tickets").update({ status: e.target.value }).eq("id", t.id); loadData(); }} style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
                                <option value="abierto">Abierto</option>
                                <option value="en_proceso">En proceso</option>
                                <option value="resuelto">Resuelto</option>
                              </select>
                            </div>
                          </div>
                          {t.description && <p style={{ margin: "0 0 6px", fontSize: 13, color: "#374151" }}>{t.description}</p>}
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 11, background: "#f3f4f6", color: "#374151", padding: "2px 8px", borderRadius: 6 }}>Paga: {t.payer}</span>
                            {t.charged_amount > 0 && <span style={{ fontSize: 11, color: "#7c3aed", background: "#faf5ff", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>Costo: {fmt(t.charged_amount)}</span>}
                            <span style={{ fontSize: 11, color: "#9ca3af" }}>{new Date(t.created_at).toLocaleDateString("es-MX")}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── Modal editar unidad ── */}
      {modalUnidad !== null && (
        <Modal title={modalUnidad?.id ? `Editar unidad ${modalUnidad.numero}` : "Nueva unidad"} onClose={() => setModalUnidad(null)} wide>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Número/ID unidad"><Input value={formUnidad.numero} onChange={e => setFormUnidad({ ...formUnidad, numero: e.target.value })} placeholder="101, A, Depa 1…" /></Field>
            <Field label="Piso (opcional)"><Input type="number" value={formUnidad.piso} onChange={e => setFormUnidad({ ...formUnidad, piso: e.target.value })} /></Field>
          </div>
          <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "#374151" }}>Propietario</p>
          <Field label="Nombre *"><Input value={formUnidad.propietario_nombre} onChange={e => setFormUnidad({ ...formUnidad, propietario_nombre: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Email"><Input type="email" value={formUnidad.propietario_email} onChange={e => setFormUnidad({ ...formUnidad, propietario_email: e.target.value })} /></Field>
            <Field label="Teléfono"><Input value={formUnidad.propietario_telefono} onChange={e => setFormUnidad({ ...formUnidad, propietario_telefono: e.target.value })} /></Field>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <button onClick={() => setFormUnidad({ ...formUnidad, residente_es_propietario: true })} style={{ flex: 1, padding: 10, borderRadius: 8, border: `2px solid ${formUnidad.residente_es_propietario ? "#065f46" : "#e5e7eb"}`, background: formUnidad.residente_es_propietario ? "#f0fdf4" : "#fff", color: formUnidad.residente_es_propietario ? "#065f46" : "#6b7280", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
              El propietario vive aquí
            </button>
            <button onClick={() => setFormUnidad({ ...formUnidad, residente_es_propietario: false })} style={{ flex: 1, padding: 10, borderRadius: 8, border: `2px solid ${!formUnidad.residente_es_propietario ? "#1e40af" : "#e5e7eb"}`, background: !formUnidad.residente_es_propietario ? "#eff6ff" : "#fff", color: !formUnidad.residente_es_propietario ? "#1e40af" : "#6b7280", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
              Tiene inquilino/residente
            </button>
          </div>
          {!formUnidad.residente_es_propietario && (
            <div style={{ background: "#eff6ff", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
              <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "#1e40af" }}>Residente</p>
              <Field label="Nombre"><Input value={formUnidad.residente_nombre} onChange={e => setFormUnidad({ ...formUnidad, residente_nombre: e.target.value })} /></Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Email"><Input type="email" value={formUnidad.residente_email} onChange={e => setFormUnidad({ ...formUnidad, residente_email: e.target.value })} /></Field>
                <Field label="Teléfono"><Input value={formUnidad.residente_telefono} onChange={e => setFormUnidad({ ...formUnidad, residente_telefono: e.target.value })} /></Field>
              </div>
            </div>
          )}
          <Field label="Notas"><Input value={formUnidad.notas} onChange={e => setFormUnidad({ ...formUnidad, notas: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => setModalUnidad(null)} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={guardarUnidad} disabled={saving || !formUnidad.propietario_nombre.trim()} color={brand.red}>{saving ? "Guardando…" : "Guardar"}</Btn>
          </div>
        </Modal>
      )}

      {/* ── Modal registrar pago de cuota ── */}
      {modalCuota && (
        <Modal title={`Registrar pago — Unidad ${modalCuota.unidades_condominio?.numero || ""}`} onClose={() => { setModalCuota(null); setArchivoComprobante(null); setFechaPagoCuota(new Date().toISOString().split("T")[0]); }}>
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 0 }}>
            Propietario: <strong>{modalCuota.unidades_condominio?.propietario_nombre || "—"}</strong><br />
            Periodo: <strong>{periodoLabel(modalCuota.periodo)}</strong><br />
            Monto: <strong>{fmt(modalCuota.monto)}</strong>
          </p>
          <Field label="Fecha de pago">
            <Input type="date" value={fechaPagoCuota} onChange={e => setFechaPagoCuota(e.target.value)} />
          </Field>
          <Field label="Comprobante de pago (opcional)">
            <div style={{ border: "2px dashed #d1d5db", borderRadius: 8, padding: 16, textAlign: "center", background: "#fafafa" }}>
              <input type="file" accept="image/*,application/pdf" id="comp-cuota" style={{ display: "none" }} onChange={e => setArchivoComprobante(e.target.files[0] || null)} />
              <label htmlFor="comp-cuota" style={{ cursor: "pointer" }}>
                {archivoComprobante
                  ? <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#065f46" }}>✓ {archivoComprobante.name}</p>
                  : <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>📎 Subir comprobante</p>
                }
              </label>
            </div>
          </Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={() => { setModalCuota(null); setArchivoComprobante(null); setFechaPagoCuota(new Date().toISOString().split("T")[0]); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={registrarPagoCuota} disabled={saving} color="#065f46">{saving ? "Guardando…" : "✓ Confirmar pago"}</Btn>
          </div>
        </Modal>
      )}

      {/* ── Modal registrar gasto ── */}
      {modalGasto && (
        <Modal title="Registrar gasto común" onClose={() => { setModalGasto(false); setArchivoComprobante(null); }}>
          <Field label="Concepto *"><Input value={formGasto.concepto} onChange={e => setFormGasto({ ...formGasto, concepto: e.target.value })} placeholder="Ej: Pago de agua abril, Mantenimiento elevador…" /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Categoría">
              <Sel value={formGasto.categoria} onChange={e => setFormGasto({ ...formGasto, categoria: e.target.value })}>
                {Object.entries(CATEGORIAS).map(([k, { label, icon }]) => <option key={k} value={k}>{icon} {label}</option>)}
              </Sel>
            </Field>
            <Field label="Monto *"><Input type="number" value={formGasto.monto} onChange={e => setFormGasto({ ...formGasto, monto: e.target.value })} placeholder="0" /></Field>
          </div>
          <Field label="Fecha"><Input type="date" value={formGasto.fecha} onChange={e => setFormGasto({ ...formGasto, fecha: e.target.value })} /></Field>
          <Field label="Comprobante (opcional)">
            <div style={{ border: "2px dashed #d1d5db", borderRadius: 8, padding: 14, textAlign: "center", background: "#fafafa" }}>
              <input type="file" accept="image/*,application/pdf" id="comp-gasto" style={{ display: "none" }} onChange={e => setArchivoComprobante(e.target.files[0] || null)} />
              <label htmlFor="comp-gasto" style={{ cursor: "pointer" }}>
                {archivoComprobante
                  ? <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#065f46" }}>✓ {archivoComprobante.name}</p>
                  : <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>📎 Subir comprobante</p>
                }
              </label>
            </div>
          </Field>
          <Field label="Notas"><Input value={formGasto.notas} onChange={e => setFormGasto({ ...formGasto, notas: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={() => { setModalGasto(false); setArchivoComprobante(null); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={guardarGasto} disabled={saving || !formGasto.concepto.trim() || !formGasto.monto} color={brand.red}>{saving ? "Guardando…" : "Registrar gasto"}</Btn>
          </div>
        </Modal>
      )}

      {/* ── Modal nuevo ticket ── */}
      {modalTicket && (
        <Modal title="Nuevo ticket de mantenimiento" onClose={() => setModalTicket(false)}>
          <Field label="Título *"><Input value={formTicket.title} onChange={e => setFormTicket({ ...formTicket, title: e.target.value })} placeholder="Ej: Fuga de agua en área común, Falla en elevador…" /></Field>
          <Field label="Descripción">
            <textarea value={formTicket.description} onChange={e => setFormTicket({ ...formTicket, description: e.target.value })} rows={3} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", resize: "vertical" }} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Quién paga">
              <Sel value={formTicket.payer} onChange={e => setFormTicket({ ...formTicket, payer: e.target.value })}>
                <option value="condominio">Fondo del condominio</option>
                <option value="propietario">Propietario específico</option>
                <option value="emporio">Emporio</option>
              </Sel>
            </Field>
            <Field label="Costo estimado"><Input type="number" value={formTicket.charged_amount} onChange={e => setFormTicket({ ...formTicket, charged_amount: e.target.value })} placeholder="0" /></Field>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={() => setModalTicket(false)} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={guardarTicket} disabled={saving || !formTicket.title.trim()} color={brand.red}>{saving ? "Guardando…" : "Crear ticket"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
