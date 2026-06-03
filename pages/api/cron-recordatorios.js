import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const hoy = new Date();
  const fmtFecha = (d) => d.toISOString().split("T")[0];

  // ── PASO 1: Marcar como atrasado pagos vencidos hace más de 5 días ──
  const hace5 = new Date(hoy);
  hace5.setDate(hace5.getDate() - 5);
  const fecha5 = fmtFecha(hace5);

  const { data: pagosAtrasados } = await supabase
    .from("payments")
    .select("id, tenant_name, property_name, due_date")
    .eq("status", "pendiente")
    .lte("due_date", fecha5);

  let marcadosAtrasados = 0;
  if (pagosAtrasados && pagosAtrasados.length > 0) {
    const ids = pagosAtrasados.map(p => p.id);
    await supabase.from("payments").update({ status: "atrasado" }).in("id", ids);
    marcadosAtrasados = ids.length;
  }

  // ── PASO 2: Enviar recordatorios a pagos vencidos con email ──
  const { data: pagos } = await supabase
    .from("payments")
    .select("*")
    .in("status", ["pendiente", "atrasado"])
    .not("tenant_email", "is", null);

  let enviados = 0;
  const resumen = [];

  if (pagos && pagos.length > 0) {
    for (const pago of pagos) {
      if (!pago.due_date || !pago.tenant_email) continue;

      const vencimiento = new Date(pago.due_date);
      const diasVencido = Math.floor((hoy - vencimiento) / (1000 * 60 * 60 * 24));

      if (![1, 5, 10].includes(diasVencido)) continue;

      let asunto, urgencia, color;
      if (diasVencido === 1) {
        asunto = `Recordatorio de pago — ${pago.property_name}`;
        urgencia = "Tu pago venció ayer.";
        color = "#92400e";
      } else if (diasVencido === 5) {
        asunto = `⚠️ Pago atrasado 5 días — ${pago.property_name}`;
        urgencia = "Tu pago lleva 5 días de retraso.";
        color = "#dc2626";
      } else {
        asunto = `🚨 Pago atrasado 10 días — ${pago.property_name}`;
        urgencia = "Tu pago lleva 10 días de retraso. Por favor regulariza tu situación a la brevedad.";
        color = "#7f1d1d";
      }

      const htmlInquilino = `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;">
          <div style="background:#1a1a2e;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
            <h1 style="color:#c8a96e;margin:0;font-size:20px;">🏢 Emporio Inmobiliario</h1>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:28px;">
            <p style="color:${color};font-weight:700;font-size:16px;margin:0 0 16px;">${urgencia}</p>
            <p style="color:#374151;margin:0 0 20px;">Hola <strong>${pago.tenant_name}</strong>, te recordamos que tienes un pago pendiente:</p>
            <div style="background:#f9fafb;border-radius:10px;padding:20px;margin:0 0 20px;">
              <p style="margin:0 0 8px;color:#374151;"><strong>Propiedad:</strong> ${pago.property_name}</p>
              <p style="margin:0 0 8px;color:#374151;"><strong>Monto:</strong> ${fmt(pago.amount)}</p>
              <p style="margin:0;color:#374151;"><strong>Fecha límite:</strong> ${pago.due_date}</p>
            </div>
            <div style="text-align:center;">
              <a href="https://app.emporioinmobiliario.com.mx/inquilino" style="background:#c8a96e;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">
                Subir comprobante →
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
            to: [pago.tenant_email],
            subject: asunto,
            html: htmlInquilino,
          }),
        });
        enviados++;
        resumen.push({ inquilino: pago.tenant_name, propiedad: pago.property_name, dias: diasVencido });
      } catch (e) {
        console.error("Error enviando a", pago.tenant_email, e.message);
      }
    }
  }

  // ── PASO 3: Enviar resumen al equipo ──
  const htmlEquipo = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;">
      <div style="background:#1a1a2e;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:#c8a96e;margin:0;font-size:20px;">📋 Reporte diario — ${fmtFecha(hoy)}</h1>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:28px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
          <div style="background:#fff5f5;border-radius:10px;padding:16px;text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase;">Marcados atrasados hoy</p>
            <p style="margin:0;font-size:28px;font-weight:800;color:#dc2626;">${marcadosAtrasados}</p>
          </div>
          <div style="background:#fffbeb;border-radius:10px;padding:16px;text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase;">Recordatorios enviados</p>
            <p style="margin:0;font-size:28px;font-weight:800;color:#92400e;">${enviados}</p>
          </div>
        </div>
        ${resumen.length > 0 ? `
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;">INQUILINO</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;">PROPIEDAD</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;">DÍAS VENCIDO</th>
            </tr>
          </thead>
          <tbody>
            ${resumen.map(r => `
              <tr>
                <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">${r.inquilino}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">${r.propiedad}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#dc2626;font-weight:700;">${r.dias} día${r.dias !== 1 ? "s" : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table>` : "<p style='color:#6b7280;text-align:center;'>No hubo recordatorios hoy ✅</p>"}
        <p style="margin:20px 0 0;font-size:13px;color:#6b7280;text-align:center;">
          <a href="https://app.emporioinmobiliario.com.mx" style="color:#c8a96e;">Ver panel completo →</a>
        </p>
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
        to: ["carlos.nachon@emporioinmobiliario.mx", "asistente1@emporioinmobiliario.mx", "administracion@emporioinmobiliario.com.mx"],
        subject: `📋 Reporte diario — ${marcadosAtrasados} atrasados, ${enviados} recordatorios — ${fmtFecha(hoy)}`,
        html: htmlEquipo,
      }),
    });
  } catch (e) {
    console.error("Error enviando resumen al equipo", e.message);
  }

  // ── PASO 4: Recordatorios automáticos de renovación de póliza ──
  const en60dias = new Date(hoy); en60dias.setDate(en60dias.getDate() + 60);
  const en30dias = new Date(hoy); en30dias.setDate(en30dias.getDate() + 30);

  const { data: expedientes } = await supabase
    .from('poliza_expedientes')
    .select('id, nombre_arrendatario, nombre_arrendador, correo_arrendatario, correo_arrendador, direccion_inmueble, fecha_vigencia, renta_mensual, recordatorio_60_enviado, recordatorio_30_enviado')
    .eq('status', 'activo')
    .not('fecha_vigencia', 'is', null)
    .lte('fecha_vigencia', fmtFecha(en60dias));

  let recordatoriosPoliza = 0;

  if (expedientes && expedientes.length > 0) {
    for (const exp of expedientes) {
      const vigencia = new Date(exp.fecha_vigencia + 'T12:00:00');
      const diasRestantes = Math.ceil((vigencia - hoy) / (1000 * 60 * 60 * 24));

      const es60 = diasRestantes <= 60 && diasRestantes > 30 && !exp.recordatorio_60_enviado;
      const es30 = diasRestantes <= 30 && diasRestantes >= 0 && !exp.recordatorio_30_enviado;

      if (!es60 && !es30) continue;

      const urgencia = diasRestantes <= 30
        ? `⚠️ Su póliza vence en ${diasRestantes} días.`
        : `Su póliza jurídica vence en ${diasRestantes} días.`;

      const htmlPoliza = `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;">
          <div style="background:#1a1a2e;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
            <h1 style="color:#c8a96e;margin:0;font-size:20px;">🏢 Emporio Inmobiliario</h1>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:28px;">
            <p style="color:${diasRestantes <= 30 ? '#dc2626' : '#92400e'};font-weight:700;font-size:16px;margin:0 0 16px;">${urgencia}</p>
            <p style="color:#374151;margin:0 0 20px;">Le informamos que la póliza jurídica del siguiente inmueble está próxima a vencer:</p>
            <div style="background:#f9fafb;border-radius:10px;padding:20px;margin:0 0 20px;">
              <p style="margin:0 0 8px;color:#374151;"><strong>Inmueble:</strong> ${exp.direccion_inmueble}</p>
              <p style="margin:0 0 8px;color:#374151;"><strong>Arrendatario:</strong> ${exp.nombre_arrendatario}</p>
              <p style="margin:0 0 8px;color:#374151;"><strong>Arrendador:</strong> ${exp.nombre_arrendador}</p>
              <p style="margin:0 0 8px;color:#374151;"><strong>Renta mensual:</strong> ${fmt(exp.renta_mensual)}</p>
              <p style="margin:0;color:${diasRestantes <= 30 ? '#dc2626' : '#374151'};font-weight:700;"><strong>Vence:</strong> ${exp.fecha_vigencia} (${diasRestantes} días)</p>
            </div>
            <p style="color:#6b7280;font-size:13px;text-align:center;">Para renovar su póliza, comuníquese con nosotros a la brevedad.</p>
          </div>
        </div>`;

      const destinatarios = [
        exp.correo_arrendatario,
        exp.correo_arrendador,
        'administracion@emporioinmobiliario.com.mx',
      ].filter(Boolean);

      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'InmoAdmin <cobros@emporioinmobiliario.com.mx>',
            to: destinatarios,
            subject: `${diasRestantes <= 30 ? '⚠️' : '📋'} Póliza jurídica por vencer — ${exp.direccion_inmueble}`,
            html: htmlPoliza,
          }),
        });

        await supabase.from('poliza_expedientes').update({
          fecha_ultimo_recordatorio: new Date().toISOString(),
          ...(es60 && { recordatorio_60_enviado: true }),
          ...(es30 && { recordatorio_30_enviado: true }),
        }).eq('id', exp.id);

        recordatoriosPoliza++;
      } catch (e) {
        console.error('Error enviando recordatorio póliza', exp.id, e.message);
      }
    }
  }

  return res.status(200).json({
    fecha: fmtFecha(hoy),
    marcadosAtrasados,
    recordatoriosEnviados: enviados,
    recordatoriosPoliza,
    resumen,
  });
}
