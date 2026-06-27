import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Layout, { brand } from "../components/Layout";
import { supabase } from "../lib/supabase";
import { SinAcceso } from "../lib/permisos";

const EVENTOS_CONTACTO = new Set(["whatsapp", "telefono", "registro_partner"]);
const EVENTO_LABEL = {
  visita: "Visita",
  whatsapp: "WhatsApp",
  telefono: "Teléfono",
  disponibilidad: "Disponibilidad",
  registro_partner: "Registro partner",
  login_partner: "Login partner",
};

const fmt = (value) => Number(value || 0).toLocaleString("es-MX");
const pct = (value) => `${Number(value || 0).toFixed(1)}%`;

function mesActual() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function limitesMes(mes) {
  const [year, month] = mes.split("-").map(Number);
  const inicio = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00-06:00`);
  const siguiente = new Date(inicio);
  siguiente.setMonth(siguiente.getMonth() + 1);
  return { inicio: inicio.toISOString(), fin: siguiente.toISOString() };
}

function nombreMes(mes) {
  const [year, month] = mes.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("es-MX", {
    month: "long",
    year: "numeric",
  });
}

function fechaMexico(value) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function agruparConteos(items, getKey) {
  const map = new Map();
  items.forEach((item) => {
    const key = getKey(item) || "Sin dato";
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()]
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

function resumenProyecto(eventos) {
  const visitas = eventos.filter((event) => event.evento === "visita");
  const whatsapp = eventos.filter((event) => event.evento === "whatsapp");
  const telefono = eventos.filter((event) => event.evento === "telefono");
  const disponibilidad = eventos.filter((event) => event.evento === "disponibilidad");
  const visitantes = new Set(visitas.map((event) => event.visitante_id));
  const contactos = new Set(
    eventos
      .filter((event) => EVENTOS_CONTACTO.has(event.evento))
      .map((event) => event.visitante_id)
  );

  return {
    visitas: visitas.length,
    visitantes: visitantes.size,
    whatsapp: whatsapp.length,
    telefono: telefono.length,
    disponibilidad: disponibilidad.length,
    contactos: contactos.size,
    conversion: visitantes.size > 0 ? (contactos.size / visitantes.size) * 100 : 0,
  };
}

function StatCard({ label, value, detail, tone = "default" }) {
  const tones = {
    default: { color: "#1a1a2e", bg: "#fff" },
    green: { color: "#065f46", bg: "#f0fdf4" },
    red: { color: brand.red, bg: "#fff5f5" },
    blue: { color: "#1e40af", bg: "#eff6ff" },
    amber: { color: "#92400e", bg: "#fffbeb" },
  };
  const selected = tones[tone] || tones.default;

  return (
    <div style={{ background: selected.bg, border: "1px solid #e5e7eb", borderRadius: 14, padding: "16px 18px" }}>
      <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</p>
      <p style={{ margin: 0, fontSize: 27, lineHeight: 1, fontWeight: 900, color: selected.color }}>{value}</p>
      {detail && <p style={{ margin: "7px 0 0", fontSize: 11, color: "#9ca3af", lineHeight: 1.4 }}>{detail}</p>}
    </div>
  );
}

function MiniBar({ label, value, max, color = brand.red }) {
  const width = max > 0 ? Math.max(3, (value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <strong style={{ fontSize: 12, color: "#1a1a2e" }}>{fmt(value)}</strong>
      </div>
      <div style={{ height: 7, background: "#f3f4f6", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${width}%`, background: color, borderRadius: 99 }} />
      </div>
    </div>
  );
}

