export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { nombre, tipo, hora, tieneCita, llegaTarde, motivo, horaEsperada } = req.body

  const asunto = tieneCita
    ? `📅 ${nombre} tiene cita hoy — checó a las ${hora}`
    : `⚠️ ${nombre} llegó tarde a ${tipo === 'junta' ? 'la junta' : 'su guardia'} — ${hora}`

  const html = `
  <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
    <div style="background:${tieneCita ? '#eff6ff' : '#fff7ed'};border-radius:12px;padding:20px;border:1px solid ${tieneCita ? '#93c5fd' : '#fed7aa'};">
      <p style="margin:0 0 4px;font-size:22px;">${tieneCita ? '📅' : '⚠️'}</p>
      <h2 style="margin:0 0 8px;font-size:18px;font-weight:800;color:${tieneCita ? '#1e40af' : '#92400e'};">${nombre}</h2>
      <p style="margin:0 0 4px;font-size:14px;color:#374151;">
        ${tieneCita ? 'Tiene cita hoy' : `Llegó tarde a ${tipo === 'junta' ? 'la junta' : 'su guardia'}`}
      </p>
      <div style="display:flex;gap:16px;margin-top:14px;flex-wrap:wrap;">
        <div>
          <p style="margin:0;font-size:10px;color:#9ca3af;text-transform:uppercase;">Hora checada</p>
          <p style="margin:0;font-size:20px;font-weight:900;color:#1a1a2e;">${hora}</p>
        </div>
        <div>
          <p style="margin:0;font-size:10px;color:#9ca3af;text-transform:uppercase;">Hora esperada</p>
          <p style="margin:0;font-size:20px;font-weight:900;color:#6b7280;">${horaEsperada}</p>
        </div>
      </div>
      ${motivo ? `
      <div style="margin-top:14px;background:#fff;border-radius:8px;padding:12px;">
        <p style="margin:0 0 4px;font-size:10px;color:#9ca3af;text-transform:uppercase;">Motivo</p>
        <p style="margin:0;font-size:14px;font-weight:700;color:#374151;">${motivo}</p>
      </div>` : ''}
    </div>
    <p style="text-align:center;margin-top:16px;">
      <a href="https://app.emporioinmobiliario.com.mx/checador" style="color:#b91c3c;font-weight:600;font-size:13px;">Ver checador →</a>
    </p>
  </div>`

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
        subject: asunto,
        html,
      }),
    })
    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
