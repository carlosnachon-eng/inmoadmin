// pages/api/notificar-recibo.js
// Notifica a Carlos cuando se genera un nuevo recibo de apartado

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { folio, tipo, cliente, inmueble, monto, recibido_por, forma_pago, tiene_comprobante, generado_por } = req.body;

  const tipoLabel = tipo === "compraventa" ? "Compraventa" : "Arrendamiento";
  const comprobante = tiene_comprobante ? "✅ Sí" : "❌ No adjunto";
  const tipoColor = tipo === "compraventa" ? "#b91c3c" : "#1e40af";

  const html = `
    <div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:32px;">
      <div style="background:#1a1a2e;padding:20px 24px;border-radius:12px 12px 0 0;display:flex;align-items:center;gap:12px;">
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" style="height:36px;" />
        <h1 style="color:#fff;margin:0;font-size:18px;">Nuevo recibo generado</h1>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px;">

        <div style="background:#f9fafb;border-radius:10px;padding:16px 20px;margin-bottom:20px;border-left:4px solid ${tipoColor};">
          <p style="margin:0 0 4px;font-size:22px;font-weight:800;color:${tipoColor};">${folio}</p>
          <p style="margin:0;font-size:13px;color:#6b7280;">${tipoLabel}</p>
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
            <td style="padding:10px 0;font-weight:700;color:#b91c3c;font-size:16px;">${monto}</td>
          </tr>
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:10px 0;color:#6b7280;">Forma de pago</td>
            <td style="padding:10px 0;color:#374151;">${forma_pago}</td>
          </tr>
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:10px 0;color:#6b7280;">Recibido por</td>
            <td style="padding:10px 0;font-weight:600;color:#1a1a2e;">${recibido_por}</td>
          </tr>
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:10px 0;color:#6b7280;">Comprobante</td>
            <td style="padding:10px 0;">${comprobante}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#6b7280;">Generado por</td>
            <td style="padding:10px 0;color:#374151;">${generado_por}</td>
          </tr>
        </table>

        <div style="margin-top:24px;text-align:center;">
          <a href="https://app.emporioinmobiliario.com.mx/recibos" style="background:#b91c3c;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">
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
        subject: `🧾 Nuevo recibo ${folio} — ${cliente} — ${monto}`,
        html,
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Error notificando recibo:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
