import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Layout, { brand } from "../../components/Layout";
import { supabase } from "../../lib/supabase";

const META_MENSUAL_NUEVA = 380000;
const META_CITAS_DIARIAS = 2;
const META_CONVERSION_OPERATIVA = 0.15;
const ROLES_DIRECCION = new Set(["admin", "gerente_ventas"]);
const ROLES_ASESORES = new Set(["asesor"]);
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const VALIDACION_HISTORICA = {
  "2026-04": 304450,
  "2026-05": 101000,
  "2026-06": 206600,
  "2026-07": 232750,
};

const fmtMoney = (value) => new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const fmtNumber = (value) => new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 1,
}).format(Number(value || 0));

const pct = (value, total, decimals = 1) => {
  if (!total) return "n/d";
  return `${((Number(value || 0) / Number(total || 0)) * 100).toFixed(decimals)}%`;
};

const fechaMx = (value) => {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
};

const monthKey = (value) => String(value || "").slice(0, 7);
const dateKey = (value) => String(value || "").slice(0, 10);
const normalize = (value) => String(value || "").trim().toLowerCase();

const esRenovacionTemporal = (cierre) => normalize(cierre?.propiedad).startsWith("renov");

const nombrePerfil = (perfil) => perfil?.full_name || perfil?.email || "Sin nombre";

const normVendedor = (value) => {
  const s = normalize(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (s.includes("guillermo")) return "Guillermo";
  if (s.includes("ari")) return "Ariannet";
  if (s.includes("andrea")) return "Andrea";
  if (s.includes("rosario")) return "Rosario";
  if (s.includes("angelica")) return "Angélica";
  if (s.includes("ivan")) return "Iván";
  if (s.includes("amanda")) return "Amanda";
  if (s.includes("oficina")) return "Oficina";
  if (s.includes("direccion")) return "Dirección";
  if (s.includes("otro")) return "Otro";
  return value || "Sin vendedor";
};

const parseYearMonth = (value) => {
  const [year, month] = String(value).split("-").map(Number);
  return { year, month };
};

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

const isSunday = (dateString) => {
  const date = new Date(`${dateString}T12:00:00-06:00`);
  return date.getDay() === 0;
};

const countNonSundayDays = (year, month, throughDay) => {
  let count = 0;
  for (let day = 1; day <= throughDay; day += 1) {
    const d = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!isSunday(d)) count += 1;
  }
  return count;
};

const getMonthBounds = (selectedMonth) => {
  const { year, month } = parseYearMonth(selectedMonth);
  const start = `${selectedMonth}-01`;
  const endDay = daysInMonth(year, month);
  const end = `${selectedMonth}-${String(endDay).padStart(2, "0")}`;
  return { year, month, start, end, endDay };
};

const getCorte = (selectedMonth) => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  const currentMonth = today.slice(0, 7);
  if (selectedMonth === currentMonth) return today;
  return getMonthBounds(selectedMonth).end;
};

const estadoSalud = ({ avanceMeta, avanceCitas, riesgoPct }) => {
  if (avanceMeta >= 0.9 && avanceCitas >= 0.9 && riesgoPct <= 0.1) {
    return { label: "Verde", tone: "green", text: "Ritmo sano con datos actuales" };
  }
  if (avanceMeta >= 0.65 || avanceCitas >= 0.65) {
    return { label: "Amarillo", tone: "yellow", text: "Ritmo con riesgo; requiere seguimiento" };
  }
  return { label: "Rojo", tone: "red", text: "Desviación importante contra actividad/meta" };
};

