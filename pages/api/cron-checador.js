import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fmt12 = (ts) => {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Mexico_City' });
};

const fmtFecha = (f) => {
  if (!f) return '—';
  return new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
};

const diasFuera = (fecha_prestamo) => {
  if (!fecha_prestamo) return 0;
  return Math.floor((new Date() - new Date(fecha_prestamo)) / (1000 * 60 * 60 * 24));
};

const PERSONAL_FALLBACK = {
  'ariannet81@gmail.com':              'Ariannet',
  'angelicamomox@gmail.com':           'Angélica',
  'rddd298@gmail.com':                 'Rosario',
  'ivanmtzco@gmail.com':               'Iván',
  'nextelmoto2@gmail.com':             'Andrea',
  'islas.amanda111@gmail.com':         'Amanda',
  'guillermo@emporioinmobiliario.com.mx': 'Guillermo',
  'juridico@emporioinmobiliario.mx':   'Zaye',
  'asistente1@emporioinmobiliario.mx': 'Tania',
};

const NOMBRES_CONOCIDOS = {
  'carlos.nachon@emporioinmobiliario.mx': 'Carlos',
  'guillermo@emporioinmobiliario.com.mx': 'Guillermo',
  'juridico@emporioinmobiliario.mx': 'Zaye',
  'asistente1@emporioinmobiliario.mx': 'Tania',
  'ariannet81@gmail.com': 'Ariannet',
  'angelicamomox@gmail.com': 'Angélica',
  'rddd298@gmail.com': 'Rosario',
  'ivanmtzco@gmail.com': 'Iván',
  'nextelmoto2@gmail.com': 'Andrea',
  'islas.amanda111@gmail.com': 'Amanda',
  'ismaelorortiz@gmail.com': 'Ismael Ortiz',
};

const ROLES_EQUIPO_CHECADOR_CRON = ['gerente_ventas', 'coord_operaciones', 'juridico', 'asesor', 'chofer'];
const ROLES_ASISTENCIA_FIJA = ['coord_operaciones', 'juridico', 'chofer'];
const ROLES_JUNTA = ['gerente_ventas', 'asesor'];

const isPartnerEmail = (email, partnerEmails) => partnerEmails.has(String(email || '').toLowerCase());

const getNombrePersona = (profile) => {
  const email = String(profile?.email || '').toLowerCase();
  return profile?.full_name || NOMBRES_CONOCIDOS[email] || email.split('@')[0] || profile?.email || 'Sin nombre';
};

