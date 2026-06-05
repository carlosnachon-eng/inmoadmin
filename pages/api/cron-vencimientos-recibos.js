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

  // ─────────────────────────────────────────────
  // BLOQUE 1: Recibos ACTIVOS sin solicitud
  // Vencen cuando fecha + vigencia_dias <= hoy
  // (aplica a cualquier tipo, incluyendo arrendamiento que no recibió solicitud a tiempo)
  // ─────────────────────────────────────────────
  const { data: recibosActivos, error: err1 } = await supabase
    .from("recibos_apartado")
    .select("id, folio, tipo, cliente_nombre, inmueble, monto, fecha, vigencia_dias")
    .eq("estatus", "activo");

  if (err1) return res.status(500).json({ error: err1.message });

  const vencidosPlazo1 = (recibosActivos || []).filter(r => {
    if (!r.fecha || !r.vigencia_dias) return false;
    const fechaVencimiento = new Date(r.fecha);
    fechaVencimiento.setDate(fechaVencimiento.getDate() + r.vigencia_dias);
    return fechaVencimiento.toISOString().split("T")[0] <= hoy;
  });

  // ─────────────────────────────────────────────
  // BLOQUE 2: Recibos con SOLICITUD_RECIBIDA
  // Vencen cuando fecha_limite_firma <= hoy
  // Si fecha_limite_firma es null → NO se tocan (pendiente de agendar firma)
  // ─────────────────────────────────────────────
  const { data: recibosSolicitud, error: err2 } = await supabase
    .from("recibos_apartado")
    .select("id, folio, tipo, cliente_nombre, inmueble, monto, fecha_limite_firma")
    .eq("estatus", "solicitud_recibida")
    .not("fecha_limite_firma", "is", null); // Solo los que tienen fecha límite de firma asignada

  if (err2) return res.status(500).json({ error: err2.message });

  const vencidosPlazo2 = (recibosSolicitud || []).filter(r => {
    return r.fecha_limite_firma && r.fecha_limite_firma <= hoy;
  });

  // ─────────────────────────────────────────────
  // Unir todos los vencidos
  // ─────────────────────────────────────────────
  const todosVencidos = [...vencidosPlazo1, ...vencidosPlazo2];

  if (todosVencidos.length === 0) {
    return res.status(200).json({ vencidos: 0, message: "Sin vencimientos hoy" });
  }

  // Marcar como vencidos
  const ids = todosVencidos.map(r => r.id);
  await supabase.from("recibos_apartado").update({ estatus: "vencido" }).in("id", ids);

  // Log
  for (const r of todosVencidos) {
    await supabase.from("recibos_log").insert({
      recibo_id: r.id,
      accion: "vencido",
      usuario_id: null,
      notas: vencidosPlazo2.find(x => x.id === r.id)
        ? "Vencido por plazo de firma (Plazo 2)"
        : "Vencido por plazo de vigencia (Plazo 1)",
    });
  }

  // Notificar a Carlos
  const buildFila = (r, motivo) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-family:monospace;color:#b91c3c;font-weight:700;">${r.folio}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">${r.cliente_nombre}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280;">${r.inmueble}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-weight:700;color:#dc2626;">${fmt(r.monto || 0)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:11px;color:#6b7280;">${motivo}</td>
    </tr>`;

  const filas = [
    ...vencidosPlazo1.map(r => buildFila(r, "Sin solicitud (Plazo 1)")),
    ...vencidosPlazo2.map(r => buildFila(r, "Sin firma (Plazo 2)")),
  ].join("");

  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:32px;">
      <div style="background:#1a1a2e;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:18px;">⏰ Recibos vencidos hoy — ${hoy}</h1>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px;">
        <p style="color:#374151;margin:0 0 20px;">Los siguientes <strong>${todosVencidos.length}</strong> recibos cumplieron su plazo y fueron marcados como vencidos:</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Folio</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Cliente</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Inmueble</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Monto</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Motivo</th>
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
        subject: `⏰ ${todosVencidos.length} recibo${todosVencidos.length !== 1 ? "s" : ""} vencido${todosVencidos.length !== 1 ? "s" : ""} hoy — ${hoy}`,
        html,
      }),
    });
  } catch (e) {
    console.error("Error enviando notificación de vencimientos:", e.message);
  }

  return res.status(200).json({
    vencidos: todosVencidos.length,
    plazo1: vencidosPlazo1.length,
    plazo2: vencidosPlazo2.length,
    folios: todosVencidos.map(r => r.folio),
  });
}
