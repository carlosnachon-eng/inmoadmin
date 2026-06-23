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

// Resumen ejecutivo con criterio: combina visitas + citas del periodo actual
// contra el anterior para dar una sola frase de interpretación, en vez de
// solo enumerar números sueltos.
function construirResumenEjecutivo(datos) {
  const totalActividad = datos.visitas.length + datos.citas.length + datos.solicitudes.length;

  if (totalActividad === 0) {
    return "Esta propiedad no tuvo actividad registrada durante este periodo.";
  }

  const partes = [];
  if (datos.citas.length > 0) {
    partes.push(`${datos.citas.length} cita${datos.citas.length === 1 ? "" : "s"} agendada${datos.citas.length === 1 ? "" : "s"}`);
  }
  if (datos.visitas.length > 0) {
    partes.push(`${datos.visitas.length} visita${datos.visitas.length === 1 ? "" : "s"} a la ficha`);
  }
  if (datos.solicitudes.length > 0) {
    partes.push(`${datos.solicitudes.length} solicitud${datos.solicitudes.length === 1 ? "" : "es"} de contacto`);
  }
  const detalle = partes.join(", ");

  if (!datos.comparativaAnterior) {
    return `Este periodo tu propiedad registró ${detalle}.`;
  }

  const totalAnterior = datos.comparativaAnterior.visitas + datos.comparativaAnterior.citas;
  const totalActualComparable = datos.visitas.length + datos.citas.length;
  const diferencia = totalActualComparable - totalAnterior;

  let calificativo;
  if (totalAnterior === 0 && totalActualComparable > 0) calificativo = "un buen arranque de actividad";
  else if (diferencia > 0) calificativo = "más actividad que el periodo anterior";
  else if (diferencia < 0) calificativo = "menos actividad que el periodo anterior";
  else calificativo = "un nivel de actividad similar al periodo anterior";

  return `Este periodo tu propiedad tuvo ${calificativo}, con ${detalle}.`;
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
    return { dataUrl: `data:${contentType || "image/png"};base64,${base64}`, width: dims.width, height: dims.height, formato };
  } catch {
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

export async function generarReportePropietarioPdf({ propiedad, propietario, periodo, datos, asesorNombre }) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 44;
  const contentWidth = pageWidth - margin * 2;
  const bottomLimit = pageHeight - 50;
  const padCard = 14;

  let y = margin;

  function ensureSpace(h) {
    if (y + h > bottomLimit) {
      doc.addPage();
      y = margin;
    }
  }

  // Dibuja una "card": fondo gris claro con esquinas redondeadas, un título
  // con ícono y una lista de líneas de texto debajo, todo con padding
  // generoso. Mide el contenido primero para reservar el alto exacto y
  // llamar ensureSpace ANTES de pintar nada — así nunca se corta una card
  // a la mitad entre dos páginas.
  function dibujarCard(titulo, lineas, { lineasDerecha, acento } = {}) {
    const lineHeight = 13;
    const alturaTitulo = 22;
    const alturaContenido = lineas.length * lineHeight;
    const alturaTotal = alturaTitulo + alturaContenido + padCard * 1.4;

    ensureSpace(alturaTotal + 10);

    doc.setFillColor(GRIS_BG);
    doc.roundedRect(margin, y, contentWidth, alturaTotal, 8, 8, "F");

    // Acento de color a la izquierda — sustituye al ícono/emoji (la fuente
    // Helvetica estándar de jsPDF no renderiza emojis Unicode) dando
    // identidad visual a cada tipo de sección sin depender de glifos.
    doc.setFillColor(acento || ROJO);
    doc.roundedRect(margin, y, 4, alturaTotal, 2, 2, "F");

    let cy = y + padCard + 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(GRIS_OSCURO);
    doc.text(titulo, margin + padCard, cy);
    cy += alturaTitulo;

    lineas.forEach((linea, i) => {
      doc.setFont("helvetica", linea.bold ? "bold" : "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(linea.color || GRIS_MEDIO);
      doc.text(linea.texto, margin + padCard, cy);
      if (lineasDerecha && lineasDerecha[i]) {
        doc.setFont("helvetica", lineasDerecha[i].bold ? "bold" : "normal");
        doc.setTextColor(lineasDerecha[i].color || GRIS_CLARO);
        doc.text(lineasDerecha[i].texto, pageWidth - margin - padCard, cy, { align: "right" });
      }
      cy += lineHeight;
    });

    y += alturaTotal + 16;
  }

  // ── Header ──────────────────────────────────────────────────────────────
  const logo = await descargarImagen("https://www.emporioinmobiliario.com.mx/logo.png");
  let alturaLogo = 24; // altura del fallback de texto "EMPORIO"
  if (logo) {
    const logoMaxW = 130, logoMaxH = 60;
    const ratio = Math.min(logoMaxW / logo.width, logoMaxH / logo.height);
    const w = logo.width * ratio, h = logo.height * ratio;
    doc.addImage(logo.dataUrl, logo.formato, margin, y, w, h);
    alturaLogo = h;
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(ROJO);
    doc.text("EMPORIO", margin, y + 18);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(GRIS_CLARO);
  doc.text("Reporte mensual de actividad", pageWidth - margin, y + 8, { align: "right" });
  doc.text(`${fmtFecha(periodo.desde)} — ${fmtFecha(periodo.hasta)}`, pageWidth - margin, y + 20, { align: "right" });

  // Avanzar lo suficiente para no encimarse con el logo, sin importar si
  // mide más o menos que el bloque de texto de la derecha.
  y += Math.max(alturaLogo, 30) + 10;
  doc.setDrawColor(ROJO);
  doc.setLineWidth(2.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 24;

  // ── Saludo ──────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(GRIS_OSCURO);
  doc.text(`Hola ${propietario?.nombre_propietario || ""},`, margin, y);
  y += 18;
  doc.setFontSize(9.5);
  doc.setTextColor(GRIS_MEDIO);
  const intro = doc.splitTextToSize(
    "Te compartimos un resumen de la actividad de tu propiedad durante este periodo, para que tengas visibilidad de cómo va su promoción.",
    contentWidth
  );
  doc.text(intro, margin, y);
  y += intro.length * 12 + 16;

  // ── Banner de foto de la propiedad ───────────────────────────────────────
  // La primera foto del catálogo (la que se usa como portada) se muestra a
  // todo lo ancho, con el título y la dirección superpuestos en una franja
  // oscura inferior. Si la propiedad no tiene fotos, cae a un bloque de
  // color de marca con el mismo texto encima, sin romper el layout.
  const fotoPortadaUrl = Array.isArray(propiedad.fotos) && propiedad.fotos[0] ? (propiedad.fotos[0].url || propiedad.fotos[0]) : null;
  const bannerH = 130;
  const franjaH = 46;
  ensureSpace(bannerH + 20);

  const fotoPortada = fotoPortadaUrl ? await descargarImagen(fotoPortadaUrl) : null;
  if (fotoPortada) {
    // jsPDF dibuja la imagen completa ajustada al ancho disponible
    // (cover horizontal); como el banner es mucho más ancho que alto en la
    // mayoría de fotos de propiedad, el recorte visual es mínimo y se ve
    // limpio sin necesitar manipulación de pixeles fuera del navegador.
    doc.addImage(fotoPortada.dataUrl, fotoPortada.formato, margin, y, contentWidth, bannerH, undefined, "FAST");
  } else {
    doc.setFillColor(GRIS_OSCURO);
    doc.roundedRect(margin, y, contentWidth, bannerH, 8, 8, "F");
  }

  // Franja oscura semitransparente en la base del banner con título + dirección.
  if (doc.GState) {
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.55 }));
    doc.setFillColor(0, 0, 0);
    doc.rect(margin, y + bannerH - franjaH, contentWidth, franjaH, "F");
    doc.restoreGraphicsState();
  } else {
    doc.setFillColor(GRIS_OSCURO);
    doc.rect(margin, y + bannerH - franjaH, contentWidth, franjaH, "F");
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor("#ffffff");
  const tituloLineas = doc.splitTextToSize(propiedad.titulo || "Propiedad", contentWidth - 24);
  doc.text(tituloLineas[0], margin + 12, y + bannerH - franjaH + 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor("#e5e7eb");
  doc.text([propiedad.direccion, propiedad.colonia, propiedad.ciudad].filter(Boolean).join(", "), margin + 12, y + bannerH - franjaH + 32);

  y += bannerH + 16;

  // ── Resumen ejecutivo (una frase con criterio) ───────────────────────────
  const resumenTexto = construirResumenEjecutivo(datos);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(10);
  const resumenLineas = doc.splitTextToSize(resumenTexto, contentWidth - padCard * 2);
  const alturaResumen = resumenLineas.length * 13 + padCard * 1.4;
  ensureSpace(alturaResumen + 16);
  doc.setFillColor(VERDE_BG);
  doc.roundedRect(margin, y, contentWidth, alturaResumen, 8, 8, "F");
  doc.setTextColor(VERDE_TXT);
  doc.text(resumenLineas, margin + padCard, y + padCard + 6);
  y += alturaResumen + 24;

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

  // ── Comparación con el periodo anterior (gráfica de barras) ──────────────
  if (datos.comparativaAnterior) {
    const comparaciones = [
      ["Visitas a la ficha", datos.visitas.length, datos.comparativaAnterior.visitas],
      ["Citas agendadas", datos.citas.length, datos.comparativaAnterior.citas],
    ];
    const alturaBloque = comparaciones.length * 52 + 24;
    ensureSpace(alturaBloque);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(GRIS_OSCURO);
    doc.text("Comparado con el periodo anterior", margin, y);
    y += 18;

    const maxBarW = contentWidth - 70; // deja espacio a la derecha para el número
    const barH = 14;
    const gapBarras = 4;

    for (const [label, actual, anterior] of comparaciones) {
      const diferencia = actual - anterior;
      const igual = diferencia === 0;
      const subio = diferencia > 0;
      const maxValor = Math.max(actual, anterior, 1);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(GRIS_MEDIO);
      doc.text(label, margin, y);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(igual ? GRIS_CLARO : subio ? VERDE_TXT : "#991b1b");
      const textoComparacion = igual ? "Sin cambio" : `${subio ? "+" : "-"}${Math.abs(diferencia)}`;
      doc.text(textoComparacion, pageWidth - margin, y, { align: "right" });
      y += 10;

      // Barra del periodo anterior (gris)
      const wAnterior = Math.max((anterior / maxValor) * maxBarW, anterior > 0 ? 4 : 0);
      doc.setFillColor(GRIS_BORDE);
      doc.roundedRect(margin, y, maxBarW, barH, 3, 3, "F");
      if (wAnterior > 0) {
        doc.setFillColor("#9ca3af");
        doc.roundedRect(margin, y, wAnterior, barH, 3, 3, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(GRIS_CLARO);
      doc.text(`${anterior} antes`, margin + maxBarW + 8, y + barH - 4);
      y += barH + gapBarras;

      // Barra del periodo actual (rojo de marca)
      const wActual = Math.max((actual / maxValor) * maxBarW, actual > 0 ? 4 : 0);
      doc.setFillColor(GRIS_BORDE);
      doc.roundedRect(margin, y, maxBarW, barH, 3, 3, "F");
      if (wActual > 0) {
        doc.setFillColor(ROJO);
        doc.roundedRect(margin, y, wActual, barH, 3, 3, "F");
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(ROJO);
      doc.text(`${actual} ahora`, margin + maxBarW + 8, y + barH - 4);
      y += barH + 16;
    }
    y += 4;
  }

  // ── Citas agendadas para la propiedad ────────────────────────────────────
  // Esta sección representa interés comercial real (alguien que agendó
  // tiempo para conocer la propiedad en persona), distinto de una simple
  // visita a la página web.
  if (datos.citas.length > 0) {
    const efectivas = datos.citas.filter((c) => c.estado === "efectiva" || c.estado === "calificada").length;
    const calificadas = datos.citas.filter((c) => c.estado === "calificada").length;
    const ESTADO_LABEL = { agendada: "Agendada", efectiva: "Se realizó", calificada: "Cliente interesado", cancelada: "Cancelada", no_show: "No se presentó" };
    const ESTADO_COLOR = { calificada: VERDE_TXT, efectiva: "#1e40af", cancelada: "#991b1b", no_show: "#991b1b" };

    const resumen = [
      `${datos.citas.length} cita${datos.citas.length === 1 ? "" : "s"} agendada${datos.citas.length === 1 ? "" : "s"} en total`,
      efectivas > 0 ? `${efectivas} se realizaron` : null,
      calificadas > 0 ? `${calificadas} cliente${calificadas === 1 ? "" : "s"} interesado${calificadas === 1 ? "" : "s"} después de conocer la propiedad` : null,
    ].filter(Boolean).map((t) => ({ texto: `•  ${t}` }));

    const detalle = datos.citas.map((c) => ({ texto: fmtFecha(c.fecha_hora) }));
    const detalleDerecha = datos.citas.map((c) => ({ texto: ESTADO_LABEL[c.estado] || c.estado, bold: true, color: ESTADO_COLOR[c.estado] || GRIS_OSCURO }));

    dibujarCard("Citas agendadas para conocer tu propiedad", [...resumen, { texto: "" }, ...detalle], {
      lineasDerecha: [...resumen.map(() => null), null, ...detalleDerecha],
      acento: ROJO,
    });
  }

  // ── Solicitudes de contacto ─────────────────────────────────────────────
  if (datos.solicitudes.length > 0) {
    const lineas = [];
    const lineasDerecha = [];
    for (const s of datos.solicitudes) {
      lineas.push({ texto: s.nombre || "—", bold: true, color: GRIS_OSCURO });
      lineasDerecha.push({ texto: fmtFecha(s.created_at), color: GRIS_CLARO });
      lineas.push({ texto: `${s.telefono || ""}${s.email ? "  ·  " + s.email : ""}` });
      lineasDerecha.push(null);
    }
    dibujarCard("Personas interesadas que se pusieron en contacto", lineas, { lineasDerecha, acento: VERDE_TXT });
  }

  // ── Envíos realizados ───────────────────────────────────────────────────
  if (datos.envios.length > 0) {
    const correoCount = datos.envios.filter((e) => e.medio === "correo").length;
    const whatsappCount = datos.envios.filter((e) => e.medio === "whatsapp").length;
    const ligaCount = datos.envios.filter((e) => e.medio === "liga_copiada").length;
    const lineas = [
      correoCount > 0 ? `${correoCount} ${correoCount === 1 ? "envío" : "envíos"} por correo a prospectos interesados` : null,
      whatsappCount > 0 ? `${whatsappCount} ${whatsappCount === 1 ? "envío" : "envíos"} por WhatsApp con la liga de tu propiedad` : null,
      ligaCount > 0 ? `${ligaCount} ${ligaCount === 1 ? "vez" : "veces"} se compartió la liga de tu propiedad con prospectos` : null,
    ].filter(Boolean).map((t) => ({ texto: `•  ${t}` }));

    dibujarCard("Promoción activa de tu propiedad", lineas, { acento: "#1e40af" });
  }

  // ── Canales de promoción ─────────────────────────────────────────────────
  const lineasCanales = [{ texto: "•  Publicada en el sitio web de Emporio Inmobiliario" }];
  if (propiedad.en_marketplace) {
    lineasCanales.push({ texto: "•  Publicada en Facebook Marketplace" });
  }
  const vistasRedes = [
    propiedad.vistas_tiktok > 0 ? `TikTok: ${propiedad.vistas_tiktok} vistas` : null,
    propiedad.vistas_instagram > 0 ? `Instagram: ${propiedad.vistas_instagram} vistas` : null,
    propiedad.vistas_facebook > 0 ? `Facebook: ${propiedad.vistas_facebook} vistas` : null,
  ].filter(Boolean);
  if (vistasRedes.length > 0) {
    lineasCanales.push({ texto: `•  ${vistasRedes.join("   ·   ")}` });
  }
  dibujarCard("Canales de promoción", lineasCanales, { acento: GRIS_CLARO });

  if (datos.visitas.length === 0 && datos.envios.length === 0 && datos.solicitudes.length === 0 && datos.citas.length === 0) {
    ensureSpace(20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(GRIS_MEDIO);
    doc.text("No se registró actividad adicional durante este periodo.", margin, y);
    y += 20;
  }

  // ── Cierre personal + footer ─────────────────────────────────────────────
  ensureSpace(70);
  y += 6;
  doc.setDrawColor(GRIS_BORDE);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 18;

  if (asesorNombre && asesorNombre.trim()) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(GRIS_MEDIO);
    doc.text("Esta propiedad está a cargo de", pageWidth / 2, y, { align: "center" });
    y += 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(GRIS_OSCURO);
    doc.text(asesorNombre.trim(), pageWidth / 2, y, { align: "center" });
    y += 18;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9.5);
    doc.setTextColor(GRIS_CLARO);
    doc.text("Gracias por tu confianza — seguimos trabajando para encontrarle el mejor destino a tu propiedad.", pageWidth / 2, y, { align: "center" });
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(GRIS_OSCURO);
    doc.text("Emporio Inmobiliario", pageWidth / 2, y, { align: "center" });
    y += 13;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(GRIS_CLARO);
    doc.text("Cualquier duda, estamos a tus órdenes.", pageWidth / 2, y, { align: "center" });
  }

  return Buffer.from(doc.output("arraybuffer"));
}
