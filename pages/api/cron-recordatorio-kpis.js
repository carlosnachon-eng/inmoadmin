import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ASESORES = [
  { nombre: 'Ariannet',  email: 'ariannet81@gmail.com' },
  { nombre: 'Angélica',  email: 'angelicamomox@gmail.com' },
  { nombre: 'Rosario',   email: 'rddd298@gmail.com' },
  { nombre: 'Iván',      email: 'ivanmtzco@gmail.com' },
  { nombre: 'Andrea',    email: 'nextelmoto2@gmail.com' },
  { nombre: 'Guillermo', email: 'guillermo@emporioinmobiliario.com.mx' },
];

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

  // Ver quién ya capturó hoy
  const { data: registrosHoy } = await supabase
    .from('kpis_diarios')
    .select('email')
    .eq('fecha', hoy);

  const emailsCapturados = new Set((registrosHoy || []).map(r => r.email));

  const pendientes = ASESORES.filter(a => !emailsCapturados.has(a.email));

  let enviados = 0;

  for (const asesor of pendientes) {
    const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <div style="background:#1a1a2e;border-radius:12px 12px 0 0;padding:20px;text-align:center;">
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style="height:40px;margin-bottom:8px;" />
        <h1 style="color:#c8a96e;margin:0;font-size:17px;font-weight:800;">Captura tus KPIs de hoy</h1>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:24px;text-align:center;">
        <p style="font-size:32px;margin:0 0 8px;">📊</p>
        <p style="font-size:15px;font-weight:700;color:#374151;margin:0 0 8px;">Hola ${asesor.nombre},</p>
        <p style="font-size:13px;color:#6b7280;margin:0 0 20px;">Aún no has capturado tus citas de hoy. Tarda menos de 1 minuto.</p>
        <a href="https://app.emporioinmobiliario.com.mx/kpis"
          style="background:#b91c3c;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:800;font-size:14px;display:inline-block;">
          Capturar ahora →
        </a>
        <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;">Si ya los capturaste, ignora este mensaje.</p>
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
          to: [asesor.email],
          subject: `📊 Recuerda capturar tus KPIs de hoy — ${hoy}`,
          html,
        }),
      });
      enviados++;
    } catch (e) {
      console.error("Error enviando a", asesor.email, e.message);
    }
  }

  return res.status(200).json({ fecha: hoy, pendientes: pendientes.length, enviados });
}
