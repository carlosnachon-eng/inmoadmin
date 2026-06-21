import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";
import { PageHeader, brand } from "../components/Layout";
import { usePermiso, SinAcceso } from "../lib/permisos";

const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n || 0);

const calcComision = (c) => {
  if (!c.commission_value) return 0;
  if (c.commission_type === "porcentaje") return (c.monthly_rent * c.commission_value) / 100;
  return c.commission_value;
};

const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const KpiCard = ({ label, value, sub, color = "#1a1a2e", bg = "#fff", icon }) => (
  <div style={{ background: bg, borderRadius: 14, padding: "16px 18px", border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <p style={{ margin: "0 0 6px", fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</p>
      {icon && <span style={{ fontSize: 18 }}>{icon}</span>}
    </div>
    <p style={{ margin: 0, fontSize: 26, fontWeight: 900, color }}>{value}</p>
    {sub && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca3af" }}>{sub}</p>}
  </div>
);

const SectionTitle = ({ title, icon }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "32px 0 16px" }}>
    <span style={{ fontSize: 20 }}>{icon}</span>
    <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "#1a1a2e" }}>{title}</h2>
  </div>
);

const BarChart = ({ data, colorFn, labelKey, valueKey, fmt: fmtFn }) => {
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "#6b7280", width: 32, textAlign: "right", flexShrink: 0 }}>{d[labelKey]}</span>
          <div style={{ flex: 1, background: "#f3f4f6", borderRadius: 6, height: 22, overflow: "hidden" }}>
            <div style={{ width: `${(d[valueKey] / max) * 100}%`, height: "100%", background: colorFn ? colorFn(d, i) : "#b91c3c", borderRadius: 6, minWidth: d[valueKey] > 0 ? 4 : 0, transition: "width 0.4s ease" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#374151", width: 80, textAlign: "right", flexShrink: 0 }}>{fmtFn ? fmtFn(d[valueKey]) : d[valueKey]}</span>
        </div>
      ))}
    </div>
  );
};