const cargarEquipoChecador = async () => {
  const [{ data: profiles, error: profilesError }, { data: partners }] = await Promise.all([
    supabase
      .from('profiles')
      .select('email, full_name, role_id, active')
      .eq('active', true)
      .in('role_id', ROLES_EQUIPO_CHECADOR_CRON),
    supabase.from('partner_users').select('email'),
  ]);

  if (profilesError || !profiles?.length) {
    const fallback = Object.entries(PERSONAL_FALLBACK).map(([email, nombre]) => ({
      email,
      nombre,
      role_id: ['juridico@emporioinmobiliario.mx', 'asistente1@emporioinmobiliario.mx'].includes(email)
        ? 'juridico'
        : email === 'guillermo@emporioinmobiliario.com.mx'
          ? 'gerente_ventas'
          : 'asesor',
    }));
    return { equipo: fallback, source: 'fallback' };
  }

  const partnerEmails = new Set((partners || []).map(p => String(p.email || '').toLowerCase()));
  const equipo = profiles
    .filter(p => !isPartnerEmail(p.email, partnerEmails))
    .map(p => ({
      email: String(p.email || '').toLowerCase(),
      nombre: getNombrePersona(p),
      role_id: p.role_id,
    }));

  return { equipo, source: 'profiles' };
};

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  const diaSemana = new Date().getDay(); // 0=dom, 2=mar, 6=sab
  const esLaborable = diaSemana >= 1 && diaSemana <= 5;
  const esMartes = diaSemana === 2;
  const { equipo, source: equipoSource } = await cargarEquipoChecador();

  // 1. Llaves fuera de resguardo por más de 1 día
  const { data: llavesAfuera } = await supabase
    .from('llaves')
    .select('*')
    .eq('activa', true)
    .eq('en_resguardo', false);

  const llavesAlerta = (llavesAfuera || []).filter(l => diasFuera(l.fecha_prestamo) >= 1);

  // 2. Guardia de hoy
  const { data: guardiasHoy } = await supabase
    .from('guardias')
    .select('*')
    .eq('fecha_guardia', hoy);

  // 3. Quién no checó ayer (solo días laborables)
  const { data: checadasAyer } = await supabase
    .from('checadas')
    .select('*')
    .eq('fecha', ayer);

  const nombresChecaronAyer = new Set((checadasAyer || []).map(c => c.nombre));

  // Staff fijo que debió checar ayer
  const staffNoCheco = esLaborable
    ? equipo
      .filter(p => ROLES_ASISTENCIA_FIJA.includes(p.role_id))
      .map(p => p.nombre)
      .filter(n => !nombresChecaronAyer.has(n))
    : [];

  // Asesores con guardia ayer que no checaron
  const { data: guardiasAyer } = await supabase
    .from('guardias')
    .select('*')
    .eq('fecha_guardia', ayer);

  const asesoresNoChecaron = (guardiasAyer || [])
    .filter(g => !nombresChecaronAyer.has(g.nombre))
    .map(g => g.nombre);

  // Junta de ayer (martes) — quién no checó
  const diaSemanaAyer = new Date(Date.now() - 86400000).getDay();
  const ayerFueMartes = diaSemanaAyer === 2;
  const { data: juntasAyer } = ayerFueMartes
    ? await supabase.from('checadas').select('*').eq('fecha', ayer).eq('tipo', 'junta')
    : { data: [] };
  const nombresJuntaAyer = new Set((juntasAyer || []).map(c => c.nombre));
  const asesoresSinJunta = ayerFueMartes
    ? equipo
      .filter(p => ROLES_JUNTA.includes(p.role_id))
      .map(p => p.nombre)
      .filter(n => !nombresJuntaAyer.has(n))
    : [];

  // No enviar si no hay nada relevante
  const hayAlgo = llavesAlerta.length > 0 || guardiasHoy.length > 0 || staffNoCheco.length > 0 || asesoresNoChecaron.length > 0 || asesoresSinJunta.length > 0;
  if (!hayAlgo) {
    return res.status(200).json({ ok: true, mensaje: 'Sin alertas, no se envió email' });
  }

  const html = `
  <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#f8f8f8;padding:24px;">
    <div style="background:#1a1a2e;border-radius:12px;padding:20px;text-align:center;margin-bottom:16px;">
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style="height:40px;margin-bottom:8px;" />
      <h1 style="color:#fff;margin:0;font-size:17px;font-weight:800;">Reporte Diario — Checador</h1>
      <p style="color:rgba(255,255,255,0.5);margin:4px 0 0;font-size:12px;">${fmtFecha(hoy)}</p>
    </div>

    ${llavesAlerta.length > 0 ? `
    <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:12px;border:1px solid #fed7aa;">
      <h2 style="margin:0 0 12px;font-size:13px;font-weight:800;color:#92400e;text-transform:uppercase;">⚠️ Llaves fuera de resguardo +1 día (${llavesAlerta.length})</h2>
      ${llavesAlerta.map(l => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <div>
            <span style="background:#1a1a2e;color:#fff;border-radius:6px;padding:2px 8px;font-size:13px;font-weight:900;margin-right:8px;">#${l.numero}</span>
            <span style="font-size:13px;font-weight:700;color:#374151;">${l.propiedad}</span>
          </div>
          <div style="text-align:right;">
            <span style="font-size:12px;color:#b91c3c;font-weight:700;">${l.portador_nombre}</span>
            <br/><span style="font-size:11px;color:#9ca3af;">${diasFuera(l.fecha_prestamo)} día(s)</span>
          </div>
        </div>
      `).join('')}
    </div>` : ''}

    ${guardiasHoy.length > 0 ? `
    <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:12px;border:1px solid #e5e7eb;">
      <h2 style="margin:0 0 12px;font-size:13px;font-weight:800;color:#374151;text-transform:uppercase;">🗓️ Guardia de hoy</h2>
      ${guardiasHoy.map(g => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;">
          <span style="font-size:14px;font-weight:800;color:#1a1a2e;">${g.nombre}</span>
          <span style="font-size:12px;color:#9ca3af;">· 9:00 AM</span>
        </div>
      `).join('')}
    </div>` : `
    <div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0;font-size:13px;color:#9ca3af;">Sin guardia asignada hoy</p>
    </div>`}

    ${(staffNoCheco.length > 0 || asesoresNoChecaron.length > 0) ? `
    <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:12px;border:1px solid #fee2e2;">
      <h2 style="margin:0 0 12px;font-size:13px;font-weight:800;color:#991b1b;text-transform:uppercase;">🔴 No checaron ayer</h2>
      ${[...staffNoCheco, ...asesoresNoChecaron].map(n => `
        <div style="padding:6px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-size:13px;font-weight:700;color:#374151;">${n}</span>
        </div>
      `).join('')}
    </div>` : `
    <div style="background:#f0fdf4;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #86efac;text-align:center;">
      <p style="margin:0;font-size:13px;color:#065f46;font-weight:700;">✅ Todo el equipo checó ayer</p>
    </div>`}

    ${asesoresSinJunta.length > 0 ? `
    <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:12px;border:1px solid #fca5a5;">
      <h2 style="margin:0 0 12px;font-size:13px;font-weight:800;color:#991b1b;text-transform:uppercase;">📅 Faltaron a la junta de ayer</h2>
      ${asesoresSinJunta.map(n => `
        <div style="padding:6px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-size:13px;font-weight:700;color:#374151;">${n}</span>
        </div>
      `).join('')}
    </div>` : ayerFueMartes ? `
    <div style="background:#eff6ff;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #93c5fd;text-align:center;">
      <p style="margin:0;font-size:13px;color:#1e40af;font-weight:700;">✅ Todos asistieron a la junta</p>
    </div>` : ''}

    <p style="text-align:center;font-size:12px;color:#9ca3af;margin:0;">
      <a href="https://app.emporioinmobiliario.com.mx/checador" style="color:#b91c3c;font-weight:600;">Ver checador →</a>
    </p>
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
        to: ["carlos.nachon@emporioinmobiliario.mx", "guillermo@emporioinmobiliario.com.mx"],
        subject: `📋 Checador ${fmtFecha(hoy)}${llavesAlerta.length > 0 ? ` · ⚠️ ${llavesAlerta.length} llave(s) fuera` : ''}`,
        html,
      }),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  return res.status(200).json({ ok: true, llavesAlerta: llavesAlerta.length, guardiasHoy: guardiasHoy.length, equipoSource });
}
