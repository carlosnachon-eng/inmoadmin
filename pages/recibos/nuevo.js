import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabase";
import { PageHeader, brand } from "../../components/Layout";
import jsPDF from "jspdf";
import { FIRMA_CARLOS_B64 } from "../../lib/firmaCarlos";

const Field = ({ label, children, half }) => (
  <div style={{ marginBottom: 14, flex: half ? "0 0 calc(50% - 6px)" : "1 1 100%" }}>
    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
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

const fmt = (n) => "$" + Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2 });

// ── Generador PDF ──────────────────────────────────────────────────────────
async function generarPDF(data) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = 612, H = 792, M = 42;
  const RED = [185, 28, 60], DARK = [26, 26, 46], GRAY = [120, 120, 120];
  const LGRAY = [247, 247, 247], LRED = [253, 240, 241], LINE = [220, 220, 220];
  const fmtMXN = (n) => "$" + Number(n).toLocaleString("es-MX", {minimumFractionDigits:2});

  const wrapText = (text, x, y, maxW, lh, size) => {
    doc.setFontSize(size);
    const words = text.split(" ");
    let line = "", cy = y;
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (doc.getTextWidth(test) <= maxW) { line = test; }
      else { doc.text(line, x, cy); cy += lh; line = w; }
    }
    if (line) { doc.text(line, x, cy); cy += lh; }
    return cy;
  };

  // TOP BAR
  doc.setFillColor(...RED); doc.rect(0, 0, W, 6, "F");

  // LOGO
  const logoW = 110, logoH = Math.round(110*(959/1801));
  try {
    const res = await fetch("https://www.emporioinmobiliario.com.mx/logo.png");
    const blob = await res.blob();
    const b64 = await new Promise(r => { const fr = new FileReader(); fr.onloadend = () => r(fr.result); fr.readAsDataURL(blob); });
    doc.addImage(b64, "PNG", M, 10, logoW, logoH);
  } catch(_) {}

  // TÍTULO
  const tx = M + logoW + 18;
  const logoMid = 10 + logoH/2;
  doc.setFont("helvetica","bold"); doc.setFontSize(14); doc.setTextColor(...DARK);
  doc.text("RECIBO DE APARTADO", tx, logoMid - 2);
  doc.setTextColor(...RED);
  doc.text(data.tipo === "compraventa" ? "COMPRAVENTA" : "ARRENDAMIENTO", tx, logoMid + 14);

  // FECHA/FOLIO top right - right aligned
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text("Fecha:", W-M-148, 22);
  doc.setFont("helvetica","bold"); doc.setTextColor(...DARK);
  doc.text(data.fecha, W-M-116, 22);
  doc.setFont("helvetica","normal"); doc.setTextColor(...GRAY);
  doc.text("Folio:", W-M-148, 34);
  doc.setFont("helvetica","bold"); doc.setTextColor(...RED);
  doc.text(data.folio, W-M-116, 34);

  // LÍNEA ROJA
  const divY = 10 + logoH + 8;
  doc.setDrawColor(...RED); doc.setLineWidth(2); doc.line(M, divY, W-M, divY);

  // BARRA FECHA/FOLIO
  let y = divY + 8;
  doc.setFillColor(...LGRAY); doc.rect(M, y, W-2*M, 22, "F");
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text("Fecha:", M+8, y+14); doc.setFont("helvetica","bold"); doc.setTextColor(...DARK); doc.text(data.fecha, M+35, y+14);
  doc.setFont("helvetica","normal"); doc.setTextColor(...GRAY); doc.text("Lugar:", M+170, y+14);
  doc.setFont("helvetica","bold"); doc.setTextColor(...DARK); doc.text("Puebla, Pue.", M+197, y+14);
  doc.setFont("helvetica","normal"); doc.setTextColor(...GRAY); doc.text("Folio:", W-M-80, y+14);
  doc.setFont("helvetica","bold"); doc.setTextColor(...RED); doc.text(data.folio, W-M-52, y+14);
  y += 30;

  // BLOQUE RECEPTOR
  doc.setFillColor(...RED); doc.rect(M, y, 4, 58, "F");
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text("Recibí de:", M+12, y+12);
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...DARK);
  doc.text(data.cliente_nombre, M+55, y+12);
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text("La cantidad de:", M+12, y+26);
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...RED);
  doc.text(fmtMXN(data.monto), M+75, y+26);
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text("Por concepto de:", M+12, y+40);
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...DARK);
  doc.text("APARTADO para la posible "+(data.tipo==="compraventa"?"compraventa":"arrendamiento")+" del inmueble ubicado en:", M+78, y+40);
  doc.setFont("helvetica","bold"); doc.setFontSize(8);
  doc.text(data.inmueble, M+12, y+54);
  y += 68;

  // SEPARADOR
  doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(M, y, W-M, y); y += 14;

  // CONDICIONES TÍTULO
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...RED);
  doc.text("CONDICIONES DEL APARTADO", M, y); y += 16;

  const fechaLimite = data.fecha_limite_firma
    ? new Date(data.fecha_limite_firma + "T12:00:00").toLocaleDateString("es-MX",{day:"numeric",month:"long",year:"numeric"})
    : "_______________";

  const clausulas = data.tipo === "compraventa" ? [
    ["1. Carácter de intermediación.","Emporio Inmobiliario actúa única y exclusivamente como intermediario inmobiliario entre las partes. El inmueble no es propiedad de Emporio Inmobiliario; la decisión final de venta corresponde al propietario."],
    ["2. Naturaleza del apartado.","El presente apartado no constituye contrato de compraventa, promesa de compraventa ni obliga a la transmisión del dominio. Su finalidad es manifestar el interés del comprador y reservar temporalmente el inmueble."],
    ["3. Vigencia del apartado.","El apartado tendrá una vigencia de "+data.vigencia_dias+" días naturales contados a partir de la fecha de firma del presente recibo."],
    ["4. Plazo para firma de promesa de compraventa.","El comprador se compromete a firmar la promesa de compraventa dentro de un plazo máximo de "+data.vigencia_dias+" días naturales. En caso de incumplimiento por causas imputables al comprador, la operación se tendrá por no concretada y el apartado se perderá en su totalidad."],
    ["5. Carácter no reembolsable.","El apartado es no reembolsable, salvo en los casos expresamente previstos en este documento."],
    ["6. No concreción de la operación.","En caso de que la operación no se concrete por causas imputables al comprador (desistimiento, falta de documentación, incumplimiento de plazos), el apartado se perderá en su totalidad."],
    ["7. Cancelación imputable al propietario.","Únicamente en caso de que la operación no se concrete por causas imputables al propietario, el apartado será devuelto íntegramente al comprador."],
    ["8. Enganche.","A la firma de la promesa de compraventa deberá realizarse el pago de un enganche cuyo porcentaje será pactado entre comprador y propietario, salvo acuerdo distinto por escrito."],
    ["9. Forma de pago propuesta.","El comprador manifiesta que la forma de pago propuesta para la operación será: "+data.forma_pago+"."],
    ["10. Declaración de licitud.","El comprador declara bajo protesta de decir verdad que los recursos utilizados para este apartado provienen de actividades lícitas."],
  ] : [
    ["1. Naturaleza del apartado.","El presente apartado tiene como finalidad reservar temporalmente el inmueble y dar inicio al proceso de formalización del arrendamiento. No constituye contrato de arrendamiento ni garantiza por sí mismo la ocupación del inmueble."],
    ["2. Proceso de formalización.","La formalización incluye la firma del contrato y la entrega de garantías que Emporio Inmobiliario y/o el propietario determinen como requisito. La negativa a cumplir con cualquiera de estos requisitos se considerará como no concreción de la operación."],
    ["3. Fecha límite de firma.","El cliente se compromete a concretar la firma del contrato a más tardar el día "+fechaLimite+"."],
    ["4. Carácter no reembolsable.","Si la operación no se concreta por causas imputables al cliente, el monto entregado se perderá en su totalidad. La única excepción es la no aprobación de la póliza, caso en el cual se devolverá el apartado menos $1,000 por concepto de investigación."],
    ["5. Cancelación imputable al propietario.","Si la operación no se concreta por causas imputables al propietario, el monto entregado será reembolsado en su totalidad."],
    ["6. Aceptación de condiciones.","El cliente manifiesta haber sido informado de las condiciones del proceso de arrendamiento y acepta expresamente los términos del presente recibo."],
    ["7. Solicitud de arrendamiento.","El cliente se compromete a completar su solicitud de arrendamiento en el link proporcionado por Emporio Inmobiliario en un plazo máximo de 1 día hábil. El incumplimiento se considerará como desistimiento."],
    ["8. No prórroga tácita.","Cualquier comunicación posterior a la fecha límite no constituirá prórroga ni modificación de los plazos, salvo convenio por escrito firmado por ambas partes."],
    ["9. Declaración de licitud.","El cliente declara que los recursos utilizados provienen de actividades lícitas y no están relacionados con operaciones de procedencia ilícita."],
  ];

  const maxW = W-2*M-8, lh = 12.5;
  for (const [titulo, texto] of clausulas) {
    doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...DARK);
    doc.text(titulo, M+4, y); y += lh;
    doc.setFont("helvetica","normal"); doc.setTextColor(...GRAY);
    y = wrapText(texto, M+4, y, maxW, lh, 8.5);
    y += 6;
  }

  if (data.condiciones_especiales?.trim()) {
    y += 4;
    doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...RED);
    doc.text("Condiciones especiales acordadas:", M+4, y); y += lh;
    doc.setFont("helvetica","normal"); doc.setTextColor(...DARK);
    y = wrapText(data.condiciones_especiales.trim(), M+4, y, maxW, lh, 8.5);
  }

  // SEPARADOR FIRMAS
  y += 6;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(M, y, W-M, y); y += 12;

  // FIRMAS
  const mid = W/2, sigW = 180;
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...RED);
  doc.text("Por Emporio Inmobiliario", M, y);

  // Firma de Carlos
  try {
    doc.addImage(FIRMA_CARLOS_B64, "PNG", M, y+2, 90, 50);
  } catch(_) {}

  doc.setDrawColor(204,204,204); doc.setLineWidth(0.8);
  doc.line(M, y+54, M+sigW, y+54);
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...DARK);
  doc.text("Carlos Alejandro Nachón Saldivar", M, y+64);
  doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...GRAY);
  doc.text("Recibido por: "+data.recibido_por, M, y+74);
  doc.text("Fecha: "+data.fecha, M, y+83);

  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...DARK);
  doc.text(data.tipo==="compraventa"?"Nombre y firma del comprador":"Nombre y firma del cliente", mid+20, y);
  doc.setDrawColor(204,204,204);
  doc.line(mid+20, y+28, mid+20+sigW, y+28);
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...DARK);
  doc.text(data.cliente_nombre, mid+20, y+38);
  doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...GRAY);
  doc.text("Fecha: ___________________________", mid+20, y+48);

  // QR de verificación
  try {
    const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent("https://www.emporioinmobiliario.com.mx/verificar/" + data.folio)}&size=80&margin=1`;
    const qrRes = await fetch(qrUrl);
    const qrBlob = await qrRes.blob();
    const qrB64 = await new Promise(r => { const fr = new FileReader(); fr.onloadend = () => r(fr.result); fr.readAsDataURL(qrBlob); });
    doc.addImage(qrB64, "PNG", W - M - 58, H - 70, 58, 58);
    doc.setFont("helvetica","normal"); doc.setFontSize(6); doc.setTextColor(...GRAY);
    doc.text("Escanea para", W - M - 29, H - 10, {align:"center"});
    doc.text("verificar", W - M - 29, H - 4, {align:"center"});
  } catch(_) {}

  // BOTTOM BAR
  doc.setFillColor(...RED); doc.rect(0, H-6, W, 6, "F");
  doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(...GRAY);
  doc.text("Emporio Inmobiliario  —  Uso interno  —  2026  |  emporioinmobiliario.com.mx", W/2 - 30, H-10, {align:"center"});

  return doc;
}

// ── Página ─────────────────────────────────────────────────────────────────
export default function NuevoRecibo() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tipo, setTipo] = useState("compraventa");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [inmuebleActivo, setInmuebleActivo] = useState(null);
  const [form, setForm] = useState({
    cliente_nombre: "", cliente_tel: "", cliente_email: "",
    inmueble: "", monto: "", monto_previo: "",
    fecha: new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }),
    vigencia_dias: 7, fecha_limite_firma: "",
    forma_pago: "Transferencia",
    recibido_por: "Guillermo",
    efectivo: false, comprobante: null,
    condiciones_especiales: "",
    es_urgente: false, es_contado: false,
  });

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setAuthLoading(false);
    });
  }, []);

  const loadProfile = async (uid) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).single();
    setProfile(data); setAuthLoading(false);
  };

  // Verificar duplicado
  const verificarDuplicado = async (inmueble) => {
    if (!inmueble.trim()) { setInmuebleActivo(null); return; }
    const { data } = await supabase.from("recibos_apartado").select("folio, cliente_nombre").eq("inmueble", inmueble).eq("estatus", "activo").maybeSingle();
    setInmuebleActivo(data || null);
  };

  const handleSubmit = async () => {
    if (!form.cliente_nombre || !form.inmueble || !form.monto) { showToast("Completa los campos obligatorios", false); return; }
    setLoading(true);
    try {
      // Folio
      const { data: folio, error: folioErr } = await supabase.rpc("generar_folio", { p_tipo: tipo });
      if (folioErr) throw folioErr;

      // Subir comprobante si existe
      let comprobante_url = null;
      if (form.comprobante) {
        const ext = form.comprobante.name.split(".").pop();
        const { error: upErr } = await supabase.storage.from("recibos-comprobantes").upload(`${folio}.${ext}`, form.comprobante, { upsert: false });
        if (!upErr) {
          const { data: signed } = await supabase.storage.from("recibos-comprobantes").createSignedUrl(`${folio}.${ext}`, 60*60*24*365);
          comprobante_url = signed?.signedUrl ?? null;
        }
      }

      // Generar PDF
      const pdfData = { ...form, tipo, folio, monto: parseFloat(form.monto), monto_previo: parseFloat(form.monto_previo) || 0 };
      const doc = await generarPDF(pdfData);

      // Subir PDF
      const pdfBlob = doc.output("blob");
      let pdf_url = null;
      const { error: pdfErr } = await supabase.storage.from("recibos-apartado").upload(`${folio}.pdf`, pdfBlob, { contentType: "application/pdf", upsert: false });
      if (!pdfErr) {
        const { data: signed } = await supabase.storage.from("recibos-apartado").createSignedUrl(`${folio}.pdf`, 60*60*24*365);
        pdf_url = signed?.signedUrl ?? null;
      }

      // Insertar en BD
      const { data: recibo, error: insertErr } = await supabase.from("recibos_apartado").insert({
        folio, tipo,
        cliente_nombre: form.cliente_nombre,
        cliente_tel: form.cliente_tel || null,
        cliente_email: form.cliente_email || null,
        inmueble: form.inmueble,
        monto: parseFloat(form.monto),
        monto_previo: parseFloat(form.monto_previo) || 0,
        fecha: new Date().toISOString().split("T")[0],
        vigencia_dias: parseInt(form.vigencia_dias),
        fecha_limite_firma: form.fecha_limite_firma || null,
        forma_pago: form.forma_pago,
        recibido_por: form.recibido_por,
        efectivo: form.efectivo,
        comprobante_url,
        condiciones_especiales: form.condiciones_especiales || null,
        es_urgente: form.es_urgente,
        es_contado: form.es_contado,
        pdf_url,
        created_by: session.user.id,
      }).select().single();
      if (insertErr) throw insertErr;

      // Log
      await supabase.from("recibos_log").insert({ recibo_id: recibo.id, accion: "generado", usuario_id: session.user.id });

      // Notificar a Carlos
      await fetch("/api/notificar-recibo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folio, tipo, cliente: form.cliente_nombre, inmueble: form.inmueble,
          monto: fmt(form.monto), recibido_por: form.recibido_por,
          forma_pago: form.forma_pago, tiene_comprobante: !!comprobante_url,
          generado_por: profile?.email,
        }),
      });

      // Trigger módulo de firmas (solo compraventa)
      if (tipo === "compraventa") {
        fetch("/api/recibos/trigger-firmas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recibo_id: recibo.id,
            folio, tipo,
            cliente_nombre: form.cliente_nombre,
            inmueble: form.inmueble,
            monto: parseFloat(form.monto),
            forma_pago: form.forma_pago,
            es_contado: form.es_contado,
            es_urgente: form.es_urgente,
            creado_por: session.user.id,
            creado_por_nombre: profile?.email,
          }),
        }).catch(e => console.error("Trigger firmas:", e));
      }

      // Descargar PDF
      doc.save(`${folio}.pdf`);
      showToast(`Recibo ${folio} generado correctamente`);
      setTimeout(() => router.push("/recibos"), 1500);

    } catch (e) {
      console.error(e);
      showToast(e.message || "Error al generar el recibo", false);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: brand.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} />
    </div>
  );
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }

  const inputSt = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" };
  const selSt = { ...inputSt, background: "#fff" };
  const labelSt = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 };
  const sectionLabel = { fontSize: 13, fontWeight: 700, color: brand.gray, borderBottom: `1px solid ${brand.border}`, paddingBottom: 8, marginBottom: 14, marginTop: 4 };

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}>
          {toast.msg}
        </div>
      )}

      <PageHeader title="Nuevo Recibo de Apartado" icon="🧾" />

      <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 20px" }}>

        {/* Selector tipo */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          {["compraventa", "arrendamiento"].map(t => (
            <button key={t} onClick={() => setTipo(t)} style={{
              flex: 1, padding: "14px", borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: "pointer",
              border: `2px solid ${tipo === t ? brand.red : brand.border}`,
              background: tipo === t ? brand.redLight : "#fff",
              color: tipo === t ? brand.red : brand.gray,
            }}>
              {t === "compraventa" ? "🏠 Compraventa" : "📋 Arrendamiento"}
            </button>
          ))}
        </div>

        <div style={{ background: "#fff", borderRadius: 14, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>

          {/* Datos del cliente */}
          <p style={sectionLabel}>Datos del cliente</p>
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>Nombre completo *</label>
            <input style={inputSt} value={form.cliente_nombre} onChange={e => set("cliente_nombre", e.target.value)} placeholder="Nombre tal como aparecerá en el recibo" />
          </div>
          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={labelSt}>Teléfono</label>
              <input style={inputSt} value={form.cliente_tel} onChange={e => set("cliente_tel", e.target.value)} placeholder="222 000 0000" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelSt}>Correo electrónico</label>
              <input style={inputSt} value={form.cliente_email} onChange={e => set("cliente_email", e.target.value)} placeholder="correo@ejemplo.com" />
            </div>
          </div>

          {/* Inmueble */}
          <p style={sectionLabel}>Inmueble</p>
          <div style={{ marginBottom: 4 }}>
            <label style={labelSt}>Dirección completa *</label>
            <textarea style={{ ...inputSt, resize: "vertical" }} rows={2} value={form.inmueble}
              onChange={e => { set("inmueble", e.target.value); verificarDuplicado(e.target.value); }}
              placeholder="Calle, número, colonia, ciudad, CP" />
          </div>
          {inmuebleActivo && (
            <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13, color: "#92400e" }}>
              ⚠️ <strong>Atención:</strong> Este inmueble ya tiene el folio <strong>{inmuebleActivo.folio}</strong> activo a nombre de <strong>{inmuebleActivo.cliente_nombre}</strong>. ¿Deseas continuar?
            </div>
          )}

          {/* Monto */}
          <p style={{ ...sectionLabel, marginTop: 16 }}>Monto del apartado</p>
          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={labelSt}>Monto *</label>
              <input style={inputSt} type="number" value={form.monto} onChange={e => set("monto", e.target.value)} placeholder="10000" />
            </div>
            {tipo === "arrendamiento" && (
              <div style={{ flex: 1 }}>
                <label style={labelSt}>Abono previo (si aplica)</label>
                <input style={inputSt} type="number" value={form.monto_previo} onChange={e => set("monto_previo", e.target.value)} placeholder="1000" />
              </div>
            )}
          </div>

          {/* Forma de pago y comprobante */}
          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={labelSt}>Forma de pago</label>
              <select style={selSt} value={form.forma_pago} onChange={e => { set("forma_pago", e.target.value); set("efectivo", e.target.value === "Efectivo"); }}>
                {tipo === "compraventa"
                  ? ["Transferencia", "Efectivo", "Depósito en ventanilla"].map(o => <option key={o}>{o}</option>)
                  : ["Transferencia", "Efectivo", "Depósito en ventanilla"].map(o => <option key={o}>{o}</option>)
                }
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelSt}>Recibido por</label>
              <select style={selSt} value={form.recibido_por} onChange={e => set("recibido_por", e.target.value)}>
                <option>Guillermo</option>
                <option>Oficina</option>
                <option>Carlos</option>
              </select>
            </div>
          </div>

          {/* Comprobante o efectivo */}
          {form.forma_pago === "Efectivo" ? (
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
              <input type="checkbox" id="efectivo" checked={form.efectivo} onChange={e => set("efectivo", e.target.checked)} style={{ width: 16, height: 16 }} />
              <label htmlFor="efectivo" style={{ fontSize: 13, fontWeight: 600, color: "#065f46", cursor: "pointer" }}>Confirmo que recibí el efectivo en mano</label>
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <label style={labelSt}>Comprobante de pago (transferencia/ventanilla)</label>
              <input type="file" accept="image/*,.pdf" onChange={e => set("comprobante", e.target.files[0])}
                style={{ ...inputSt, padding: "7px 12px" }} />
              {form.comprobante && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#065f46" }}>✓ {form.comprobante.name}</p>}
            </div>
          )}

          {/* Plazos */}
          <p style={{ ...sectionLabel, marginTop: 8 }}>Plazos</p>
          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={labelSt}>Vigencia (días naturales)</label>
              <input style={inputSt} type="number" value={form.vigencia_dias} onChange={e => set("vigencia_dias", e.target.value)} />
            </div>
            {tipo === "arrendamiento" && (
              <div style={{ flex: 1 }}>
                <label style={labelSt}>Fecha límite de firma</label>
                <input style={inputSt} type="date" value={form.fecha_limite_firma} onChange={e => set("fecha_limite_firma", e.target.value)} />
              </div>
            )}
          </div>

          {/* Checkboxes */}
          <div style={{ display: "flex", gap: 20, marginBottom: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: brand.gray, cursor: "pointer" }}>
              <input type="checkbox" checked={form.es_urgente} onChange={e => set("es_urgente", e.target.checked)} style={{ width: 16, height: 16 }} />
              Urgente (3 días)
            </label>
            {tipo === "compraventa" && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: brand.gray, cursor: "pointer" }}>
                <input type="checkbox" checked={form.es_contado} onChange={e => set("es_contado", e.target.checked)} style={{ width: 16, height: 16 }} />
                Operación de contado
              </label>
            )}
          </div>

          {/* Condiciones especiales */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>Condiciones especiales (opcional — aparece en el PDF)</label>
            <textarea style={{ ...inputSt, resize: "vertical" }} rows={2} value={form.condiciones_especiales}
              onChange={e => set("condiciones_especiales", e.target.value)}
              placeholder="Ej: En caso de que el crédito no sea aprobado, el apartado será devuelto en su totalidad." />
          </div>

          {/* Notas internas */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelSt}>Notas internas (no aparecen en el PDF)</label>
            <textarea style={{ ...inputSt, resize: "vertical" }} rows={2} value={form.notas}
              onChange={e => set("notas", e.target.value)}
              placeholder="Observaciones para el equipo" />
          </div>

          {/* Botones */}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => router.push("/recibos")} style={{ flex: 1, background: "#f9fafb", color: brand.gray, border: `1px solid ${brand.border}`, borderRadius: 10, padding: "12px", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
              Cancelar
            </button>
            <button onClick={handleSubmit} disabled={loading || !form.cliente_nombre || !form.inmueble || !form.monto}
              style={{ flex: 2, background: loading ? "#9ca3af" : brand.red, color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontSize: 14 }}>
              {loading ? "Generando recibo…" : "✓ Generar y descargar PDF"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
