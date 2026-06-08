import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const periodoLabel = (p) => {
  if (!p) return "—";
  const [y, m] = p.split("-");
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
};

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

  const { data: pagosParaAtrasado } = await supabase
    .from("payments")
    .select("id, tenant_name, property_name, due_date")
    .eq("status", "pendiente")
    .lte("due_date", fecha5);

  let marcadosAtrasados = 0;
  if (pagosParaAtrasado && pagosParaAtrasado.length > 0) {
    const ids = pagosParaAtrasado.map(p => p.id);
    await supabase.from("payments").update({ status: "atrasado" }).in("id", ids);
    marcadosAtrasados = ids.length;
  }

  // ── PASO 2: Enviar recordatorios ──
  // - Pendientes: solo en días 1, 5 (antes de marcar atrasado)
  // - Atrasados: TODOS LOS DÍAS hasta que paguen
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

      const vencimiento = new Date(pago.due_date + "T12:00:00");
      const diasVencido = Math.floor((hoy - vencimiento) / (1000 * 60 * 60 * 24));

      if (diasVencido < 1) continue; // aún no vence

      // Pendientes: solo días 1 y 5
      if (pago.status === "pendiente" && ![1, 5].includes(diasVencido)) continue;

      // Atrasados: todos los días (sin filtro de días específicos)
      // — ya caen aquí automáticamente

      let asunto, urgencia, color;
      if (diasVencido === 1) {
        asunto = `Recordatorio de pago — ${pago.property_name}`;
        urgencia = "Tu pago venció ayer.";
        color = "#92400e";
      } else if (diasVencido <= 5) {
        asunto = `⚠️ Pago atrasado ${diasVencido} días — ${pago.property_name}`;
        urgencia = `Tu pago lleva ${diasVencido} días de retraso.`;
        color = "#dc2626";
      } else if (diasVencido <= 10) {
        asunto = `🚨 Pago atrasado ${diasVencido} días — ${pago.property_name}`;
        urgencia = `Tu pago lleva ${diasVencido} días de retraso. Por favor regulariza tu situación a la brevedad.`;
        color = "#7f1d1d";
      } else {
        asunto = `🔴 URGENTE: Pago atrasado ${diasVencido} días — ${pago.property_name}`;
        urgencia = `Tu pago lleva ${diasVencido} días de retraso. Tu contrato puede estar en riesgo.`;
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
        resumen.push({
          inquilino: pago.tenant_name,
          propiedad: pago.property_name,
          dias: diasVencido,
          status: pago.status,
        });
      } catch (e) {
        console.error("Error enviando a", pago.tenant_email, e.message);
      }
    }
  }

  // ── PASO 3: Marcar cuotas de condominio como atrasadas ──
  const { data: cuotasVencidas } = await supabase
    .from("cuotas_condominio")
    .select("id, unidad_id, periodo, monto, fecha_vencimiento, unidades_condominio(propietario_nombre, propietario_email, numero, condominios(nombre))")
    .eq("status", "pendiente")
    .lte("fecha_vencimiento", fecha5);

  let cuotasMarcadas = 0;
  if (cuotasVencidas && cuotasVencidas.length > 0) {
    const ids = cuotasVencidas.map(q => q.id);
    await supabase.from("cuotas_condominio").update({ status: "atrasado" }).in("id", ids);
    cuotasMarcadas = ids.length;
  }

  // Enviar recordatorios a condóminos morosos
  const { data: cuotasAtrasadas } = await supabase
    .from("cuotas_condominio")
    .select("*, unidades_condominio(propietario_nombre, propietario_email, residente_email, numero, condominios(nombre))")
    .eq("status", "atrasado")
    .not("unidades_condominio.propietario_email", "is", null);

  let enviadosCondominio = 0;
  if (cuotasAtrasadas && cuotasAtrasadas.length > 0) {
    for (const q of cuotasAtrasadas) {
      const u = q.unidades_condominio;
      if (!u?.propietario_email) continue;
      const emailDestino = u.residente_email || u.propietario_email;
      const v = new Date((q.fecha_vencimiento || hoy) + "T12:00:00");
      const dias = Math.floor((hoy - v) / (1000 * 60 * 60 * 24));
      const htmlCuota = `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;">
          <div style="background:#1a1a2e;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
            <h1 style="color:#c8a96e;margin:0;font-size:20px;">🏢 Emporio Inmobiliario</h1>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:28px;">
            <p style="color:#dc2626;font-weight:700;font-size:16px;margin:0 0 16px;">🔴 Cuota de condominio atrasada ${dias} día${dias !== 1 ? "s" : ""}</p>
            <p style="color:#374151;margin:0 0 20px;">Hola <strong>${u.propietario_nombre}</strong>, tu cuota de condominio está pendiente:</p>
            <div style="background:#f9fafb;border-radius:10px;padding:20px;margin:0 0 20px;">
              <p style="margin:0 0 8px;color:#374151;"><strong>Condominio:</strong> ${u.condominios?.nombre || "—"}</p>
              <p style="margin:0 0 8px;color:#374151;"><strong>Unidad:</strong> ${u.numero}</p>
              <p style="margin:0 0 8px;color:#374151;"><strong>Periodo:</strong> ${periodoLabel(q.periodo)}</p>
              <p style="margin:0;color:#374151;"><strong>Monto:</strong> ${fmt(q.monto)}</p>
            </div>
            <div style="text-align:center;">
              <a href="https://app.emporioinmobiliario.com.mx/condomino" style="background:#c8a96e;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">
                Subir comprobante →
              </a>
            </div>
          </div>
        </div>`;
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "InmoAdmin <cobros@emporioinmobiliario.com.mx>",
            to: [emailDestino],
            subject: `🔴 Cuota de condominio atrasada ${dias} días — Unidad ${u.numero}`,
            html: htmlCuota,
          }),
        });
        enviadosCondominio++;
      } catch (e) { console.error("Error enviando a condómino", emailDestino, e.message); }
    }
  }

  // ── PASO 4: Contar totales REALES del día (no solo los nuevos) ──
  const { data: todosAtrasados } = await supabase
    .from("payments")
    .select("id, tenant_name, property_name, due_date, amount")
    .eq("status", "atrasado");

  const { data: todosPendientesVencidos } = await supabase
    .from("payments")
    .select("id, tenant_name, property_name, due_date, amount")
    .eq("status", "pendiente")
    .lte("due_date", fmtFecha(hoy));

  const totalAtrasadosActual = (todosAtrasados || []).length;
  const totalPendientesVencidos = (todosPendientesVencidos || []).length;
  const montoAtrasado = (todosAtrasados || []).reduce((a, p) => a + (p.amount || 0), 0);

  // ── PASO 4: Enviar resumen al equipo ──
  const hayAtrasados = totalAtrasadosActual > 0 || totalPendientesVencidos > 0;

  const tablaAtrasados = todosAtrasados && todosAtrasados.length > 0 ? `
    <h3 style="margin:20px 0 8px;font-size:13px;color:#dc2626;text-transform:uppercase;">Pagos atrasados (${totalAtrasadosActual})</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#fff5f5;">
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;">INQUILINO</th>
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;">PROPIEDAD</th>
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;">VENCIMIENTO</th>
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;">MONTO</th>
        </tr>
      </thead>
      <tbody>
        ${todosAtrasados.map(p => {
          const v = new Date(p.due_date + "T12:00:00");
          const dias = Math.floor((hoy - v) / (1000 * 60 * 60 * 24));
          return `<tr>
            <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;">${p.tenant_name}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;">${p.property_name}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;color:#dc2626;font-weight:700;">${dias} día${dias !== 1 ? "s" : ""}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-weight:700;">${fmt(p.amount)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>` : "";

  const htmlEquipo = `
    <div style="font-family:sans-serif;max-width:620px;margin:0 auto;padding:32px;">
      <div style="background:#1a1a2e;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:#c8a96e;margin:0;font-size:20px;">📋 Reporte diario — ${fmtFecha(hoy)}</h1>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:28px;">

        <!-- KPIs principales -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px;">
          <div style="background:#fff5f5;border-radius:10px;padding:14px;text-align:center;">
            <p style="margin:0 0 4px;font-size:10px;color:#6b7280;text-transform:uppercase;">Atrasados hoy</p>
            <p style="margin:0;font-size:26px;font-weight:800;color:#dc2626;">${totalAtrasadosActual}</p>
          </div>
          <div style="background:#fffbeb;border-radius:10px;padding:14px;text-align:center;">
            <p style="margin:0 0 4px;font-size:10px;color:#6b7280;text-transform:uppercase;">Recordatorios enviados</p>
            <p style="margin:0;font-size:26px;font-weight:800;color:#92400e;">${enviados}</p>
          </div>
          <div style="background:#fff5f5;border-radius:10px;padding:14px;text-align:center;">
            <p style="margin:0 0 4px;font-size:10px;color:#6b7280;text-transform:uppercase;">Monto en riesgo</p>
            <p style="margin:0;font-size:18px;font-weight:800;color:#dc2626;">${fmt(montoAtrasado)}</p>
          </div>
        </div>

        ${marcadosAtrasados > 0 ? `
        <div style="background:#fff5f5;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-bottom:16px;">
          <p style="margin:0;font-size:13px;color:#dc2626;font-weight:700;">⚠️ ${marcadosAtrasados} pago${marcadosAtrasados !== 1 ? "s" : ""} nuevo${marcadosAtrasados !== 1 ? "s" : ""} marcado${marcadosAtrasados !== 1 ? "s" : ""} como atrasado hoy</p>
        </div>` : ""}

        ${cuotasMarcadas > 0 ? `
        <div style="background:#fff5f5;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-bottom:16px;">
          <p style="margin:0;font-size:13px;color:#dc2626;font-weight:700;">🏢 ${cuotasMarcadas} cuota${cuotasMarcadas !== 1 ? "s" : ""} de condominio marcada${cuotasMarcadas !== 1 ? "s" : ""} como atrasada hoy · ${enviadosCondominio} recordatorio${enviadosCondominio !== 1 ? "s" : ""} enviado${enviadosCondominio !== 1 ? "s" : ""}</p>
        </div>` : ""}

        ${tablaAtrasados}

        ${!hayAtrasados ? "<p style='color:#065f46;text-align:center;font-weight:700;'>✅ Todo al corriente — sin pagos atrasados</p>" : ""}

        <p style="margin:20px 0 0;font-size:13px;color:#6b7280;text-align:center;">
          <a href="https://app.emporioinmobiliario.com.mx" style="color:#c8a96e;font-weight:700;">Ver panel completo →</a>
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
        subject: `📋 Reporte diario — ${totalAtrasadosActual} atrasados, ${enviados} recordatorios — ${fmtFecha(hoy)}`,
        html: htmlEquipo,
      }),
    });
  } catch (e) {
    console.error("Error enviando resumen al equipo", e.message);
  }

  // ── PASO 5: Recordatorios automáticos de renovación de póliza (sin cambios) ──
  const en60dias = new Date(hoy); en60dias.setDate(en60dias.getDate() + 60);

  const { data: expedientes } = await supabase
    .from("poliza_expedientes")
    .select("id, nombre_arrendatario, nombre_arrendador, correo_arrendatario, correo_arrendador, direccion_inmueble, fecha_vigencia, renta_mensual, recordatorio_60_enviado, recordatorio_30_enviado")
    .eq("status", "activo")
    .not("fecha_vigencia", "is", null)
    .lte("fecha_vigencia", fmtFecha(en60dias));

  let recordatoriosPoliza = 0;

  if (expedientes && expedientes.length > 0) {
    for (const exp of expedientes) {
      const vigencia = new Date(exp.fecha_vigencia + "T12:00:00");
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
            <p style="color:${diasRestantes <= 30 ? "#dc2626" : "#92400e"};font-weight:700;font-size:16px;margin:0 0 16px;">${urgencia}</p>
            <p style="color:#374151;margin:0 0 20px;">Le informamos que la póliza jurídica del siguiente inmueble está próxima a vencer:</p>
            <div style="background:#f9fafb;border-radius:10px;padding:20px;margin:0 0 20px;">
              <p style="margin:0 0 8px;color:#374151;"><strong>Inmueble:</strong> ${exp.direccion_inmueble}</p>
              <p style="margin:0 0 8px;color:#374151;"><strong>Arrendatario:</strong> ${exp.nombre_arrendatario}</p>
              <p style="margin:0 0 8px;color:#374151;"><strong>Arrendador:</strong> ${exp.nombre_arrendador}</p>
              <p style="margin:0 0 8px;color:#374151;"><strong>Renta mensual:</strong> ${fmt(exp.renta_mensual)}</p>
              <p style="margin:0;color:${diasRestantes <= 30 ? "#dc2626" : "#374151"};font-weight:700;"><strong>Vence:</strong> ${exp.fecha_vigencia} (${diasRestantes} días)</p>
            </div>
            <p style="color:#6b7280;font-size:13px;text-align:center;">Para renovar su póliza, comuníquese con nosotros a la brevedad.</p>
          </div>
        </div>`;

      const destinatarios = [
        exp.correo_arrendatario,
        exp.correo_arrendador,
        "administracion@emporioinmobiliario.com.mx",
      ].filter(Boolean);

      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "InmoAdmin <cobros@emporioinmobiliario.com.mx>",
            to: destinatarios,
            subject: `${diasRestantes <= 30 ? "⚠️" : "📋"} Póliza jurídica por vencer — ${exp.direccion_inmueble}`,
            html: htmlPoliza,
          }),
        });

        await supabase.from("poliza_expedientes").update({
          fecha_ultimo_recordatorio: new Date().toISOString(),
          ...(es60 && { recordatorio_60_enviado: true }),
          ...(es30 && { recordatorio_30_enviado: true }),
        }).eq("id", exp.id);

        recordatoriosPoliza++;
      } catch (e) {
        console.error("Error enviando recordatorio póliza", exp.id, e.message);
      }
    }
  }

  return res.status(200).json({
    fecha: fmtFecha(hoy),
    marcadosAtrasados,
    cuotasMarcadas,
    totalAtrasadosActual,
    totalPendientesVencidos,
    montoAtrasado,
    recordatoriosEnviados: enviados,
    enviadosCondominio,
    recordatoriosPoliza,
    resumen,
  });
}
