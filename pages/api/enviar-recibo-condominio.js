import crypto from "crypto";
import { Resend } from "resend";
import { jsPDF } from "jspdf";
import {
  enforceRateLimit,
  HttpError,
  requestId,
  requireUser,
  sendApiError,
} from "../../lib/server/condominiosAuth";
import {
  assertJsonBody,
  asIdempotencyKey,
  asUuid,
  escapeHtml,
} from "../../lib/server/condominiosValidation";
import { PRIVATE_BUCKET } from "../../lib/server/condominiosStorage";
import {
  completeIdempotency,
  releaseIdempotency,
  reserveIdempotency,
} from "../../lib/server/condominiosIdempotency";

export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };

function createReceiptPdf({ condo, unit, fee, payment, folio }) {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  pdf.setFontSize(18);
  pdf.text("Recibo de cuota de mantenimiento", 40, 52);
  pdf.setFontSize(11);
  const lines = [
    ["Folio", folio],
    ["Condominio", condo.nombre],
    ["Unidad", unit.numero],
    ["Periodo", fee.periodo],
    ["Monto", `$${Number(payment.monto).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`],
    ["Fecha de pago", payment.fecha_pago],
  ];
  let y = 86;
  for (const [label, value] of lines) {
    pdf.setFont(undefined, "bold");
    pdf.text(`${label}:`, 40, y);
    pdf.setFont(undefined, "normal");
    pdf.text(String(value || ""), 150, y);
    y += 22;
  }
  pdf.setFontSize(9);
  pdf.text("Documento generado por Emporio Inmobiliario.", 40, y + 24);
  return Buffer.from(pdf.output("arraybuffer"));
}