const DonutChart = ({ items }) => {
  const total = items.reduce((a, i) => a + i.value, 0);
  if (total === 0) return <p style={{ color: "#9ca3af", fontSize: 13 }}>Sin datos</p>;
  let offset = 0;
  const r = 40, cx = 50, cy = 50, circ = 2 * Math.PI * r;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <svg viewBox="0 0 100 100" width={100} height={100}>
        {items.map((item, i) => {
          const pct = item.value / total;
          const dash = pct * circ;
          const gap  = circ - dash;
          const el = (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={item.color} strokeWidth={18}
              strokeDasharray={`${dash} ${gap}`} strokeDashoffset={-offset * circ}
              style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }} />
          );
          offset += pct;
          return el;
        })}
        <circle cx={cx} cy={cy} r={28} fill="#fff" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={14} fontWeight={800} fill="#1a1a2e">{total}</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "#374151" }}>{item.label}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginLeft: "auto" }}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function KpisMttoAdmon() {
  const router = useRouter();
  const { cargando: permisoCargando, puedeVer } = usePermiso("kpis-mtto-admon");
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("admon");

  // Data
  const [tickets, setTickets]       = useState([]);
  const [quotes, setQuotes]         = useState([]);
  const [payments, setPayments]     = useState([]);
  const [contracts, setContracts]   = useState([]);
  const [properties, setProperties] = useState([]);
  const [ownerPayments, setOwnerPayments] = useState([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) loadProfile(s.user.id);
      else { setProfile(null); setAuthLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (uid) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).single();
    setProfile(data); setAuthLoading(false);
  };

  const loadData = async () => {
    setLoading(true);
    const [t, q, pay, c, p, op] = await Promise.all([
      supabase.from("maintenance_tickets").select("*").order("created_at", { ascending: false }),
      supabase.from("maintenance_quotes").select("*"),
      supabase.from("payments").select("*").order("due_date", { ascending: true }),
      supabase.from("contracts").select("*").order("end_date", { ascending: true }),
      supabase.from("properties").select("*").order("name"),
      supabase.from("owner_payments").select("*").order("created_at", { ascending: false }),
    ]);
    setTickets(t.data || []);
    setQuotes(q.data || []);
    setPayments(pay.data || []);
    setContracts(c.data || []);
    setProperties(p.data || []);
    setOwnerPayments(op.data || []);
    setLoading(false);
  };

  useEffect(() => { if (session) loadData(); }, [session]);

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} />
    </div>
  );
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }

  if (permisoCargando) return null;
  if (!puedeVer) return <SinAcceso />;

  const hoy = new Date();
  const mesActual = hoy.getMonth();
  const anioActual = hoy.getFullYear();

  // ── CÁLCULOS ADMINISTRACIÓN ────────────────────────────────────────────────
  const contratosActivos = contracts.filter(c => c.status === "activo");
  const totalPropiedades = properties.length;
  const ocupacion = totalPropiedades > 0 ? Math.round((contratosActivos.length / totalPropiedades) * 100) : 0;

  const pagosMes = payments.filter(p => {
    if (!p.due_date) return false;
    const d = new Date(p.due_date + "T12:00:00");
    return d.getMonth() === mesActual && d.getFullYear() === anioActual;
  });
  const cobradoMes   = pagosMes.filter(p => p.status === "pagado").reduce((a, p) => a + (p.amount || 0), 0);
  const pendienteMes = pagosMes.filter(p => p.status === "pendiente").reduce((a, p) => a + (p.amount || 0), 0);
  const atrasado     = payments.filter(p => p.status === "atrasado").reduce((a, p) => a + (p.amount || 0), 0);
  const totalMes     = cobradoMes + pendienteMes;
  const pctCobrado   = totalMes > 0 ? Math.round((cobradoMes / totalMes) * 100) : 0;

  // Contratos por vencer
  const vence30  = contratosActivos.filter(c => { const d = Math.ceil((new Date(c.end_date) - hoy) / 86400000); return d >= 0 && d <= 30; }).length;
  const vence60  = contratosActivos.filter(c => { const d = Math.ceil((new Date(c.end_date) - hoy) / 86400000); return d > 30 && d <= 60; }).length;
  const vence90  = contratosActivos.filter(c => { const d = Math.ceil((new Date(c.end_date) - hoy) / 86400000); return d > 60 && d <= 90; }).length;

  // Ingreso mensual por rentas
  const ingresoMensualRentas = contratosActivos.reduce((a, c) => a + (c.monthly_rent || 0), 0);
  const comisionMensual      = contratosActivos.reduce((a, c) => a + calcComision(c), 0);

  // Propietarios con pendiente
  const propietariosUnicos = [...new Set(properties.filter(p => p.owner_email).map(p => p.owner_email))];
  const propietariosConPendiente = propietariosUnicos.filter(email => {
    const propsProp = properties.filter(p => p.owner_email === email);
    const contratosProp = contratosActivos.filter(c => propsProp.some(p => p.name === c.property_name));
    const contractIds = contratosProp.map(c => c.id);
    const pagosPagados = payments.filter(p => contractIds.includes(p.contract_id) && p.status === "pagado" && (() => { const d = new Date(p.due_date + "T12:00:00"); return d.getMonth() === mesActual && d.getFullYear() === anioActual; })());
    const rentaTotal = pagosPagados.reduce((a, p) => a + (p.amount || 0), 0);
    const comTotal = contratosProp.filter(c => pagosPagados.some(p => p.contract_id === c.id)).reduce((a, c) => a + calcComision(c), 0);
    const liqDelMes = ownerPayments.filter(l => {
      const desc = (l.period_description || "").toLowerCase();
      const mesLabel = hoy.toLocaleDateString("es-MX", { month: "long" }).toLowerCase();
      return l.owner_email === email && desc.includes(mesLabel) && desc.includes(String(anioActual));
    });
    const pagado = liqDelMes.reduce((a, l) => a + (l.amount_paid || 0), 0);
    return (rentaTotal - comTotal - pagado) > 0;
  }).length;

  // Cobranza últimos 6 meses
  const cobranzaMeses = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(anioActual, mesActual - i, 1);
    const m = d.getMonth(); const a = d.getFullYear();
    const pagosFiltrados = payments.filter(p => {
      if (!p.due_date) return false;
      const pd = new Date(p.due_date + "T12:00:00");
      return pd.getMonth() === m && pd.getFullYear() === a;
    });
    const cobrado  = pagosFiltrados.filter(p => p.status === "pagado").reduce((a, p) => a + (p.amount || 0), 0);
    const total    = pagosFiltrados.reduce((a, p) => a + (p.amount || 0), 0);
    return { mes: MESES[m], cobrado, total, pct: total > 0 ? Math.round((cobrado / total) * 100) : 0 };
  }).reverse();

  // Contratos por vencer detalle
  const contratosVencer = contratosActivos
    .map(c => ({ ...c, dias: Math.ceil((new Date(c.end_date) - hoy) / 86400000) }))
    .filter(c => c.dias >= 0 && c.dias <= 90)
    .sort((a, b) => a.dias - b.dias);

  // ── CÁLCULOS MANTENIMIENTO ─────────────────────────────────────────────────
  const ticketsAbiertos   = tickets.filter(t => !["cerrado","cancelado"].includes(t.status));
  const ticketsCerradosMes = tickets.filter(t => {
    if (t.status !== "cerrado") return false;
    const d = new Date(t.updated_at || t.created_at);
    return d.getMonth() === mesActual && d.getFullYear() === anioActual;
  });
  const ticketsNuevos   = tickets.filter(t => t.status === "nuevo").length;
  const ticketsCotizados = tickets.filter(t => t.status === "cotizado").length;
  const ticketsAprobados = tickets.filter(t => t.status === "aprobado").length;

  // Tiempo promedio de resolución
  const cerradosConTiempo = tickets.filter(t => t.status === "cerrado" && t.created_at && t.updated_at);
  const tiempoPromedio = cerradosConTiempo.length > 0
    ? Math.round(cerradosConTiempo.reduce((a, t) => a + (new Date(t.updated_at) - new Date(t.created_at)) / 86400000, 0) / cerradosConTiempo.length)
    : null;

  // Utilidad mantenimiento este mes
  const utilidadMes = ticketsCerradosMes.reduce((a, t) => a + ((t.charged_amount || 0) - (t.provider_cost || 0)), 0);
  const costoMes    = ticketsCerradosMes.reduce((a, t) => a + (t.provider_cost || 0), 0);
  const cobradoMtto = ticketsCerradosMes.reduce((a, t) => a + (t.charged_amount || 0), 0);

  // Cotizaciones
  const cotPendientes = quotes.filter(q => q.status === "pendiente").length;
  const cotAprobadas  = quotes.filter(q => q.status === "aprobada").length;
  const cotRechazadas = quotes.filter(q => q.status === "rechazada").length;

  // Tickets por categoría
  const categorias = {};
  ticketsAbiertos.forEach(t => { const k = t.category || "otro"; categorias[k] = (categorias[k] || 0) + 1; });
  const categoriasData = Object.entries(categorias).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  // Tickets por propiedad (top 5)
  const porPropiedad = {};
  tickets.filter(t => !["cancelado"].includes(t.status)).forEach(t => {
    const k = t.property_name || "Sin propiedad";
    porPropiedad[k] = (porPropiedad[k] || 0) + 1;
  });
  const porPropiedadData = Object.entries(porPropiedad).map(([label, value]) => ({ label: label.length > 18 ? label.slice(0, 18) + "…" : label, value })).sort((a, b) => b.value - a.value).slice(0, 5);

  // Tickets últimos 6 meses
  const ticketsMeses = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(anioActual, mesActual - i, 1);
    const m = d.getMonth(); const a = d.getFullYear();
    const abiertos = tickets.filter(t => { const td = new Date(t.created_at); return td.getMonth() === m && td.getFullYear() === a; }).length;
    const cerrados = tickets.filter(t => { if (t.status !== "cerrado") return false; const td = new Date(t.updated_at || t.created_at); return td.getMonth() === m && td.getFullYear() === a; }).length;
    return { mes: MESES[m], abiertos, cerrados };
  }).reverse();

  const TABS = [
    { id: "admon", label: "🏠 Administración" },
    { id: "mtto",  label: "🔧 Mantenimiento" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      <PageHeader title="KPIs" icon="📊" />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24, background: "#fff", borderRadius: 12, padding: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", width: "fit-content" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "10px 24px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, background: tab === t.id ? "#1a1a2e" : "transparent", color: tab === t.id ? "#fff" : "#6b7280", transition: "all 0.15s" }}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 48 }}><p style={{ color: "#6b7280" }}>Cargando KPIs...</p></div>
        ) : (

          <>
            {/* ── TAB ADMINISTRACIÓN ── */}
            {tab === "admon" && (
              <div>
                <SectionTitle title="Cartera activa" icon="🏠" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 8 }}>
                  <KpiCard label="Ocupación" value={`${ocupacion}%`} sub={`${contratosActivos.length} de ${totalPropiedades} propiedades`} color={ocupacion >= 80 ? "#065f46" : ocupacion >= 60 ? "#92400e" : "#dc2626"} bg={ocupacion >= 80 ? "#f0fdf4" : "#fffbeb"} icon="🏠" />
                  <KpiCard label="Renta mensual" value={fmt(ingresoMensualRentas)} sub="Suma de todos los contratos activos" color="#1a1a2e" icon="💰" />
                  <KpiCard label="Comisión mensual" value={fmt(comisionMensual)} sub="Lo que retiene Emporio" color="#7c3aed" bg="#faf5ff" icon="💼" />
                  <KpiCard label="Propietarios con pend." value={propietariosConPendiente} sub="Con liquidación pendiente este mes" color={propietariosConPendiente > 0 ? "#b45309" : "#065f46"} bg={propietariosConPendiente > 0 ? "#fffbeb" : "#f0fdf4"} icon="👤" />
                </div>

                <SectionTitle title="Cobranza del mes" icon="💰" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
                  <KpiCard label="Cobrado" value={fmt(cobradoMes)} sub={`${pctCobrado}% del total`} color="#065f46" bg="#f0fdf4" icon="✅" />
                  <KpiCard label="Pendiente" value={fmt(pendienteMes)} sub="Por cobrar este mes" color="#92400e" bg="#fffbeb" icon="⏳" />
                  <KpiCard label="Atrasado" value={fmt(atrasado)} sub="Fuera de fecha" color={atrasado > 0 ? "#dc2626" : "#065f46"} bg={atrasado > 0 ? "#fff5f5" : "#f0fdf4"} icon="🔴" />
                  <KpiCard label="En revisión" value={payments.filter(p => p.status === "en_revision").length} sub="Comprobantes por verificar" color="#1e40af" bg="#eff6ff" icon="🔍" />
                </div>

                {/* Barra de cobranza mensual */}
                <div style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 16, border: "1px solid #f0f0f0" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "#374151" }}>Progreso de cobranza — {MESES[mesActual]}</p>
                  <p style={{ margin: "0 0 12px", fontSize: 12, color: "#9ca3af" }}>{fmt(cobradoMes)} cobrado de {fmt(totalMes)} total</p>
                  <div style={{ background: "#f3f4f6", borderRadius: 8, height: 12, overflow: "hidden" }}>
                    <div style={{ width: `${pctCobrado}%`, height: "100%", background: pctCobrado >= 80 ? "#065f46" : pctCobrado >= 50 ? "#f59e0b" : "#dc2626", borderRadius: 8, transition: "width 0.4s" }} />
                  </div>
                  <p style={{ margin: "6px 0 0", fontSize: 12, fontWeight: 700, color: pctCobrado >= 80 ? "#065f46" : "#92400e" }}>{pctCobrado}% cobrado</p>
                </div>

                {/* Histórico cobranza 6 meses */}
                <div style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 16, border: "1px solid #f0f0f0" }}>
                  <p style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, color: "#374151" }}>Cobranza últimos 6 meses</p>
                  <BarChart
                    data={cobranzaMeses}
                    labelKey="mes"
                    valueKey="cobrado"
                    fmt={fmt}
                    colorFn={(d) => d.pct >= 80 ? "#065f46" : d.pct >= 50 ? "#f59e0b" : "#dc2626"}
                  />
                  <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
                    {cobranzaMeses.map((d, i) => (
                      <div key={i} style={{ textAlign: "center" }}>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{d.mes}</p>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: d.pct >= 80 ? "#065f46" : "#92400e" }}>{d.pct}%</p>
                      </div>
                    ))}
                  </div>
                </div>

                <SectionTitle title="Contratos por vencer" icon="📋" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
                  <KpiCard label="Vencen en 30 días" value={vence30} color={vence30 > 0 ? "#dc2626" : "#065f46"} bg={vence30 > 0 ? "#fff5f5" : "#f9fafb"} icon="🔴" />
                  <KpiCard label="Vencen en 31–60 días" value={vence60} color={vence60 > 0 ? "#d97706" : "#065f46"} bg={vence60 > 0 ? "#fffbeb" : "#f9fafb"} icon="🟡" />
                  <KpiCard label="Vencen en 61–90 días" value={vence90} color={vence90 > 0 ? "#1e40af" : "#065f46"} bg="#eff6ff" icon="🟢" />
                </div>

                {contratosVencer.length > 0 && (
                  <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid #f0f0f0" }}>
                    <div style={{ padding: "12px 16px", background: "#f9fafb", borderBottom: "1px solid #f0f0f0" }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#374151" }}>Detalle contratos próximos a vencer</p>
                    </div>
                    {contratosVencer.map(c => (
                      <div key={c.id} style={{ padding: "12px 16px", borderBottom: "1px solid #f9fafb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1a1a2e" }}>{c.property_name}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>👤 {c.tenant_name} · Vence {c.end_date}</p>
                        </div>
                        <span style={{
                          fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
                          background: c.dias <= 30 ? "#fee2e2" : c.dias <= 60 ? "#fef3c7" : "#dbeafe",
                          color: c.dias <= 30 ? "#991b1b" : c.dias <= 60 ? "#92400e" : "#1e40af",
                        }}>
                          {c.dias}d
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── TAB MANTENIMIENTO ── */}
            {tab === "mtto" && (
              <div>
                <SectionTitle title="Estado actual" icon="🔧" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 8 }}>
                  <KpiCard label="Tickets abiertos" value={ticketsAbiertos.length} color={ticketsAbiertos.length > 5 ? "#dc2626" : "#1e40af"} bg="#eff6ff" icon="📋" />
                  <KpiCard label="Sin atender" value={ticketsNuevos} sub="Status: Nuevo" color={ticketsNuevos > 0 ? "#dc2626" : "#065f46"} bg={ticketsNuevos > 0 ? "#fff5f5" : "#f0fdf4"} icon="🆕" />
                  <KpiCard label="Por aprobar" value={ticketsCotizados} sub="Cotización enviada" color={ticketsCotizados > 0 ? "#7c3aed" : "#065f46"} bg="#faf5ff" icon="🔍" />
                  <KpiCard label="Aprobados" value={ticketsAprobados} sub="Listos para ejecutar" color="#065f46" bg="#f0fdf4" icon="✅" />
                  <KpiCard label="Cerrados este mes" value={ticketsCerradosMes.length} color="#065f46" bg="#f0fdf4" icon="⭐" />
                  {tiempoPromedio !== null && (
                    <KpiCard label="Tiempo promedio" value={`${tiempoPromedio}d`} sub="Promedio de resolución" color="#1e40af" bg="#eff6ff" icon="⏱️" />
                  )}
                </div>

                <SectionTitle title="Finanzas del mes" icon="💰" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
                  <KpiCard label="Cobrado a clientes" value={fmt(cobradoMtto)} sub="Lo que pagaron" color="#065f46" bg="#f0fdf4" icon="📥" />
                  <KpiCard label="Costo proveedores" value={fmt(costoMes)} sub="Lo que pagamos" color="#dc2626" bg="#fff5f5" icon="📤" />
                  <KpiCard label="Utilidad" value={fmt(utilidadMes)} sub="Ganancia neta" color={utilidadMes > 0 ? "#7c3aed" : "#dc2626"} bg={utilidadMes > 0 ? "#faf5ff" : "#fff5f5"} icon="💜" />
                  {cobradoMtto > 0 && (
                    <KpiCard label="Margen" value={`${Math.round((utilidadMes / cobradoMtto) * 100)}%`} sub="Sobre lo cobrado" color="#7c3aed" bg="#faf5ff" icon="📊" />
                  )}
                </div>

                <SectionTitle title="Cotizaciones" icon="📋" />
                <div style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 16, border: "1px solid #f0f0f0" }}>
                  <DonutChart items={[
                    { label: "Pendientes", value: cotPendientes, color: "#f59e0b" },
                    { label: "Aprobadas",  value: cotAprobadas,  color: "#065f46" },
                    { label: "Rechazadas", value: cotRechazadas, color: "#dc2626" },
                  ]} />
                  {quotes.length > 0 && (
                    <p style={{ margin: "12px 0 0", fontSize: 12, color: "#9ca3af" }}>
                      Tasa de aprobación: <strong style={{ color: "#065f46" }}>{quotes.length > 0 ? Math.round((cotAprobadas / quotes.length) * 100) : 0}%</strong>
                    </p>
                  )}
                </div>

                {/* Tickets últimos 6 meses */}
                <SectionTitle title="Volumen últimos 6 meses" icon="📅" />
                <div style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 16, border: "1px solid #f0f0f0" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {ticketsMeses.map((d, i) => (
                      <div key={i}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{d.mes}</span>
                          <span style={{ fontSize: 12, color: "#9ca3af" }}>{d.abiertos} abiertos · {d.cerrados} cerrados</span>
                        </div>
                        <div style={{ display: "flex", gap: 4, height: 8 }}>
                          <div style={{ flex: d.abiertos, background: "#b91c3c", borderRadius: 4, minWidth: d.abiertos > 0 ? 4 : 0 }} />
                          <div style={{ flex: d.cerrados, background: "#065f46", borderRadius: 4, minWidth: d.cerrados > 0 ? 4 : 0 }} />
                          <div style={{ flex: Math.max(0, 10 - d.abiertos - d.cerrados), background: "#f3f4f6", borderRadius: 4 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, background: "#b91c3c", borderRadius: 3 }} /><span style={{ fontSize: 11, color: "#6b7280" }}>Abiertos</span></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, background: "#065f46", borderRadius: 3 }} /><span style={{ fontSize: 11, color: "#6b7280" }}>Cerrados</span></div>
                  </div>
                </div>

                {/* Por categoría */}
                {categoriasData.length > 0 && (
                  <>
                    <SectionTitle title="Tickets abiertos por categoría" icon="🏷️" />
                    <div style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 16, border: "1px solid #f0f0f0" }}>
                      <BarChart
                        data={categoriasData}
                        labelKey="label"
                        valueKey="value"
                        colorFn={(_, i) => ["#b91c3c","#7c3aed","#1e40af","#065f46","#d97706"][i % 5]}
                      />
                    </div>
                  </>
                )}

                {/* Por propiedad */}
                {porPropiedadData.length > 0 && (
                  <>
                    <SectionTitle title="Top 5 propiedades con más tickets" icon="🏠" />
                    <div style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 16, border: "1px solid #f0f0f0" }}>
                      <BarChart
                        data={porPropiedadData}
                        labelKey="label"
                        valueKey="value"
                        colorFn={(d, i) => d.value >= 3 ? "#dc2626" : d.value === 2 ? "#d97706" : "#065f46"}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
