export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { nombre, telefono, email, mensaje, propiedad_id, propiedad_titulo } = req.body;
  try {
    // Registrar en EasyBroker
    await fetch("https://api.easybroker.com/v1/contact_requests", {
      method: "POST",
      headers: {
        "X-Authorization": process.env.EASYBROKER_API_KEY,
        "Content-Type": "application/json",
        "accept": "application/json",
      },
      body: JSON.stringify({
        property_id: propiedad_id,
        source: "emporioinmobiliario.com.mx",
        name: nombre,
        phone: telefono,
        email: email || undefined,
        message: mensaje || `Interesado en la propiedad ${propiedad_id}`,
      }),
    });

    // Email de notificación
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "InmoAdmin <cobros@emporioinmobiliario.com.mx>",
        to: ["ventas@emporioinmobiliario.mx"],
        subject: `🏠 Nuevo contacto — ${propiedad_id} — ${nombre}`,
        html: `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;">
            <div style="background:#1a1a2e;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
              <h1 style="color:#c8a96e;margin:0;font-size:18px;">🏠 Nuevo Prospecto</h1>
            </div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:24px;">
              <p style="margin:0 0 8px;"><strong>Propiedad:</strong> ${propiedad_titulo} (${propiedad_id})</p>
              <p style="margin:0 0 8px;"><strong>Nombre:</strong> ${nombre}</p>
              <p style="margin:0 0 8px;"><strong>Teléfono:</strong> ${telefono}</p>
              <p style="margin:0 0 8px;"><strong>Email:</strong> ${email || "—"}</p>
              <p style="margin:0;"><strong>Mensaje:</strong> ${mensaje || "—"}</p>
            </div>
          </div>
        `,
      }),
    });

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
