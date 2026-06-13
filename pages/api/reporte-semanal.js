import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
  const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];

  const [
    { data: properties },
    { data: payments },
    { data: expedientes },
    { data: cierres },
    { data: kpis },
  ] = await Promise.all([
    supabase.from("properties").select("status, rent_amount"),
    supabase.from("payments").select("status, amount, due_date").gte("due_date", inicioMes).lte("due_date", finMes),
    supabase.from("poliza_expedientes").select("status, fecha_vigencia, nombre_arrendatario, direccion_inmueble").eq("status", "activo"),
    supabase.from("cierres").select("vendedor, comision").gte("fecha_cierre", inicioMes).lte("fecha_cierre", finMes),
    supabase.from("kpis_diarios").select("asesor, citas_efectivas").gte("fecha", inicioMes).lte("fecha", finMes),
  ]);

  const propOcupadas    = (properties || []).filter(p => p.status === "ocupada");
  const propDisponibles = (properties || []).filter(p => p.status === "disponible");
  const rentaMensual    = propOcupadas.reduce((a, p) => a + (p.rent_amount || 0), 0);
  const cobrado         = (payments || []).filter(p => p.status === "pagado").reduce((a, p) => a + (p.amount || 0), 0);
  const pendiente       = (payments || []).filter(p => p.status === "pendiente").reduce((a, p) => a + (p.amount || 0), 0);
  const atrasado        = (payments || []).filter(p => p.status === "atrasado").reduce((a, p) => a + (p.amount || 0), 0);

  const polizasPorVencer = (expedientes || []).filter(e => {
    if (!e.fecha_vigencia) return false;
    const dias = Math.ceil((new Date(e.fecha_vigencia + 'T12:00:00') - hoy) / (1000 * 60 * 60 * 24));
    return dias <= 30 && dias >= 0;
  });

  const ASESORES = ['Ariannet', 'Angélica', 'Rosario', 'Iván', 'Andrea', 'Guillermo', 'Amanda'];
  const VENDEDOR_MAP = {
    'Ariannet': 'ari', 'Angélica': 'angelica', 'Iván': 'ivan',
    'Rosario': 'rosario', 'Andrea': 'andrea', 'Guillermo': 'guillermo',
    'Amanda': 'amanda',
  };
  const META_INGRESOS = 90000;

  const rankingVentas = ASESORES.map(nombre => {
    const key = VENDEDOR_MAP[nombre] || nombre.toLowerCase();
    const cierresAsesor = (cierres || []).filter(c => (c.vendedor || '').toLowerCase() === key);
    const kpisAsesor = (kpis || []).filter(k => k.asesor === nombre);
    const ingresos = cierresAsesor.reduce((a, c) => a + (parseFloat(c.comision) || 0), 0);
    const citas = kpisAsesor.reduce((a, k) => a + (k.citas_efectivas || 0), 0);
    return { nombre, operaciones: cierresAsesor.length, ingresos, citas };
  }).sort((a, b) => b.operaciones - a.operaciones || b.ingresos - a.ingresos);

  const totalIngresos = rankingVentas.reduce((a, a2) => a + a2.ingresos, 0);
  const totalCierres  = rankingVentas.reduce((a, a2) => a + a2.operaciones, 0);
  const mes = hoy.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

  const html = `
  <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#f8f8f8;padding:24px;">
    <div style="background:#1a1a2e;border-radius:12px;padding:24px;text-align:center;margin-bottom:16px;">
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style="height:48px;margin-bottom:8px;" />
      <h1 style="color:#c8a96e;margin:0;font-size:18px;font-weight:800;">Reporte Semanal</h1>
      <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">${hoy.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
    </div>

    <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #e5e7eb;">
      <h2 style="margin:0 0 16px;font-size:14px;font-weight:800;color:#374151;text-transform:uppercase;letter-spacing:1px;">🏢 Arrendamiento — ${mes}</h2>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
        <div style="background:#f0fdf4;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:10px;color:#6b7280;margin-bottom:4px;">OCUPADAS</div>
          <div style="font-size:24px;font-weight:900;color:#065f46;">${propOcupadas.length}</div>
        </div>
        <div style="background:#f8f8f8;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:10px;color:#6b7280;margin-bottom:4px;">DISPONIBLES</div>
          <div style="font-size:24px;font-weight:900;color:#374151;">${propDisponibles.length}</div>
        </div>
        <div style="background:#f8f8f8;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:10px;color:#6b7280;margin-bottom:4px;">RENTA TOTAL</div>
          <div style="font-size:16px;font-weight:900;color:#374151;">${fmt(rentaMensual)}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
        <div style="background:#f0fdf4;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:10px;color:#6b7280;margin-bottom:4px;">COBRADO</div>
          <div style="font-size:16px;font-weight:800;color:#065f46;">${fmt(cobrado)}</div>
        </div>
        <div style="background:#fffbeb;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:10px;color:#6b7280;margin-bottom:4px;">PENDIENTE</div>
          <div style="font-size:16px;font-weight:800;color:#92400e;">${fmt(pendiente)}</div>
        </div>
        <div style="background:${atrasado > 0 ? '#fee2e2' : '#f8f8f8'};border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:10px;color:#6b7280;margin-bottom:4px;">ATRASADO</div>
          <div style="font-size:16px;font-weight:800;color:${atrasado > 0 ? '#991b1b' : '#9ca3af'};">${fmt(atrasado)}</div>
        </div>
      </div>
      ${polizasPorVencer.length > 0 ? `
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid #f0f0f0;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#92400e;">⚠️ Pólizas por vencer en 30 días (${polizasPorVencer.length})</p>
        ${polizasPorVencer.map(e => {
          const dias = Math.ceil((new Date(e.fecha_vigencia + 'T12:00:00') - hoy) / (1000 * 60 * 60 * 24));
          return `<div style="font-size:12px;color:#374151;padding:4px 0;border-bottom:1px solid #f9f9f9;">
            <strong>${e.nombre_arrendatario}</strong> — ${fmtDate(e.fecha_vigencia)} <span style="color:#b91c3c;font-weight:700;">(${dias} días)</span>
          </div>`;
        }).join('')}
      </div>` : ''}
    </div>

    <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #e5e7eb;">
      <h2 style="margin:0 0 4px;font-size:14px;font-weight:800;color:#374151;text-transform:uppercase;letter-spacing:1px;">🏆 Ventas — ${mes}</h2>
      <p style="margin:0 0 16px;font-size:12px;color:#9ca3af;">${totalCierres} cierres · ${fmt(totalIngresos)} en ingresos</p>
      ${rankingVentas.map((a, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f3f4f6;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:16px;">${['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣'][i]}</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:#374151;">${a.nombre}</div>
            <div style="font-size:11px;color:#9ca3af;">${a.citas} citas efectivas</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:18px;font-weight:900;color:${a.operaciones > 0 ? '#b91c3c' : '#e5e7eb'};">${a.operaciones} <span style="font-size:11px;font-weight:400;color:#9ca3af;">cierres</span></div>
          <div style="font-size:12px;color:${a.ingresos >= META_INGRESOS ? '#065f46' : '#9ca3af'};font-weight:600;">${fmt(a.ingresos)}</div>
        </div>
      </div>`).join('')}
    </div>

    <p style="text-align:center;font-size:12px;color:#9ca3af;margin:0;">
      <a href="https://app.emporioinmobiliario.com.mx" style="color:#b91c3c;font-weight:600;">Abrir InmoAdmin →</a>
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
        to: ["carlos.nachon@emporioinmobiliario.mx"],
        subject: `📊 Reporte semanal — ${totalCierres} cierres · ${fmt(cobrado)} cobrado — ${mes}`,
        html,
      }),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  return res.status(200).json({ ok: true, mes, totalCierres, totalIngresos, cobrado, atrasado });
}
