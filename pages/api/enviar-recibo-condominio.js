import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { resolveCondominiumOperationControls } from "../../lib/condominios/operationControls.mjs";

const resend = new Resend(process.env.RESEND_API_KEY);

const publicError = (res, status, error) => res.status(status).json({ error });

async function authorizeCondominiumReceipt(req, supabase, condominioId) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { status: 401, error: "Sesión requerida" };

  const authClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData?.user?.id) return { status: 401, error: "Sesión inválida" };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role_id, active, roles:role_id(es_externo)")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.active === false || profile.roles?.es_externo) {
    return { status: 403, error: "Operación no permitida" };
  }

  let allowed = profile.role_id === "admin";
  if (!allowed) {
    const { data: permission, error: permissionError } = await supabase
      .from("permisos_modulo")
      .select("puede_ver, puede_editar")
      .eq("role_id", profile.role_id)
      .eq("modulo", "condominios")
      .maybeSingle();
    if (permissionError) return { status: 503, error: "No fue posible verificar permisos" };
    allowed = permission?.puede_ver === true && permission?.puede_editar === true;
  }
  if (!allowed) return { status: 403, error: "Operación no permitida" };

  const { data: condo, error: condoError } = await supabase
    .from("condominios")
    .select("id")
    .eq("id", condominioId)
    .maybeSingle();
  if (condoError) return { status: 503, error: "No fue posible verificar el condominio" };
  if (!condo) return { status: 404, error: "Condominio no localizado" };
  return { userId: authData.user.id };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { cuotaId, condominioId, emailDestino, nombreCondómino, numeroDepto, condominio, periodo, monto, fechaPago, folio, pdfBase64 } = req.body;

  if (!cuotaId || !condominioId || !emailDestino || !pdfBase64) {
    return res.status(400).json({ error: "Faltan datos requeridos" });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return publicError(res, 503, "Servicio temporalmente no disponible");
  }
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const authorization = await authorizeCondominiumReceipt(req, supabase, condominioId);
  if (authorization.error) return publicError(res, authorization.status, authorization.error);

  const { data: fee, error: feeError } = await supabase
    .from("cuotas_condominio")
    .select("condominio_id")
    .eq("id", cuotaId)
    .eq("condominio_id", condominioId)
    .maybeSingle();
  if (feeError) return publicError(res, 503, "No fue posible verificar la cuota");
  if (!fee?.condominio_id) return publicError(res, 404, "Cuota no localizada");

  const { data: control, error: controlError } = await supabase
    .from("condominium_operation_controls")
    .select("lifecycle_status, owner_portal_enabled, communications_enabled, current_billing_enabled, receipts_enabled, real_payments_enabled, money_movements_enabled")
    .eq("condominio_id", fee.condominio_id)
    .maybeSingle();
  if (controlError) return publicError(res, 503, "No fue posible verificar controles de operación");
  const resolved = resolveCondominiumOperationControls(control);
  if (!resolved.receiptsEnabled || !resolved.communicationsEnabled) {
    return publicError(res, 409, "La emisión o comunicación de recibos está bloqueada para este condominio");
  }

  try {
    await resend.emails.send({
      from: "Emporio Inmobiliario <cobros@emporioinmobiliario.com.mx>",
      to: [emailDestino],
      bcc: ["carlos.nachon@emporioinmobiliario.mx"],
      subject: `Recibo de cuota de mantenimiento — ${condominio} Depto ${numeroDepto} — ${periodo}`,
      html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 32px;">
          <div style="background: #1a1a2e; padding: 20px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: #c8a96e; margin: 0; font-size: 20px;">🏢 Emporio Inmobiliario</h1>
            <p style="color: rgba(255,255,255,0.6); margin: 4px 0 0; font-size: 13px;">Administración de Condominios</p>
          </div>
          <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 0 0 12px 12px; padding: 28px;">
            <p style="color: #374151; margin: 0 0 20px;">Estimado/a <strong>${nombreCondómino}</strong>,</p>
            <p style="color: #374151; margin: 0 0 20px;">Confirmamos que hemos recibido su pago de cuota de mantenimiento. Adjuntamos su recibo oficial.</p>
            <div style="background: #f9fafb; border-radius: 10px; padding: 20px; margin: 0 0 20px;">
              <p style="margin: 0 0 8px; color: #374151;"><strong>Folio:</strong> ${folio}</p>
              <p style="margin: 0 0 8px; color: #374151;"><strong>Condominio:</strong> ${condominio}</p>
              <p style="margin: 0 0 8px; color: #374151;"><strong>Unidad:</strong> Depto ${numeroDepto}</p>
              <p style="margin: 0 0 8px; color: #374151;"><strong>Periodo:</strong> ${periodo}</p>
              <p style="margin: 0 0 8px; color: #374151;"><strong>Monto:</strong> ${monto}</p>
              <p style="margin: 0; color: #374151;"><strong>Fecha de pago:</strong> ${fechaPago}</p>
            </div>
            <p style="color: #6b7280; font-size: 13px; margin: 0;">Gracias por mantener sus pagos al corriente.</p>
            <p style="color: #6b7280; font-size: 13px; margin: 8px 0 0;">Emporio Inmobiliario · 222 257 3237</p>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: `Recibo_${folio}_${numeroDepto}.pdf`,
          content: pdfBase64,
        },
      ],
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("condominium_receipt_send_failed", { name: error?.name || "Error" });
    return res.status(500).json({ error: "No fue posible enviar el recibo" });
  }
}
