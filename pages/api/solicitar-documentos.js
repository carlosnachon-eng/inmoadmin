export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { solicitud_id, correo, nombre, documentos_solicitados, notas } = req.body;
  if (!solicitud_id || !correo) return res.status(400).json({ error: 'Faltan datos' });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.emporioinmobiliario.com.mx';
  const linkComplemento = `${baseUrl}/complementar-solicitud?id=${solicitud_id}`;

  const listaDocumentos = documentos_solicitados?.map(d => `<li style="margin-bottom:6px;">${d}</li>`).join('') || '';

  const html = `
  <div style="font-family:system-ui,sans-serif;max-width:540px;margin:0 auto;padding:24px;">
    <div style="background:#1a1a2e;border-radius:12px 12px 0 0;padding:24px;text-align:center;">
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style="height:44px;margin-bottom:8px;" />
      <h1 style="color:#c8a96e;margin:0;font-size:18px;font-weight:800;">Información adicional requerida</h1>
    </div>
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:28px;">
      <p style="color:#374151;font-size:14px;margin:0 0 16px;">Hola <strong>${nombre}</strong>,</p>
      <p style="color:#374151;font-size:14px;margin:0 0 16px;">Nuestro equipo jurídico está revisando tu solicitud de arrendamiento y necesita que complementes la siguiente información:</p>
      ${listaDocumentos ? `<ul style="color:#374151;font-size:13px;margin:0 0 16px;padding-left:20px;">${listaDocumentos}</ul>` : ''}
      ${notas ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;margin-bottom:16px;"><p style="margin:0;font-size:13px;color:#92400e;"><strong>Notas del equipo jurídico:</strong> ${notas}</p></div>` : ''}
      <div style="text-align:center;margin:24px 0;">
        <a href="${linkComplemento}" style="background:#b91c3c;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:800;font-size:14px;display:inline-block;">
          Subir documentos →
        </a>
      </div>
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">¿Tienes dudas? Contáctanos al <strong>222 257 3237</strong></p>
    </div>
  </div>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Emporio Inmobiliario <cobros@emporioinmobiliario.com.mx>',
        to: [correo],
        subject: `📋 Tu solicitud requiere información adicional — Emporio Inmobiliario`,
        html,
      }),
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
