import { jsPDF } from "jspdf";
import { LoraRegular, LoraBold, LoraItalic, LoraBoldItalic } from "./loraFontData.js";

// ── Paleta de marca ─────────────────────────────────────────────────────
// Mismo rojo institucional de Emporio, acompañado de un acento bronce
// (evoca trayectoria / bienes raíces establecidos) y un fondo crema cálido
// en vez de blanco puro, para que el documento se sienta impreso, no
// exportado de un sistema.
const ROJO = "#B11226";
const ROJO_OSCURO = "#7A0C1A";
const CARBON = "#1C1C22";
const PIEDRA = "#8A8A82";
const PIEDRA_CLARO = "#C9C5BC";
const BRONCE = "#A8895E";
const CREMA = "#FAF8F4";
const VERDE = "#3F5B44";
const AZUL = "#2C4A6E";
const LINEA_SUTIL = "#ECE9E2";

function fmt(n) {
  if (n === null || n === undefined || n === "") return "";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n);
}

function fmtFecha(d) {
  return new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtFechaCorta(d) {
  return new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
}

// Normaliza nombres que pueden venir en MAYÚSCULAS o minúsculas desde la
// base de datos (captura manual del equipo), a Formato Título —
// "EDSON GARCIA PERALTA" -> "Edson Garcia Peralta".
const PARTICULAS_MINUSCULA = new Set(["de", "del", "la", "las", "los", "y"]);
function formatearNombre(nombre) {
  if (!nombre) return "";
  return nombre
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((palabra) => (PARTICULAS_MINUSCULA.has(palabra) ? palabra : palabra.charAt(0).toUpperCase() + palabra.slice(1)))
    .join(" ");
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
  if (datos.solicitudes.length > 0) {
    partes.push(`${datos.solicitudes.length} solicitud${datos.solicitudes.length === 1 ? "" : "es"} de contacto`);
  }
  const detalle = partes.join(" y ");

  if (!datos.comparativaAnterior) {
    return detalle
      ? `Este periodo tu propiedad registró ${detalle} — una señal de interés que vale la pena seguir de cerca.`
      : `Este periodo tu propiedad tuvo movimiento de visitas, aunque todavía sin contacto directo de un prospecto.`;
  }

  const totalAnterior = datos.comparativaAnterior.visitas + datos.comparativaAnterior.citas;
  const totalActualComparable = datos.visitas.length + datos.citas.length;
  const diferencia = totalActualComparable - totalAnterior;

  let frase;
  if (totalAnterior === 0 && totalActualComparable > 0) {
    frase = "tuvo un arranque sólido de actividad";
  } else if (diferencia > 0) {
    frase = "tuvo más actividad que el periodo anterior";
  } else if (diferencia < 0) {
    frase = "tuvo menos actividad que el periodo anterior";
  } else {
    frase = "mantuvo un nivel de actividad similar al periodo anterior";
  }

  const cierre = detalle ? `, con ${detalle}` : "";
  return `Este periodo tu propiedad ${frase}${cierre}.`;
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

  // Margen izquierdo más ancho que el derecho: deja espacio para el filo
  // rojo de "lomo de libro", el detalle de marca que se repite en cada
  // página, sin que el contenido se sienta apretado contra él.
  const filoAncho = 9;
  const marginL = 56;
  const marginR = 56;
  const contentWidth = pageWidth - marginL - marginR;
  const bottomLimit = pageHeight - 56;

  // ── Registro de la fuente serif (Lora) ───────────────────────────────────
  doc.addFileToVFS("Lora-Regular.ttf", LoraRegular);
  doc.addFont("Lora-Regular.ttf", "Lora", "normal");
  doc.addFileToVFS("Lora-Bold.ttf", LoraBold);
  doc.addFont("Lora-Bold.ttf", "Lora", "bold");
  doc.addFileToVFS("Lora-Italic.ttf", LoraItalic);
  doc.addFont("Lora-Italic.ttf", "Lora", "italic");
  doc.addFileToVFS("Lora-BoldItalic.ttf", LoraBoldItalic);
  doc.addFont("Lora-BoldItalic.ttf", "Lora", "bolditalic");

  let paginaActual = 1;
  let y = 0;

  // Pinta el fondo crema + el filo rojo de marca en la página actual. Se
  // llama una vez por página (incluyendo cada vez que se agrega una nueva),
  // para que el detalle de identidad se repita de forma consistente.
  function pintarFondoPagina() {
    doc.setFillColor(CREMA);
    doc.rect(0, 0, pageWidth, pageHeight, "F");
    doc.setFillColor(ROJO);
    doc.rect(0, 0, filoAncho, pageHeight, "F");
    doc.setFillColor(PIEDRA_CLARO);
    doc.setFontSize(8.5);
    doc.setFont("Helvetica", "normal");
    doc.setTextColor(PIEDRA_CLARO);
    doc.text(String(paginaActual).padStart(2, "0"), pageWidth - marginR, pageHeight - 34, { align: "right" });
  }

  function nuevaPagina() {
    doc.addPage();
    paginaActual += 1;
    pintarFondoPagina();
    y = 56;
  }

  function ensureSpace(h) {
    if (y + h > bottomLimit) {
      nuevaPagina();
    }
  }

  pintarFondoPagina();
  y = 56;

  // ── Masthead (encabezado tipo publicación) ───────────────────────────────
  doc.setFont("Lora", "bold");
  doc.setFontSize(16);
  doc.setTextColor(CARBON);
  doc.text("EMPORIO INMOBILIARIO", marginL, y);

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(PIEDRA);
  doc.text("REPORTE MENSUAL DE ACTIVIDAD", pageWidth - marginR, y - 5, { align: "right" });
  doc.text(`${fmtFecha(periodo.desde)} — ${fmtFecha(periodo.hasta)}`, pageWidth - marginR, y + 6, { align: "right" });

  y += 14;
  doc.setDrawColor(CARBON);
  doc.setLineWidth(1.2);
  doc.line(marginL, y, pageWidth - marginR, y);
  y += 26;

  // ── Eyebrow + saludo ──────────────────────────────────────────────────────
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(BRONCE);
  doc.text("INFORME PARA PROPIETARIO", marginL, y);
  y += 18;

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(11.5);
  doc.setTextColor(CARBON);
  const nombrePropietario = formatearNombre(propietario?.nombre_propietario);
  doc.text(`Estimado${nombrePropietario ? " " + nombrePropietario : ""},`, marginL, y);
  y += 18;

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(PIEDRA);
  const intro = doc.splitTextToSize(
    "Le compartimos el desempeño de su propiedad durante este periodo, con el detalle de cada interacción registrada por nuestro equipo y plataformas digitales.",
    contentWidth - 220
  );
  doc.text(intro, marginL, y);
  y += intro.length * 12 + 22;

  // ── Foto a sangre completa (ancho total de la página, no del margen) ────
  const fotoPortadaUrl = Array.isArray(propiedad.fotos) && propiedad.fotos[0] ? (propiedad.fotos[0].url || propiedad.fotos[0]) : null;
  const bannerH = 175;
  ensureSpace(bannerH + 30);

  const fotoPortada = fotoPortadaUrl ? await descargarImagen(fotoPortadaUrl) : null;
  if (fotoPortada) {
    doc.addImage(fotoPortada.dataUrl, fotoPortada.formato, filoAncho, y, pageWidth - filoAncho, bannerH, undefined, "FAST");
  } else {
    // Sin foto: bloque sobrio de marca en vez de un placeholder gris,
    // para que la ausencia de imagen no se sienta como un hueco vacío.
    doc.setFillColor(CARBON);
    doc.rect(filoAncho, y, pageWidth - filoAncho, bannerH, "F");
    doc.setFont("Lora", "bold");
    doc.setFontSize(13);
    doc.setTextColor(PIEDRA_CLARO);
    doc.text("EMPORIO INMOBILIARIO", pageWidth / 2, y + bannerH / 2, { align: "center" });
  }

  // Etiqueta de estatus sobre la foto, esquina inferior izquierda.
  const etiquetaTexto = "EN PROMOCIÓN ACTIVA";
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(8.5);
  const etiquetaW = doc.getTextWidth(etiquetaTexto) + 22;
  doc.setFillColor(ROJO);
  doc.rect(filoAncho + 16, y + bannerH - 30, etiquetaW, 20, "F");
  doc.setTextColor("#ffffff");
  doc.text(etiquetaTexto, filoAncho + 16 + etiquetaW / 2, y + bannerH - 17, { align: "center" });

  y += bannerH + 28;

  // ── Título editorial + dirección ─────────────────────────────────────────
  doc.setFont("Lora", "bold");
  doc.setFontSize(20);
  doc.setTextColor(CARBON);
  const tituloLineas = doc.splitTextToSize(propiedad.titulo || "Propiedad", contentWidth - 40).slice(0, 3);
  for (const linea of tituloLineas) {
    ensureSpace(26);
    doc.text(linea, marginL, y);
    y += 25;
  }
  y += 2;
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(PIEDRA);
  doc.text([propiedad.direccion, propiedad.colonia, propiedad.ciudad].filter(Boolean).join(", "), marginL, y);
  y += 18;
  doc.setDrawColor(PIEDRA_CLARO);
  doc.setLineWidth(0.75);
  doc.line(marginL, y, pageWidth - marginR, y);
  y += 30;

  // ── KPI principal inteligente ─────────────────────────────────────────────
ensureSpace(80);

let kpiPrincipal = {
  valor: datos.visitas.length,
  etiqueta: "VISITAS A LA FICHA",
  color: ROJO,
};

if (datos.solicitudes.length > 0) {
  kpiPrincipal = {
    valor: datos.solicitudes.length,
    etiqueta: "PROSPECTOS INTERESADOS",
    color: VERDE,
  };
}

if (datos.citas.length > 0) {
  kpiPrincipal = {
    valor: datos.citas.length,
    etiqueta: "CITAS AGENDADAS",
    color: VERDE,
  };
}

const numeroProtagonista = String(kpiPrincipal.valor);
const numeroX = marginL;
doc.setFont("Lora", "bold");
doc.setFontSize(52);
doc.setTextColor(kpiPrincipal.color);
doc.text(numeroProtagonista, numeroX, y + 42);
const anchoNumero = doc.getTextWidth(numeroProtagonista);
doc.setFont("Helvetica", "bold");
doc.setFontSize(8.5);
doc.setTextColor(CARBON);
doc.text(kpiPrincipal.etiqueta, numeroX, y + 58);

  const textoX = numeroX + Math.max(anchoNumero, 60) + 28;
  const anchoTexto = pageWidth - marginR - textoX;
  doc.setFont("Lora", "italic");
  doc.setFontSize(13);
  doc.setTextColor(CARBON);
  const resumenLineas = doc.splitTextToSize(construirResumenEjecutivo(datos), anchoTexto);
  let resumenY = y + 16;
  for (const linea of resumenLineas) {
    doc.text(linea, textoX, resumenY);
    resumenY += 17;
  }
  y += Math.max(64, resumenY - y + 8) + 24;

  // ── Datos secundarios: separados por líneas finas, no cajas de color ────
  const secundarios = [
    [String(datos.envios.length), "ENVÍOS REALIZADOS", false],
    [String(datos.solicitudes.length), "SOLICITUDES DE CONTACTO", datos.solicitudes.length > 0],
    [String(datos.citas.length), "CITAS AGENDADAS", datos.citas.length > 0],
  ];
  ensureSpace(46);
  const colW2 = contentWidth / secundarios.length;
  secundarios.forEach(([valor, label, destacar], i) => {
    const bx = marginL + colW2 * i;
    doc.setFont("Lora", "bold");
    doc.setFontSize(19);
    doc.setTextColor(destacar ? VERDE : CARBON);
    doc.text(valor, bx, y);
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(7.8);
    doc.setTextColor(PIEDRA);
    doc.text(label, bx, y + 14);
    if (i > 0) {
      doc.setDrawColor(PIEDRA_CLARO);
      doc.setLineWidth(0.6);
      doc.line(bx - 14, y - 16, bx - 14, y + 16);
    }
  });
  y += 38;

  // Encabezado de sección estilo editorial: texto + línea fina que ocupa
  // el resto del ancho. Reutilizado por cada bloque de contenido.
  function tituloSeccion(texto) {
    y += 10;
    ensureSpace(30);
    doc.setFont("Lora", "bold");
    doc.setFontSize(12.5);
    doc.setTextColor(CARBON);
    const anchoTitulo = doc.getTextWidth(texto);
    doc.text(texto, marginL, y);
    doc.setDrawColor(PIEDRA_CLARO);
    doc.setLineWidth(0.75);
    doc.line(marginL + anchoTitulo + 10, y - 4, pageWidth - marginR, y - 4);
    y += 20;
  }

  // Fila simple de una sección: texto a la izquierda, dato a la derecha,
  // con una línea sutil debajo. Mide su propia altura y respeta el salto
  // de página antes de dibujar, para no cortar contenido a la mitad.
  function filaSeccion(izquierda, derecha, { negritaIzq, colorDer, subtitulo } = {}) {
    const alturaExtra = subtitulo ? 13 : 0;
    ensureSpace(26 + alturaExtra);
    doc.setFont("Helvetica", negritaIzq ? "bold" : "normal");
    doc.setFontSize(10);
    doc.setTextColor(CARBON);
    doc.text(izquierda, marginL, y);
    if (derecha) {
      doc.setFont("Helvetica", "bold");
      doc.setTextColor(colorDer || PIEDRA);
      doc.text(derecha, pageWidth - marginR, y, { align: "right" });
    }
    if (subtitulo) {
      y += 13;
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(PIEDRA);
      doc.text(subtitulo, marginL, y);
    }
    y += 11;
    doc.setDrawColor(LINEA_SUTIL);
    doc.setLineWidth(0.5);
    doc.line(marginL, y, pageWidth - marginR, y);
    y += 15;
  }

  function bullet(texto) {
    const lineas = doc.splitTextToSize(texto, contentWidth - 16);
    ensureSpace(lineas.length * 13 + 4);
    doc.setFillColor(BRONCE);
    doc.circle(marginL + 2.5, y - 3, 1.6, "F");
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(CARBON);
    doc.text(lineas, marginL + 14, y);
    y += lineas.length * 13 + 6;
  }
  function check(texto) {
  const lineas = doc.splitTextToSize(texto, contentWidth - 18);
  ensureSpace(lineas.length * 13 + 4);
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(VERDE);
  doc.text("✓", marginL, y);
  doc.setFont("Helvetica", "normal");
  doc.setTextColor(CARBON);
  doc.text(lineas, marginL + 16, y);
  y += lineas.length * 13 + 6;
}

function bloqueAlcanceRedes() {
  const alcanceTotal =
    Number(propiedad.vistas_tiktok || 0) +
    Number(propiedad.vistas_instagram || 0) +
    Number(propiedad.vistas_facebook || 0);

  if (alcanceTotal <= 0) return;

  tituloSeccion("Alcance digital de la propiedad");
  ensureSpace(62);

  doc.setFont("Lora", "bold");
  doc.setFontSize(34);
  doc.setTextColor(ROJO);
  doc.text(alcanceTotal.toLocaleString("es-MX"), marginL, y + 26);

  doc.setFont("Helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(CARBON);
  doc.text("PERSONAS ALCANZADAS EN REDES", marginL, y + 42);

  const desglose = [
    propiedad.vistas_tiktok > 0 ? `${Number(propiedad.vistas_tiktok).toLocaleString("es-MX")} TikTok` : null,
    propiedad.vistas_instagram > 0 ? `${Number(propiedad.vistas_instagram).toLocaleString("es-MX")} Instagram` : null,
    propiedad.vistas_facebook > 0 ? `${Number(propiedad.vistas_facebook).toLocaleString("es-MX")} Facebook` : null,
  ].filter(Boolean).join("  ·  ");

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(PIEDRA);
  doc.text(desglose, marginL + 250, y + 28);

  y += 66;
}

function bloqueEmbudoConversion() {
  const alcanceTotal =
    Number(propiedad.vistas_tiktok || 0) +
    Number(propiedad.vistas_instagram || 0) +
    Number(propiedad.vistas_facebook || 0);

  const pasos = [
    alcanceTotal > 0 ? [alcanceTotal.toLocaleString("es-MX"), "visualizaciones en redes"] : null,
    [datos.visitas.length.toLocaleString("es-MX"), "visitas a la ficha"],
    [datos.envios.length.toLocaleString("es-MX"), "envíos directos"],
    [datos.solicitudes.length.toLocaleString("es-MX"), "solicitudes de contacto"],
    [datos.citas.length.toLocaleString("es-MX"), "citas agendadas"],
  ].filter(Boolean);

  tituloSeccion("Embudo de actividad comercial");
  ensureSpace(70);

  const colW = contentWidth / pasos.length;

  pasos.forEach(([valor, label], i) => {
    const x = marginL + colW * i;

    doc.setFont("Lora", "bold");
    doc.setFontSize(18);
    doc.setTextColor(i === pasos.length - 1 && datos.citas.length > 0 ? VERDE : ROJO);
    doc.text(valor, x, y);

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(PIEDRA);
    const labelLineas = doc.splitTextToSize(label.toUpperCase(), colW - 18);
    doc.text(labelLineas, x, y + 13);

    if (i < pasos.length - 1) {
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(PIEDRA_CLARO);
      doc.text("→", x + colW - 22, y + 6);
    }
  });

  y += 54;
}

function bloqueAccionesRealizadas() {
  tituloSeccion("Acciones realizadas por Emporio");

  check("Publicación activa en el sitio web de Emporio Inmobiliario");
  if (propiedad.en_marketplace) check("Publicación y promoción en Facebook Marketplace");
  check("Difusión de la propiedad en redes sociales");
  if (datos.envios.length > 0) check("Envío directo de la propiedad a prospectos interesados");
  if (datos.citas.length > 0) check("Seguimiento comercial para cita con prospecto interesado");
  check("Monitoreo del desempeño de la propiedad durante el periodo");

  y += 8;
}

function bloqueConclusionPeriodo() {
  tituloSeccion("Conclusión del periodo");

  const conclusion = `Durante este periodo, la propiedad generó ${datos.visitas.length} visita${datos.visitas.length === 1 ? "" : "s"} a la ficha, ${datos.envios.length} interacción${datos.envios.length === 1 ? "" : "es"} directa${datos.envios.length === 1 ? "" : "s"} y ${datos.citas.length} cita${datos.citas.length === 1 ? "" : "s"} agendada${datos.citas.length === 1 ? "" : "s"}. Continuaremos impulsando su promoción para incrementar el número de prospectos calificados.`;

  const lineas = doc.splitTextToSize(conclusion, contentWidth);
  ensureSpace(lineas.length * 14 + 10);

  doc.setFont("Lora", "italic");
  doc.setFontSize(10.5);
  doc.setTextColor(CARBON);
  doc.text(lineas, marginL, y);
  y += lineas.length * 14 + 10;
}

  // ── Comparación con el periodo anterior ──────────────────────────────────
  if (datos.comparativaAnterior) {
    tituloSeccion("Comparado con el periodo anterior");
    const comparaciones = [
      ["Visitas a la ficha", datos.visitas.length, datos.comparativaAnterior.visitas],
      ["Citas agendadas", datos.citas.length, datos.comparativaAnterior.citas],
    ];
    const maxBarW = contentWidth - 70;
    const barH = 5;

    for (const [label, actual, anterior] of comparaciones) {
      ensureSpace(78);
      const diferencia = actual - anterior;
      const igual = diferencia === 0;
      const subio = diferencia > 0;
      const maxValor = Math.max(actual, anterior, 1);

      doc.setFont("Helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(PIEDRA);
      doc.text(label, marginL, y);
      doc.setFont("Helvetica", "bold");
      doc.setTextColor(igual ? PIEDRA : subio ? VERDE : "#8C2F2F");
      doc.text(igual ? "Sin cambio" : `${subio ? "+" : "-"}${Math.abs(diferencia)}`, pageWidth - marginR, y, { align: "right" });
      y += 10;

      const wAnterior = Math.max((anterior / maxValor) * maxBarW, anterior > 0 ? 3 : 0);
      doc.setFillColor(LINEA_SUTIL);
      doc.rect(marginL, y, maxBarW, barH, "F");
      if (wAnterior > 0) { doc.setFillColor(PIEDRA_CLARO); doc.rect(marginL, y, wAnterior, barH, "F"); }
      y += barH + 3;
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(PIEDRA);
      doc.text(`${anterior} antes`, marginL, y + 7);
      y += 13;

      const wActual = Math.max((actual / maxValor) * maxBarW, actual > 0 ? 3 : 0);
      doc.setFillColor(LINEA_SUTIL);
      doc.rect(marginL, y, maxBarW, barH, "F");
      if (wActual > 0) { doc.setFillColor(ROJO); doc.rect(marginL, y, wActual, barH, "F"); }
      y += barH + 3;
      doc.setTextColor(ROJO);
      doc.text(`${actual} ahora`, marginL, y + 7);
      y += 22;
    }
  }

  // ── Citas agendadas ───────────────────────────────────────────────────────
  if (datos.citas.length > 0) {
    const ESTADO_LABEL = { agendada: "Agendada", efectiva: "Se realizó", calificada: "Cliente interesado", cancelada: "Cancelada", no_show: "No se presentó" };
    const ESTADO_COLOR = { calificada: VERDE, efectiva: AZUL, cancelada: "#8C2F2F", no_show: "#8C2F2F" };
    tituloSeccion("Citas agendadas");
    for (const c of datos.citas) {
      filaSeccion(fmtFecha(c.fecha_hora), ESTADO_LABEL[c.estado] || c.estado, { negritaIzq: true, colorDer: ESTADO_COLOR[c.estado] || CARBON });
    }
  }

  // ── Solicitudes de contacto ───────────────────────────────────────────────
  if (datos.solicitudes.length > 0) {
    tituloSeccion("Personas interesadas que se pusieron en contacto");
    for (const s of datos.solicitudes) {
      const detalle = `${s.telefono || ""}${s.email ? "  ·  " + s.email : ""}`.trim();
      filaSeccion(s.nombre || "—", fmtFecha(s.created_at), { negritaIzq: true, subtitulo: detalle || null });
    }
  }

  // ── Promoción activa (envíos) ─────────────────────────────────────────────
  if (datos.envios.length > 0) {
    const correoCount = datos.envios.filter((e) => e.medio === "correo").length;
    const whatsappCount = datos.envios.filter((e) => e.medio === "whatsapp").length;
    const ligaCount = datos.envios.filter((e) => e.medio === "liga_copiada").length;
    tituloSeccion("Promoción activa de tu propiedad");
    if (correoCount > 0) bullet(`${correoCount} ${correoCount === 1 ? "envío" : "envíos"} por correo a prospectos interesados`);
    if (whatsappCount > 0) bullet(`${whatsappCount} ${whatsappCount === 1 ? "envío" : "envíos"} por WhatsApp con la liga de tu propiedad`);
    if (ligaCount > 0) bullet(`${ligaCount} ${ligaCount === 1 ? "vez" : "veces"} se compartió la liga de tu propiedad con prospectos`);
    y += 8;
  }

  // ── Alcance, embudo, acciones y canales ────────────────────────────────────
bloqueAlcanceRedes();
bloqueEmbudoConversion();
bloqueAccionesRealizadas();

tituloSeccion("Canales de promoción");
const canalesTexto = ["el sitio web de Emporio Inmobiliario"];
if (propiedad.en_marketplace) canalesTexto.push("Facebook Marketplace");
bullet(`Publicada en ${canalesTexto.join(" y ")}`);
y += 10;

  if (datos.visitas.length === 0 && datos.envios.length === 0 && datos.solicitudes.length === 0 && datos.citas.length === 0) {
    ensureSpace(20);
    doc.setFont("Lora", "italic");
    doc.setFontSize(10);
    doc.setTextColor(PIEDRA);
    doc.text("No se registró actividad adicional durante este periodo.", marginL, y);
    y += 20;
  }
bloqueConclusionPeriodo();
  
  // ── Cierre personal ────────────────────────────────────────────────────────
  ensureSpace(110);
  y += 14;
  doc.setDrawColor(CARBON);
  doc.setLineWidth(1);
  doc.line(marginL, y, pageWidth - marginR, y);
  y += 26;

  if (asesorNombre && asesorNombre.trim()) {
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(PIEDRA);
    doc.text("ESTA PROPIEDAD ESTÁ A CARGO DE", pageWidth / 2, y, { align: "center" });
    y += 18;
    doc.setFont("Lora", "bold");
    doc.setFontSize(14.5);
    doc.setTextColor(CARBON);
    doc.text(asesorNombre.trim(), pageWidth / 2, y, { align: "center" });
    y += 22;
    doc.setFont("Lora", "italic");
    doc.setFontSize(10.5);
    doc.setTextColor(PIEDRA);
    doc.text('"Gracias por tu confianza. Seguimos trabajando para encontrarle el mejor destino a tu propiedad."', pageWidth / 2, y, { align: "center" });
    y += 22;
  } else {
    doc.setFont("Lora", "bold");
    doc.setFontSize(13);
    doc.setTextColor(CARBON);
    doc.text("Emporio Inmobiliario", pageWidth / 2, y, { align: "center" });
    y += 16;
    doc.setFont("Lora", "italic");
    doc.setFontSize(10);
    doc.setTextColor(PIEDRA);
    doc.text("Cualquier duda, estamos a tus órdenes.", pageWidth / 2, y, { align: "center" });
    y += 18;
  }

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(PIEDRA_CLARO);
  doc.text("EMPORIO INMOBILIARIO · 20 AÑOS EN EL MERCADO DE PUEBLA", pageWidth / 2, y + 8, { align: "center" });

  return Buffer.from(doc.output("arraybuffer"));
}
