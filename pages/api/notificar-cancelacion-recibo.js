// pages/api/notificar-cancelacion-recibo.js
// Notifica a Carlos cuando se cancela un recibo

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { folio, cliente, inmueble, monto, motivo, cancelado_por } = req.body;

  const fmt = (n) => "$" + Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2 });

  const html = `
    <div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:32px;">
      <div style="background:#7f1d1d;padding:20px 24px;border-radius:12px 12px 0 0;display:flex;align-items:center;gap:12px;">
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" style="height:36px;" />
        <h1 style="color:#fff;margin:0;font-size:18px;">Recibo cancelado</h1>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px;">

        <div style="background:#fff5f5;border-radius:10px;padding:16px 20px;margin-bottom:20px;border-left:4px solid #dc2626;">
          <p style="margin:0 0 4px;font-size:22px;font-weight:800;color:#dc2626;">${folio}</p>
          <p style="margin:0;font-size:13px;color:#6b7280;">Cancelado</p>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:10px 0;color:#6b7280;width:140px;">Cliente</td>
            <td style="padding:10px 0;font-weight:700;color:#1a1a2e;">${cliente}</td>
          </tr>
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:10px 0;color:#6b7280;">Inmueble</td>
            <td style="padding:10px 0;color:#374151;">${inmueble}</td>
          </tr>
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:10px 0;color:#6b7280;">Monto</td>
            <td style="padding:10px 0;font-weight:700;color:#dc2626;">${fmt(monto)}</td>
          </tr>
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:10px 0;color:#6b7280;">Cancelado por</td>
            <td style="padding:10px 0;font-weight:600;color:#1a1a2e;">${cancelado_por}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#6b7280;vertical-align:top;">Motivo</td>
            <td style="padding:10px 0;color:#374151;">${motivo}</td>
          </tr>
        </table>

        <div style="margin-top:24px;text-align:center;">
          <a href="https://app.emporioinmobiliario.com.mx/recibos" style="background:#7f1d1d;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">
            Ver en InmoAdmin →
          </a>
        </div>
      </div>
      <p style="text-align:center;font-size:12px;color:#9ca3af;margin-top:16px;">InmoAdmin · Emporio Inmobiliario</p>
    </div>`;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "InmoAdmin <cobros@emporioinmobiliario.com.mx>",
        to: ["carlos.nachon@emporioinmobiliario.mx"],
        subject: `⚠️ Recibo cancelado ${folio} — ${cliente}`,
        html,
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Error notificando cancelación:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
