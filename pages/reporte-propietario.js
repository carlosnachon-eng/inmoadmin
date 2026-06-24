import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import Layout, { brand } from "../components/Layout";
import { usePermiso, SinAcceso } from "../lib/permisos";

const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n || 0);
const fmtFecha = (d) => new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

function rangoRapido(tipo) {
  const hoy = new Date();
  if (tipo === "mes_actual") {
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    return { desde: inicio.toISOString().split("T")[0], hasta: hoy.toISOString().split("T")[0] };
  }
  if (tipo === "mes_pasado") {
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    return { desde: inicio.toISOString().split("T")[0], hasta: fin.toISOString().split("T")[0] };
  }
  if (tipo === "ultimos_30") {
    const inicio = new Date(hoy);
    inicio.setDate(inicio.getDate() - 30);
    return { desde: inicio.toISOString().split("T")[0], hasta: hoy.toISOString().split("T")[0] };
  }
  return { desde: "", hasta: hoy.toISOString().split("T")[0] };
}

const Tarjeta = ({ icon, label, valor, color }) => (
  <div style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
    <p style={{ margin: "0 0 4px", fontSize: 24 }}>{icon}</p>
    <p style={{ margin: "0 0 2px", fontSize: 26, fontWeight: 800, color: color || brand.gray }}>{valor}</p>
    <p style={{ margin: 0, fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>{label}</p>
  </div>
);

export default function ReportePropietario() {
  const { cargando: permisoCargando, puedeVer } = usePermiso("reporte-propietario");

  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [propiedades, setPropiedades] = useState([]);
  const [busqueda, setBusqueda] = useState("");
  const [propiedadSel, setPropiedadSel] = useState(null);
  const [propietario, setPropietario] = useState(null);
  const [desde, setDesde] = useState(rangoRapido("mes_actual").desde);
  const [hasta, setHasta] = useState(rangoRapido("mes_actual").hasta);
  const [loading, setLoading] = useState(false);
  const [datos, setDatos] = useState(null);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [toast, setToast] = useState(null);
  const [asesorNombre, setAsesorNombre] = useState("");

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return; }
      setSession(session);
      supabase.from("profiles").select("*").eq("id", session.user.id).single().then(({ data }) => setProfile(data));
    });
  }, []);

  useEffect(() => {
    const buscar = async () => {
      if (!busqueda || busqueda.length < 3) { setPropiedades([]); return; }
      const { data } = await supabase
        .from("propiedades")
        .select("id, titulo, direccion, colonia, ciudad, public_id, operacion, precio, status, apartado_fecha, apartado_vigencia_hasta, en_marketplace, vistas_tiktok, vistas_instagram, vistas_facebook")
        .or(`titulo.ilike.%${busqueda}%,direccion.ilike.%${busqueda}%`)
        .limit(8);
      setPropiedades(data || []);
    };
    const t = setTimeout(buscar, 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const elegirPropiedad = async (p) => {
    setPropiedadSel(p);
    setBusqueda("");
    setPropiedades([]);
    setDatos(null);
    const { data: prop } = await supabase
      .from("propietarios_inmuebles")
      .select("*")
      .eq("propiedad_id", p.id)
      .maybeSingle();
    setPropietario(prop);
  };

  const aplicarRango = (tipo) => {
    const r = rangoRapido(tipo);
    setDesde(r.desde);
    setHasta(r.hasta);
  };

  const generarReporte = async () => {
    if (!propiedadSel) return;
    setLoading(true);
    try {
      const filtroFecha = (query) => {
        let q = query;
        if (desde) q = q.gte("created_at", `${desde}T00:00:00`);
        if (hasta) q = q.lte("created_at", `${hasta}T23:59:59`);
        return q;
      };

      const filtroFechaHora = (query) => {
        let q = query;
        if (desde) q = q.gte("fecha_hora", `${desde}T00:00:00`);
        if (hasta) q = q.lte("fecha_hora", `${hasta}T23:59:59`);
        return q;
      };

      const [visitasRes, solicitudesRes, enviosPropRes, citasRes] = await Promise.all([
        filtroFecha(supabase.from("visitas_propiedad").select("*").eq("propiedad_id", propiedadSel.id)),
        filtroFecha(supabase.from("solicitudes_contacto_propiedad").select("*").eq("propiedad_id", propiedadSel.id)),
        supabase.from("envios_propiedades").select("envio_id, envios(medio, destinatario_nombre, asesor_nombre, created_at)").eq("propiedad_id", propiedadSel.id),
        filtroFechaHora(supabase.from("citas").select("*, clientes(nombre)").eq("propiedad_id", propiedadSel.id)),
      ]);

      const visitas = visitasRes.data || [];
      const solicitudes = solicitudesRes.data || [];
      let envios = (enviosPropRes.data || []).map((e) => e.envios).filter(Boolean);
      if (desde) envios = envios.filter((e) => e.created_at >= `${desde}T00:00:00`);
      if (hasta) envios = envios.filter((e) => e.created_at <= `${hasta}T23:59:59`);
      const citas = citasRes.data || [];

      // Periodo anterior (mismo número de días, justo antes del rango
      // seleccionado) — solo para comparar totales, no se necesita el
      // detalle completo.
      let comparativaAnterior = null;
      if (desde && hasta) {
        const diffMs = new Date(hasta) - new Date(desde);
        const desdeAnterior = new Date(new Date(desde).getTime() - diffMs - 86400000);
        const hastaAnterior = new Date(new Date(desde).getTime() - 86400000);
        const desdeAnteriorStr = desdeAnterior.toISOString().split("T")[0];
        const hastaAnteriorStr = hastaAnterior.toISOString().split("T")[0];

        const [visitasAntRes, citasAntRes] = await Promise.all([
          supabase.from("visitas_propiedad").select("id", { count: "exact", head: true }).eq("propiedad_id", propiedadSel.id).gte("created_at", `${desdeAnteriorStr}T00:00:00`).lte("created_at", `${hastaAnteriorStr}T23:59:59`),
          supabase.from("citas").select("id", { count: "exact", head: true }).eq("propiedad_id", propiedadSel.id).gte("fecha_hora", `${desdeAnteriorStr}T00:00:00`).lte("fecha_hora", `${hastaAnteriorStr}T23:59:59`),
        ]);
        comparativaAnterior = {
          visitas: visitasAntRes.count || 0,
          citas: citasAntRes.count || 0,
          periodo: { desde: desdeAnteriorStr, hasta: hastaAnteriorStr },
        };
      }

      setDatos({ visitas, solicitudes, envios, citas, comparativaAnterior });
    } catch (e) {
      showToast("Error al generar el reporte: " + e.message, false);
    }
    setLoading(false);
  };

  const generarPdf = async () => {
    if (!propiedadSel || !datos) return;
    setGenerandoPdf(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/generar-reporte-propietario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propiedad_id: propiedadSel.id,
          desde, hasta,
          usuario_id: session?.user?.id,
          asesor_nombre: asesorNombre,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "No se pudo generar el PDF");
      window.open(data.url, "_blank");
    } catch (e) {
      showToast("Error al generar el PDF: " + e.message, false);
    }
    setGenerandoPdf(false);
  };

  const logout = async () => { await supabase.auth.signOut(); window.location.href = "/"; };

  if (permisoCargando) return null;
  if (!puedeVer) return <SinAcceso />;

  return (
    <Layout view="reporte-propietario" profile={profile} onLogout={logout}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000 }}>
          {toast.msg}
        </div>
      )}

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 20px" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: brand.gray }}>Reporte mensual a propietarios</h2>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "#9ca3af" }}>
          Elige una propiedad y un periodo para ver su actividad y generar el reporte para el propietario.
        </p>

        {/* Selector de propiedad */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #f0f0f0" }}>
          {propiedadSel ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: brand.gray }}>{propiedadSel.titulo}</p>
                <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>{[propiedadSel.direccion, propiedadSel.colonia, propiedadSel.ciudad].filter(Boolean).join(", ")} · ID: {propiedadSel.public_id}</p>
              </div>
              <button onClick={() => { setPropiedadSel(null); setDatos(null); setPropietario(null); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                Cambiar
              </button>
            </div>
          ) : (
            <div>
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar propiedad por título o dirección…"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }}
              />
              {propiedades.length > 0 && (
                <div style={{ marginTop: 8, border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                  {propiedades.map((p) => (
                    <button key={p.id} onClick={() => elegirPropiedad(p)} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", background: "#fff", border: "none", borderBottom: "1px solid #f3f4f6", cursor: "pointer", fontSize: 13 }}>
                      <strong>{p.titulo}</strong><br />
                      <span style={{ color: "#9ca3af", fontSize: 12 }}>{[p.direccion, p.colonia, p.ciudad].filter(Boolean).join(", ")} · {p.public_id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {propiedadSel && (
          <>
            {!propietario && (
              <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#92400e" }}>
                Esta propiedad no tiene un propietario vinculado todavía. Ve al expediente del propietario en el módulo de Póliza y vincúlalo ahí para poder enviarle el reporte directamente.
              </div>
            )}

            {/* Selector de rango */}
            <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #f0f0f0", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={() => aplicarRango("mes_actual")} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Este mes</button>
              <button onClick={() => aplicarRango("mes_pasado")} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Mes pasado</button>
              <button onClick={() => aplicarRango("ultimos_30")} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Últimos 30 días</button>
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }} />
              <span style={{ color: "#9ca3af", fontSize: 12 }}>a</span>
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }} />
              <button onClick={generarReporte} disabled={loading} style={{ background: brand.red, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer", marginLeft: "auto" }}>
                {loading ? "Generando…" : "Ver reporte"}
              </button>
            </div>

            {datos && (
              <>
                {propiedadSel.status === "reserved" && (
                  <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, padding: 16, marginBottom: 16 }}>
                    <p style={{ margin: 0, fontSize: 13, color: "#78350f", lineHeight: 1.55 }}>
                      La propiedad se encuentra reservada por un prospecto calificado desde {propiedadSel.apartado_fecha ? fmtFecha(propiedadSel.apartado_fecha) : "fecha no registrada"}. El apartado está vigente hasta {propiedadSel.apartado_vigencia_hasta ? fmtFecha(`${propiedadSel.apartado_vigencia_hasta}T12:00:00`) : "fecha no registrada"}, sujeto a firma de contrato/promesa.
                    </p>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
                  <Tarjeta icon="👀" label="Visitas a la ficha" valor={datos.visitas.length} />
                  <Tarjeta icon="📨" label="Envíos realizados" valor={datos.envios.length} />
                  <Tarjeta icon="💬" label="Solicitudes de contacto" valor={datos.solicitudes.length} color={datos.solicitudes.length > 0 ? "#065f46" : brand.gray} />
                  <Tarjeta icon="📅" label="Citas agendadas" valor={datos.citas.length} color={datos.citas.length > 0 ? "#1e40af" : brand.gray} />
                </div>

                {datos.comparativaAnterior && (
                  <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #f0f0f0" }}>
                    <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: brand.gray }}>Comparado con el periodo anterior</p>
                    {[
                      ["Visitas", datos.visitas.length, datos.comparativaAnterior.visitas],
                      ["Citas", datos.citas.length, datos.comparativaAnterior.citas],
                    ].map(([label, actual, anterior]) => {
                      const diferencia = actual - anterior;
                      const subio = diferencia > 0;
                      const igual = diferencia === 0;
                      return (
                        <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 13 }}>
                          <span style={{ color: "#374151" }}>{label}: {actual} (antes {anterior})</span>
                          <span style={{ fontWeight: 700, color: igual ? "#9ca3af" : subio ? "#065f46" : "#991b1b" }}>
                            {igual ? "Sin cambio" : `${subio ? "▲" : "▼"} ${Math.abs(diferencia)}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {datos.citas.length > 0 && (
                  <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #f0f0f0" }}>
                    <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: brand.gray }}>Citas para esta propiedad</p>
                    {datos.citas.map((c) => (
                      <div key={c.id} style={{ padding: "8px 0", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>
                        <strong>{c.clientes?.nombre || "Cliente"}</strong> — {fmtFecha(c.fecha_hora)} ·{" "}
                        <span style={{ color: c.estado === "calificada" ? "#065f46" : c.estado === "efectiva" ? "#1e40af" : c.estado === "cancelada" || c.estado === "no_show" ? "#991b1b" : "#92400e" }}>
                          {{ agendada: "Agendada", efectiva: "Efectiva", calificada: "Calificada", cancelada: "Cancelada", no_show: "No se presentó" }[c.estado] || c.estado}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {datos.solicitudes.length > 0 && (
                  <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #f0f0f0" }}>
                    <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: brand.gray }}>Solicitudes de contacto recibidas</p>
                    {datos.solicitudes.map((s) => (
                      <div key={s.id} style={{ padding: "8px 0", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>
                        <strong>{s.nombre}</strong> · {s.telefono} {s.email ? `· ${s.email}` : ""} — <span style={{ color: "#9ca3af" }}>{fmtFecha(s.created_at)}</span>
                        {s.mensaje && <p style={{ margin: "2px 0 0", color: "#6b7280" }}>{s.mensaje}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {datos.envios.length > 0 && (
                  <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #f0f0f0" }}>
                    <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: brand.gray }}>Envíos de la ficha</p>
                    {datos.envios.map((e, i) => (
                      <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #f3f4f6", fontSize: 12, color: "#374151" }}>
                        {e.medio === "correo" ? "✉️" : e.medio === "whatsapp" ? "💬" : "🔗"} {e.medio === "correo" ? `Correo a ${e.destinatario_nombre || "—"}` : e.medio === "whatsapp" ? "WhatsApp" : "Liga compartida"} — <span style={{ color: "#9ca3af" }}>{fmtFecha(e.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #f0f0f0" }}>
                  <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: brand.gray }}>Canales de promoción</p>
                  {propiedadSel.status === "published"
                    ? <p style={{ margin: "0 0 8px", fontSize: 12, color: "#374151" }}>🌐 Publicada en el sitio web de Emporio Inmobiliario</p>
                    : <p style={{ margin: "0 0 8px", fontSize: 12, color: "#92400e" }}>⏸ Promoción pública pausada por estatus: {propiedadSel.status}</p>}
                  {propiedadSel.en_marketplace && <p style={{ margin: "0 0 8px", fontSize: 12, color: "#374151" }}>🛒 Publicada en Facebook Marketplace</p>}
                  {(propiedadSel.vistas_tiktok > 0 || propiedadSel.vistas_instagram > 0 || propiedadSel.vistas_facebook > 0) && (
                    <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                      {propiedadSel.vistas_tiktok > 0 && <span style={{ fontSize: 12, color: "#374151" }}>🎵 TikTok: <strong>{propiedadSel.vistas_tiktok}</strong> vistas</span>}
                      {propiedadSel.vistas_instagram > 0 && <span style={{ fontSize: 12, color: "#374151" }}>📷 Instagram: <strong>{propiedadSel.vistas_instagram}</strong> vistas</span>}
                      {propiedadSel.vistas_facebook > 0 && <span style={{ fontSize: 12, color: "#374151" }}>👍 Facebook: <strong>{propiedadSel.vistas_facebook}</strong> vistas</span>}
                    </div>
                  )}
                </div>

                {propietario && (
                  <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #f0f0f0" }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6 }}>
                      Asesor a cargo de esta propiedad (aparece en el cierre del reporte)
                    </label>
                    <input
                      value={asesorNombre}
                      onChange={(e) => setAsesorNombre(e.target.value)}
                      placeholder="Ej. Iván Ramírez"
                      style={{ width: "100%", maxWidth: 320, padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, boxSizing: "border-box" }}
                    />
                    <p style={{ margin: "6px 0 0", fontSize: 11, color: "#9ca3af" }}>
                      Déjalo en blanco si no quieres mostrar un asesor específico en este reporte.
                    </p>
                  </div>
                )}

                {propietario && (
                  <button onClick={generarPdf} disabled={generandoPdf} style={{ background: brand.red, color: "#fff", border: "none", borderRadius: 10, padding: "12px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                    {generandoPdf ? "Generando…" : "📄 Generar reporte para enviar"}
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