function parseBcc() {
  return String(process.env.CONDOMINIOS_RECEIPT_BCC || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean)
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  let context;
  let reservation;
  let key;
  let condominioId;
  try {
    const body = assertJsonBody(req, 16 * 1024);
    const cuotaId = asUuid(body.cuota_id, "cuota_id");
    context = await requireUser(req);

    const { data: fee, error: feeError } = await context.supabase
      .from("cuotas_condominio")
      .select("id,condominio_id,unidad_id,periodo,monto,status,fecha_pago")
      .eq("id", cuotaId)
      .maybeSingle();
    if (feeError) throw new Error(feeError.message);
    if (!fee) throw new HttpError(404, "Cuota no encontrada");
    condominioId = fee.condominio_id;

    const { data: allowed, error: permissionError } = await context.supabase.rpc("condominio_usuario_puede", {
      p_user_id: context.user.id,
      p_condominio_id: condominioId,
      p_accion: "enviar_recibo",
      p_unidad_id: null,
    });
    if (permissionError) throw new Error(permissionError.message);
    if (!allowed) throw new HttpError(403, "Acceso denegado");
    await enforceRateLimit(context.supabase, `receipt:${context.user.id}:${condominioId}`, 20, 3600);
    key = asIdempotencyKey(req);
    reservation = await reserveIdempotency({
      supabase: context.supabase,
      actorId: context.user.id,
      condominioId,
      key,
      payload: { cuota_id: cuotaId },
    });
    if (reservation.cached) return res.status(200).json({ ok: true, cached: true, data: reservation.response });

    const [{ data: unit, error: unitError }, { data: condo, error: condoError }, { data: payments, error: paymentError }] = await Promise.all([
      context.supabase.from("unidades_condominio").select("*").eq("id", fee.unidad_id).eq("condominio_id", condominioId).single(),
      context.supabase.from("condominios").select("id,nombre").eq("id", condominioId).single(),
      context.supabase.from("condominio_pagos").select("*").eq("cuota_id", cuotaId).eq("condominio_id", condominioId).is("reversed_at", null).order("created_at", { ascending: false }).limit(1),
    ]);
    if (unitError || condoError || paymentError) throw new Error(unitError?.message || condoError?.message || paymentError?.message);
    if (!payments?.[0] || fee.status !== "pagado") throw new HttpError(409, "La cuota no tiene un pago vigente");
    const recipients = [...new Set([unit.propietario_email, unit.residente_email].filter(Boolean).map((email) => email.trim().toLowerCase()))]
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    const emailEnabled = process.env.CONDOMINIOS_RECEIPT_SEND_ENABLED === "true";
    if (emailEnabled && !recipients.length) throw new HttpError(409, "La unidad no tiene un correo registrado");

    const payment = payments[0];
    const folio = `EC-${String(payment.id).split("-")[0].toUpperCase()}`;
    const pdf = createReceiptPdf({ condo, unit, fee, payment, folio });
    const hash = crypto.createHash("sha256").update(pdf).digest("hex");
    const path = `${condominioId}/recibo/${new Date().toISOString().slice(0, 10)}/${payment.id}.pdf`;
    const { error: uploadError } = await context.supabase.storage
      .from(PRIVATE_BUCKET)
      .upload(path, pdf, { contentType: "application/pdf", upsert: false });
    if (uploadError && String(uploadError.statusCode) !== "409") throw new Error(uploadError.message);

    let { data: document } = await context.supabase
      .from("condominio_documentos")
      .select("*")
      .eq("object_path", path)
      .maybeSingle();
    if (!document) {
      const { data, error } = await context.supabase.from("condominio_documentos").insert({
        condominio_id: condominioId,
        unidad_id: fee.unidad_id,
        categoria: "recibo",
        bucket: PRIVATE_BUCKET,
        object_path: path,
        nombre_original: `Recibo_${folio}_${unit.numero}.pdf`,
        mime_type: "application/pdf",
        size_bytes: pdf.length,
        sha256: hash,
        created_by: context.user.id,
      }).select("*").single();
      if (error) throw new Error(error.message);
      document = data;
    }
    const { error: receiptLinkError } = await context.supabase
      .from("cuotas_condominio")
      .update({ recibo_documento_id: document.id })
      .eq("id", cuotaId)
      .eq("condominio_id", condominioId);
    if (receiptLinkError) throw new Error(receiptLinkError.message);

    if (emailEnabled) {
      if (!process.env.RESEND_API_KEY) {
        throw new Error("El envío de recibos está habilitado sin una credencial Resend.");
      }
      const resend = new Resend(process.env.RESEND_API_KEY);
      const bcc = parseBcc();
      const safeName = escapeHtml(unit.propietario_nombre || unit.residente_nombre || "Condómino");
      const safeCondo = escapeHtml(condo.nombre);
      const safeUnit = escapeHtml(unit.numero);
      const { error: sendError } = await resend.emails.send({
        from: process.env.CONDOMINIOS_RECEIPT_FROM || "Emporio Inmobiliario <cobros@emporioinmobiliario.com.mx>",
        to: recipients,
        ...(bcc.length ? { bcc } : {}),
        subject: `Recibo de cuota — ${condo.nombre} — Unidad ${unit.numero} — ${fee.periodo}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
          <h1 style="font-size:20px">Recibo de cuota de mantenimiento</h1>
          <p>Hola ${safeName}:</p>
          <p>Confirmamos el pago registrado para <strong>${safeCondo}</strong>, unidad <strong>${safeUnit}</strong>.</p>
          <p>Adjuntamos el recibo ${escapeHtml(folio)} correspondiente al periodo ${escapeHtml(fee.periodo)}.</p>
          <p style="color:#6b7280;font-size:13px">Emporio Inmobiliario · Administración de Condominios</p>
        </div>`,
        attachments: [{ filename: document.nombre_original, content: pdf.toString("base64") }],
      });
      if (sendError) throw new Error(sendError.message);
    }

    await context.supabase.rpc("condominio_auditar", {
      p_actor: context.user.id,
      p_condominio: condominioId,
      p_unidad: fee.unidad_id,
      p_accion: "enviar_recibo",
      p_entidad: "condominio_documentos",
      p_entidad_id: document.id,
      p_motivo: null,
      p_antes: null,
      p_despues: {
        cuota_id: cuotaId,
        destinatarios: emailEnabled ? recipients.length : 0,
        email_habilitado: emailEnabled,
        folio,
      },
      p_request_id: requestId(req),
    });
    const response = {
      documento_id: document.id,
      folio,
      destinatarios: emailEnabled ? recipients.length : 0,
      email_enviado: emailEnabled,
    };
    await completeIdempotency({
      supabase: context.supabase,
      actorId: context.user.id,
      condominioId,
      key,
      response,
    });
    return res.status(200).json({ ok: true, cached: false, data: response });
  } catch (error) {
    if (context && condominioId && key && !reservation?.cached) {
      await releaseIdempotency({ supabase: context.supabase, actorId: context.user.id, condominioId, key });
    }
    return sendApiError(res, error);
  }
}
