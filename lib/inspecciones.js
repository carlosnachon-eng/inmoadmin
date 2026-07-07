import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "./supabase";

export const TIPOS_INMUEBLE = [
  ["casa", "Casa"],
  ["departamento", "Departamento"],
  ["local_comercial", "Local comercial"],
  ["oficina", "Oficina"],
  ["bodega", "Bodega"],
  ["terreno", "Terreno"],
  ["otro", "Otro"],
];

export const ESTADOS_INSPECCION = {
  borrador: { label: "Borrador", bg: "#f3f4f6", color: "#374151" },
  en_revision: { label: "En revisión", bg: "#dbeafe", color: "#1d4ed8" },
  con_observaciones: { label: "Con observaciones", bg: "#fef3c7", color: "#92400e" },
  pendiente_presupuesto: { label: "Pendiente presupuesto", bg: "#ffedd5", color: "#c2410c" },
  pendiente_autorizacion_propietario: { label: "Pendiente autorización", bg: "#ede9fe", color: "#6d28d9" },
  cerrada: { label: "Cerrada", bg: "#d1fae5", color: "#065f46" },
};

export const ESTADOS_RESPUESTA = [
  ["sin_observaciones", "Sin observaciones"],
  ["observacion_menor", "Observación menor"],
  ["requiere_reparacion", "Requiere reparación"],
  ["no_aplica", "No aplica"],
];

export const CATEGORIAS_FOTO = [
  ["fachada", "Fachada"],
  ["acceso", "Acceso"],
  ["sala", "Sala"],
  ["cocina", "Cocina"],
  ["recamara", "Recámara"],
  ["bano", "Baño"],
  ["patio", "Patio"],
  ["medidores", "Medidores"],
  ["danos", "Daños"],
  ["otros", "Otros"],
];

export const LEGAL_INSPECCION =
  "La presente acta documenta el estado físico visible del inmueble al momento de la entrega-recepción. Las observaciones, fotografías, lecturas de medidores, inventario y firmas forman parte integral de este documento. La firma de las partes no implica renuncia a derechos, ni limita la posibilidad de reclamar daños, adeudos, reparaciones, servicios pendientes o responsabilidades que se detecten posteriormente y que correspondan al periodo de ocupación o uso del inmueble, conforme al contrato aplicable y a la legislación vigente.";

export const fmtFecha = (value) => {
  if (!value) return "—";
  return new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

export const fmtMoney = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 0,
}).format(Number(n || 0));

export async function subirArchivoInspeccion(inspeccionId, file, carpeta = "archivos") {
  const ext = file.name?.split(".").pop() || "bin";
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `${inspeccionId}/${carpeta}/${safeName}`;
  const { error } = await supabase.storage.from("inspecciones").upload(path, file, {
    upsert: true,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("inspecciones").getPublicUrl(path);
  return data.publicUrl;
}

export async function subirDataUrlInspeccion(inspeccionId, dataUrl, carpeta = "firmas", nombre = "firma.png") {
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], nombre, { type: "image/png" });
  return subirArchivoInspeccion(inspeccionId, file, carpeta);
}

const estadoLabel = (estado) => ESTADOS_RESPUESTA.find(([key]) => key === estado)?.[1] || estado || "—";

async function addLogo(doc, x, y, w) {
  try {
    const res = await fetch("https://www.emporioinmobiliario.com.mx/logo.png");
    const blob = await res.blob();
    const b64 = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(fr.result);
      fr.readAsDataURL(blob);
    });
    doc.addImage(b64, "PNG", x, y, w, Math.round(w * (959 / 1801)));
  } catch (_) {}
}

