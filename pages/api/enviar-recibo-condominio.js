import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { emailDestino, nombreCondómino, numeroDepto, condominio, periodo, monto, fechaPago, folio, pdfBase64 } = req.body;

  if (!emailDestino || !pdfBase64) {
    return res.status(400).json({ error: "Faltan datos requeridos" });
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
    console.error("Error enviando recibo:", error);
    return res.status(500).json({ error: error.message });
  }
}
