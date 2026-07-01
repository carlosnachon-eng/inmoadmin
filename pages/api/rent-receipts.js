import { createClient } from "@supabase/supabase-js";
import { jsPDF } from "jspdf";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
}).format(Number(n || 0));

const safeText = (value) => String(value || "").trim();

const formatDate = (value = new Date()) => {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
};

const monthName = (month) => {
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const idx = Number(month) - 1;
  return months[idx] || "";
};

const buildPeriodLabel = (payment) => {
  if (payment.period_month && payment.period_year) return `${monthName(payment.period_month)} ${payment.period_year}`;
  if (payment.due_date) {
    const d = new Date(`${payment.due_date}T12:00:00`);
    return `${monthName(d.getMonth() + 1)} ${d.getFullYear()}`;
  }
  return "periodo de renta correspondiente";
};

async function autenticar(req, requiereEditar = false) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return { error: "Sesión requerida", status: 401 };

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return { error: "Sesión inválida", status: 401 };

  const { data: perfil, error: perfilError } = await supabase
    .from("profiles")
    .select("id, email, full_name, role_id")
    .eq("id", user.id)
    .maybeSingle();

  if (perfilError) return { error: perfilError.message, status: 500 };
  if (!perfil) return { error: "Perfil no encontrado", status: 403 };

  if (perfil.role_id === "admin") return { user, perfil };

  const { data: permiso, error: permisoError } = await supabase
    .from("permisos_modulo")
    .select("puede_ver, puede_editar")
    .eq("role_id", perfil.role_id)
    .eq("modulo", "cobranza")
    .maybeSingle();

  if (permisoError) return { error: permisoError.message, status: 500 };
  const autorizado = requiereEditar ? permiso?.puede_editar : permiso?.puede_ver;
  if (!autorizado) return { error: "No tienes permiso para recibos de cobranza", status: 403 };

  return { user, perfil };
}

function drawLine(doc, y) {
  doc.setDrawColor(224, 229, 236);
  doc.line(42, y, 570, y);
}

function addLabelValue(doc, label, value, x, y, width = 220) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(140, 148, 163);
  doc.text(label.toUpperCase(), x, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(31, 41, 55);
  doc.text(doc.splitTextToSize(value || "-", width), x, y + 16);
}

function generarPdf({ receipt, payment, contract }) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const issuedAt = receipt.issued_at ? new Date(receipt.issued_at) : new Date();
  const tenantName = safeText(receipt.tenant_name || payment.tenant_name);
  const propertyName = safeText(receipt.property_name || payment.property_name);
  const ownerName = safeText(receipt.owner_name || contract?.owner_name);
  const amount = Number(receipt.amount || payment.amount || 0);
  const period = safeText(receipt.period_label || buildPeriodLabel(payment));

  doc.setFillColor(190, 18, 60);
  doc.rect(0, 0, 612, 86, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("EMPORIO INMOBILIARIO", 42, 36);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Recibo de renta administrada", 42, 56);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`Folio ${receipt.folio}`, 432, 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Fecha: ${formatDate(issuedAt)}`, 432, 56);

  doc.setTextColor(17, 24, 39);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text("RECIBO DE RENTA", 42, 132);

  doc.setFontSize(30);
  doc.setTextColor(190, 18, 60);
  doc.text(fmt(amount), 42, 176);

  drawLine(doc, 204);

  addLabelValue(doc, "Recibimos de", tenantName, 42, 234, 250);
  addLabelValue(doc, "Inmueble", propertyName, 320, 234, 230);
  addLabelValue(doc, "Periodo", period, 42, 304, 220);
  addLabelValue(doc, "Propietario", ownerName || "Propietario del inmueble", 320, 304, 230);

  drawLine(doc, 376);

  doc.setTextColor(31, 41, 55);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  const body = `Emporio Inmobiliario recibe de ${tenantName || "el arrendatario"} la cantidad de ${fmt(amount)} por concepto de renta del inmueble ${propertyName || "indicado"}, correspondiente a ${period}.`;
  doc.text(doc.splitTextToSize(body, 528), 42, 420);

  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.text("Forma de pago: ________________________________", 42, 496);
  doc.text("Referencia / comentarios: ______________________", 42, 526);

  drawLine(doc, 612);

  doc.setTextColor(31, 41, 55);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Emporio Inmobiliario", 42, 662);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text("Nombre y firma de quien recibe", 42, 680);

  doc.setDrawColor(156, 163, 175);
  doc.line(42, 644, 250, 644);
  doc.line(332, 644, 540, 644);
  doc.text("Firma del arrendatario", 332, 680);

  return Buffer.from(doc.output("arraybuffer"));
}

