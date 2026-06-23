import { jsPDF } from "jspdf";

const ROJO = "#C8102E";
const GRIS_OSCURO = "#1a1a2e";
const GRIS_MEDIO = "#4a4a5a";
const GRIS_CLARO = "#6b7280";
const GRIS_BG = "#f5f5f6";
const GRIS_BORDE = "#e5e7eb";
const VERDE_TXT = "#065f46";
const VERDE_BG = "#f0fdf4";

function fmt(n) {
  if (n === null || n === undefined || n === "") return "";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n);
}

function fmtFecha(d) {
  return new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

async function descargarImagen(url) {
  try {
    const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; EmporioBot/1.0)" } });
    if (!resp.ok) return null;
    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString("base64");
    return { dataUrl: `data:image/png;base64,${base64}`, formato: "PNG" };
  } catch {
    return null;
  }
}

export async function generarReportePropietarioPdf({ propiedad, propietario, periodo, datos }) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 44;
  const contentWidth = pageWidth - margin * 2;
  const bottomLimit = pageHeight - 50;

  let y = margin;

  function ensureSpace(h) {
    if (y + h > bottomLimit) {
      doc.addPage();
      y = margin;
    }
  }

  // ── Header ──────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(ROJO);
  doc.text("EMPORIO", margin, y + 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(GRIS_CLARO);
  doc.text("Reporte mensual de actividad", pageWidth - margin, y + 8, { align: "right" });
  doc.text(`${fmtFecha(periodo.desde)} — ${fmtFecha(periodo.hasta)}`, pageWidth - margin, y + 20, { align: "right" });

  y += 38;
  doc.setDrawColor(ROJO);
  doc.setLineWidth(2.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 24;

  // ── Saludo + propiedad ──────────────────────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(GRIS_OSCURO);
  doc.text(`Hola ${propietario?.nombre_propietario || ""},`, margin, y);
  y += 20;
  doc.setFontSize(10);
  doc.setTextColor(GRIS_MEDIO);
  const intro = doc.splitTextToSize(
    "Te compartimos un resumen de la actividad de tu propiedad durante este periodo, para que tengas visibilidad de cómo va su promoción.",
    contentWidth
  );
  doc.text(intro, margin, y);
  y += intro.length * 13 + 14;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(GRIS_OSCURO);
  doc.text(propiedad.titulo, margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(GRIS_CLARO);
  doc.text([propiedad.direccion, propiedad.colonia, propiedad.ciudad].filter(Boolean).join(", "), margin, y);
  y += 24;

  // ── Tarjetas de resumen ─────────────────────────────────────────────────
  const tarjetas = [
    [String(datos.visitas.length), "Visitas a la ficha"],
    [String(datos.envios.length), "Envíos realizados"],
    [String(datos.solicitudes.length), "Solicitudes de contacto"],
    [String(datos.citas.length), "Citas agendadas"],
  ];
  const boxH = 50;
  ensureSpace(boxH + 16);
  const colW = contentWidth / tarjetas.length;
  tarjetas.forEach(([valor, label], i) => {
    const destacar = (i === 2 && datos.solicitudes.length > 0) || (i === 3 && datos.citas.length > 0);
    const bx = margin + colW * i;
    doc.setFillColor(destacar ? VERDE_BG : GRIS_BG);
    doc.roundedRect(bx, y, colW - 8, boxH, 6, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(destacar ? VERDE_TXT : GRIS_OSCURO);
    doc.text(valor, bx + (colW - 8) / 2, y + 28, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(GRIS_CLARO);
    doc.text(label, bx + (colW - 8) / 2, y + 42, { align: "center" });
  });
  y += boxH + 24;

  // ── Citas agendadas para la propiedad ────────────────────────────────────
  // Esta sección representa interés comercial real (alguien que agendó
  // tiempo para conocer la propiedad en persona), distinto de una simple
  // visita a la página web.
  if (datos.citas.length > 0) {
    ensureSpace(20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(GRIS_OSCURO);
    doc.text("Citas agendadas para conocer tu propiedad", margin, y);
    y += 18;
    const ESTADO_LABEL = { agendada: "Agendada", efectiva: "Se realizó", calificada: "Cliente interesado", cancelada: "Cancelada", no_show: "No se presentó" };
    for (const c of datos.citas) {
      ensureSpace(16);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(GRIS_MEDIO);
      doc.text(fmtFecha(c.fecha_hora), margin, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(GRIS_OSCURO);
      doc.text(ESTADO_LABEL[c.estado] || c.estado, pageWidth - margin, y, { align: "right" });
      y += 14;
    }
    y += 8;
  }

  // ── Solicitudes de contacto ─────────────────────────────────────────────
  if (datos.solicitudes.length > 0) {
    ensureSpace(20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(GRIS_OSCURO);
    doc.text("Personas interesadas que se pusieron en contacto", margin, y);
    y += 18;
    for (const s of datos.solicitudes) {
      ensureSpace(28);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(GRIS_OSCURO);
      doc.text(s.nombre || "—", margin, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(GRIS_CLARO);
      doc.text(fmtFecha(s.created_at), pageWidth - margin, y, { align: "right" });
      y += 13;
      doc.setFontSize(9);
      doc.setTextColor(GRIS_MEDIO);
      doc.text(`${s.telefono || ""}${s.email ? "  ·  " + s.email : ""}`, margin, y);
      y += 16;
    }
    y += 8;
  }

  // ── Envíos realizados ───────────────────────────────────────────────────
  if (datos.envios.length > 0) {
    ensureSpace(20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(GRIS_OSCURO);
    doc.text("Promoción activa de tu propiedad", margin, y);
    y += 18;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(GRIS_MEDIO);
    const correoCount = datos.envios.filter((e) => e.medio === "correo").length;
    const whatsappCount = datos.envios.filter((e) => e.medio === "whatsapp").length;
    const ligaCount = datos.envios.filter((e) => e.medio === "liga_copiada").length;
    const resumenEnvios = [
      correoCount > 0 ? `${correoCount} ${correoCount === 1 ? "envío" : "envíos"} por correo a prospectos interesados` : null,
      whatsappCount > 0 ? `${whatsappCount} ${whatsappCount === 1 ? "envío" : "envíos"} por WhatsApp con la liga de tu propiedad` : null,
      ligaCount > 0 ? `${ligaCount} ${ligaCount === 1 ? "vez" : "veces"} se compartió la liga de tu propiedad con prospectos` : null,
    ].filter(Boolean);
    for (const linea of resumenEnvios) {
      ensureSpace(14);
      doc.text(`•  ${linea}`, margin, y);
      y += 14;
    }
    y += 8;
  }

  if (datos.visitas.length === 0 && datos.envios.length === 0 && datos.solicitudes.length === 0 && datos.citas.length === 0) {
    ensureSpace(20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(GRIS_MEDIO);
    doc.text("No se registró actividad durante este periodo.", margin, y);
    y += 20;
  }

  // ── Footer / leyenda ────────────────────────────────────────────────────
  ensureSpace(50);
  y += 10;
  doc.setDrawColor(GRIS_BORDE);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(GRIS_OSCURO);
  doc.text("Emporio Inmobiliario", pageWidth / 2, y, { align: "center" });
  y += 13;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(GRIS_CLARO);
  doc.text("Cualquier duda, estamos a tus órdenes.", pageWidth / 2, y, { align: "center" });

  return Buffer.from(doc.output("arraybuffer"));
}
