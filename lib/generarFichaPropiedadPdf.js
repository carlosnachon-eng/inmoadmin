import { jsPDF } from "jspdf";

const ROJO = "#C8102E";
const GRIS_OSCURO = "#1a1a2e";
const GRIS_MEDIO = "#4a4a5a";
const GRIS_CLARO = "#6b7280";
const GRIS_BG = "#f5f5f7";
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

// Descarga una imagen y la regresa como { dataUrl, width, height } usando
// solo APIs disponibles en Node (sin canvas), detectando dimensiones a partir
// de los bytes del archivo (soporta JPEG y PNG, que es lo único que sube el
// sistema de fotos de propiedades).
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
    console.error("[generar-pdf-propiedad] no se pudo descargar imagen", url, e.message);
    return null;
  }
}

// Lee el ancho/alto de un JPEG o PNG directamente de sus bytes, sin
// dependencias externas (jsPDF necesita estas dimensiones para no deformar
// la imagen al insertarla).
function leerDimensiones(buffer, formato) {
  try {
    if (formato === "PNG") {
      // IHDR siempre empieza en el byte 16 para un PNG válido
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
    // JPEG: recorrer los markers buscando el SOF (Start Of Frame)
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
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  let y = 40;

  // ── Header: logo + tipo de operación ──────────────────────────────────────
  const logo = await descargarImagen("https://www.emporioinmobiliario.com.mx/logo.png");
  if (logo) {
    const logoMaxW = 140, logoMaxH = 78;
    const ratio = Math.min(logoMaxW / logo.width, logoMaxH / logo.height);
    const w = logo.width * ratio, h = logo.height * ratio;
    doc.addImage(logo.dataUrl, logo.formato, margin, y, w, h);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(ROJO);
    doc.text("EMPORIO", margin, y + 24);
  }

  const operacionLabel = propiedad.operacion === "sale" ? "EN VENTA" : "EN RENTA";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(ROJO);
  doc.text(operacionLabel, pageWidth - margin, y + 16, { align: "right" });
  if (propiedad.es_exclusiva) {
    doc.setFontSize(9);
    doc.setTextColor(GRIS_OSCURO);
    doc.text("EXCLUSIVA", pageWidth - margin, y + 30, { align: "right" });
  }

  y += 70;
  doc.setDrawColor(ROJO);
  doc.setLineWidth(2.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 24;

  // ── Título y dirección ──────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(GRIS_OSCURO);
  const tituloLineas = doc.splitTextToSize(propiedad.titulo || "Propiedad", contentWidth);
  doc.text(tituloLineas, margin, y);
  y += tituloLineas.length * 18 + 4;

  const direccion = [propiedad.direccion, propiedad.colonia, propiedad.ciudad, propiedad.estado].filter(Boolean).join(", ");
  if (direccion) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(GRIS_CLARO);
    const dirLineas = doc.splitTextToSize(direccion, contentWidth);
    doc.text(dirLineas, margin, y);
    y += dirLineas.length * 13 + 10;
  }

  // ── Precio ──────────────────────────────────────────────────────────────
  if (propiedad.precio) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.setTextColor(ROJO);
    doc.text(`${fmt(propiedad.precio)} MXN`, margin, y + 6);
    y += 36;
  }

  // ── Fotos (hasta 3 en una fila) ─────────────────────────────────────────
  const fotos = Array.isArray(propiedad.fotos) ? propiedad.fotos.slice(0, 3) : [];
  if (fotos.length > 0) {
    const gap = 8;
    const fotoW = (contentWidth - gap * (fotos.length - 1)) / fotos.length;
    const fotoH = fotoW * 0.72;
    let x = margin;
    let alturaMaxFila = 0;
    for (const foto of fotos) {
      const url = typeof foto === "string" ? foto : foto?.url;
      if (!url) continue;
      const img = await descargarImagen(url);
      if (img) {
        const ratio = Math.min(fotoW / img.width, fotoH / img.height);
        const w = img.width * ratio, h = img.height * ratio;
        const offsetX = x + (fotoW - w) / 2;
        doc.addImage(img.dataUrl, img.formato, offsetX, y, w, h);
        alturaMaxFila = Math.max(alturaMaxFila, h);
      }
      x += fotoW + gap;
    }
    y += (alturaMaxFila || fotoH) + 20;
  }

  // ── Datos destacados (tabla de chips) ──────────────────────────────────
  const destacados = [];
  if (propiedad.tipo) destacados.push(["TIPO", propiedad.tipo]);
  if (propiedad.recamaras) destacados.push(["RECÁMARAS", String(propiedad.recamaras)]);
  if (propiedad.banos) destacados.push(["BAÑOS", String(propiedad.banos)]);
  if (propiedad.estacionamientos) destacados.push(["ESTAC.", String(propiedad.estacionamientos)]);
  if (propiedad.m2_construccion) destacados.push(["M2 CONSTR.", String(propiedad.m2_construccion)]);
  if (propiedad.m2_terreno) destacados.push(["M2 TERRENO", String(propiedad.m2_terreno)]);

  if (destacados.length > 0) {
    const boxH = 46;
    doc.setFillColor(GRIS_BG);
    doc.roundedRect(margin, y, contentWidth, boxH, 4, 4, "F");
    const colW = contentWidth / destacados.length;
    destacados.forEach(([label, valor], i) => {
      const cx = margin + colW * i + 10;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(GRIS_CLARO);
      doc.text(label, cx, y + 16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(GRIS_OSCURO);
      doc.text(valor, cx, y + 33);
    });
    y += boxH + 20;
  }

  // ── Descripción ─────────────────────────────────────────────────────────
  if (propiedad.descripcion) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(ROJO);
    doc.text("DESCRIPCIÓN", margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(GRIS_MEDIO);
    const descLineas = doc.splitTextToSize(propiedad.descripcion, contentWidth);
    doc.text(descLineas, margin, y);
    y += descLineas.length * 13 + 14;
  }

  // ── Amenidades ──────────────────────────────────────────────────────────
  const amenidades = Array.isArray(propiedad.amenidades) ? propiedad.amenidades : [];
  if (amenidades.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(ROJO);
    doc.text("AMENIDADES", margin, y);
    y += 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(VERDE_TXT);
    const amenidadesTexto = amenidades.map((a) => `• ${a}`).join("    ");
    const amenidadesLineas = doc.splitTextToSize(amenidadesTexto, contentWidth);
    doc.text(amenidadesLineas, margin, y);
    y += amenidadesLineas.length * 13 + 14;
  }

  // ── Créditos aceptados (solo venta) ─────────────────────────────────────
  const creditos = Array.isArray(propiedad.creditos_aceptados) ? propiedad.creditos_aceptados : [];
  if (creditos.length > 0 && propiedad.operacion === "sale") {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(ROJO);
    doc.text("CRÉDITOS ACEPTADOS", margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(GRIS_MEDIO);
    doc.text(creditos.join("    "), margin, y);
    y += 24;
  }

  // ── Footer / contacto + leyenda PROFECO ─────────────────────────────────
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 70;
  doc.setDrawColor("#e5e7eb");
  doc.setLineWidth(0.5);
  doc.line(margin, footerY, pageWidth - margin, footerY);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(GRIS_OSCURO);
  const contacto = propiedad.contacto_nombre || "Emporio Inmobiliario";
  const tel = propiedad.contacto_telefono || "";
  doc.text(tel ? `${contacto} · ${tel}` : contacto, pageWidth / 2, footerY + 16, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(GRIS_CLARO);
  const legalLineas = doc.splitTextToSize(LEYENDA_PROFECO, contentWidth);
  doc.text(legalLineas, pageWidth / 2, footerY + 28, { align: "center" });

  return Buffer.from(doc.output("arraybuffer"));
}