async function getReceiptByPayment(paymentId) {
  const { data, error } = await supabase
    .from("rent_receipts")
    .select("*")
    .eq("payment_id", paymentId)
    .neq("status", "cancelado")
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function uploadPdf(folio, buffer) {
  const path = `rent-receipts/${folio}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("documentos")
    .upload(path, buffer, { contentType: "application/pdf", upsert: true });

  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage.from("documentos").getPublicUrl(path);
  return urlData?.publicUrl || null;
}

async function emitirRecibo(req, res, auth) {
  const { payment_id, variant = "impreso" } = req.body || {};
  if (!payment_id) return res.status(400).json({ ok: false, error: "Falta payment_id" });

  const existing = await getReceiptByPayment(payment_id);
  if (existing) return res.status(200).json({ ok: true, receipt: existing, reused: true });

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select("*")
    .eq("id", payment_id)
    .maybeSingle();
  if (paymentError) throw paymentError;
  if (!payment) return res.status(404).json({ ok: false, error: "Pago no encontrado" });

  let contract = null;
  if (payment.contract_id) {
    const { data, error } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", payment.contract_id)
      .maybeSingle();
    if (error) throw error;
    contract = data;
  }

  const folio = `RR-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
  const draft = {
    folio,
    payment_id,
    contract_id: payment.contract_id || null,
    property_name: payment.property_name || contract?.property_name || "",
    tenant_name: payment.tenant_name || contract?.tenant_name || "",
    tenant_email: payment.tenant_email || contract?.tenant_email || "",
    owner_name: contract?.owner_name || "",
    period_label: buildPeriodLabel(payment),
    amount: Number(payment.amount || 0),
    status: "emitido",
    variant,
    issued_by: auth.perfil?.email || auth.user?.email || "",
    issued_at: new Date().toISOString(),
  };

  const pdfBuffer = generarPdf({ receipt: draft, payment, contract });
  const pdfUrl = await uploadPdf(folio, pdfBuffer);

  const { data: receipt, error: insertError } = await supabase
    .from("rent_receipts")
    .insert([{ ...draft, pdf_url: pdfUrl }])
    .select("*")
    .single();
  if (insertError) throw insertError;

  return res.status(200).json({ ok: true, receipt });
}

async function marcarCobrado(req, res, auth) {
  const { payment_id } = req.body || {};
  if (!payment_id) return res.status(400).json({ ok: false, error: "Falta payment_id" });

  const { data, error } = await supabase
    .from("rent_receipts")
    .update({
      status: "cobrado",
      collected_by: auth.perfil?.email || auth.user?.email || "",
      collected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("payment_id", payment_id)
    .eq("status", "emitido")
    .select("*");

  if (error) throw error;
  return res.status(200).json({ ok: true, receipts: data || [] });
}

export default async function handler(req, res) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: "Falta configuración de Supabase" });
  }

  try {
    if (req.method === "GET") {
      const auth = await autenticar(req, false);
      if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });

      const ids = String(req.query.payment_ids || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      let query = supabase
        .from("rent_receipts")
        .select("*")
        .neq("status", "cancelado")
        .order("issued_at", { ascending: false })
        .limit(200);

      if (ids.length) query = query.in("payment_id", ids);

      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ ok: true, receipts: data || [] });
    }

    if (req.method === "POST") {
      const auth = await autenticar(req, true);
      if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });

      const action = req.body?.action || "emit";
      if (action === "emit") return emitirRecibo(req, res, auth);
      if (action === "mark_collected") return marcarCobrado(req, res, auth);

      return res.status(400).json({ ok: false, error: "Acción no soportada" });
    }

    return res.status(405).json({ ok: false, error: "Método no permitido" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Error en recibos de renta" });
  }
}
