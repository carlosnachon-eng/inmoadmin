import { jsPDF } from "jspdf";

const ROJO = "#C8102E";
const GRIS_OSCURO = "#1a1a2e";
const GRIS_MEDIO = "#4a4a5a";
const GRIS_CLARO = "#6b7280";
const GRIS_BG = "#f5f5f6";
const GRIS_BORDE = "#e5e7eb";
const VERDE_TXT = "#065f46";

const LEYENDA_PROFECO =
  "La información presentada en este documento es de carácter informativo y referencial; no constituye una " +
  "oferta vinculante ni sustituye la información que se proporcione en el contrato correspondiente. En " +
  "cumplimiento de la normatividad de la Procuraduría Federal del Consumidor (PROFECO) en materia de " +
  "publicidad inmobiliaria, Emporio Inmobiliario se compromete a que la información aquí mostrada sea " +
  "veraz y comprobable.";

function fmt(n) {
  if (n === null || n === undefined || n === "") return "";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n);
}

function urlDeFoto(foto) {
  if (typeof foto === "string") return foto;
  if (foto && typeof foto === "object") return foto.url;
  return null;
}

// Descarga una imagen y la regresa como { dataUrl, width, height }, usando
// solo APIs nativas de Node (fetch + lectura manual de cabeceras de imagen),
// sin depender de paquetes externos.
async function descargarImagen(url) {
  try {
    const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; EmporioBot/1.0)" } });
    if (!resp.ok) return null;
    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = resp.headers.get("content-type") || "";
    const formato = contentType.includes("png") ? "PNG" : "JPEG";
    const dims = leerDimensiones(buffer, formato);
    if (!dims) return null;
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${contentType || "image/jpeg"};base64,${base64}`;
    return { dataUrl, width: dims.width, height: dims.height, formato };
  } catch (e) {
    console.error("[generarFichaPropiedadPdf] no se pudo descargar imagen", url, e.message);
    return null;
  }
}

function leerDimensiones(buffer, formato) {
  try {
    if (formato === "PNG") {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height };
      }
      const segmentLength = buffer.readUInt16BE(offset + 2);
      offset += 2 + segmentLength;
    }
    return null;
  } catch {
    return null;
  }
}

export async function generarFichaPropiedadPdf(propiedad) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 44;
  const contentWidth = pageWidth - margin * 2;
  const topStart = 44;
  const bottomLimit = pageHeight - 50; // deja espacio para que el footer nunca se encime con contenido fluido

  let y = topStart;

  // Si lo que sigue no cabe en lo que queda de página, salta a una nueva.
  function ensureSpace(alturaNecesaria) {
    if (y + alturaNecesaria > bottomLimit) {
      doc.addPage();
      y = topStart;
    }
  }

  function dibujarTitulo(texto) {
    ensureSpace(20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(ROJO);
    doc.text(texto, margin, y);
    y += 16;
  }

  function dibujarParrafo(texto, opts = {}) {
    const fontSize = opts.fontSize || 10;
    const lineHeight = opts.lineHeight || 13.5;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(opts.color || GRIS_MEDIO);
    const lineas = doc.splitTextToSize(texto, contentWidth);
    for (const linea of lineas) {
      ensureSpace(lineHeight);
      doc.text(linea, margin, y);
      y += lineHeight;
    }
  }

  // ══ HEADER: logo + tipo de operación ════════════════════════════════════
  const logo = await descargarImagen("https://www.emporioinmobiliario.com.mx/logo.png");
  const logoMaxW = 150, logoMaxH = 80;
  let logoH = 0;
  if (logo) {
    const ratio = Math.min(logoMaxW / logo.width, logoMaxH / logo.height);
    const w = logo.width * ratio;
    logoH = logo.height * ratio;
    doc.addImage(logo.dataUrl, logo.formato, margin, y, w, logoH);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(ROJO);
    doc.text("EMPORIO", margin, y + 22);
    logoH = 30;
  }

  const operacionLabel = propiedad.operacion === "sale" ? "EN VENTA" : "EN RENTA";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(ROJO);
  doc.text(operacionLabel, pageWidth - margin, y + 14, { align: "right" });
  if (propiedad.es_exclusiva) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(GRIS_OSCURO);
    doc.text("EXCLUSIVA", pageWidth - margin, y + 28, { align: "right" });
  }

  y += Math.max(logoH, 30) + 14;
  doc.setDrawColor(ROJO);
  doc.setLineWidth(2.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 24;

  // ══ TÍTULO, DIRECCIÓN, PRECIO ═════════════════════════════════════════════
  dibujarParrafo(propiedad.titulo || "Propiedad", { fontSize: 16, lineHeight: 19, bold: true, color: GRIS_OSCURO });
  y += 2;

  const direccion = [propiedad.direccion, propiedad.colonia, propiedad.ciudad, propiedad.estado].filter(Boolean).join(", ");
  if (direccion) {
    dibujarParrafo(direccion, { fontSize: 10, lineHeight: 13, color: GRIS_CLARO });
    y += 6;
  }

  if (propiedad.precio) {
    ensureSpace(34);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(25);
    doc.setTextColor(ROJO);
    doc.text(`${fmt(propiedad.precio)} MXN`, margin, y + 4);
    y += 38;
  }

  // ══ FOTOS (hasta 3, centradas dentro de su columna) ══════════════════════
  const fotos = (propiedad.fotos || []).map(urlDeFoto).filter(Boolean).slice(0, 3);
  if (fotos.length > 0) {
    const gap = 8;
    const fotoW = (contentWidth - gap * (fotos.length - 1)) / fotos.length;
    const fotoH = fotoW * 0.72;
    ensureSpace(fotoH + 18);
    let x = margin;
    for (const url of fotos) {
      const img = await descargarImagen(url);
      if (img) {
        const ratio = Math.min(fotoW / img.width, fotoH / img.height);
        const w = img.width * ratio, h = img.height * ratio;
        const offsetX = x + (fotoW - w) / 2;
        const offsetY = y + (fotoH - h) / 2;
        doc.addImage(img.dataUrl, img.formato, offsetX, offsetY, w, h);
      }
      x += fotoW + gap;
    }
    y += fotoH + 18;
  }

  // ══ DATOS DESTACADOS (caja gris) ══════════════════════════════════════════
  const destacados = [];
  if (propiedad.tipo) destacados.push(["TIPO", propiedad.tipo]);
  if (propiedad.recamaras) destacados.push(["RECÁMARAS", String(propiedad.recamaras)]);
  if (propiedad.banos) destacados.push(["BAÑOS", String(propiedad.banos)]);
  if (propiedad.estacionamientos) destacados.push(["ESTAC.", String(propiedad.estacionamientos)]);
  if (propiedad.m2_construccion) destacados.push(["M2 CONSTR.", String(propiedad.m2_construccion)]);
  if (propiedad.m2_terreno) destacados.push(["M2 TERRENO", String(propiedad.m2_terreno)]);

  if (destacados.length > 0) {
    const boxH = 48;
    ensureSpace(boxH + 18);
    doc.setFillColor(GRIS_BG);
    doc.roundedRect(margin, y, contentWidth, boxH, 5, 5, "F");
    const colW = contentWidth / destacados.length;
    destacados.forEach(([label, valor], i) => {
      const cx = margin + colW * i + 12;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(GRIS_CLARO);
      doc.text(label, cx, y + 18);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12.5);
      doc.setTextColor(GRIS_OSCURO);
      doc.text(valor, cx, y + 35);
    });
    y += boxH + 18;
  }

  // ══ DESCRIPCIÓN (respeta saltos de línea como párrafos separados) ════════
  if (propiedad.descripcion) {
    dibujarTitulo("DESCRIPCIÓN");
    const parrafos = String(propiedad.descripcion).split("\n").map((p) => p.trim()).filter(Boolean);
    for (const parrafo of parrafos) {
      dibujarParrafo(parrafo, { fontSize: 10, lineHeight: 14 });
      y += 6;
    }
    y += 4;
  }

  // ══ AMENIDADES ════════════════════════════════════════════════════════════
  const amenidades = Array.isArray(propiedad.amenidades) ? propiedad.amenidades : [];
  if (amenidades.length > 0) {
    dibujarTitulo("AMENIDADES");
    dibujarParrafo(amenidades.map((a) => `•  ${a}`).join("    "), { fontSize: 9.5, lineHeight: 18, bold: true, color: VERDE_TXT });
    y += 8;
  }

  // ══ CRÉDITOS ACEPTADOS (solo venta) ═══════════════════════════════════════
  const creditos = Array.isArray(propiedad.creditos_aceptados) ? propiedad.creditos_aceptados : [];
  if (creditos.length > 0 && propiedad.operacion === "sale") {
    dibujarTitulo("CRÉDITOS ACEPTADOS");
    dibujarParrafo(creditos.join("    "), { fontSize: 10, lineHeight: 14 });
    y += 8;
  }

  // ══ FOOTER: justo después del contenido real, nunca se encima ═══════════
  ensureSpace(56);
  y += 8;
  doc.setDrawColor(GRIS_BORDE);
  doc.setLineWidth(0.75);
  doc.line(margin, y, pageWidth - margin, y);
  y += 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(GRIS_OSCURO);
  const contacto = propiedad.contacto_nombre || "Emporio Inmobiliario";
  const tel = propiedad.contacto_telefono || "";
  doc.text(tel ? `${contacto}  ·  ${tel}` : contacto, pageWidth / 2, y, { align: "center" });
  y += 16;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(GRIS_CLARO);
  const legalLineas = doc.splitTextToSize(LEYENDA_PROFECO, contentWidth - 40);
  for (const linea of legalLineas) {
    doc.text(linea, pageWidth / 2, y, { align: "center" });
    y += 9.5;
  }

  return Buffer.from(doc.output("arraybuffer"));
}
