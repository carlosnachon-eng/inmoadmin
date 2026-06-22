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

// Helvetica estándar (la única fuente garantizada en jsPDF sin embeber
// fuentes adicionales) no soporta emojis ni la mayoría de símbolos fuera del
// rango Latin-1. Sin filtrarlos, se ven como caracteres rotos ("Ø=Ü°").
// Esta función los quita, dejando el resto del texto intacto.
function limpiarTexto(texto) {
  if (!texto) return texto;
  return String(texto)
    .replace(/[^\x20-\x7E\u00A0-\u00FF\n]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

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

// Dibuja la ficha completa de UNA propiedad dentro de un documento jsPDF que
// ya está abierto, empezando en una página nueva. Se usa tanto para la
// ficha individual (un solo llamado) como para el catálogo (un llamado por
// cada propiedad seleccionada, una tras otra).
//
// opciones.esUltima: si es false, no imprime la leyenda PROFECO al final
// (en un catálogo, esa leyenda solo va una vez, al final de todo el documento).
async function dibujarFichaPropiedad(doc, propiedad, logo, opciones = {}) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 44;
  const contentWidth = pageWidth - margin * 2;
  const headerH = 56;
  const topStart = margin + headerH + 14;
  const bottomLimit = pageHeight - 50;

  const fotosUrls = (propiedad.fotos || []).map(urlDeFoto).filter(Boolean);

  let y = topStart;
  let primeraPaginaDeEstaPropiedad = true;

  function drawPageHeader() {
    const hy = margin;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(GRIS_OSCURO);
    doc.text(propiedad.contacto_nombre || "Emporio Inmobiliario", margin, hy + 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(GRIS_CLARO);
    let lineaInfo = hy + 26;
    if (propiedad.contacto_telefono) {
      doc.text(`Celular: ${propiedad.contacto_telefono}`, margin, lineaInfo);
      lineaInfo += 12;
    }
    if (propiedad.contacto_correo) {
      doc.text(propiedad.contacto_correo, margin, lineaInfo);
    }

    const logoMaxW = 110, logoMaxH = 50;
    if (logo) {
      const ratio = Math.min(logoMaxW / logo.width, logoMaxH / logo.height);
      const w = logo.width * ratio, h = logo.height * ratio;
      doc.addImage(logo.dataUrl, logo.formato, pageWidth - margin - w, hy, w, h);
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(ROJO);
      doc.text("EMPORIO", pageWidth - margin, hy + 16, { align: "right" });
    }
  }

  function nuevaPagina() {
    doc.addPage();
    primeraPaginaDeEstaPropiedad = false;
    drawPageHeader();
    y = topStart;
  }

  function ensureSpace(alturaNecesaria) {
    if (y + alturaNecesaria > bottomLimit) {
      nuevaPagina();
    }
  }

  function dibujarTitulo(texto, x, ancho) {
    ensureSpace(18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(GRIS_OSCURO);
    doc.text(texto, x, y);
    y += 16;
  }

  // ══ HEADER (primera página de esta propiedad) ════════════════════════════
  drawPageHeader();
  doc.setDrawColor(GRIS_BORDE);
  doc.setLineWidth(0.75);
  doc.line(margin, margin + headerH - 6, pageWidth - margin, margin + headerH - 6);

  // ══ TÍTULO + PRECIO ═══════════════════════════════════════════════════════
  const tituloAncho = contentWidth * 0.62;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(GRIS_OSCURO);
  const tituloLineas = doc.splitTextToSize(limpiarTexto(propiedad.titulo) || "Propiedad", tituloAncho);
  doc.text(tituloLineas, margin, y);
  const alturaTitulo = tituloLineas.length * 18;

  const operacionLabel = propiedad.operacion === "sale" ? "EN VENTA" : "EN RENTA";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(ROJO);
  doc.text(`${fmt(propiedad.precio)} MXN`, pageWidth - margin, y + 14, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(GRIS_CLARO);
  doc.text(operacionLabel, pageWidth - margin, y + 27, { align: "right" });

  y += Math.max(alturaTitulo, 30) + 8;

  const direccion = [propiedad.direccion, propiedad.colonia, propiedad.ciudad, propiedad.estado].filter(Boolean).join(", ");
  if (direccion) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(GRIS_CLARO);
    doc.text(direccion, margin, y);
    y += 20;
  } else {
    y += 10;
  }

  // ══ FOTOS (hasta 2, modo "contain") ═══════════════════════════════════════
  const fotosPortada = fotosUrls.slice(0, 2);
  if (fotosPortada.length > 0) {
    const gap = 8;
    const fotoW = (contentWidth - gap * (fotosPortada.length - 1)) / Math.max(fotosPortada.length, 1);
    const fotoH = fotoW * 0.62;
    ensureSpace(fotoH + 16);
    let x = margin;
    for (const url of fotosPortada) {
      doc.setFillColor(GRIS_BG);
      doc.rect(x, y, fotoW, fotoH, "F");
      const img = await descargarImagen(url);
      if (img) {
        const ratio = Math.min(fotoW / img.width, fotoH / img.height);
        const w = img.width * ratio, h = img.height * ratio;
        doc.addImage(img.dataUrl, img.formato, x + (fotoW - w) / 2, y + (fotoH - h) / 2, w, h);
      }
      x += fotoW + gap;
    }
    y += fotoH + 18;
  }

  // ══ DATOS CLAVE ═══════════════════════════════════════════════════════════
  const destacados = [];
  if (propiedad.recamaras) destacados.push([String(propiedad.recamaras), "Recámaras"]);
  if (propiedad.banos) destacados.push([String(propiedad.banos), "Baños"]);
  if (propiedad.estacionamientos) destacados.push([String(propiedad.estacionamientos), "Estacionamientos"]);
  if (propiedad.m2_construccion) destacados.push([`${propiedad.m2_construccion} m2`, "Construcción"]);
  if (propiedad.tipo) destacados.push([propiedad.tipo, "Tipo"]);

  if (destacados.length > 0) {
    ensureSpace(46);
    const colW = contentWidth / destacados.length;
    destacados.forEach(([valor, label], i) => {
      const cx = margin + colW * i + colW / 2;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.setTextColor(GRIS_OSCURO);
      doc.text(valor, cx, y, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(GRIS_CLARO);
      doc.text(label, cx, y + 14, { align: "center" });
    });
    y += 34;
  }

  if (primeraPaginaDeEstaPropiedad && propiedad.public_id) {
    ensureSpace(20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(GRIS_OSCURO);
    doc.text(propiedad.public_id, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(GRIS_CLARO);
    doc.text("ID", margin, y + 11);
    y += 24;
  }

  doc.setDrawColor(GRIS_BORDE);
  doc.setLineWidth(0.75);
  ensureSpace(10);
  doc.line(margin, y, pageWidth - margin, y);
  y += 18;

  // ══ DOS COLUMNAS: Descripción + Amenidades ═══════════════════════════════
  const colGap = 24;
  const colDescW = contentWidth * 0.62;
  const colAmenW = contentWidth - colDescW - colGap;
  const colDescX = margin;
  const colAmenX = margin + colDescW + colGap;
  const colStartY = y;

  const amenidades = Array.isArray(propiedad.amenidades) ? propiedad.amenidades : [];
  let amenY = colStartY;
  if (amenidades.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(GRIS_OSCURO);
    doc.text("Amenidades", colAmenX, amenY);
    amenY += 18;
    for (const a of amenidades) {
      const lineas = doc.splitTextToSize(`•  ${limpiarTexto(a)}`, colAmenW);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(GRIS_MEDIO);
      doc.text(lineas, colAmenX, amenY);
      amenY += lineas.length * 13;
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(GRIS_OSCURO);
  doc.text("Descripción", colDescX, colStartY);
  let descY = colStartY + 18;

  if (propiedad.descripcion) {
    const parrafos = limpiarTexto(propiedad.descripcion).split("\n").map((p) => p.trim()).filter(Boolean);
    for (const parrafo of parrafos) {
      const lineas = doc.splitTextToSize(parrafo, colDescW);
      if (descY + lineas.length * 14 > bottomLimit) {
        nuevaPagina();
        descY = y;
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(GRIS_MEDIO);
      doc.text(lineas, colDescX, descY);
      descY += lineas.length * 14 + 8;
    }
  }

  const creditos = Array.isArray(propiedad.creditos_aceptados) ? propiedad.creditos_aceptados : [];
  y = Math.max(descY, amenY) + 10;
  if (creditos.length > 0 && propiedad.operacion === "sale") {
    ensureSpace(36);
    dibujarTitulo("Créditos aceptados", margin, contentWidth);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(GRIS_MEDIO);
    doc.text(creditos.join("    "), margin, y);
    y += 20;
  }

  // ══ LINK A LA FICHA PÚBLICA ═══════════════════════════════════════════════
  if (propiedad.url_publica) {
    ensureSpace(30);
    doc.setFillColor(GRIS_BG);
    doc.roundedRect(margin, y, contentWidth, 26, 5, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(ROJO);
    doc.text("Ver ficha completa y mapa de ubicación", margin + 12, y + 17);
    const anchoEtiqueta = doc.getTextWidth("Ver ficha completa y mapa de ubicación");
    doc.setFont("helvetica", "normal");
    doc.setTextColor(GRIS_OSCURO);
    doc.textWithLink(propiedad.url_publica, margin + 12 + anchoEtiqueta + 10, y + 17, { url: propiedad.url_publica });
    y += 40;
  }

  // ══ GALERÍA DE FOTOS (todas, grid de 2 columnas) ══════════════════════════
  if (fotosUrls.length > 0) {
    ensureSpace(26);
    dibujarTitulo("Fotos", margin, contentWidth);
    const gap = 10;
    const galCols = 2;
    const galW = (contentWidth - gap * (galCols - 1)) / galCols;
    const galH = galW * 0.7;
    let col = 0;
    let rowY = y;
    for (const url of fotosUrls) {
      if (col === 0) ensureSpace(galH + gap);
      const cx = margin + col * (galW + gap);
      if (col === 0) rowY = y;

      doc.setFillColor(GRIS_BG);
      doc.rect(cx, rowY, galW, galH, "F");

      const img = await descargarImagen(url);
      if (img) {
        const ratio = Math.min(galW / img.width, galH / img.height);
        const w = img.width * ratio, h = img.height * ratio;
        doc.addImage(img.dataUrl, img.formato, cx + (galW - w) / 2, rowY + (galH - h) / 2, w, h);
      }
      col++;
      if (col === galCols) {
        col = 0;
        y = rowY + galH + gap;
      }
    }
    if (col !== 0) y = rowY + galH + gap;
  }

  // ══ LEYENDA PROFECO ═══════════════════════════════════════════════════════
  // En ficha individual siempre va. En catálogo, solo en la última propiedad
  // (opciones.esUltima === false la omite para las propiedades intermedias).
  if (opciones.esUltima !== false) {
    ensureSpace(40);
    y += 6;
    doc.setDrawColor(GRIS_BORDE);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(GRIS_CLARO);
    const legalLineas = doc.splitTextToSize(LEYENDA_PROFECO, contentWidth);
    for (const linea of legalLineas) {
      ensureSpace(9);
      doc.text(linea, pageWidth / 2, y, { align: "center" });
      y += 9;
    }
  }
}

// Ficha individual de una sola propiedad (uso normal del botón "Generar PDF").
export async function generarFichaPropiedadPdf(propiedad) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const logo = await descargarImagen("https://www.emporioinmobiliario.com.mx/logo.png");
  await dibujarFichaPropiedad(doc, propiedad, logo, { esUltima: true });
  return Buffer.from(doc.output("arraybuffer"));
}

// Catálogo de varias propiedades en un solo PDF: una propiedad por sección,
// cada una empezando en página nueva, con la leyenda PROFECO solo al final
// del documento completo.
export async function generarCatalogoPropiedadesPdf(propiedades) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const logo = await descargarImagen("https://www.emporioinmobiliario.com.mx/logo.png");

  for (let i = 0; i < propiedades.length; i++) {
    if (i > 0) doc.addPage();
    const esUltima = i === propiedades.length - 1;
    await dibujarFichaPropiedad(doc, propiedades[i], logo, { esUltima });
  }

  return Buffer.from(doc.output("arraybuffer"));
}