export async function generarPDFInspeccion({
  inspeccion,
  inmueble,
  contrato,
  secciones,
  elementos,
  respuestas,
  fotografias,
  medidores,
  inventario,
}) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = 612;
  const M = 42;
  const RED = [185, 28, 60];
  const DARK = [26, 26, 46];
  const GRAY = [107, 114, 128];

  doc.setFillColor(...RED);
  doc.rect(0, 0, W, 7, "F");
  await addLogo(doc, M, 18, 96);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...DARK);
  doc.text("ACTA DE ENTREGA-RECEPCIÓN", M + 116, 38);
  doc.setFontSize(10);
  doc.setTextColor(...RED);
  doc.text("INSPECCIÓN DE INMUEBLE", M + 116, 54);

  doc.setDrawColor(...RED);
  doc.setLineWidth(2);
  doc.line(M, 78, W - M, 78);

  let y = 98;
  const info = [
    ["Fecha", fmtFecha(inspeccion.fecha)],
    ["Hora", inspeccion.hora?.slice(0, 5) || "—"],
    ["Inmueble", inmueble?.name || contrato?.property_name || "—"],
    ["Contrato", contrato ? `${contrato.tenant_name || "—"} · ${contrato.status || "—"}` : "—"],
    ["Recibido por", inspeccion.recibido_por || "—"],
    ["Entregado por", inspeccion.entregado_por || "—"],
    ["Estatus", ESTADOS_INSPECCION[inspeccion.estatus]?.label || inspeccion.estatus],
  ];

  autoTable(doc, {
    startY: y,
    head: [["Dato", "Información"]],
    body: info,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 5 },
    headStyles: { fillColor: RED, textColor: 255 },
    margin: { left: M, right: M },
  });
  y = doc.lastAutoTable.finalY + 16;

  for (const seccion of secciones) {
    const items = elementos.filter((e) => e.seccion_id === seccion.id);
    if (!items.length) continue;
    const body = items.map((elemento) => {
      const r = respuestas.find((item) => item.elemento_id === elemento.id) || {};
      const fotos = fotografias.filter((f) => f.respuesta_id === r.id);
      return [
        elemento.nombre,
        estadoLabel(r.estado),
        r.prioridad || "—",
        r.responsable || "—",
        r.observacion || "—",
        fotos.length ? `${fotos.length} foto(s)` : "—",
        r.costo_estimado ? fmtMoney(r.costo_estimado) : "—",
      ];
    });

    autoTable(doc, {
      startY: y,
      head: [[seccion.nombre, "Estado", "Prioridad", "Responsable", "Observación", "Fotos", "Costo"]],
      body,
      theme: "striped",
      styles: { fontSize: 7.2, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [26, 60, 94], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 118 },
        1: { cellWidth: 72 },
        2: { cellWidth: 50 },
        3: { cellWidth: 62 },
        4: { cellWidth: 150 },
        5: { cellWidth: 48 },
        6: { cellWidth: 55 },
      },
      margin: { left: M, right: M },
      didDrawPage: () => {
        doc.setFillColor(...RED);
        doc.rect(0, 785, W, 7, "F");
      },
    });
    y = doc.lastAutoTable.finalY + 14;
  }

  if (medidores.length) {
    autoTable(doc, {
      startY: y,
      head: [["Medidor", "Número", "Lectura", "Observaciones"]],
      body: medidores.map((m) => [m.tipo, m.numero_medidor || "—", m.lectura || "—", m.observaciones || "—"]),
      styles: { fontSize: 8, cellPadding: 5 },
      headStyles: { fillColor: RED, textColor: 255 },
      margin: { left: M, right: M },
    });
    y = doc.lastAutoTable.finalY + 14;
  }

  if (inventario.length) {
    autoTable(doc, {
      startY: y,
      head: [["Concepto", "Cantidad", "Observaciones"]],
      body: inventario.map((i) => [i.concepto, i.cantidad || 1, i.observaciones || "—"]),
      styles: { fontSize: 8, cellPadding: 5 },
      headStyles: { fillColor: [26, 60, 94], textColor: 255 },
      margin: { left: M, right: M },
    });
    y = doc.lastAutoTable.finalY + 14;
  }

  if (y > 610) {
    doc.addPage();
    y = 48;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...RED);
  doc.text("Observaciones generales", M, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...DARK);
  doc.text(doc.splitTextToSize(inspeccion.observaciones_generales || "Sin observaciones generales.", W - 2 * M), M, y);
  y += 46;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...RED);
  doc.text("Leyenda legal", M, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text(doc.splitTextToSize(LEGAL_INSPECCION, W - 2 * M), M, y);
  y += 70;

  if (y > 690) {
    doc.addPage();
    y = 64;
  }

  const lineY = y + 44;
  doc.setDrawColor(180, 180, 180);
  doc.line(M, lineY, M + 210, lineY);
  doc.line(W - M - 210, lineY, W - M, lineY);
  if (inspeccion.firma_representante_url) {
    try { doc.addImage(inspeccion.firma_representante_url, "PNG", M + 25, y, 150, 40); } catch (_) {}
  }
  if (inspeccion.firma_inquilino_url) {
    try { doc.addImage(inspeccion.firma_inquilino_url, "PNG", W - M - 185, y, 150, 40); } catch (_) {}
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...DARK);
  doc.text("Representante Emporio", M, lineY + 13);
  doc.text("Persona que entrega/recibe", W - M - 210, lineY + 13);

  doc.setFillColor(...RED);
  doc.rect(0, 785, W, 7, "F");
  return doc;
}
