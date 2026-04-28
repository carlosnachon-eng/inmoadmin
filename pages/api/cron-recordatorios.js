import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

export default async function handler(req, res) {
  // Verificar que viene de Vercel Cron
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const hoy = new Date();
  const ayer = new Date(hoy);
  ayer.setDate(ayer.getDate() - 1);
  const hace5 = new Date(hoy);
  hace5.setDate(hace5.getDate() - 5);
  const hace10 = new Date(hoy);
  hace10.setDate(hace10.getDate() - 10);

  const fmtFecha = (d) => d.toISOString().split("T")[0];

  // Traer pagos vencidos pendientes o atrasados con email
  const { data: pagos } = await supabase
    .from("payments")
    .select("*")
    .in("status", ["pendiente", "atrasado"])
    .not("tenant_email", "is", null);

  if (!pagos || pagos.length === 0) {
    return res.status(200).json({ message: "Sin pagos vencidos con email", enviados: 0 });
  }

  let enviados = 0;
  const resumen = [];

  for (const pago of pagos) {
    if (!pago.due_date || !pago.tenant_email) continue;

    const vencimiento = new Date(pago.due_date);
    const diasVencido = Math.floor((hoy - vencimiento) / (1000 * 60 * 60 * 24));

    // Solo mandar en día 1, 5 y 10 de vencido
    if (![1, 5, 10].includes(diasVencido)) continue;

    let asunto, urgencia, color;
    if (diasVencido === 1) {
      asunto = `Recordatorio de pago — ${pago.property_name}`;
      urgencia = "Tu pago venció ayer.";
      color = "#92400e";
    } else if (diasVencido === 5) {
      asunto = `⚠️ Pago atrasado 5 días — ${pago.property_name}`;
      urgencia = "Tu pago lleva 5 días de retraso.";
      color = "#dc2626";
    } else {
      asunto = `🚨 Pago atrasado 10 días — ${pago.property_name}`;
      urgencia = "Tu pago lleva 10 días de retraso. Por favor regulariza tu situación.";
      color = "#7f1d1d";
    }

    const htmlInquilino = `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;">
        <div style="background:#1a1a2e;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
          <h1 style="color:#c8a96e;margin:0;font-size:20px;">🏢 Emporio Inmobiliario</h1>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:28px;">
          <p style="color:${color};font-weight:700;font-size:16px;margin:0 0 16px;">${urgencia}</p>
          <p style="color:#374151;margin:0 0 20px;">Hola <strong>${pago.tenant_name}</strong>, te recordamos que tienes un pago pendiente:</p>
          <div style="background:#f9fafb;border-radius:10px;padding:20px;margin:0 0 20px;">
            <p style="margin:0 0 8px;color:#374151;"><strong>Propiedad:</strong> ${pago.property_name}</p>
            <p style="margin:0 0 8px;color:#374151;"><strong>Monto:</strong> ${fmt(pago.amount)}</p>
            <p style="margin:0;color:#374151;"><strong>Fecha límite:</strong> ${pago.due_date}</p>
          </div>
          <p style="color:#6b7280;font-size:13px;margin:0;">Para regularizar tu pago entra a tu portal: <a href="https://app.emporioinmobiliario.com.mx/inquilino" style="color:#c8a96e;">app.emporioinmobiliario.com.mx/inquilino</a></p>
        </div>
      </div>`;

    // Enviar al inquilino
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "InmoAdmin <cobros@emporioinmobiliario.com.mx>",
          to: [pago.tenant_email],
          subject: asunto,
          html: htmlInquilino,
        }),
      });

      // Marcar como atrasado si lleva más de 1 día
      if (diasVencido >= 1) {
        await supabase.from("payments").update({ status: "atrasado" }).eq("id", pago.id);
      }

      enviados++;
      resumen.push({ inquilino: pago.tenant_name, propiedad: pago.property_name, dias: diasVencido });
    } catch (e) {
      console.error("Error enviando a", pago.tenant_email, e.message);
    }
  }

  // Enviar resumen al equipo
  if (resumen.length > 0) {
    const filas = resumen.map(r =>
      `<tr><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${r.inquilino}</td><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${r.propiedad}</td><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#dc2626;font-weight:700;">${r.dias} día${r.dias !== 1 ? "s" : ""}</td></tr>`
    ).join("");

    const htmlEquipo = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;">
        <div style="background:#1a1a2e;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
          <h1 style="color:#c8a96e;margin:0;font-size:20px;">🏢 Reporte diario de pagos vencidos</h1>
          <p style="color:rgba(255,255,255,0.6);margin:8px 0 0;font-size:13px;">${fmtFecha(hoy)}</p>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:28px;">
          <p style="color:#374151;margin:0 0 20px;">Se enviaron <strong>${enviados} recordatorios</strong> automáticos hoy:</p>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;">INQUILINO</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;">PROPIEDAD</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;">DÍAS VENCIDO</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
          <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">Ver todos los pagos: <a href="https://app.emporioinmobiliario.com.mx" style="color:#c8a96e;">app.emporioinmobiliario.com.mx</a></p>
        </div>
      </div>`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "InmoAdmin <cobros@emporioinmobiliario.com.mx>",
        to: ["carlos.nachon@emporioinmobiliario.mx"],
        subject: `📋 ${enviados} pagos vencidos hoy — ${fmtFecha(hoy)}`,
        html: htmlEquipo,
      }),
    });
  }

  return res.status(200).json({
    message: `Cron ejecutado correctamente`,
    fecha: fmtFecha(hoy),
    enviados,
    resumen,
  });
}
