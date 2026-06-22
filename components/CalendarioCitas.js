import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { brand } from "./Layout";

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const ESTADOS_CITA = {
  agendada: { label: "Agendada", color: "#92400e", bg: "#fef3c7" },
  efectiva: { label: "Efectiva", color: "#1e40af", bg: "#dbeafe" },
  calificada: { label: "Calificada", color: "#065f46", bg: "#d1fae5" },
  cancelada: { label: "Cancelada", color: "#991b1b", bg: "#fee2e2" },
  no_show: { label: "No se presentó", color: "#78716c", bg: "#f5f5f4" },
};

const fmtHora = (d) => new Date(d).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

// Modal de calendario mensual de citas. Reutilizable: recibe `alcance` y
// `asesorId` para filtrar solo las citas propias (asesor) o todas
// (gerente_ventas / admin), igual patrón que el resto de InmoAdmin.
export default function CalendarioCitas({ onClose, alcance, asesorId }) {
  const hoyDate = new Date();
  const [mesActual, setMesActual] = useState(hoyDate.getMonth());
  const [anioActual, setAnioActual] = useState(hoyDate.getFullYear());
  const [citas, setCitas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [diaSeleccionado, setDiaSeleccionado] = useState(null);
  const [filtroAsesor, setFiltroAsesor] = useState("");
  const [asesoresLista, setAsesoresLista] = useState([]);

  const hoy = hoyDate.toLocaleDateString("en-CA");

  const cargarMes = async () => {
    setLoading(true);
    const inicio = `${anioActual}-${String(mesActual + 1).padStart(2, "0")}-01`;
    const fin = new Date(anioActual, mesActual + 1, 0).toISOString().split("T")[0];
    let query = supabase
      .from("citas")
      .select("id, fecha_hora, estado, asesor_id, clientes(nombre, telefono), propiedades(titulo), profiles:asesor_id(full_name, email)")
      .gte("fecha_hora", `${inicio}T00:00:00`)
      .lte("fecha_hora", `${fin}T23:59:59`)
      .order("fecha_hora", { ascending: true });
    if (alcance === "propio" && asesorId) query = query.eq("asesor_id", asesorId);
    const { data } = await query;
    setCitas(data || []);
    setLoading(false);
  };

  // Lista de asesores para el filtro — solo aplica a quien ve "todos"
  // (Admin, Guillermo); un asesor con alcance "propio" ya solo ve lo suyo.
  useEffect(() => {
    if (alcance === "todos") {
      supabase.from("profiles").select("id, full_name, email").eq("active", true)
        .then(({ data }) => setAsesoresLista(data || []));
    }
  }, [alcance]);

  useEffect(() => { cargarMes(); }, [mesActual, anioActual]);

  const primerDia = new Date(anioActual, mesActual, 1).getDay();
  const diasEnMes = new Date(anioActual, mesActual + 1, 0).getDate();

  const citasPorDia = (dia) => {
    const fecha = `${anioActual}-${String(mesActual + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    return citas.filter((c) => c.fecha_hora.slice(0, 10) === fecha && (!filtroAsesor || c.asesor_id === filtroAsesor));
  };

  const irMesAnterior = () => {
    if (mesActual === 0) { setMesActual(11); setAnioActual((a) => a - 1); } else setMesActual((m) => m - 1);
  };
  const irMesSiguiente = () => {
    if (mesActual === 11) { setMesActual(0); setAnioActual((a) => a + 1); } else setMesActual((m) => m + 1);
  };

  const nombreMes = new Date(anioActual, mesActual, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  const citasDelDiaSeleccionado = diaSeleccionado ? citasPorDia(diaSeleccionado) : [];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 20, width: "100%", maxWidth: 920, maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: brand.gray }}>📅 Calendario de citas</h2>
          <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <button onClick={irMesAnterior} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "8px 16px", fontWeight: 700, cursor: "pointer" }}>←</button>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: brand.gray, textTransform: "capitalize" }}>{nombreMes}</p>
          <button onClick={irMesSiguiente} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "8px 16px", fontWeight: 700, cursor: "pointer" }}>→</button>
        </div>

        {alcance === "todos" && asesoresLista.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <select value={filtroAsesor} onChange={(e) => setFiltroAsesor(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 13, background: "#fff", width: "100%", boxSizing: "border-box" }}>
              <option value="">Todos los asesores</option>
              {asesoresLista.map((a) => <option key={a.id} value={a.id}>{a.full_name || a.email}</option>)}
            </select>
          </div>
        )}

        {loading ? (
          <p style={{ textAlign: "center", color: "#9ca3af", padding: 30 }}>Cargando…</p>
        ) : (
          <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", border: "1px solid #e5e7eb" }}>
            {/* Header días */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              {DIAS.map((d) => (
                <div key={d} style={{ padding: "8px 4px", minWidth: 0, textAlign: "center", fontSize: 11, fontWeight: 700, color: "#9ca3af" }}>{d}</div>
              ))}
            </div>
            {/* Días */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
              {Array.from({ length: primerDia }).map((_, i) => (
                <div key={`empty-${i}`} style={{ minHeight: 64, minWidth: 0, borderRight: "1px solid #f3f4f6", borderBottom: "1px solid #f3f4f6", background: "#fafafa" }} />
              ))}
              {Array.from({ length: diasEnMes }, (_, i) => i + 1).map((dia) => {
                const fechaDia = `${anioActual}-${String(mesActual + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
                const esHoy = fechaDia === hoy;
                const citasDia = citasPorDia(dia);
                return (
                  <div key={dia} onClick={() => citasDia.length > 0 && setDiaSeleccionado(dia)}
                    style={{ minHeight: 64, minWidth: 0, overflow: "hidden", borderRight: "1px solid #f3f4f6", borderBottom: "1px solid #f3f4f6", padding: 6, cursor: citasDia.length > 0 ? "pointer" : "default", background: esHoy ? "#eff6ff" : "#fff" }}>
                    <div style={{ fontSize: 12, fontWeight: esHoy ? 800 : 400, color: esHoy ? "#fff" : "#374151", background: esHoy ? brand.red : "transparent", width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
                      {dia}
                    </div>
                    {citasDia.slice(0, 2).map((c, i) => {
                      const info = ESTADOS_CITA[c.estado] || ESTADOS_CITA.agendada;
                      const asesorNombre = c.profiles?.full_name || c.profiles?.email;
                      return (
                        <div key={i} style={{ background: info.bg, color: info.color, borderRadius: 4, padding: "1px 4px", fontSize: 9, fontWeight: 600, marginBottom: 2, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                          {fmtHora(c.fecha_hora)} {c.clientes?.nombre}{alcance === "todos" && asesorNombre ? ` · ${asesorNombre}` : ""}
                        </div>
                      );
                    })}
                    {citasDia.length > 2 && (
                      <p style={{ margin: 0, fontSize: 9, color: "#9ca3af" }}>+{citasDia.length - 2} más</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {diaSeleccionado && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100, padding: 16 }} onClick={() => setDiaSeleccionado(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 20, width: "100%", maxWidth: 420, maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: brand.gray }}>
                {diaSeleccionado} de {nombreMes}
              </p>
              <button onClick={() => setDiaSeleccionado(null)} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, width: 28, height: 28, cursor: "pointer" }}>✕</button>
            </div>
            {citasDelDiaSeleccionado.map((c) => {
              const info = ESTADOS_CITA[c.estado] || ESTADOS_CITA.agendada;
              return (
                <div key={c.id} style={{ background: "#f9fafb", borderRadius: 10, padding: 12, marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{fmtHora(c.fecha_hora)} — {c.clientes?.nombre}</p>
                    <span style={{ background: info.bg, color: info.color, padding: "2px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{info.label}</span>
                  </div>
                  {c.clientes?.telefono && <p style={{ margin: "0 0 2px", fontSize: 12, color: "#6b7280" }}>📞 {c.clientes.telefono}</p>}
                  {c.propiedades?.titulo && <p style={{ margin: "0 0 2px", fontSize: 12, color: "#6b7280" }}>🏠 {c.propiedades.titulo}</p>}
                  {alcance === "todos" && (c.profiles?.full_name || c.profiles?.email) && (
                    <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>👤 {c.profiles.full_name || c.profiles.email}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
