// pages/api/cron-vencimientos-recibos.js
// Corre cada noche — marca como vencidos los recibos que cumplieron su plazo
// Agregar en vercel.json: { "path": "/api/cron-vencimientos-recibos", "schedule": "0 7 * * *" }

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fmt = (n) => "$" + Number(n).toLocaleString("es-MX", { minimumFractionDigits: 0 });

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const hoy = new Date().toISOString().split("T")[0];

  // Buscar recibos activos donde fecha + vigencia_dias <= hoy
  const { data: recibos, error } = await supabase
    .from("recibos_apartado")
    .select("id, folio, tipo, cliente_nombre, inmueble, monto, fecha, vigencia_dias")
    .eq("estatus", "activo");

  if (error) return res.status(500).json({ error: error.message });

  const vencidos = (recibos || []).filter(r => {
    const fechaVencimiento = new Date(r.fecha);
    fechaVencimiento.setDate(fechaVencimiento.getDate() + r.vigencia_dias);
    return fechaVencimiento.toISOString().split("T")[0] <= hoy;
  });

  if (vencidos.length === 0) {
    return res.status(200).json({ vencidos: 0, message: "Sin vencimientos hoy" });
  }

  // Marcar como vencidos
  const ids = vencidos.map(r => r.id);
  await supabase.from("recibos_apartado").update({ estatus: "vencido" }).in("id", ids);

  // Log
  for (const r of vencidos) {
    await supabase.from("recibos_log").insert({ recibo_id: r.id, accion: "vencido", usuario_id: null });
  }

  // Notificar a Carlos
  const filas = vencidos.map(r => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-family:monospace;color:#b91c3c;font-weight:700;">${r.folio}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">${r.cliente_nombre}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280;">${r.inmueble}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-weight:700;color:#dc2626;">${fmt(r.monto)}</td>
    </tr>`).join("");

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;">
      <div style="background:#1a1a2e;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:18px;">⏰ Recibos vencidos hoy — ${hoy}</h1>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px;">
        <p style="color:#374151;margin:0 0 20px;">Los siguientes <strong>${vencidos.length}</strong> recibos cumplieron su plazo y fueron marcados como vencidos:</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Folio</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Cliente</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Inmueble</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Monto</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
        <div style="margin-top:24px;text-align:center;">
          <a href="https://app.emporioinmobiliario.com.mx/recibos" style="background:#b91c3c;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">
            Ver recibos →
          </a>
        </div>
      </div>
    </div>`;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "InmoAdmin <cobros@emporioinmobiliario.com.mx>",
        to: ["carlos.nachon@emporioinmobiliario.mx"],
        subject: `⏰ ${vencidos.length} recibo${vencidos.length !== 1 ? "s" : ""} vencido${vencidos.length !== 1 ? "s" : ""} hoy — ${hoy}`,
        html,
      }),
    });
  } catch (e) {
    console.error("Error enviando notificación de vencimientos:", e.message);
  }

  return res.status(200).json({ vencidos: vencidos.length, folios: vencidos.map(r => r.folio) });
}
