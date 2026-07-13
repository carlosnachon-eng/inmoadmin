import { jsPDF } from "jspdf";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
}).format(Number(n || 0));

const safeText = (value) => String(value || "").replace(/\s+/g, " ").trim();

const direccionPropiedad = (propiedad) =>
  [propiedad?.direccion, propiedad?.colonia, propiedad?.ciudad, propiedad?.estado]
    .map(safeText)
    .filter(Boolean)
    .join(", ");

const formatDate = (value = new Date()) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

function drawLabelValue(doc, label, value, x, y, width = 230) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.text(label.toUpperCase(), x, y);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(31, 41, 55);
  doc.text(doc.splitTextToSize(safeText(value) || "—", width), x, y + 15);
}

function drawFooter(doc) {
  doc.setDrawColor(200, 16, 46);
  doc.setLineWidth(1.2);
  doc.line(42, 744, 570, 744);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(107, 114, 128);
  doc.text("Emporio Inmobiliario - Recibo de comisión", 42, 762);
  doc.text("emporioinmobiliario.com.mx", 570, 762, { align: "right" });
}

export function generarReciboComisionPdf({ cierre, pagos = [], emitidoPor = null, propiedad = null, propietario = null, recibo = null, firma = null, poliza = null }) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const red = "#C8102E";
  const dark = "#253047";
  const gray = "#6B7280";
  const light = "#F7F7F9";
  const softRed = "#FFF1F2";
  const margin = 42;
  const folio = `RC-${new Date().getFullYear()}-${String(cierre.id || "").slice(0, 6).toUpperCase()}`;
  const nombrePropiedad = safeText(propiedad?.titulo) || safeText(cierre.propiedad) || "inmueble";
  const direccion = direccionPropiedad(propiedad) || safeText(firma?.direccion) || safeText(recibo?.inmueble) || safeText(poliza?.direccion_inmueble) || safeText(cierre.direccion_inmueble) || "—";
  const nombrePropietario = safeText(propietario?.razon_social_propietario)
    || safeText(propietario?.nombre_propietario)
    || safeText(firma?.nombre_vendedor)
    || safeText(poliza?.propietarios_inmuebles?.razon_social_propietario)
    || safeText(poliza?.propietarios_inmuebles?.nombre_propietario)
    || safeText(poliza?.nombre_arrendador)
    || "—";
  const operacion = String(cierre.operacion || "RENTA").toLowerCase() === "venta" ? "venta" : "renta";
  const pagosOrdenados = [...pagos].sort((a, b) => String(a.fecha || "").localeCompare(String(b.fecha || "")));
  const totalPagos = pagosOrdenados.reduce((sum, pago) => sum + Number(pago.monto || 0), 0);
  const recibido = totalPagos > 0 ? totalPagos : Number(cierre.cobrado || 0);
  const pendiente = Math.max(0, Number(cierre.comision || 0) - recibido);

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageW, 792, "F");

  doc.setDrawColor(red);
  doc.setLineWidth(2);
  doc.line(margin, 48, pageW - margin, 48);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(red);
  doc.text("EMPORIO", pageW / 2, 82, { align: "center" });
  doc.setFontSize(8);
  doc.setTextColor(gray);
  doc.text("INMOBILIARIO", pageW / 2, 96, { align: "center" });

  doc.setFontSize(20);
  doc.setTextColor(dark);
  doc.text("RECIBO DE COMISIÓN", pageW / 2, 132, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(gray);
  doc.text("Comisión inmobiliaria por operación", pageW / 2, 150, { align: "center" });

  doc.setFillColor(light);
  doc.setDrawColor("#E5E7EB");
  doc.roundedRect(margin, 174, pageW - margin * 2, 58, 10, 10, "FD");
  drawLabelValue(doc, "Folio", folio, margin + 16, 196, 210);
  drawLabelValue(doc, "Fecha", formatDate(new Date()), pageW / 2 + 20, 196, 210);

  doc.setFillColor(softRed);
  doc.setDrawColor(red);
  doc.roundedRect(margin, 252, pageW - margin * 2, 94, 10, 10, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(gray);
  doc.text("IMPORTE RECIBIDO", pageW / 2, 276, { align: "center" });
  doc.setFontSize(30);
  doc.setTextColor(red);
  doc.text(fmt(recibido), pageW / 2, 316, { align: "center" });
  doc.setFontSize(8);
  doc.setTextColor(gray);
  doc.text(`Comisión total: ${fmt(cierre.comision)}${pendiente > 0 ? ` · Saldo pendiente: ${fmt(pendiente)}` : " · Liquidado"}`, pageW / 2, 334, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(dark);
  const inmuebleTexto = direccion !== "—" ? `del inmueble ubicado en ${direccion}` : `de ${nombrePropiedad}`;
  const propietarioTexto = nombrePropietario !== "—" ? `, propiedad de ${nombrePropietario}` : "";
  const body = `Emporio Inmobiliario hace constar que recibió la cantidad de ${fmt(recibido)} por concepto de comisión inmobiliaria correspondiente a la ${operacion} ${inmuebleTexto}${propietarioTexto}.`;
  doc.text(doc.splitTextToSize(body, pageW - margin * 2), margin, 378);

  doc.setFillColor("#FFFFFF");
  doc.setDrawColor("#E5E7EB");
  doc.roundedRect(margin, 426, pageW - margin * 2, 132, 10, 10, "D");
  drawLabelValue(doc, "Propiedad / operación", nombrePropiedad, margin + 16, 452, 300);
  drawLabelValue(doc, "Propietario", nombrePropietario, pageW - 210, 452, 160);
  drawLabelValue(doc, "Dirección del inmueble", direccion, margin + 16, 502, 300);
  drawLabelValue(doc, "Operación", String(cierre.operacion || "RENTA").toUpperCase(), pageW - 210, 502, 160);
  drawLabelValue(doc, "Fecha cierre", cierre.fecha_cierre || "—", margin + 16, 538, 160);
  drawLabelValue(doc, "Monto comisión", fmt(cierre.comision), 220, 538, 150);

  let y = 590;
  if (pagosOrdenados.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(gray);
    doc.text("PAGOS REGISTRADOS", margin, y);
    y += 18;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(dark);
    pagosOrdenados.slice(0, 5).forEach((pago) => {
      const linea = `${pago.fecha || "—"} · ${pago.concepto || "pago"} · ${pago.metodo_pago || "—"} · ${fmt(pago.monto)}`;
      doc.text(doc.splitTextToSize(linea, pageW - margin * 2), margin + 10, y);
      y += 14;
    });
    if (pagosOrdenados.length > 5) {
      doc.setTextColor(gray);
      doc.text(`+ ${pagosOrdenados.length - 5} pagos adicionales`, margin + 10, y);
      y += 14;
    }
  }

  doc.setFillColor(light);
  doc.setDrawColor("#E5E7EB");
  doc.roundedRect(margin, Math.max(y + 8, 650), pageW - margin * 2, 46, 8, 8, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(gray);
  const nota = "Este recibo acredita únicamente la recepción de la cantidad señalada por el concepto indicado. No sustituye CFDI/factura fiscal, salvo emisión posterior conforme a los datos fiscales correspondientes.";
  doc.text(doc.splitTextToSize(nota, pageW - margin * 2 - 24), margin + 12, Math.max(y + 28, 670));

  doc.setDrawColor(gray);
  doc.line(pageW / 2 - 130, 724, pageW / 2 + 130, 724);
  doc.setFontSize(8);
  doc.setTextColor(gray);
  doc.text("Recibí de conformidad", pageW / 2, 738, { align: "center" });
  if (emitidoPor) doc.text(`Emitido por: ${emitidoPor}`, pageW / 2, 752, { align: "center" });

  drawFooter(doc);

  return Buffer.from(doc.output("arraybuffer"));
}
