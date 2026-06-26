import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabase";

const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n || 0);

export default function CotizacionPublica() {
  const router = useRouter();
  const { id } = router.query;
  const [cotizacion, setCotizacion] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [showRechazo, setShowRechazo] = useState(false);
  const [done, setDone] = useState(null); // 'aprobada' | 'rechazada'

  useEffect(() => {
    if (id) loadCotizacion();
  }, [id]);

  const loadCotizacion = async () => {
    setLoading(true);
    const { data: cot } = await supabase
      .from("maintenance_quotes")
      .select("*")
      .eq("id", id)
      .single();

    if (cot) {
      setCotizacion(cot);
      const { data: t } = await supabase
        .from("maintenance_tickets")
        .select("*")
        .eq("id", cot.ticket_id)
        .single();
      setTicket(t);
      if (cot.status !== "pendiente") setDone(cot.status);
    }
    setLoading(false);
  };

  const aprobar = async () => {
    setSaving(true);
    await supabase.from("maintenance_quotes").update({
      status: "aprobada",
      updated_at: new Date().toISOString(),
    }).eq("id", id);

    await supabase.from("maintenance_tickets").update({
      status: "aprobado",
      charged_amount: cotizacion.monto_final,
      updated_at: new Date().toISOString(),
    }).eq("id", cotizacion.ticket_id);

    // Notificar a Emporio
    try {
      await fetch("/api/send-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: ["carlos.nachon@emporioinmobiliario.mx", "administracion@emporioinmobiliario.com.mx"],
          subject: `✅ Cotización APROBADA — ${cotizacion.property_name}`,
          html: `
            <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;background:#f9fafb;">
              <div style="background:#065f46;padding:20px;border-radius:12px;margin-bottom:20px;">
                <h2 style="color:#fff;margin:0;">✅ Cotización Aprobada</h2>
                <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:13px;">Emporio Inmobiliario</p>
              </div>
              <div style="background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
                <p><strong>Propiedad:</strong> ${cotizacion.property_name}</p>
                <p><strong>Trabajo:</strong> ${cotizacion.descripcion}</p>
                <p><strong>Monto aprobado:</strong> ${fmt(cotizacion.monto_final)}</p>
                <p><strong>Aprobado por:</strong> ${cotizacion.payer}</p>
              </div>
              <p style="text-align:center;margin-top:16px;font-size:12px;color:#9ca3af;">
                <a href="https://app.emporioinmobiliario.com.mx/mantenimiento" style="color:#065f46;">Ver en InmoAdmin →</a>
              </p>
            </div>
          `
        })
      });
    } catch (e) { console.error(e); }

    setSaving(false);
    setDone("aprobada");
  };

  const rechazar = async () => {
    if (!motivo.trim()) return;
    setSaving(true);
    await supabase.from("maintenance_quotes").update({
      status: "rechazada",
      motivo_rechazo: motivo,
      updated_at: new Date().toISOString(),
    }).eq("id", id);

    await supabase.from("maintenance_tickets").update({
      status: "revisado",
      updated_at: new Date().toISOString(),
    }).eq("id", cotizacion.ticket_id);

    // Notificar a Emporio
    try {
      await fetch("/api/send-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: ["carlos.nachon@emporioinmobiliario.mx", "administracion@emporioinmobiliario.com.mx"],
          subject: `❌ Cotización RECHAZADA — ${cotizacion.property_name}`,
          html: `
            <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;background:#f9fafb;">
              <div style="background:#b91c3c;padding:20px;border-radius:12px;margin-bottom:20px;">
                <h2 style="color:#fff;margin:0;">❌ Cotización Rechazada</h2>
              </div>
              <div style="background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
                <p><strong>Propiedad:</strong> ${cotizacion.property_name}</p>
                <p><strong>Trabajo:</strong> ${cotizacion.descripcion}</p>
                <p><strong>Monto:</strong> ${fmt(cotizacion.monto_final)}</p>
                <p><strong>Motivo:</strong> ${motivo}</p>
              </div>
              <p style="text-align:center;margin-top:16px;font-size:12px;color:#9ca3af;">
                <a href="https://app.emporioinmobiliario.com.mx/mantenimiento" style="color:#b91c3c;">Ver en InmoAdmin →</a>
              </p>
            </div>
          `
        })
      });
    } catch (e) { console.error(e); }

    setSaving(false);
    setDone("rechazada");
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} />
    </div>
  );

  if (!cotizacion) return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", padding: 40 }}>
        <p style={{ fontSize: 48 }}>🔍</p>
        <h2 style={{ color: "#4a4a4a" }}>Cotización no encontrada</h2>
        <p style={{ color: "#9ca3af" }}>El enlace puede haber expirado o ser incorrecto</p>
      </div>
    </div>
  );

  // Ya respondida
  if (done) return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 40, maxWidth: 440, width: "100%", textAlign: "center", boxShadow: "0 2px 20px rgba(0,0,0,0.08)" }}>
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 40, marginBottom: 24 }} />
        <div style={{ fontSize: 56, marginBottom: 16 }}>{done === "aprobada" ? "✅" : "❌"}</div>
        <h2 style={{ margin: "0 0 8px", color: done === "aprobada" ? "#065f46" : "#b91c3c", fontSize: 22 }}>
          {done === "aprobada" ? "¡Cotización aprobada!" : "Cotización rechazada"}
        </h2>
        <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 20px" }}>
          {done === "aprobada"
            ? "Hemos recibido tu aprobación. Nos pondremos en contacto contigo para coordinar el trabajo."
            : "Hemos recibido tu respuesta. Nos pondremos en contacto para buscar una solución."}
        </p>
        <div style={{ background: "#f9fafb", borderRadius: 12, padding: "14px 18px" }}>
          <p style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}>¿Dudas? Contáctanos</p>
          <p style={{ margin: "4px 0 0", fontSize: 14, fontWeight: 700, color: "#4a4a4a" }}>222 257 3237</p>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#b91c3c", padding: "20px 20px 24px" }}>
        <div style={{ maxWidth: 500, margin: "0 auto" }}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 36, filter: "brightness(0) invert(1)", opacity: 0.9 }} />
          <h1 style={{ margin: "16px 0 4px", fontSize: 22, fontWeight: 800, color: "#fff" }}>Cotización de Mantenimiento</h1>
          <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.7)" }}>📍 {cotizacion.property_name}</p>
        </div>
      </div>

      <div style={{ maxWidth: 500, margin: "0 auto", padding: "24px 20px" }}>

        {/* Descripción del trabajo */}
        <div style={{ background: "#fff", borderRadius: 16, padding: 20, marginBottom: 16, border: "1px solid #f0f0f0" }}>
          <p style={{ margin: "0 0 4px", fontSize: 11, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Trabajo a realizar</p>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a1a2e", lineHeight: 1.5 }}>{cotizacion.descripcion}</p>
        </div>

        {/* Desglose de costos */}
        <div style={{ background: "#fff", borderRadius: 16, padding: 20, marginBottom: 16, border: "1px solid #f0f0f0" }}>
          <p style={{ margin: "0 0 16px", fontSize: 11, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Desglose</p>
          {(() => {
            const tieneDescuento = cotizacion.descuento_valor > 0 && cotizacion.monto_sin_descuento > cotizacion.monto_final;
            const montoOriginal = cotizacion.monto_sin_descuento ?? cotizacion.monto_final;
            const subtotal = cotizacion.monto_final;
            const iva = Math.round(subtotal * 0.16);
            const total = subtotal + iva;
            const anticipo = Math.round(total * 0.5);
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {tieneDescuento && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 14, color: "#6b7280" }}>Precio original</span>
                      <span style={{ fontSize: 14, color: "#9ca3af", textDecoration: "line-through" }}>{fmt(montoOriginal)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 14, color: "#b91c3c", fontWeight: 700 }}>
                        🏷️ Descuento {cotizacion.descuento_tipo === "pct" ? `(${cotizacion.descuento_valor}%)` : ""}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#b91c3c" }}>− {fmt(montoOriginal - subtotal)}</span>
                    </div>
                  </>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14, color: "#6b7280" }}>Subtotal</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#4a4a4a" }}>{fmt(subtotal)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14, color: "#6b7280" }}>IVA (16%)</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#4a4a4a" }}>{fmt(iva)}</span>
                </div>
                <div style={{ height: 1, background: "#e5e7eb" }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "#1a1a2e" }}>Total</span>
                  <span style={{ fontSize: 24, fontWeight: 900, color: "#b91c3c" }}>{fmt(total)}</span>
                </div>
                <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 10, padding: "12px 14px", marginTop: 4 }}>
                  <p style={{ margin: "0 0 2px", fontSize: 12, fontWeight: 700, color: "#92400e" }}>⚡ Anticipo requerido para iniciar</p>
                  <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#92400e" }}>{fmt(anticipo)}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "#92400e" }}>50% del total — el resto al terminar el trabajo</p>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Quién paga */}
        <div style={{ background: "#fffbeb", borderRadius: 12, padding: "12px 16px", marginBottom: 24, border: "1px solid #fcd34d" }}>
          <p style={{ margin: 0, fontSize: 13, color: "#92400e", fontWeight: 600 }}>
            💡 Este costo está a cargo de: <strong>{cotizacion.payer === "propietario" ? "el propietario" : cotizacion.payer === "inquilino" ? "el inquilino" : cotizacion.payer}</strong>
          </p>
        </div>

        {/* Formas de pago */}
        {(() => {
          const subtotal = cotizacion.monto_final;
          const iva = Math.round(subtotal * 0.16);
          const total = subtotal + iva;
          const anticipo = Math.round(total * 0.5);
          return (
            <div style={{ background: "#fff", borderRadius: 16, padding: 20, marginBottom: 16, border: "1px solid #f0f0f0" }}>
              <p style={{ margin: "0 0 14px", fontSize: 13, fontWeight: 700, color: "#374151" }}>💳 Formas de pago del anticipo ({fmt(anticipo)})</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ background: "#f0fdf4", borderRadius: 10, padding: "14px 16px", border: "1px solid #86efac" }}>
                  <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "#065f46" }}>🏦 Transferencia bancaria</p>
                  <p style={{ margin: "0 0 2px", fontSize: 12, color: "#374151" }}>Grupo Inmobiliario Nachón Torres SA de CV</p>
                  <p style={{ margin: "0 0 2px", fontSize: 12, color: "#374151" }}>Banco: <strong>Klar</strong></p>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#065f46", fontFamily: "monospace", letterSpacing: 1 }}>CLABE: 6611 8002 6030 6793 33</p>
                </div>
                <div style={{ background: "#fffbeb", borderRadius: 10, padding: "14px 16px", border: "1px solid #fcd34d" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "#92400e" }}>💵 Efectivo</p>
                  <p style={{ margin: 0, fontSize: 12, color: "#92400e" }}>Retiro sin tarjeta en cualquier cajero Klar, o pago directo en nuestras oficinas.</p>
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "#92400e", fontWeight: 600 }}>📞 Coordina con nosotros: 222 257 3237</p>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Acciones */}
        {!showRechazo ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button onClick={aprobar} disabled={saving} style={{ width: "100%", background: "#065f46", color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontWeight: 700, fontSize: 16, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Procesando..." : "✅ Aprobar cotización"}
            </button>
            <button onClick={() => setShowRechazo(true)} style={{ width: "100%", background: "#fff", color: "#b91c3c", border: "2px solid #fca5a5", borderRadius: 14, padding: "14px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
              ❌ Rechazar
            </button>
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 16, padding: 20, border: "2px solid #fca5a5" }}>
            <p style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#b91c3c" }}>¿Por qué rechazas la cotización?</p>
            <textarea
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Ej: El precio es muy alto, necesito otra opción..."
              rows={3}
              style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", marginBottom: 12 }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowRechazo(false)} style={{ flex: 1, background: "#f3f4f6", border: "none", borderRadius: 10, padding: "12px", fontWeight: 600, cursor: "pointer", color: "#6b7280" }}>
                Cancelar
              </button>
              <button onClick={rechazar} disabled={saving || !motivo.trim()} style={{ flex: 1, background: "#b91c3c", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontWeight: 700, cursor: saving || !motivo.trim() ? "not-allowed" : "pointer", opacity: saving || !motivo.trim() ? 0.6 : 1 }}>
                {saving ? "Enviando..." : "Confirmar rechazo"}
              </button>
            </div>
          </div>
        )}

        <p style={{ textAlign: "center", marginTop: 24, fontSize: 12, color: "#9ca3af" }}>
          Emporio Inmobiliario · 222 257 3237
        </p>
      </div>
    </div>
  );
}
