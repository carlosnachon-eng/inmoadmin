import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";

const inp = {
  width: "100%", padding: "10px 14px", borderRadius: 8,
  border: "1.5px solid #e5e7eb", fontSize: 14, boxSizing: "border-box",
  fontFamily: "'Montserrat', sans-serif", color: "#1a1a2e", outline: "none",
  background: "#fff", transition: "border 0.15s",
};
const sel = { ...inp, cursor: "pointer" };
const txta = { ...inp, minHeight: 80, resize: "vertical" };

function Campo({ label, children, required }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}{required && <span style={{ color: "#C8102E" }}> *</span>}
      </label>
      {children}
    </div>
  );
}

function SecTitle({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "28px 0 20px" }}>
      <div style={{ width: 4, height: 18, background: "#C8102E", borderRadius: 2, flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 800, color: "#1a1a2e", letterSpacing: "0.15em", textTransform: "uppercase" }}>{children}</span>
      <div style={{ flex: 1, height: 1, background: "#f0f0f0" }} />
    </div>
  );
}

async function generarPDF(data) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const W = 215.9, H = 279.4, M = 18, AW = W - M * 2;
  let y = 0;

  // ── Paleta Emporio ───────────────────────────────────────
  const ROJO   = [185, 28, 60];
  const BORG   = [127, 29, 46];
  const GR1    = [74,  74,  74];   // gris oscuro texto
  const GR2    = [122, 122, 122];  // gris medio labels
  const GR3    = [229, 231, 235];  // gris borde
  const GBGX   = [248, 248, 248];  // fondo celdas
  const VBG    = [220, 252, 231]; const VC  = [6,  95,  70]; const VS = [34, 197, 94];
  const ABG    = [254, 249, 195]; const AC  = [133, 77,  14]; const AS = [234, 179, 8];
  const RBG    = [254, 226, 226]; const RC  = [153, 27,  27]; const RS = [239, 68,  68];
  const AZB    = [239, 246, 255]; const AZC = [29,  78, 216];

  const addPg = () => { doc.addPage(); y = 18; };
  const chk   = (n)  => { if (y + n > 258) addPg(); };

  // ═══════════════════════════════════════════════════════
  // PORTADA — Página 1
  // ═══════════════════════════════════════════════════════

  // Franja superior roja
  doc.setFillColor(...ROJO); doc.rect(0, 0, W, 52, "F");
  // Franja borgoña inferior de la portada
  doc.setFillColor(...BORG); doc.rect(0, 46, W, 6, "F");

  // Logo desde navegador
  let logoData = null;
  try {
    const res = await fetch("https://www.emporioinmobiliario.com.mx/logo.png");
    const blob = await res.blob();
    logoData = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(blob); });
  } catch(e) {}

  if (logoData) {
    doc.addImage(logoData, "PNG", M, 8, 38, 16);
  } else {
    doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(16);
    doc.text("EMPORIO", M, 18);
    doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(255,200,210);
    doc.text("INMOBILIARIO", M, 24);
  }

  // Folio y fecha alineados a la derecha en la franja
  doc.setTextColor(255,220,230); doc.setFont("helvetica","normal"); doc.setFontSize(7);
  doc.text("FOLIO", W - M, 11, { align: "right" });
  doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(14);
  doc.text(data.folio || "—", W - M, 20, { align: "right" });
  doc.setTextColor(255,210,220); doc.setFont("helvetica","normal"); doc.setFontSize(7);
  doc.text(data.fecha || "", W - M, 27, { align: "right" });

  y = 62;

  // Título del documento
  doc.setTextColor(...GR1); doc.setFont("helvetica","bold"); doc.setFontSize(13);
  doc.text("REPORTE DE INVESTIGACIÓN Y DICTAMEN", W / 2, y, { align: "center" }); y += 7;
  doc.setTextColor(...ROJO); doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
  doc.text("PÓLIZA JURÍDICA DE DESALOJO Y DESLINDE — HABITACIONAL", W / 2, y, { align: "center" }); y += 5;
  doc.setDrawColor(...GR3); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 8;

  // ── Semáforo de dictamen ─────────────────────────────
  const dict = data.dictamen || "APROBADO";
  const sems = [
    { val: "APROBADO",               icon: "✓", on: VS, bg: VBG, tc: VC, lbl: "APROBADO" },
    { val: "APROBADO CON CONDICIONES", icon: "!", on: AS, bg: ABG, tc: AC, lbl: "CON CONDICIONES" },
    { val: "NO APROBADO",            icon: "✗", on: RS, bg: RBG, tc: RC, lbl: "NO APROBADO" },
  ];
  const semH = 28;
  doc.setFillColor(...GBGX); doc.roundedRect(M, y, AW, semH, 4, 4, "F");
  const sw = AW / 3;
  sems.forEach((s, i) => {
    const cx = M + sw * i + sw / 2, cy = y + semH / 2 - 3;
    const act = dict === s.val;
    if (act) {
      doc.setFillColor(...s.bg); doc.setDrawColor(...s.on); doc.setLineWidth(1.5);
    } else {
      doc.setFillColor(240, 240, 240); doc.setDrawColor(...GR3); doc.setLineWidth(0.5);
    }
    doc.circle(cx, cy, 8, "FD");
    doc.setFont("helvetica","bold"); doc.setFontSize(act ? 12 : 8);
    doc.setTextColor(...(act ? s.on : [209,213,219]));
    doc.text(s.icon, cx, cy + 4, { align: "center" });
    doc.setFont("helvetica", act ? "bold" : "normal"); doc.setFontSize(6.5);
    doc.setTextColor(...(act ? s.tc : [180,180,180]));
    doc.text(s.lbl, cx, y + semH - 3, { align: "center" });
  });
  y += semH + 10;

  // ── Helpers ──────────────────────────────────────────
  // Título de sección
  const st = (t) => {
    chk(14);
    doc.setFillColor(...ROJO); doc.rect(M, y, 3, 7, "F");
    doc.setTextColor(...ROJO); doc.setFont("helvetica","bold"); doc.setFontSize(8);
    doc.text(t, M + 6, y + 5); y += 11;
  };

  // 2 columnas
  const c2 = (l1, v1, l2, v2) => {
    chk(18); const h = AW / 2 - 2;
    [[l1, v1, M], [l2, v2, M + h + 4]].forEach(([l, v, x]) => {
      doc.setFillColor(...GBGX); doc.roundedRect(x, y, h, 16, 2, 2, "F");
      doc.setDrawColor(...GR3); doc.setLineWidth(0.2); doc.roundedRect(x, y, h, 16, 2, 2, "S");
      doc.setTextColor(...GR2); doc.setFont("helvetica","normal"); doc.setFontSize(6);
      doc.text((l || "").toUpperCase(), x + 4, y + 5.5);
      doc.setTextColor(...GR1); doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
      const vv = doc.splitTextToSize(v || "—", h - 8);
      doc.text(vv[0], x + 4, y + 12);
    });
    y += 19;
  };

  // 3 columnas
  const c3 = (l1, v1, l2, v2, l3, v3) => {
    chk(18); const t = AW / 3 - 1.5;
    [[l1, v1, 0], [l2, v2, 1], [l3, v3, 2]].forEach(([l, v, i]) => {
      const x = M + (t + 2.25) * i;
      doc.setFillColor(...GBGX); doc.roundedRect(x, y, t, 16, 2, 2, "F");
      doc.setDrawColor(...GR3); doc.setLineWidth(0.2); doc.roundedRect(x, y, t, 16, 2, 2, "S");
      doc.setTextColor(...GR2); doc.setFont("helvetica","normal"); doc.setFontSize(5.5);
      doc.text((l || "").toUpperCase(), x + 4, y + 5.5);
      doc.setTextColor(...GR1); doc.setFont("helvetica","bold"); doc.setFontSize(8);
      doc.text(doc.splitTextToSize(v || "—", t - 8)[0], x + 4, y + 12);
    });
    y += 19;
  };

  // Texto largo
  const ctxt = (l, v) => {
    if (!v) return;
    const lines = doc.splitTextToSize(v, AW - 10);
    const lineH = 5.5, h = lines.length * lineH + 14;
    chk(h + 12);
    doc.setTextColor(...GR2); doc.setFont("helvetica","normal"); doc.setFontSize(6);
    doc.text((l || "").toUpperCase(), M, y + 4); y += 7;
    doc.setFillColor(...GBGX); doc.roundedRect(M, y, AW, h, 2, 2, "F");
    doc.setDrawColor(...GR3); doc.setLineWidth(0.2); doc.roundedRect(M, y, AW, h, 2, 2, "S");
    doc.setTextColor(...GR1); doc.setFont("helvetica","normal"); doc.setFontSize(8);
    lines.forEach((line, i) => doc.text(line, M + 5, y + 8 + i * lineH));
    y += h + 6;
  };

  // ── I. DATOS GENERALES ───────────────────────────────
  st("I. DATOS GENERALES");
  c2("Nombre del solicitante", data.nombre_solicitante, "Tipo de solicitante", data.tipo_solicitante);
  c3("Tipo de identificación", data.tipo_identificacion, "Núm. de identificación", data.num_identificacion, "Fecha de nacimiento", data.fecha_nacimiento);
  c3("RFC", data.rfc_solicitante || "—", "Estado civil", data.estado_civil || "—", "Cónyuge", data.conyuge || "—");
  c3("Teléfono", data.telefono_inquilino, "Correo electrónico", data.correo_inquilino, "Tiempo en dom. anterior", data.tiempo_domicilio_anterior);
  c2("Domicilio anterior", data.domicilio_anterior, "Domicilio actual / nuevo inmueble", data.direccion_inmueble);
  c3("Monto de renta", data.monto_renta, "Fecha de inicio", data.fecha_inicio, "Tipo de solicitud", data.tipo_solicitante);

  // ── II. ACTIVIDAD Y FUENTE DE INGRESOS ───────────────
  st("II. ACTIVIDAD Y FUENTE DE INGRESOS");
  const fuenteDisplay = data.fuente_ingresos === "OTRA" ? `Otra: ${data.fuente_ingresos_otro || "—"}` : data.fuente_ingresos;
  c2("Actividad principal", data.actividad_principal, "Fuente de ingresos", fuenteDisplay);
  c3("Empresa / Empleador", data.empresa, "Teléfono RRHH", data.tel_empresa, "Ingreso mensual", data.ingreso_mensual);

  // Relación ingreso/renta destacada
  chk(20);
  const rel = data.relacion_ingreso_renta || "—";
  const adecuada = rel.toLowerCase().includes("adecuada") || rel.toLowerCase().includes("x el");
  doc.setFillColor(...(adecuada ? VBG : ABG));
  doc.setDrawColor(...(adecuada ? VC : AC)); doc.setLineWidth(0.8);
  doc.roundedRect(M, y, AW, 16, 3, 3, "FD");
  doc.setTextColor(...GR2); doc.setFont("helvetica","normal"); doc.setFontSize(6);
  doc.text("RELACIÓN INGRESO / RENTA", M + 6, y + 5.5);
  doc.setTextColor(...(adecuada ? VC : AC)); doc.setFont("helvetica","bold"); doc.setFontSize(9);
  doc.text(rel, M + 6, y + 12);
  doc.setTextColor(...GR2); doc.setFont("helvetica","normal"); doc.setFontSize(7);
  doc.text(`Comprobante: ${data.comprobante_ingresos || "—"}`, W - M - 2, y + 12, { align: "right" });
  y += 20;

  // ── III. USO DEL INMUEBLE / OCUPANTES ────────────────
  st("III. USO DEL INMUEBLE / OCUPANTES");
  const mascotasDisplay = data.mascotas === "Si — especificar" ? `Sí — ${data.mascotas_detalle || "por especificar"}` : data.mascotas;
  c3("Uso declarado", data.uso_declarado, "Núm. de ocupantes", data.num_ocupantes, "Subarrendamiento", data.subarrendamiento || "No");
  c3("Mascotas", mascotasDisplay, "Personal de servicio", data.personal_servicio, "Modalidad", data.modalidad_servicio || "—");
  if (data.descripcion_uso) ctxt("Descripción del uso", data.descripcion_uso);

  // ── IV. REFERENCIAS ──────────────────────────────────
  const tieneRefs = data.ref1_nombre || data.ref2_nombre || data.ref_fam1 || data.ref_per1;
  if (tieneRefs) {
    st("IV. REFERENCIAS PERSONALES Y FAMILIARES");
    if (data.ref1_nombre) c3("Referencia 1 — Nombre", data.ref1_nombre, "Teléfono", data.ref1_telefono, "Relación", data.ref1_relacion);
    if (data.ref2_nombre) c3("Referencia 2 — Nombre", data.ref2_nombre, "Teléfono", data.ref2_telefono, "Relación", data.ref2_relacion);
    if (data.ref_fam1) c3("Ref. familiar — Nombre", data.ref_fam1, "Teléfono", data.ref_fam1_tel, "Parentesco", data.ref_fam1_parentesco);
  }

  // ── V. ANTECEDENTES LEGALES ──────────────────────────
  st("V. ANTECEDENTES LEGALES — BURÓ MÉXICO");
  chk(18);
  const sinA = data.resultado_legal === "Sin antecedentes";
  doc.setFillColor(...(sinA ? VBG : RBG)); doc.setDrawColor(...(sinA ? VC : RC)); doc.setLineWidth(0.8);
  doc.roundedRect(M, y, AW, 15, 3, 3, "FD");
  doc.setTextColor(...(sinA ? VC : RC)); doc.setFont("helvetica","bold"); doc.setFontSize(9);
  doc.text(sinA ? "✓  SIN ANTECEDENTES LEGALES RELEVANTES" : "⚠  CON ANTECEDENTES — VER OBSERVACIONES", W / 2, y + 9.5, { align: "center" });
  y += 19;
  if (data.observaciones_legales) ctxt("Observaciones de antecedentes", data.observaciones_legales);

  // ── VI. HISTORIAL Y REVISIÓN LEGAL ──────────────────
  st("VI. REFERENCIAS E HISTORIAL / REVISIÓN LEGAL");
  ctxt("Historial de referencias", data.referencias);
  ctxt("Revisión legal", data.revision_legal);

  // ── VII. CONCLUSIÓN ──────────────────────────────────
  st("VII. CONCLUSIÓN Y RECOMENDACIÓN");
  ctxt("Conclusión", data.conclusion);
  if (data.observaciones_analista) {
    chk(24);
    const ol = doc.splitTextToSize(data.observaciones_analista, AW - 12);
    const oh = ol.length * 4.5 + 14; chk(oh);
    doc.setFillColor(...AZB); doc.setDrawColor(...AZC); doc.setLineWidth(0.8);
    doc.roundedRect(M, y, AW, oh, 3, 3, "FD");
    doc.setTextColor(...AZC); doc.setFont("helvetica","bold"); doc.setFontSize(6.5);
    doc.text("OBSERVACIONES DEL ANALISTA", M + 6, y + 6);
    doc.setTextColor(...GR1); doc.setFont("helvetica","normal"); doc.setFontSize(8);
    doc.text(ol, M + 6, y + 12); y += oh + 6;
  }

  // ── VIII. DICTAMEN FINAL ─────────────────────────────
  chk(36); st("VIII. DICTAMEN FINAL");
  const [dbg, dc, dtxt] = dict === "APROBADO" ? [VBG, VC, "APROBADO"]
    : dict === "APROBADO CON CONDICIONES" ? [ABG, AC, "APROBADO CON CONDICIONES"]
    : [RBG, RC, "NO APROBADO"];
  chk(26);
  doc.setFillColor(...dbg); doc.setDrawColor(...dc); doc.setLineWidth(2);
  doc.roundedRect(M, y, AW, 24, 5, 5, "FD");
  doc.setTextColor(...dc); doc.setFont("helvetica","bold"); doc.setFontSize(16);
  doc.text(dtxt, W / 2, y + 15, { align: "center" }); y += 28;
  if (data.condiciones) {
    doc.setTextColor(...GR2); doc.setFont("helvetica","normal"); doc.setFontSize(8);
    doc.text(`Condiciones: ${data.condiciones}`, W / 2, y + 5, { align: "center" }); y += 10;
  }

  // ── IX. DESLINDE LEGAL ───────────────────────────────
  chk(22);
  doc.setDrawColor(...GR3); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 6;
  doc.setFillColor(...ROJO); doc.rect(M, y, 3, 7, "F");
  doc.setTextColor(...ROJO); doc.setFont("helvetica","bold"); doc.setFontSize(8);
  doc.text("IX. DESLINDE LEGAL", M + 6, y + 5); y += 9;
  doc.setTextColor(...GR2); doc.setFont("helvetica","normal"); doc.setFontSize(7.5);
  const dl = doc.splitTextToSize(
    "El presente reporte y dictamen se emite con base en la información proporcionada por el solicitante y bajo un estándar de diligencia razonable, sin constituir garantía de pago ni sustituir resoluciones judiciales. Emporio Inmobiliario actúa como intermediario en la verificación de la información y no asume responsabilidad por datos incorrectos o incompletos proporcionados por el solicitante.",
    AW
  );
  doc.text(dl, M, y); y += dl.length * 4.5 + 6;

  // ── X. FIRMA ─────────────────────────────────────────
  chk(50);
  doc.setFillColor(...ROJO); doc.rect(M, y, 3, 7, "F");
  doc.setTextColor(...ROJO); doc.setFont("helvetica","bold"); doc.setFontSize(8);
  doc.text("X. FIRMA Y AUTORIZACIÓN", M + 6, y + 5); y += 12;

  // Caja de firma profesional
  const fw = AW / 3 - 4;
  // Columna analista
  doc.setFillColor(...GBGX); doc.roundedRect(M, y, fw, 36, 3, 3, "F");
  doc.setDrawColor(...GR3); doc.setLineWidth(0.3); doc.roundedRect(M, y, fw, 36, 3, 3, "S");
  doc.setTextColor(...GR2); doc.setFont("helvetica","normal"); doc.setFontSize(6);
  doc.text("ANALISTA", M + fw/2, y + 6, { align: "center" });
  // Línea de firma
  doc.setDrawColor(...GR1); doc.setLineWidth(0.5);
  doc.line(M + 6, y + 26, M + fw - 6, y + 26);
  doc.setTextColor(...GR1); doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
  doc.text(data.analista || "—", M + fw/2, y + 31, { align: "center" });
  doc.setTextColor(...ROJO); doc.setFont("helvetica","normal"); doc.setFontSize(6.5);
  doc.text("Firma autorizada", M + fw/2, y + 35, { align: "center" });

  // Columna fecha
  const fx2 = M + fw + 8;
  doc.setFillColor(...GBGX); doc.roundedRect(fx2, y, fw, 36, 3, 3, "F");
  doc.setDrawColor(...GR3); doc.setLineWidth(0.3); doc.roundedRect(fx2, y, fw, 36, 3, 3, "S");
  doc.setTextColor(...GR2); doc.setFont("helvetica","normal"); doc.setFontSize(6);
  doc.text("FECHA DE EMISIÓN", fx2 + fw/2, y + 6, { align: "center" });
  doc.setTextColor(...GR1); doc.setFont("helvetica","bold"); doc.setFontSize(10);
  doc.text(data.fecha || "—", fx2 + fw/2, y + 22, { align: "center" });

  // Columna empresa con logo
  const fx3 = fx2 + fw + 8;
  doc.setFillColor(...ROJO); doc.roundedRect(fx3, y, fw, 36, 3, 3, "F");
  if (logoData) {
    doc.addImage(logoData, "PNG", fx3 + 4, y + 4, fw - 8, 14);
  } else {
    doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(9);
    doc.text("EMPORIO", fx3 + fw/2, y + 14, { align: "center" });
    doc.setFont("helvetica","normal"); doc.setFontSize(6);
    doc.text("INMOBILIARIO", fx3 + fw/2, y + 19, { align: "center" });
  }
  doc.setTextColor(255,220,230); doc.setFont("helvetica","normal"); doc.setFontSize(6.5);
  doc.text("emporioinmobiliario.com.mx", fx3 + fw/2, y + 26, { align: "center" });
  doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(6);
  doc.text("222 257 3237", fx3 + fw/2, y + 31, { align: "center" });
  doc.text("ventas@emporioinmobiliario.mx", fx3 + fw/2, y + 35.5, { align: "center" });

  y += 42;

  // ── FOOTER EN TODAS LAS PÁGINAS ──────────────────────
  const np = doc.internal.getNumberOfPages();
  for (let i = 1; i <= np; i++) {
    doc.setPage(i);
    const ph = doc.internal.pageSize.height;
    // Línea separadora
    doc.setDrawColor(...GR3); doc.setLineWidth(0.3);
    doc.line(M, ph - 12, W - M, ph - 12);
    // Barra roja lateral izquierda
    doc.setFillColor(...ROJO); doc.rect(0, ph - 11, 4, 11, "F");
    // Texto footer
    doc.setTextColor(...GR2); doc.setFont("helvetica","normal"); doc.setFontSize(6.5);
    doc.text("Emporio Inmobiliario  ·  Reserva Territorial Atlixcayotl, San Andrés Cholula, Puebla", M + 2, ph - 4);
    doc.text("222 257 3237  ·  ventas@emporioinmobiliario.mx", M + 2, ph - 0.5);
    // Numeración
    doc.setTextColor(...ROJO); doc.setFont("helvetica","bold"); doc.setFontSize(7);
    doc.text(`${i} / ${np}`, W - M, ph - 2.5, { align: "right" });
  }

  doc.save(`Dictamen_${(data.folio || "").slice(0,8)}_${data.nombre_solicitante?.split(" ")[0] || "Emporio"}.pdf`);
}
export default function Dictamen() {
  const router = useRouter();
  const [generando, setGenerando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [form, setForm] = useState({
    folio: "", fecha: new Date().toLocaleDateString("es-MX"),
    nombre_solicitante: "", tipo_solicitante: "PERSONA FÍSICA",
    tipo_identificacion: "INE", num_identificacion: "", fecha_nacimiento: "",
    telefono_inquilino: "", correo_inquilino: "",
    domicilio_anterior: "", tiempo_domicilio_anterior: "",
    direccion_inmueble: "", monto_renta: "", fecha_inicio: "",
    actividad_principal: "", fuente_ingresos: "NÓMINA", fuente_ingresos_otro: "",
    empresa: "", tel_empresa: "", ingreso_mensual: "",
    relacion_ingreso_renta: "Adecuada",
    comprobante_ingresos: "Sí — 3 recibos de nómina presentados",
    uso_declarado: "HABITACIONAL", descripcion_uso: "",
    num_ocupantes: "", mascotas: "No", mascotas_detalle: "",
    personal_servicio: "No", modalidad_servicio: "",
    ref1_nombre: "", ref1_telefono: "", ref1_relacion: "",
    ref2_nombre: "", ref2_telefono: "", ref2_relacion: "",
    resultado_legal: "Sin antecedentes", observaciones_legales: "",
    referencias: "Se revisaron referencias e historial de arrendamiento, no detectandose alertas relevantes para el propietario.",
    revision_legal: "Se realizo verificacion de identidad y consulta de antecedentes juridicos en plataforma BuroMexico. No se detectaron impedimentos legales, inconsistencias relevantes ni riesgos juridicos.",
    conclusion: "Derivado de la investigacion realizada, el perfil de los solicitantes resulta congruente con el inmueble y el monto de renta.",
    observaciones_analista: "",
    dictamen: "APROBADO", condiciones: "",
    analista: "LIC. ZAYETZY MONTES LUNA",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Pre-llenar desde solicitud si viene el query param
  useEffect(() => {
    const { solicitud_id } = router.query;
    if (!solicitud_id) return;
    setCargando(true);
    supabase.from("solicitudes_inquilino").select("*").eq("id", solicitud_id).single()
      .then(({ data: s }) => {
        if (!s) { setCargando(false); return; }
        const fmt = (n) => n ? `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2 })}` : "";
        const fmtFecha = (d) => {
          if (!d) return "";
          if (d.includes("/")) return d;
          return new Date(d + "T12:00:00").toLocaleDateString("es-MX");
        };
        // Calcular relacion ingreso/renta
        const ingresos = Number(s.ingresos_mensuales) || 0;
        const renta = Number(s.monto_renta_solicitada) || 0;
        let relacionIngresoRenta = "Adecuada";
        if (ingresos && renta) {
          const ratio = ingresos / renta;
          if (ratio >= 3) relacionIngresoRenta = "Adecuada — ingresos 3x el monto";
          else if (ratio >= 2.5) relacionIngresoRenta = "Adecuada — ingresos 2.5x el monto";
          else if (ratio >= 2) relacionIngresoRenta = "Adecuada — ingresos 2x el monto";
          else if (ratio >= 1.5) relacionIngresoRenta = "Ajustada";
          else relacionIngresoRenta = "Insuficiente";
        }
        // Mascotas
        let mascotas = "No";
        if (s.tiene_mascotas) mascotas = s.detalle_mascotas ? "Sí — especificar" : "Sí — perro";
        // Personal servicio
        let personalServicio = "No";
        if (s.personal_servicio) personalServicio = s.personal_servicio_detalle?.includes("planta") ? "Sí — de planta" : "Sí — entrada y salida";

        setForm(f => ({
          ...f,
          folio: solicitud_id.slice(0, 8).toUpperCase(),
          nombre_solicitante: s.nombre_completo || s.razon_social || "",
          tipo_solicitante: s.tipo_solicitante === "Persona moral" ? "PERSONA MORAL" : "PERSONA FÍSICA",
          num_identificacion: s.clave_elector || s.rfc || "",
          telefono_inquilino: s.telefono || s.telefono_representante || "",
          correo_inquilino: s.correo || s.email_representante || "",
          domicilio_anterior: s.domicilio_actual || "",
          direccion_inmueble: s.inmueble_interes || "",
          monto_renta: fmt(s.monto_renta_solicitada),
          fecha_inicio: fmtFecha(s.fecha_inicio_deseada),
          actividad_principal: s.ocupacion_arrendatario || s.giro_empresa_labora || "",
          empresa: s.empresa_labora || s.razon_social || "",
          tel_empresa: s.telefono_trabajo || "",
          ingreso_mensual: fmt(s.ingresos_mensuales || s.ingresos_empresa),
          relacion_ingreso_renta: relacionIngresoRenta,
          uso_declarado: s.uso_inmueble?.toUpperCase() || "HABITACIONAL",
          descripcion_uso: s.descripcion_uso || "",
          num_ocupantes: s.num_habitantes ? String(s.num_habitantes) + " personas" : "",
          mascotas,
          mascotas_detalle: s.detalle_mascotas || "",
          personal_servicio: personalServicio,
          ref1_nombre: s.ref_per1_nombre || s.ref_fam1_nombre || "",
          ref1_telefono: s.ref_per1_telefono || s.ref_fam1_telefono || "",
          ref1_relacion: s.ref_per1_relacion || s.ref_fam1_parentesco || "",
          ref2_nombre: s.ref_per2_nombre || s.ref_fam2_nombre || "",
          ref2_telefono: s.ref_per2_telefono || s.ref_fam2_telefono || "",
          ref2_relacion: s.ref_per2_relacion || s.ref_fam2_parentesco || "",
        }));
        setCargando(false);
      });
  }, [router.query]);

  const handleGenerar = async () => {
    if (!form.folio || !form.nombre_solicitante) { alert("Completa el Folio y Nombre del solicitante."); return; }
    setGenerando(true);
    try {
      const doc = await generarPDF(form);
      doc.save(`Dictamen_${form.folio}_${form.nombre_solicitante.split(" ")[0]}.pdf`);
      setGuardado(true); setTimeout(() => setGuardado(false), 3000);
    } catch (e) { alert("Error: " + e.message); }
    setGenerando(false);
  };

  const DOPTS = [
    { value: "APROBADO", color: "#22c55e", bg: "#dcfce7", tc: "#166534", icon: "✓", label: "APROBADO" },
    { value: "APROBADO CON CONDICIONES", color: "#eab308", bg: "#fef9c3", tc: "#854d0e", icon: "!", label: "CON CONDICIONES" },
    { value: "NO APROBADO", color: "#ef4444", bg: "#fee2e2", tc: "#991b1b", icon: "✗", label: "NO APROBADO" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "'Montserrat',system-ui,sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&display=swap" rel="stylesheet" />

      <div style={{ background: "#1a1a2e", padding: "20px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 2px 16px rgba(0,0,0,0.2)" }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, color: "#C8102E", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Emporio Inmobiliario</p>
          <h1 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: "#fff" }}>📋 Generador de Dictamen</h1>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Poliza Juridica de Desalojo y Deslinde — Habitacional</p>
        </div>
        <a href="/" style={{ color: "#c8a96e", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>← Panel admin</a>
      </div>

      {cargando && (
        <div style={{ background: "#c8a96e", color: "#000", padding: "12px 32px", textAlign: "center", fontWeight: 700, fontSize: 14 }}>
          ⏳ Cargando datos de la solicitud...
        </div>
      )}

      {router.query.solicitud_id && !cargando && (
        <div style={{ background: "#dcfce7", color: "#166534", padding: "12px 32px", textAlign: "center", fontWeight: 700, fontSize: 14 }}>
          ✅ Datos pre-llenados desde la solicitud — revisa y completa los campos necesarios
        </div>
      )}

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "32px 20px" }}>

        <div style={{ background: "#fff", borderRadius: 20, padding: "28px 32px", marginBottom: 20, border: "1px solid #f0f0f0", boxShadow: "0 2px 16px rgba(0,0,0,0.04)" }}>
          <p style={{ margin: "0 0 20px", fontSize: 11, fontWeight: 800, color: "#C8102E", letterSpacing: "0.15em", textTransform: "uppercase" }}>Dictamen Final</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            {DOPTS.map(opt => (
              <button key={opt.value} onClick={() => set("dictamen", opt.value)} style={{
                padding: "20px 12px", borderRadius: 14, cursor: "pointer", textAlign: "center",
                border: form.dictamen === opt.value ? `2.5px solid ${opt.color}` : "2px solid #f3f4f6",
                background: form.dictamen === opt.value ? opt.bg : "#fafafa", transition: "all 0.2s",
              }}>
                <div style={{
                  width: 48, height: 48, borderRadius: "50%", margin: "0 auto 12px",
                  background: form.dictamen === opt.value ? opt.bg : "#f3f4f6",
                  border: form.dictamen === opt.value ? `3px solid ${opt.color}` : "2px solid #e5e7eb",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 22, fontWeight: 900, transition: "all 0.2s",
                  color: form.dictamen === opt.value ? opt.color : "#d1d5db"
                }}>{opt.icon}</div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: form.dictamen === opt.value ? opt.tc : "#9ca3af" }}>{opt.label}</p>
              </button>
            ))}
          </div>
          {form.dictamen === "APROBADO CON CONDICIONES" && (
            <div style={{ marginTop: 20 }}>
              <Campo label="Especifica las condiciones">
                <input value={form.condiciones} onChange={e => set("condiciones", e.target.value)} placeholder="Ej. Requiere aval adicional..." style={inp} />
              </Campo>
            </div>
          )}
        </div>

        <div style={{ background: "#fff", borderRadius: 20, padding: "28px 32px", border: "1px solid #f0f0f0", boxShadow: "0 2px 16px rgba(0,0,0,0.04)" }}>

          <SecTitle>I. Datos Generales</SecTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="Folio" required><input value={form.folio} onChange={e => set("folio", e.target.value)} placeholder="E646" style={inp} /></Campo>
            <Campo label="Fecha"><input value={form.fecha} onChange={e => set("fecha", e.target.value)} style={inp} /></Campo>
            <Campo label="Tipo de solicitante"><select value={form.tipo_solicitante} onChange={e => set("tipo_solicitante", e.target.value)} style={sel}><option>PERSONA FÍSICA</option><option>PERSONA MORAL</option></select></Campo>
          </div>
          <Campo label="Nombre completo del solicitante" required><input value={form.nombre_solicitante} onChange={e => set("nombre_solicitante", e.target.value)} placeholder="Nombre completo tal como aparece en identificacion" style={inp} /></Campo>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="Tipo de identificacion"><select value={form.tipo_identificacion} onChange={e => set("tipo_identificacion", e.target.value)} style={sel}><option>INE</option><option>Pasaporte</option><option>Cedula Profesional</option><option>Otro</option></select></Campo>
            <Campo label="Numero de identificacion"><input value={form.num_identificacion} onChange={e => set("num_identificacion", e.target.value)} placeholder="Clave de elector" style={inp} /></Campo>
            <Campo label="Fecha de nacimiento"><input value={form.fecha_nacimiento} onChange={e => set("fecha_nacimiento", e.target.value)} placeholder="DD/MM/AAAA" style={inp} /></Campo>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Campo label="Telefono del inquilino"><input value={form.telefono_inquilino} onChange={e => set("telefono_inquilino", e.target.value)} placeholder="222 123 4567" style={inp} /></Campo>
            <Campo label="Correo electronico"><input value={form.correo_inquilino} onChange={e => set("correo_inquilino", e.target.value)} placeholder="inquilino@correo.com" style={inp} /></Campo>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
            <Campo label="Domicilio anterior"><input value={form.domicilio_anterior} onChange={e => set("domicilio_anterior", e.target.value)} placeholder="Calle, numero, colonia, ciudad" style={inp} /></Campo>
            <Campo label="Tiempo vivido ahi"><input value={form.tiempo_domicilio_anterior} onChange={e => set("tiempo_domicilio_anterior", e.target.value)} placeholder="Ej. 2 anos" style={inp} /></Campo>
          </div>
          <Campo label="Direccion del inmueble a rentar" required><input value={form.direccion_inmueble} onChange={e => set("direccion_inmueble", e.target.value)} placeholder="Direccion completa" style={inp} /></Campo>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Campo label="Monto de renta mensual" required><input value={form.monto_renta} onChange={e => set("monto_renta", e.target.value)} placeholder="$16,000.00" style={inp} /></Campo>
            <Campo label="Fecha de inicio del contrato"><input value={form.fecha_inicio} onChange={e => set("fecha_inicio", e.target.value)} placeholder="01/05/2026" style={inp} /></Campo>
          </div>

          <SecTitle>II. Actividad y Fuente de Ingresos</SecTitle>
          <Campo label="Actividad principal"><input value={form.actividad_principal} onChange={e => set("actividad_principal", e.target.value)} placeholder="Profesion u ocupacion" style={inp} /></Campo>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="Fuente de ingresos">
              <select value={form.fuente_ingresos} onChange={e => set("fuente_ingresos", e.target.value)} style={sel}>
                <option>NÓMINA</option><option>HONORARIOS</option><option>NEGOCIO PROPIO</option>
                <option>PENSIÓN</option><option>INVERSIONES</option><option>OTRA</option>
              </select>
            </Campo>
            <Campo label="Empresa / Empleador"><input value={form.empresa} onChange={e => set("empresa", e.target.value)} placeholder="Nombre de la empresa" style={inp} /></Campo>
            <Campo label="Telefono RRHH"><input value={form.tel_empresa} onChange={e => set("tel_empresa", e.target.value)} placeholder="222 000 0000" style={inp} /></Campo>
          </div>
          {form.fuente_ingresos === "OTRA" && (
            <Campo label="Especifica la fuente de ingresos">
              <input value={form.fuente_ingresos_otro} onChange={e => set("fuente_ingresos_otro", e.target.value)} placeholder="Describe la fuente de ingresos..." style={{ ...inp, borderColor: "#C8102E" }} />
            </Campo>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="Ingreso mensual"><input value={form.ingreso_mensual} onChange={e => set("ingreso_mensual", e.target.value)} placeholder="$36,000.00" style={inp} /></Campo>
            <Campo label="Relacion ingreso-renta">
              <select value={form.relacion_ingreso_renta} onChange={e => set("relacion_ingreso_renta", e.target.value)} style={sel}>
                <option>Adecuada</option><option>Adecuada — ingresos 2x el monto</option>
                <option>Adecuada — ingresos 2.5x el monto</option><option>Adecuada — ingresos 3x el monto</option>
                <option>Ajustada</option><option>Insuficiente</option>
              </select>
            </Campo>
            <Campo label="Comprobante de ingresos">
              <select value={form.comprobante_ingresos} onChange={e => set("comprobante_ingresos", e.target.value)} style={sel}>
                <option>Sí — 3 recibos de nómina presentados</option><option>Sí — estados de cuenta</option>
                <option>Sí — declaracion fiscal</option><option>Parcial — documentacion incompleta</option>
                <option>No presentado</option>
              </select>
            </Campo>
          </div>

          <SecTitle>III. Uso del Inmueble y Ocupantes</SecTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Campo label="Uso declarado">
              <select value={form.uso_declarado} onChange={e => set("uso_declarado", e.target.value)} style={sel}>
                <option>HABITACIONAL</option><option>COMERCIAL</option><option>MIXTO</option>
              </select>
            </Campo>
            <Campo label="Descripcion del uso"><input value={form.descripcion_uso} onChange={e => set("descripcion_uso", e.target.value)} placeholder="Ej. Casa familiar..." style={inp} /></Campo>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="Numero de ocupantes"><input value={form.num_ocupantes} onChange={e => set("num_ocupantes", e.target.value)} placeholder="Ej. 2 personas" style={inp} /></Campo>
            <Campo label="Mascotas">
              <select value={form.mascotas} onChange={e => set("mascotas", e.target.value)} style={sel}>
                <option>No</option><option>Sí — perro</option><option>Sí — gato</option><option>Sí — especificar</option>
              </select>
            </Campo>
            <Campo label="Personal de servicio">
              <select value={form.personal_servicio} onChange={e => set("personal_servicio", e.target.value)} style={sel}>
                <option>No</option><option>Sí — entrada y salida</option><option>Sí — de planta</option>
              </select>
            </Campo>
          </div>
          {form.mascotas === "Sí — especificar" && (
            <Campo label="Especifica las mascotas">
              <input value={form.mascotas_detalle} onChange={e => set("mascotas_detalle", e.target.value)} placeholder="Ej. 1 perro mediano, 2 gatos..." style={{ ...inp, borderColor: "#C8102E" }} />
            </Campo>
          )}

          <SecTitle>IV. Referencias Personales</SecTitle>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16 }}>
            <Campo label="Referencia 1 — Nombre"><input value={form.ref1_nombre} onChange={e => set("ref1_nombre", e.target.value)} placeholder="Nombre completo" style={inp} /></Campo>
            <Campo label="Telefono"><input value={form.ref1_telefono} onChange={e => set("ref1_telefono", e.target.value)} placeholder="222 000 0000" style={inp} /></Campo>
            <Campo label="Relacion"><input value={form.ref1_relacion} onChange={e => set("ref1_relacion", e.target.value)} placeholder="Colega, familiar..." style={inp} /></Campo>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16 }}>
            <Campo label="Referencia 2 — Nombre"><input value={form.ref2_nombre} onChange={e => set("ref2_nombre", e.target.value)} placeholder="Nombre completo" style={inp} /></Campo>
            <Campo label="Telefono"><input value={form.ref2_telefono} onChange={e => set("ref2_telefono", e.target.value)} placeholder="222 000 0000" style={inp} /></Campo>
            <Campo label="Relacion"><input value={form.ref2_relacion} onChange={e => set("ref2_relacion", e.target.value)} placeholder="Amigo, vecino..." style={inp} /></Campo>
          </div>

          <SecTitle>V. Antecedentes Legales — BuroMexico</SecTitle>
          <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            {["Sin antecedentes", "Con antecedentes"].map(opt => (
              <button key={opt} onClick={() => set("resultado_legal", opt)} style={{
                flex: 1, padding: "14px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14,
                fontFamily: "'Montserrat',sans-serif", border: "2px solid", transition: "all 0.15s",
                borderColor: form.resultado_legal === opt ? (opt === "Sin antecedentes" ? "#22c55e" : "#ef4444") : "#e5e7eb",
                background: form.resultado_legal === opt ? (opt === "Sin antecedentes" ? "#dcfce7" : "#fee2e2") : "#fafafa",
                color: form.resultado_legal === opt ? (opt === "Sin antecedentes" ? "#166534" : "#991b1b") : "#9ca3af",
              }}>{opt === "Sin antecedentes" ? "✓ " : "⚠ "}{opt}</button>
            ))}
          </div>
          {form.resultado_legal === "Con antecedentes" && (
            <Campo label="Descripcion de antecedentes">
              <textarea value={form.observaciones_legales} onChange={e => set("observaciones_legales", e.target.value)} placeholder="Describe los antecedentes..." style={txta} />
            </Campo>
          )}

          <SecTitle>VI. Conclusion y Observaciones</SecTitle>
          <Campo label="Conclusion y recomendacion">
            <textarea value={form.conclusion} onChange={e => set("conclusion", e.target.value)} style={{ ...txta, minHeight: 90 }} />
          </Campo>
          <Campo label="Observaciones adicionales del analista">
            <textarea value={form.observaciones_analista} onChange={e => set("observaciones_analista", e.target.value)} placeholder="Notas adicionales, contexto relevante para el propietario..." style={txta} />
          </Campo>

          <SecTitle>VII. Firma</SecTitle>
          <Campo label="Analista responsable">
            <select value={form.analista} onChange={e => set("analista", e.target.value)} style={sel}>
              <option>LIC. ZAYETZY MONTES LUNA</option>
              <option>LIC. CARLOS NACHÓN</option>
              <option>OTRO</option>
            </select>
          </Campo>

          <div style={{ marginTop: 32, paddingTop: 24, borderTop: "2px solid #f3f4f6" }}>
            <button onClick={handleGenerar} disabled={generando} style={{
              width: "100%",
              background: guardado ? "#22c55e" : generando ? "#9ca3af" : "#C8102E",
              color: "#fff", border: "none", borderRadius: 14, padding: "18px",
              fontWeight: 900, fontSize: 17, cursor: generando ? "not-allowed" : "pointer",
              fontFamily: "'Montserrat',sans-serif", transition: "background 0.3s",
              boxShadow: "0 4px 16px rgba(200,16,46,0.25)",
            }}>
              {guardado ? "✅ PDF descargado correctamente" : generando ? "⏳ Generando PDF..." : "📄 Generar y Descargar Dictamen PDF"}
            </button>
            <p style={{ textAlign: "center", fontSize: 12, color: "#9ca3af", marginTop: 12, fontFamily: "'Montserrat',sans-serif" }}>
              Se descarga automaticamente · No requiere servidor · 100% en el navegador
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
