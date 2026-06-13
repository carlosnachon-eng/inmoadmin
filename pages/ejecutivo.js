import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { PageHeader, brand } from "../components/Layout";

const ADMIN_EMAIL = "carlos.nachon@emporioinmobiliario.mx";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const RUBROS = [
  { id: "polizas",        label: "Pólizas",          icon: "⚖️", color: "#7c3aed", bg: "#faf5ff" },
  { id: "administracion", label: "Administraciones", icon: "🏢", color: "#1e40af", bg: "#eff6ff" },
  { id: "mantenimiento",  label: "Mantenimiento",    icon: "🔧", color: "#d97706", bg: "#fffbeb" },
  { id: "condominios",    label: "Condominios",      icon: "🏙️", color: "#065f46", bg: "#f0fdf4" },
];

const KpiCard = ({ label, value, sub, color, bg, icon, tendencia }) => (
  <div style={{ background: bg || "#fff", borderRadius: 14, padding: "18px 20px", border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
      <p style={{ margin: 0, fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</p>
      {icon && <span style={{ fontSize: 20 }}>{icon}</span>}
    </div>
    <p style={{ margin: 0, fontSize: 28, fontWeight: 900, color: color || "#1a1a2e" }}>{value}</p>
    {sub && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca3af" }}>{sub}</p>}
    {tendencia !== undefined && tendencia !== null && (
      <p style={{ margin: "6px 0 0", fontSize: 12, fontWeight: 700, color: tendencia >= 0 ? "#065f46" : "#dc2626" }}>
        {tendencia >= 0 ? "▲" : "▼"} {tendencia >= 0 ? "+" : "-"}{Math.abs(tendencia).toFixed(1)}% vs mes anterior
      </p>
    )}
  </div>
);

const BarraRubro = ({ label, icon, value, total, color }) => {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>{icon} {label}</span>
        <div style={{ textAlign: "right" }}>
          <span style={{ fontSize: 14, fontWeight: 800, color }}>{fmt(value)}</span>
          <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 6 }}>{pct.toFixed(1)}%</span>
        </div>
      </div>
      <div style={{ background: "#f3f4f6", borderRadius: 6, height: 10, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 6, minWidth: value > 0 ? 4 : 0, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
};

export default function Ejecutivo() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [mesSeleccionado, setMesSeleccionado] = useState(new Date().getMonth());

  const [cierres, setCierres] = useState([]);
  const [polizaCaja, setPolizaCaja] = useState([]);
  const [cashMovements, setCashMovements] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [condominios, setCondominios] = useState([]);
  const [comisionesAdmin, setComisionesAdmin] = useState([]);
  const [contratosComision, setContratosComision] = useState([]);
  const [gastosCondominio, setGastosCondominio] = useState([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadData(); }, [session]);

  const loadData = async () => {
    setLoading(true);
    const [c, pc, cm, t, cond, ca, ct, gc] = await Promise.all([
      supabase.from("cierres").select("fecha_cierre, comision, cobrado, pendiente, anio, mes"),
      supabase.from("poliza_caja").select("fecha, monto, tipo, concepto"),
      supabase.from("cash_movements").select("date, amount, type, category, description"),
      supabase.from("maintenance_tickets").select("status, charged_amount, provider_cost, updated_at, created_at, payer"),
      supabase.from("condominios").select("honorarios_emporio, activo").eq("activo", true),
      supabase.from("comisiones_admin").select("periodo, monto, status, fecha_cobro").eq("status", "cobrada"),
      supabase.from("contracts").select("commission_status, commission_type, commission_value, monthly_rent, updated_at").eq("status", "activo").eq("commission_status", "cobrada"),
      supabase.from("gastos_condominio").select("concepto, monto, fecha, categoria"),
    ]);
    setCierres(c.data || []);
    setPolizaCaja(pc.data || []);
    setCashMovements(cm.data || []);
    setTickets(t.data || []);
    setCondominios(cond.data || []);
    setComisionesAdmin(ca.data || []);
    setContratosComision(ct.data || []);
    setGastosCondominio(gc.data || []);
    setLoading(false);
  };

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} />
    </div>
  );

  if (!session || session.user.email !== ADMIN_EMAIL) return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", padding: 40 }}>
        <p style={{ fontSize: 48, margin: "0 0 16px" }}>🔒</p>
        <h2 style={{ color: "#4a4a4a", margin: "0 0 8px" }}>Acceso restringido</h2>
        <p style={{ color: "#9ca3af" }}>Esta sección es exclusiva para el administrador</p>
      </div>
    </div>
  );

  const enMes = (fecha, m, a) => {
    if (!fecha) return false;
    const d = new Date(fecha.includes("T") ? fecha : fecha + "T12:00:00");
    return d.getMonth() === m && d.getFullYear() === a;
  };

  const ingresoPorMes = (m, a) => {
    // Cierres — generado, cobrado y pendiente
    const cierresMes = cierres.filter(c => c.anio === a && c.mes === (m + 1));
    const cierresGenerado  = cierresMes.reduce((acc, c) => acc + (c.comision || 0), 0);
    const cierresCobrado   = cierresMes.reduce((acc, c) => acc + (c.cobrado || 0), 0);
    const cierresPendiente = cierresMes.reduce((acc, c) => acc + (c.pendiente || 0), 0);

    // Pólizas
    const ingrPolizas = polizaCaja
      .filter(p => enMes(p.fecha, m, a) && p.tipo === "ingreso")
      .reduce((acc, p) => acc + (p.monto || 0), 0);

    // Administración
    const periodoKey = `${a}-${String(m + 1).padStart(2, "0")}`;
    const ingrAdminCash = cashMovements
      .filter(mv => enMes(mv.date, m, a) && mv.type === "entrada" && mv.category === "comision_cobrada")
      .reduce((acc, mv) => acc + (mv.amount || 0), 0);
    const ingrAdminCA = comisionesAdmin
      .filter(ca => ca.periodo === periodoKey)
      .reduce((acc, ca) => acc + (ca.monto || 0), 0);
    const calcCom = (c) => {
      if (!c.commission_value) return 0;
      if (c.commission_type === "porcentaje") return (c.monthly_rent * c.commission_value) / 100;
      return c.commission_value;
    };
    const ingrAdminContracts = contratosComision
      .filter(c => enMes(c.updated_at, m, a))
      .reduce((acc, c) => acc + calcCom(c), 0);
    const ingrAdmin = Math.max(ingrAdminCash, ingrAdminCA, ingrAdminContracts);

    // Mantenimiento
    const ingrMtto = tickets
      .filter(t => t.status === "cerrado" && enMes(t.updated_at || t.created_at, m, a) && t.payer !== "inmobiliaria")
      .reduce((acc, t) => acc + Math.max(0, (t.charged_amount || 0) - (t.provider_cost || 0)), 0);

    // Condominios
    const ingrCondominios = gastosCondominio
      .filter(g => {
        if (g.categoria !== "honorarios_emporio" && !g.concepto?.toUpperCase().includes("ADMINISTRACION EMPORIO")) return false;
        if (!g.fecha) return false;
        const d = new Date(g.fecha + "T12:00:00");
        return d.getMonth() === m && d.getFullYear() === a;
      })
      .reduce((acc, g) => acc + (g.monto || 0), 0);

    const otrosTotal = ingrPolizas + ingrAdmin + ingrMtto + ingrCondominios;

    return {
      cierresGenerado,
      cierresCobrado,
      cierresPendiente,
      polizas: ingrPolizas,
      administracion: ingrAdmin,
      mantenimiento: ingrMtto,
      condominios: ingrCondominios,
      // "total" usa cobrado real de cierres + otros rubros
      total: cierresCobrado + otrosTotal,
      // "generado" usa comision generada de cierres + otros rubros
      totalGenerado: cierresGenerado + otrosTotal,
    };
  };

  const datosMes    = ingresoPorMes(mesSeleccionado, anio);
  const datosMesAnt = mesSeleccionado > 0
    ? ingresoPorMes(mesSeleccionado - 1, anio)
    : ingresoPorMes(11, anio - 1);

  const tendencia = (actual, anterior) => anterior > 0 ? ((actual - anterior) / anterior) * 100 : null;

  const acumuladoAnio = Array.from({ length: 12 }, (_, m) => ingresoPorMes(m, anio));
  const totalAnio          = acumuladoAnio.reduce((a, m) => a + m.total, 0);
  const totalAnioGenerado  = acumuladoAnio.reduce((a, m) => a + m.totalGenerado, 0);
  const totalAnioPendiente = acumuladoAnio.reduce((a, m) => a + m.cierresPendiente, 0);

  const mesesConDatos = acumuladoAnio.filter(m => m.total > 0).length;
  const promedioMensual = mesesConDatos > 0 ? totalAnio / mesesConDatos : 0;
  const mesActual = new Date().getMonth();
  const mesesTranscurridos = anio === new Date().getFullYear() ? mesActual + 1 : 12;
  const proyeccion = mesesTranscurridos > 0 ? (totalAnio / mesesTranscurridos) * 12 : 0;

  const porRubroAnio = {
    cierresGenerado:  acumuladoAnio.reduce((a, m) => a + m.cierresGenerado, 0),
    cierresCobrado:   acumuladoAnio.reduce((a, m) => a + m.cierresCobrado, 0),
    cierresPendiente: acumuladoAnio.reduce((a, m) => a + m.cierresPendiente, 0),
    polizas:          acumuladoAnio.reduce((a, m) => a + m.polizas, 0),
    administracion:   acumuladoAnio.reduce((a, m) => a + m.administracion, 0),
    mantenimiento:    acumuladoAnio.reduce((a, m) => a + m.mantenimiento, 0),
    condominios:      acumuladoAnio.reduce((a, m) => a + m.condominios, 0),
  };

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      <PageHeader title="Resumen Ejecutivo" icon="📊" />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {/* Selector año/mes */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 24, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {[new Date().getFullYear() - 1, new Date().getFullYear()].map(a => (
              <button key={a} onClick={() => setAnio(a)} style={{ padding: "8px 18px", borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 14, background: anio === a ? "#1a1a2e" : "#fff", color: anio === a ? "#fff" : "#6b7280", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                {a}
              </button>
            ))}
          </div>
          <select value={mesSeleccionado} onChange={e => setMesSeleccionado(parseInt(e.target.value))}
            style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff", fontWeight: 600, cursor: "pointer" }}>
            {MESES.map((m, i) => <option key={i} value={i}>{m} {anio}</option>)}
          </select>
          <span style={{ fontSize: 12, color: "#9ca3af" }}>Mes seleccionado: <strong>{MESES[mesSeleccionado]} {anio}</strong></span>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 48 }}><p style={{ color: "#6b7280" }}>Cargando datos...</p></div>
        ) : (
          <>
            {/* ── KPIs del mes ── */}
            <h2 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 800, color: "#1a1a2e" }}>{MESES[mesSeleccionado]} {anio}</h2>

            {/* Cierres — bloque especial con 3 tarjetas */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "16px 20px", marginBottom: 12, border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
              <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5 }}>🏠 Cierres / Ventas — {MESES[mesSeleccionado]}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                <div style={{ background: "#f9fafb", borderRadius: 10, padding: "12px 14px" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 10, color: "#6b7280", fontWeight: 700, textTransform: "uppercase" }}>Generado</p>
                  <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#1a1a2e" }}>{fmt(datosMes.cierresGenerado)}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>Comisiones del mes</p>
                </div>
                <div style={{ background: "#f0fdf4", borderRadius: 10, padding: "12px 14px", border: "1px solid #bbf7d0" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 10, color: "#065f46", fontWeight: 700, textTransform: "uppercase" }}>Cobrado ✅</p>
                  <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#065f46" }}>{fmt(datosMes.cierresCobrado)}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>Efectivamente en caja</p>
                </div>
                <div style={{ background: datosMes.cierresPendiente > 0 ? "#fff7ed" : "#f9fafb", borderRadius: 10, padding: "12px 14px", border: datosMes.cierresPendiente > 0 ? "1px solid #fed7aa" : "none" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 10, color: datosMes.cierresPendiente > 0 ? "#92400e" : "#6b7280", fontWeight: 700, textTransform: "uppercase" }}>Por cobrar {datosMes.cierresPendiente > 0 ? "⏳" : ""}</p>
                  <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color: datosMes.cierresPendiente > 0 ? "#dc2626" : "#9ca3af" }}>{fmt(datosMes.cierresPendiente)}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>Pendiente de cobro</p>
                </div>
              </div>
            </div>

            {/* Otros rubros */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
              <KpiCard
                label="Total cobrado del mes"
                value={fmt(datosMes.total)}
                icon="💰"
                color="#1a1a2e"
                tendencia={tendencia(datosMes.total, datosMesAnt.total)}
              />
              {RUBROS.map(r => (
                <KpiCard
                  key={r.id}
                  label={r.label}
                  value={fmt(datosMes[r.id])}
                  icon={r.icon}
                  color={r.color}
                  bg={r.bg}
                  tendencia={tendencia(datosMes[r.id], datosMesAnt[r.id])}
                />
              ))}
            </div>

            {/* ── Distribución del mes ── */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "20px 22px", marginBottom: 20, border: "1px solid #f0f0f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>Distribución por rubro — {MESES[mesSeleccionado]}</h3>
                <span style={{ fontSize: 18, fontWeight: 900, color: "#1a1a2e" }}>{fmt(datosMes.total)}</span>
              </div>
              <BarraRubro label="Cierres (cobrado)" icon="🏠" value={datosMes.cierresCobrado} total={datosMes.total} color="#b91c3c" />
              {RUBROS.map(r => (
                <BarraRubro key={r.id} label={r.label} icon={r.icon} value={datosMes[r.id]} total={datosMes.total} color={r.color} />
              ))}
            </div>

            {/* ── KPIs acumulado año ── */}
            <h2 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 800, color: "#1a1a2e" }}>Acumulado {anio}</h2>

            {/* Cierres acumulado — bloque especial */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "16px 20px", marginBottom: 12, border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
              <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5 }}>🏠 Cierres / Ventas — {anio}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                <div style={{ background: "#f9fafb", borderRadius: 10, padding: "12px 14px" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 10, color: "#6b7280", fontWeight: 700, textTransform: "uppercase" }}>Generado</p>
                  <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#1a1a2e" }}>{fmt(porRubroAnio.cierresGenerado)}</p>
                </div>
                <div style={{ background: "#f0fdf4", borderRadius: 10, padding: "12px 14px", border: "1px solid #bbf7d0" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 10, color: "#065f46", fontWeight: 700, textTransform: "uppercase" }}>Cobrado ✅</p>
                  <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#065f46" }}>{fmt(porRubroAnio.cierresCobrado)}</p>
                </div>
                <div style={{ background: porRubroAnio.cierresPendiente > 0 ? "#fff7ed" : "#f9fafb", borderRadius: 10, padding: "12px 14px", border: porRubroAnio.cierresPendiente > 0 ? "1px solid #fed7aa" : "none" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 10, color: porRubroAnio.cierresPendiente > 0 ? "#92400e" : "#6b7280", fontWeight: 700, textTransform: "uppercase" }}>Por cobrar ⏳</p>
                  <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color: porRubroAnio.cierresPendiente > 0 ? "#dc2626" : "#9ca3af" }}>{fmt(porRubroAnio.cierresPendiente)}</p>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 20 }}>
              <KpiCard label={`Total cobrado ${anio}`} value={fmt(totalAnio)} icon="🏆" color="#1a1a2e" sub={`${mesesTranscurridos} mes${mesesTranscurridos !== 1 ? "es" : ""} transcurridos`} />
              <KpiCard label="Promedio mensual" value={fmt(promedioMensual)} icon="📊" color="#1e40af" bg="#eff6ff" />
              <KpiCard label="Proyección anual" value={fmt(proyeccion)} icon="🎯" color="#7c3aed" bg="#faf5ff" sub="A ritmo actual" />
              {RUBROS.map(r => (
                <KpiCard key={r.id} label={`${r.label} (año)`} value={fmt(porRubroAnio[r.id])} icon={r.icon} color={r.color} bg={r.bg} />
              ))}
            </div>

            {/* ── Distribución acumulada año ── */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "20px 22px", marginBottom: 20, border: "1px solid #f0f0f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>Distribución por rubro — {anio}</h3>
                <span style={{ fontSize: 18, fontWeight: 900, color: "#1a1a2e" }}>{fmt(totalAnio)}</span>
              </div>
              <BarraRubro label="Cierres (cobrado)" icon="🏠" value={porRubroAnio.cierresCobrado} total={totalAnio} color="#b91c3c" />
              {RUBROS.map(r => (
                <BarraRubro key={r.id} label={r.label} icon={r.icon} value={porRubroAnio[r.id]} total={totalAnio} color={r.color} />
              ))}
            </div>

            {/* ── Histórico mensual ── */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "20px 22px", border: "1px solid #f0f0f0" }}>
              <h3 style={{ margin: "0 0 20px", fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>Histórico mensual {anio}</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>Mes</th>
                      <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 10, fontWeight: 700, color: "#b91c3c", textTransform: "uppercase", whiteSpace: "nowrap" }}>🏠 Generado</th>
                      <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 10, fontWeight: 700, color: "#065f46", textTransform: "uppercase", whiteSpace: "nowrap" }}>🏠 Cobrado</th>
                      <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 10, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", whiteSpace: "nowrap" }}>🏠 Por cobrar</th>
                      <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", whiteSpace: "nowrap" }}>⚖️ Pólizas</th>
                      <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", whiteSpace: "nowrap" }}>🏢 Admón</th>
                      <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", whiteSpace: "nowrap" }}>🔧 Mtto</th>
                      <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", whiteSpace: "nowrap" }}>🏙️ Cond</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11, fontWeight: 700, color: "#1a1a2e", textTransform: "uppercase", whiteSpace: "nowrap" }}>Total cobrado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acumuladoAnio.map((d, i) => {
                      const esActual = i === mesSeleccionado && anio === new Date().getFullYear();
                      const esFuturo = anio === new Date().getFullYear() && i > new Date().getMonth();
                      const hayPendiente = d.cierresPendiente > 0;
                      return (
                        <tr key={i}
                          onClick={() => setMesSeleccionado(i)}
                          style={{ borderTop: "1px solid #f3f4f6", background: esActual ? "#fffbeb" : "transparent", cursor: "pointer", opacity: esFuturo ? 0.4 : 1 }}>
                          <td style={{ padding: "10px 12px", fontWeight: esActual ? 800 : 600, fontSize: 13, color: esActual ? "#b45309" : "#374151" }}>{MESES[i]}</td>
                          <td style={{ padding: "10px 8px", textAlign: "right", fontSize: 12, color: d.cierresGenerado > 0 ? "#374151" : "#d1d5db", fontWeight: 600 }}>
                            {d.cierresGenerado > 0 ? fmt(d.cierresGenerado) : "—"}
                          </td>
                          <td style={{ padding: "10px 8px", textAlign: "right", fontSize: 12, color: d.cierresCobrado > 0 ? "#065f46" : "#d1d5db", fontWeight: 700 }}>
                            {d.cierresCobrado > 0 ? fmt(d.cierresCobrado) : "—"}
                          </td>
                          <td style={{ padding: "10px 8px", textAlign: "right", fontSize: 12, color: hayPendiente ? "#dc2626" : "#d1d5db", fontWeight: hayPendiente ? 700 : 400 }}>
                            {hayPendiente ? fmt(d.cierresPendiente) : "—"}
                          </td>
                          {["polizas","administracion","mantenimiento","condominios"].map(r => (
                            <td key={r} style={{ padding: "10px 8px", textAlign: "right", fontSize: 12, color: d[r] > 0 ? "#374151" : "#d1d5db", fontWeight: d[r] > 0 ? 600 : 400 }}>
                              {d[r] > 0 ? fmt(d[r]) : "—"}
                            </td>
                          ))}
                          <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 800, fontSize: 14, color: d.total > 0 ? "#1a1a2e" : "#d1d5db" }}>
                            {d.total > 0 ? fmt(d.total) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: "2px solid #e5e7eb", background: "#f9fafb" }}>
                      <td style={{ padding: "12px 12px", fontWeight: 800, fontSize: 14, color: "#1a1a2e" }}>TOTAL</td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: 700, fontSize: 13, color: "#374151" }}>{fmt(porRubroAnio.cierresGenerado)}</td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: 700, fontSize: 13, color: "#065f46" }}>{fmt(porRubroAnio.cierresCobrado)}</td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: 700, fontSize: 13, color: porRubroAnio.cierresPendiente > 0 ? "#dc2626" : "#9ca3af" }}>{fmt(porRubroAnio.cierresPendiente)}</td>
                      {["polizas","administracion","mantenimiento","condominios"].map(r => (
                        <td key={r} style={{ padding: "12px 8px", textAlign: "right", fontWeight: 700, fontSize: 13, color: "#374151" }}>{fmt(porRubroAnio[r])}</td>
                      ))}
                      <td style={{ padding: "12px 12px", textAlign: "right", fontWeight: 900, fontSize: 16, color: "#1a1a2e" }}>{fmt(totalAnio)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p style={{ margin: "12px 0 0", fontSize: 11, color: "#9ca3af", textAlign: "right" }}>
                Toca cualquier fila para ver el detalle del mes
              </p>
            </div>

          </>
        )}
      </div>
    </div>
  );
}