const toneStyle = {
  green: { bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" },
  yellow: { bg: "#fffbeb", color: "#92400e", border: "#fde68a" },
  red: { bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
  gray: { bg: "#f9fafb", color: "#4b5563", border: "#e5e7eb" },
};

const Badge = ({ tone = "gray", children }) => {
  const st = toneStyle[tone] || toneStyle.gray;
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      border: `1px solid ${st.border}`,
      background: st.bg,
      color: st.color,
      padding: "4px 9px",
      fontSize: 11,
      fontWeight: 800,
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
};

const Card = ({ label, value, sub, tone = "gray" }) => {
  const st = toneStyle[tone] || toneStyle.gray;
  return (
    <div style={{
      background: "#fff",
      border: `1px solid ${st.border}`,
      borderRadius: 14,
      padding: 18,
      boxShadow: "0 1px 3px rgba(17, 24, 39, 0.06)",
    }}>
      <p style={{ margin: 0, fontSize: 11, color: "#6b7280", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</p>
      <p style={{ margin: "10px 0 0", fontSize: 28, color: st.color === "#4b5563" ? "#111827" : st.color, fontWeight: 900 }}>{value}</p>
      {sub && <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 12, lineHeight: 1.45 }}>{sub}</p>}
    </div>
  );
};

const styles = {
  section: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 18, boxShadow: "0 1px 3px rgba(17, 24, 39, 0.05)" },
  h2: { margin: 0, fontSize: 18, color: "#111827", fontWeight: 900 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #e5e7eb", color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 },
  td: { padding: "11px 8px", borderBottom: "1px solid #f3f4f6", color: "#374151", verticalAlign: "top" },
};

export default function GerenciaVentasDashboard() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }).slice(0, 7));
  const [data, setData] = useState({
    profiles: [],
    partners: [],
    cierres: [],
    citas: [],
    clientes: [],
    seguimientos: [],
    cartas: [],
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: current } }) => {
      setSession(current);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, current) => setSession(current));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    supabase
      .from("profiles")
      .select("id, email, full_name, role_id, active")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data: perfil }) => setProfile(perfil));
  }, [session?.user?.id]);

  const puedeVer = profile?.active !== false && ROLES_DIRECCION.has(profile?.role_id);

  useEffect(() => {
    if (!session || !puedeVer) return;
    cargarDatos();
  }, [session, puedeVer, selectedMonth]);

  const cargarDatos = async () => {
    setLoading(true);
    setError("");
    const { year, month, start, end } = getMonthBounds(selectedMonth);
    const cierreQueryEnd = end < "2026-07-31" ? "2026-07-31" : end;
    const startDateTime = `${start}T00:00:00-06:00`;
    const endExclusive = new Date(`${end}T12:00:00-06:00`);
    endExclusive.setDate(endExclusive.getDate() + 1);
    const yearStart = `${year}-01-01`;
    try {
      const [profilesRes, partnersRes, cierresRes, citasRes, clientesRes, seguimientosRes, cartasRes] = await Promise.all([
        supabase.from("profiles").select("id, email, full_name, role_id, active, created_at"),
        supabase.from("partner_users").select("email"),
        supabase.from("cierres").select("id, anio, mes, propiedad, fecha_cierre, operacion, precio, comision, vendedor, notas").gte("fecha_cierre", yearStart).lte("fecha_cierre", cierreQueryEnd),
        supabase.from("citas").select("id, cliente_id, propiedad_id, asesor_id, fecha_hora, estado, created_at, updated_at").gte("fecha_hora", startDateTime).lt("fecha_hora", endExclusive.toISOString()),
        supabase.from("clientes").select("id, nombre, etapa_interes, asesor_id, created_at, updated_at"),
        supabase.from("seguimientos_cliente").select("id, cliente_id, asesor_id, tipo, created_at").gte("created_at", `${start}T00:00:00`),
        supabase.from("cartas_oferta").select("id, inmueble, precio_oferta, precio_contraoferta, estatus, created_by, created_at, notas").gte("created_at", `${start}T00:00:00`),
      ]);

      const firstError = [profilesRes, partnersRes, cierresRes, citasRes, clientesRes, seguimientosRes, cartasRes].find((res) => res.error)?.error;
      if (firstError) throw firstError;

      setData({
        profiles: profilesRes.data || [],
        partners: partnersRes.data || [],
        cierres: cierresRes.data || [],
        citas: citasRes.data || [],
        clientes: clientesRes.data || [],
        seguimientos: seguimientosRes.data || [],
        cartas: cartasRes.data || [],
      });
    } catch (err) {
      setError(err?.message || "No se pudo cargar la lectura gerencial.");
    } finally {
      setLoading(false);
    }
  };

  const lectura = useMemo(() => {
    const { year, month, start, end } = getMonthBounds(selectedMonth);
    const corte = getCorte(selectedMonth);
    const corteDay = Number(corte.slice(8, 10));
    const currentMonth = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }).slice(0, 7);
    const esMesActual = selectedMonth === currentMonth;
    const diaEvaluado = esMesActual ? corteDay : daysInMonth(year, month);
    const diasEvaluables = countNonSundayDays(year, month, diaEvaluado);
    const partnerEmails = new Set((data.partners || []).map((p) => normalize(p.email)));
    const asesoresComerciales = (data.profiles || [])
      .filter((p) => p.active !== false && ROLES_ASESORES.has(p.role_id) && !partnerEmails.has(normalize(p.email)))
      .map((p) => ({ ...p, nombre: nombrePerfil(p) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    const profileById = new Map((data.profiles || []).map((p) => [p.id, p]));
    const nameById = (id) => nombrePerfil(profileById.get(id));

    const cierresMes = (data.cierres || []).filter((c) => {
      const fecha = dateKey(c.fecha_cierre);
      return fecha >= start && fecha <= end;
    });
    const cierresHastaCorte = cierresMes.filter((c) => dateKey(c.fecha_cierre) <= corte);
    const cierresNuevos = cierresHastaCorte.filter((c) => !esRenovacionTemporal(c));
    const renovaciones = cierresHastaCorte.filter(esRenovacionTemporal);
    const totalNuevo = cierresNuevos.reduce((sum, c) => sum + Number(c.comision || 0), 0);
    const totalRenovaciones = renovaciones.reduce((sum, c) => sum + Number(c.comision || 0), 0);

    const citasHastaCorte = (data.citas || []).filter((cita) => {
      const fecha = fechaMx(cita.fecha_hora);
      return fecha >= start && fecha <= corte;
    });
    const citasEfectivas = citasHastaCorte.filter((cita) => cita.estado === "efectiva" || cita.estado === "calificada");
    const citasCalificadas = citasHastaCorte.filter((cita) => cita.estado === "calificada");
    const requeridasEquipo = asesoresComerciales.length * diasEvaluables * META_CITAS_DIARIAS;
    const avanceMeta = totalNuevo / META_MENSUAL_NUEVA;
    const avanceCitas = requeridasEquipo ? citasEfectivas.length / requeridasEquipo : 0;

    const seguimientosMes = (data.seguimientos || []).filter((s) => dateKey(s.created_at) >= start && dateKey(s.created_at) <= corte);
    const seguimientosByCliente = new Map();
    (data.seguimientos || []).forEach((s) => {
      const list = seguimientosByCliente.get(s.cliente_id) || [];
      list.push(s);
      seguimientosByCliente.set(s.cliente_id, list);
    });
    const citasByCliente = new Map();
    (data.citas || []).forEach((cita) => {
      const list = citasByCliente.get(cita.cliente_id) || [];
      list.push(cita);
      citasByCliente.set(cita.cliente_id, list);
    });

    const corteFinal = new Date(`${corte}T23:59:59-06:00`);
    const clientesActivos = (data.clientes || []).filter((c) => !["perdido", "cerrado"].includes(normalize(c.etapa_interes)));
    const riesgoCliente = (cliente) => {
      const citasCliente = citasByCliente.get(cliente.id) || [];
      const tieneCitaFutura = citasCliente.some((cita) => cita.estado === "agendada" && new Date(cita.fecha_hora) > corteFinal);
      if (tieneCitaFutura) return false;
      const segs = seguimientosByCliente.get(cliente.id) || [];
      const ultima = [cliente.updated_at, cliente.created_at, ...segs.map((s) => s.created_at), ...citasCliente.map((c) => c.updated_at || c.created_at || c.fecha_hora)]
        .filter(Boolean)
        .sort((a, b) => new Date(b) - new Date(a))[0];
      if (!ultima) return true;
      const horas = (corteFinal - new Date(ultima)) / 36e5;
      const etapa = normalize(cliente.etapa_interes);
      if (etapa === "caliente") return horas >= 48;
      if (etapa === "nuevo") return horas >= 48;
      if (etapa === "en_seguimiento") return horas >= 168;
      return horas >= 168;
    };
    const clientesEnRiesgo = clientesActivos.filter(riesgoCliente);

    const asesorRows = asesoresComerciales.map((asesor) => {
      const citasAsesor = citasHastaCorte.filter((cita) => cita.asesor_id === asesor.id);
      const efectivas = citasAsesor.filter((cita) => cita.estado === "efectiva" || cita.estado === "calificada").length;
      const calificadas = citasAsesor.filter((cita) => cita.estado === "calificada").length;
      const requeridas = diasEvaluables * META_CITAS_DIARIAS;
      const nombre = asesor.nombre;
      const cierresAsesor = cierresNuevos.filter((c) => normVendedor(c.vendedor) === nombre);
      const comision = cierresAsesor.reduce((sum, c) => sum + Number(c.comision || 0), 0);
      const clientesAsesor = clientesActivos.filter((c) => c.asesor_id === asesor.id);
      const riesgo = clientesAsesor.filter(riesgoCliente).length;
      const segs = seguimientosMes.filter((s) => s.asesor_id === asesor.id).length;
      return {
        id: asesor.id,
        nombre,
        email: asesor.email,
        requeridas,
        agendadas: citasAsesor.length,
        efectivas,
        calificadas,
        cumplimiento: requeridas ? efectivas / requeridas : 0,
        cumple: efectivas >= requeridas,
        seguimientos: segs,
        clientesActivos: clientesAsesor.length,
        riesgo,
        cierres: cierresAsesor.length,
        comision,
      };
    }).sort((a, b) => b.comision - a.comision || b.efectivas - a.efectivas || a.nombre.localeCompare(b.nombre));

    const cumplimientoAsesores = asesorRows.length
      ? asesorRows.filter((row) => row.cumple).length / asesorRows.length
      : 0;
    const conversionOperativa = citasCalificadas.length ? cierresNuevos.length / citasCalificadas.length : 0;
    const riesgoPct = clientesActivos.length ? clientesEnRiesgo.length / clientesActivos.length : 0;
    const salud = estadoSalud({ avanceMeta, avanceCitas, riesgoPct });

    const produccionPorVendedor = Object.values(cierresNuevos.reduce((acc, c) => {
      const vendedor = normVendedor(c.vendedor);
      acc[vendedor] ||= { vendedor, cierres: 0, comision: 0 };
      acc[vendedor].cierres += 1;
      acc[vendedor].comision += Number(c.comision || 0);
      return acc;
    }, {})).sort((a, b) => b.comision - a.comision);

    const historicoValidacion = Object.entries(VALIDACION_HISTORICA).map(([key, esperado]) => {
      const calculado = (data.cierres || [])
        .filter((c) => `${c.anio}-${String(c.mes).padStart(2, "0")}` === key)
        .filter((c) => !esRenovacionTemporal(c))
        .reduce((sum, c) => sum + Number(c.comision || 0), 0);
      return { key, esperado, calculado, ok: Math.round(calculado) === esperado };
    });

    return {
      start,
      end,
      corte,
      diasEvaluables,
      asesoresComerciales,
      asesoresTemporalesFuera: null,
      capacidadDisponible: asesoresComerciales.length ? 1 : 0,
      cierresNuevos,
      renovaciones,
      totalNuevo,
      totalRenovaciones,
      avanceMeta,
      requeridasEquipo,
      citasEfectivas: citasEfectivas.length,
      citasCalificadas: citasCalificadas.length,
      cumplimientoAsesores,
      conversionOperativa,
      clientesActivos: clientesActivos.length,
      clientesEnRiesgo: clientesEnRiesgo.length,
      riesgoPct,
      salud,
      asesorRows,
      produccionPorVendedor,
      historicoValidacion,
    };
  }, [data, selectedMonth]);

  if (authLoading || (session && !profile)) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui" }}>Cargando...</div>;
  }

  if (!session || !puedeVer) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui", background: brand.bg }}>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 32, textAlign: "center" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 20 }}>Acceso restringido</h1>
          <p style={{ margin: 0, color: "#6b7280" }}>Esta vista es para Dirección y Gerencia de Ventas.</p>
        </div>
      </div>
    );
  }

  const saludTone = lectura.salud.tone;
  const monthOptions = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];

  return (
    <Layout view="gerencia_ventas" profile={profile}>
      <Head>
        <title>Gerencia de Ventas · InmoAdmin</title>
      </Head>
      <main style={{ padding: "26px 28px 44px", width: "100%" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto" }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18, marginBottom: 22, flexWrap: "wrap" }}>
            <div>
              <p style={{ margin: "0 0 8px", color: brand.red, fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 1 }}>Fase 1 · Lectura preliminar</p>
              <h1 style={{ margin: 0, color: "#111827", fontSize: 30, fontWeight: 950 }}>Gerencia de Ventas</h1>
              <p style={{ margin: "8px 0 0", color: "#6b7280", fontSize: 14, maxWidth: 760 }}>
                Vista gerencial en modo lectura. La Salud Comercial es preliminar porque todavía no existe pipeline/forecast estructurado ni ausencias justificadas capturadas.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} style={{
                padding: "10px 12px",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                background: "#fff",
                fontWeight: 800,
                color: "#374151",
              }}>
                {monthOptions.map((key) => {
                  const { month } = parseYearMonth(key);
                  return <option key={key} value={key}>{MESES[month - 1]} {key.slice(0, 4)}</option>;
                })}
              </select>
              <Badge tone={saludTone}>Salud preliminar: {lectura.salud.label}</Badge>
            </div>
          </header>

          {error && <div style={{ ...styles.section, borderColor: "#fecaca", color: "#991b1b", marginBottom: 18 }}>{error}</div>}
          {loading && <div style={{ ...styles.section, marginBottom: 18 }}>Actualizando lectura...</div>}

          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 18 }}>
            <Card label="Meta mensual nueva" value={fmtMoney(META_MENSUAL_NUEVA)} sub="Renovaciones fuera de la meta." />
            <Card label="Cerrado nuevo" value={fmtMoney(lectura.totalNuevo)} sub={`${pct(lectura.totalNuevo, META_MENSUAL_NUEVA)} de cumplimiento al corte ${lectura.corte}.`} tone={lectura.avanceMeta >= 1 ? "green" : lectura.avanceMeta >= 0.65 ? "yellow" : "red"} />
            <Card label="Renovaciones separadas" value={fmtMoney(lectura.totalRenovaciones)} sub={`${lectura.renovaciones.length} cierre(s) clasificados temporalmente por nombre Renov*.`} />
            <Card label="Citas efectivas" value={`${lectura.citasEfectivas} / ${lectura.requeridasEquipo}`} sub={`${pct(lectura.citasEfectivas, lectura.requeridasEquipo)} del requerido acumulado.`} tone={lectura.citasEfectivas >= lectura.requeridasEquipo ? "green" : lectura.citasEfectivas >= lectura.requeridasEquipo * 0.65 ? "yellow" : "red"} />
            <Card label="Asesores cumpliendo" value={`${Math.round(lectura.cumplimientoAsesores * lectura.asesorRows.length)} / ${lectura.asesorRows.length}`} sub="Solo asesores activos/evaluables; sin tabla de ausencias en Fase 1." tone={lectura.cumplimientoAsesores >= 0.9 ? "green" : lectura.cumplimientoAsesores >= 0.65 ? "yellow" : "red"} />
            <Card label="Conversión operativa" value={lectura.citasCalificadas ? pct(lectura.cierresNuevos.length, lectura.citasCalificadas) : "n/d"} sub={`Cierres nuevos / citas calificadas del periodo. Referencia: ${Math.round(META_CONVERSION_OPERATIVA * 100)}%.`} />
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(280px, 0.65fr)", gap: 16, marginBottom: 18 }}>
            <div style={styles.section}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
                <div>
                  <h2 style={styles.h2}>Scorecard por asesor</h2>
                  <p style={{ margin: "5px 0 0", color: "#6b7280", fontSize: 12 }}>
                    Piso vigente: {META_CITAS_DIARIAS} citas efectivas por día activo, excluyendo domingos. Corte: {lectura.corte}.
                  </p>
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Asesor</th>
                      <th style={styles.th}>Citas</th>
                      <th style={styles.th}>Cumpl.</th>
                      <th style={styles.th}>Calif.</th>
                      <th style={styles.th}>Seg.</th>
                      <th style={styles.th}>Riesgo</th>
                      <th style={styles.th}>Cierres</th>
                      <th style={styles.th}>Comisión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lectura.asesorRows.map((row) => (
                      <tr key={row.id}>
                        <td style={styles.td}>
                          <strong>{row.nombre}</strong>
                          <div style={{ color: "#9ca3af", fontSize: 11 }}>{row.email}</div>
                        </td>
                        <td style={styles.td}>{row.efectivas} / {row.requeridas}</td>
                        <td style={styles.td}><Badge tone={row.cumple ? "green" : row.cumplimiento >= 0.65 ? "yellow" : "red"}>{pct(row.efectivas, row.requeridas)}</Badge></td>
                        <td style={styles.td}>{row.calificadas}</td>
                        <td style={styles.td}>{row.seguimientos}</td>
                        <td style={styles.td}>{row.riesgo} / {row.clientesActivos}</td>
                        <td style={styles.td}>{row.cierres}</td>
                        <td style={styles.td}><strong>{fmtMoney(row.comision)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <aside style={{ ...styles.section, display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <h2 style={styles.h2}>Salud Comercial Preliminar</h2>
                <div style={{ marginTop: 12 }}><Badge tone={saludTone}>{lectura.salud.label}</Badge></div>
                <p style={{ margin: "10px 0 0", color: "#6b7280", fontSize: 13, lineHeight: 1.55 }}>{lectura.salud.text}</p>
              </div>
              <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 12 }}>
                <p style={{ margin: 0, color: "#6b7280", fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>Capacidad comercial</p>
                <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 900, color: "#111827" }}>{lectura.asesoresComerciales.length} asesores</p>
                <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 12 }}>Fuera temporal: no disponible en datos actuales. No se aplicaron exclusiones por ausencia.</p>
              </div>
              <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 12 }}>
                <p style={{ margin: 0, color: "#6b7280", fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>Clientes en riesgo</p>
                <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 900, color: "#111827" }}>{lectura.clientesEnRiesgo} / {lectura.clientesActivos}</p>
                <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 12 }}>Inferido por actividad reciente; no sustituye pipeline estructurado.</p>
              </div>
            </aside>
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 18 }}>
            <div style={styles.section}>
              <h2 style={styles.h2}>Producción nueva por vendedor</h2>
              <div style={{ overflowX: "auto", marginTop: 10 }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Vendedor</th>
                      <th style={styles.th}>Cierres</th>
                      <th style={styles.th}>Comisión nueva</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lectura.produccionPorVendedor.length === 0 ? (
                      <tr><td style={styles.td} colSpan={3}>Sin cierres nuevos al corte.</td></tr>
                    ) : lectura.produccionPorVendedor.map((row) => (
                      <tr key={row.vendedor}>
                        <td style={styles.td}>{row.vendedor}</td>
                        <td style={styles.td}>{row.cierres}</td>
                        <td style={styles.td}><strong>{fmtMoney(row.comision)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={styles.section}>
              <h2 style={styles.h2}>Validación abril-julio</h2>
              <p style={{ margin: "5px 0 10px", color: "#6b7280", fontSize: 12 }}>Comparación automática contra la auditoría aprobada, excluyendo Renov*.</p>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Mes</th>
                    <th style={styles.th}>Calculado</th>
                    <th style={styles.th}>Esperado</th>
                    <th style={styles.th}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {lectura.historicoValidacion.map((row) => (
                    <tr key={row.key}>
                      <td style={styles.td}>{MESES[Number(row.key.slice(5, 7)) - 1]}</td>
                      <td style={styles.td}>{fmtMoney(row.calculado)}</td>
                      <td style={styles.td}>{fmtMoney(row.esperado)}</td>
                      <td style={styles.td}><Badge tone={row.ok ? "green" : "red"}>{row.ok ? "Coincide" : "Revisar"}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>Limitaciones de Fase 1</h2>
            <ul style={{ margin: "12px 0 0", color: "#4b5563", lineHeight: 1.7, paddingLeft: 20 }}>
              <li>La clasificación de renovaciones usa temporalmente el prefijo Renov*; la arquitectura definitiva debe usar un campo estructurado.</li>
              <li>No hay tabla de ausencias, por lo que todos los asesores activos cuentan como evaluables.</li>
              <li>No hay pipeline ni forecast estructurado; la Salud Comercial es preliminar.</li>
              <li>La conversión mostrada es operativa del periodo; todavía no es conversión por cohorte.</li>
              <li>El campo `cierres.vendedor` sigue siendo texto, no una relación formal con `profiles.id`.</li>
            </ul>
          </section>
        </div>
      </main>
    </Layout>
  );
}