export default function EstadisticasProyectos() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [eventos, setEventos] = useState([]);
  const [mes, setMes] = useState(mesActual());
  const [proyectoSeleccionado, setProyectoSeleccionado] = useState("todos");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: current } }) => {
      setSession(current);
      if (current) cargarPerfil(current.user.id);
      else setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, current) => {
      setSession(current);
      if (current) cargarPerfil(current.user.id);
      else {
        setProfile(null);
        setAuthLoading(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const cargarPerfil = async (userId) => {
    const { data } = await supabase
      .from("profiles")
      .select("id,email,full_name,role_id,active")
      .eq("id", userId)
      .maybeSingle();
    setProfile(data || null);
    setAuthLoading(false);
  };

  useEffect(() => {
    if (!session || profile?.role_id !== "admin") return;
    cargarEventos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, profile?.role_id, mes]);

  const cargarEventos = async () => {
    setLoading(true);
    setError("");
    const { inicio, fin } = limitesMes(mes);
    const { data, error: queryError } = await supabase
      .from("proyectos_eventos")
      .select("id,proyecto,proyecto_nombre,evento,visitante_id,sesion_id,pagina,origen,metadata,created_at")
      .gte("created_at", inicio)
      .lt("created_at", fin)
      .order("created_at", { ascending: true });

    if (queryError) {
      setError(queryError.message || "No fue posible cargar las estadísticas.");
      setEventos([]);
    } else {
      setEventos(data || []);
    }
    setLoading(false);
  };

  const proyectos = useMemo(() => {
    const map = new Map();
    eventos.forEach((event) => {
      map.set(event.proyecto, event.proyecto_nombre || event.proyecto);
    });
    return [...map.entries()]
      .map(([slug, nombre]) => ({ slug, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [eventos]);

  const eventosFiltrados = useMemo(
    () =>
      proyectoSeleccionado === "todos"
        ? eventos
        : eventos.filter((event) => event.proyecto === proyectoSeleccionado),
    [eventos, proyectoSeleccionado]
  );

  const resumenTotal = useMemo(() => resumenProyecto(eventosFiltrados), [eventosFiltrados]);

  const ranking = useMemo(() => {
    const grupos = new Map();
    eventos.forEach((event) => {
      if (!grupos.has(event.proyecto)) grupos.set(event.proyecto, []);
      grupos.get(event.proyecto).push(event);
    });

    return [...grupos.entries()]
      .map(([slug, rows]) => ({
        slug,
        nombre: rows[0]?.proyecto_nombre || slug,
        ...resumenProyecto(rows),
      }))
      .sort(
        (a, b) =>
          b.contactos - a.contactos ||
          b.conversion - a.conversion ||
          b.visitantes - a.visitantes
      );
  }, [eventos]);

  const actividadDiaria = useMemo(() => {
    const map = new Map();
    eventosFiltrados.forEach((event) => {
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Mexico_City",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(event.created_at));
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(event);
    });
    return [...map.entries()]
      .map(([day, rows]) => ({ day, ...resumenProyecto(rows) }))
      .sort((a, b) => b.day.localeCompare(a.day));
  }, [eventosFiltrados]);

  const ctas = useMemo(
    () =>
      agruparConteos(
        eventosFiltrados.filter((event) => event.evento !== "visita"),
        (event) => `${EVENTO_LABEL[event.evento] || event.evento} · ${event.metadata?.cta || "Sin etiqueta"}`
      ),
    [eventosFiltrados]
  );

  const dispositivos = useMemo(
    () => agruparConteos(eventosFiltrados, (event) => event.metadata?.dispositivo),
    [eventosFiltrados]
  );

  const origenes = useMemo(
    () =>
      agruparConteos(
        eventosFiltrados.filter((event) => event.evento === "visita"),
        (event) => {
          if (!event.origen) return "Directo / desconocido";
          try {
            return new URL(event.origen).hostname;
          } catch {
            return event.origen;
          }
        }
      ),
    [eventosFiltrados]
  );

  if (authLoading) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: brand.bg }}><span style={{ color: "#9ca3af" }}>Cargando…</span></div>;
  }
  if (!session) {
    if (typeof window !== "undefined") window.location.href = "/";
    return null;
  }
  if (profile?.role_id !== "admin") return <SinAcceso />;

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };
  const maxCta = ctas[0]?.total || 0;
  const maxDispositivo = dispositivos[0]?.total || 0;
  const maxOrigen = origenes[0]?.total || 0;

  return (
    <Layout view="estadisticas_proyectos" profile={profile} onLogout={logout}>
      <Head>
        <title>Estadísticas de proyectos · InmoAdmin</title>
      </Head>

      <div style={{ padding: "26px 22px 44px", maxWidth: 1240, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
          <div>
            <p style={{ margin: "0 0 4px", color: brand.red, fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".1em" }}>Dirección</p>
            <h2 style={{ margin: "0 0 5px", color: "#1a1a2e", fontSize: 25, fontWeight: 900 }}>Estadísticas de proyectos</h2>
            <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>Páginas independientes de proyectos · {nombreMes(mes)}</p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10, fontWeight: 800, color: "#6b7280", textTransform: "uppercase" }}>
              Mes
              <input type="month" value={mes} onChange={(event) => setMes(event.target.value)} style={{ border: "1px solid #d1d5db", borderRadius: 9, padding: "9px 11px", fontSize: 13, background: "#fff" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10, fontWeight: 800, color: "#6b7280", textTransform: "uppercase" }}>
              Proyecto
              <select value={proyectoSeleccionado} onChange={(event) => setProyectoSeleccionado(event.target.value)} style={{ minWidth: 210, border: "1px solid #d1d5db", borderRadius: 9, padding: "9px 11px", fontSize: 13, background: "#fff" }}>
                <option value="todos">Todos los proyectos</option>
                {proyectos.map((project) => <option key={project.slug} value={project.slug}>{project.nombre}</option>)}
              </select>
            </label>
          </div>
        </div>

        {error && <div style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 12, padding: "13px 16px", marginBottom: 18, fontSize: 13 }}>{error}</div>}

        {loading ? (
          <div style={{ padding: 80, textAlign: "center", color: "#9ca3af" }}>Cargando estadísticas…</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 11, marginBottom: 24 }}>
              <StatCard label="Visitas" value={fmt(resumenTotal.visitas)} detail="Una por navegador, proyecto y día." />
              <StatCard label="Visitantes únicos" value={fmt(resumenTotal.visitantes)} detail="Navegadores distintos durante el mes." tone="blue" />
              <StatCard label="WhatsApp" value={fmt(resumenTotal.whatsapp)} tone="green" />
              <StatCard label="Teléfono" value={fmt(resumenTotal.telefono)} tone="green" />
              <StatCard label="Disponibilidad" value={fmt(resumenTotal.disponibilidad)} tone="amber" />
              <StatCard label="Contactos únicos" value={fmt(resumenTotal.contactos)} detail="Visitantes con WhatsApp, teléfono o registro partner." tone="red" />
              <StatCard label="Conversión" value={pct(resumenTotal.conversion)} detail="Contactos únicos ÷ visitantes únicos." tone="red" />
            </div>

            <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, overflow: "hidden", marginBottom: 20 }}>
              <div style={{ padding: "16px 18px", borderBottom: "1px solid #f3f4f6" }}>
                <h3 style={{ margin: 0, fontSize: 15, color: "#1a1a2e" }}>🏆 Ranking mensual por proyecto</h3>
              </div>
              {ranking.length === 0 ? (
                <p style={{ padding: 28, margin: 0, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>Todavía no hay eventos en este mes.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
                    <thead>
                      <tr style={{ background: "#f9fafb" }}>
                        {["#", "Proyecto", "Visitas", "Únicos", "WhatsApp", "Teléfono", "Disponibilidad", "Contactos", "Conversión"].map((header) => (
                          <th key={header} style={{ padding: "10px 12px", textAlign: header === "Proyecto" ? "left" : "right", fontSize: 10, color: "#6b7280", textTransform: "uppercase" }}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.map((project, index) => (
                        <tr key={project.slug} style={{ borderTop: "1px solid #f3f4f6", background: proyectoSeleccionado === project.slug ? "#fff7f8" : "#fff" }}>
                          <td style={{ padding: "12px", textAlign: "right", fontWeight: 900, color: index < 3 ? brand.red : "#9ca3af" }}>{index + 1}</td>
                          <td style={{ padding: "12px", fontSize: 13, fontWeight: 800, color: "#1a1a2e" }}>
                            <button onClick={() => setProyectoSeleccionado(project.slug)} style={{ padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", cursor: "pointer", textAlign: "left" }}>{project.nombre}</button>
                          </td>
                          {[project.visitas, project.visitantes, project.whatsapp, project.telefono, project.disponibilidad, project.contactos].map((value, i) => (
                            <td key={i} style={{ padding: "12px", textAlign: "right", fontSize: 13, color: "#374151" }}>{fmt(value)}</td>
                          ))}
                          <td style={{ padding: "12px", textAlign: "right", fontSize: 13, fontWeight: 900, color: project.conversion > 0 ? brand.red : "#9ca3af" }}>{pct(project.conversion)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 20 }}>
              <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 18 }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 14, color: "#1a1a2e" }}>CTAs y acciones</h3>
                {ctas.slice(0, 15).map((item) => <MiniBar key={item.label} label={item.label} value={item.total} max={maxCta} />)}
                {ctas.length === 0 && <p style={{ color: "#9ca3af", fontSize: 12 }}>Sin clics registrados.</p>}
              </section>
              <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 18 }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 14, color: "#1a1a2e" }}>Dispositivos</h3>
                {dispositivos.map((item) => <MiniBar key={item.label} label={item.label} value={item.total} max={maxDispositivo} color="#1e40af" />)}
                <h3 style={{ margin: "24px 0 16px", fontSize: 14, color: "#1a1a2e" }}>Origen de visitas</h3>
                {origenes.slice(0, 10).map((item) => <MiniBar key={item.label} label={item.label} value={item.total} max={maxOrigen} color="#7c3aed" />)}
              </section>
            </div>

            <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, overflow: "hidden" }}>
              <div style={{ padding: "16px 18px", borderBottom: "1px solid #f3f4f6" }}>
                <h3 style={{ margin: 0, fontSize: 14, color: "#1a1a2e" }}>Detalle diario</h3>
              </div>
              {actividadDiaria.length === 0 ? (
                <p style={{ padding: 28, margin: 0, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>Sin actividad para mostrar.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                    <thead>
                      <tr style={{ background: "#f9fafb" }}>
                        {["Día", "Visitas", "Únicos", "WhatsApp", "Teléfono", "Disponibilidad", "Contactos", "Conversión"].map((header) => (
                          <th key={header} style={{ padding: "10px 12px", textAlign: header === "Día" ? "left" : "right", fontSize: 10, color: "#6b7280", textTransform: "uppercase" }}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {actividadDiaria.map((day) => (
                        <tr key={day.day} style={{ borderTop: "1px solid #f3f4f6" }}>
                          <td style={{ padding: "11px 12px", fontSize: 12, fontWeight: 700, color: "#374151" }}>{fechaMexico(`${day.day}T12:00:00-06:00`)}</td>
                          {[day.visitas, day.visitantes, day.whatsapp, day.telefono, day.disponibilidad, day.contactos].map((value, i) => (
                            <td key={i} style={{ padding: "11px 12px", textAlign: "right", fontSize: 12, color: "#374151" }}>{fmt(value)}</td>
                          ))}
                          <td style={{ padding: "11px 12px", textAlign: "right", fontSize: 12, fontWeight: 800, color: brand.red }}>{pct(day.conversion)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}
