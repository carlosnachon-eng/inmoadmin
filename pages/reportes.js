import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";
import { PageHeader, brand } from "../components/Layout";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const calcComision = (contrato) => {
  if (!contrato.commission_value) return 0;
  if (contrato.commission_type === "porcentaje") return (contrato.monthly_rent * contrato.commission_value) / 100;
  return contrato.commission_value;
};

const Btn = ({ children, onClick, color = "#1a1a2e", disabled, small }) => (
  <button onClick={onClick} disabled={disabled} style={{
    background: color, color: "#fff", border: "none",
    borderRadius: small ? 6 : 10, padding: small ? "5px 10px" : "11px 20px",
    fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
    fontSize: small ? 12 : 14, opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap"
  }}>
    {children}
  </button>
);

export default function Reportes() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [properties, setProperties] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [cashMovements, setCashMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [anio] = useState(new Date().getFullYear());

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (!session) { setAuthLoading(false); }
      else setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  const loadData = async () => {
    setLoading(true);
    const [pay, c, p, t, cm] = await Promise.all([
      supabase.from("payments").select("*").order("due_date", { ascending: true }),
      supabase.from("contracts").select("*").order("created_at", { ascending: false }),
      supabase.from("properties").select("*").order("name"),
      supabase.from("maintenance_tickets").select("*").order("created_at", { ascending: false }),
      supabase.from("cash_movements").select("*").order("date", { ascending: false }),
    ]);
    setPayments(pay.data || []);
    setContracts(c.data || []);
    setProperties(p.data || []);
    setTickets(t.data || []);
    setCashMovements(cm.data || []);
    setLoading(false);
  };

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} />
    </div>
  );

  if (!session) {
    if (typeof window !== "undefined") window.location.href = "/";
    return null;
  }

  // ── CÁLCULOS ──────────────────────────────────────────────────────────────
  const meses = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  const cobrosPorMes = Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    const pm = payments.filter(p => p.period_month === mes && p.period_year === anio);
    const cobrado = pm.filter(p => p.status === "pagado").reduce((a, p) => a + (p.amount || 0), 0);
    const total   = pm.reduce((a, p) => a + (p.amount || 0), 0);
    const pct     = total > 0 ? Math.round((cobrado / total) * 100) : 0;
    return { mes: meses[i], cobrado, total, pct, count: pm.length };
  });

  const estadoPorPropiedad = properties.map(prop => {
    const pp       = payments.filter(p => p.property_name === prop.name);
    const cobrado  = pp.filter(p => p.status === "pagado").reduce((a, p) => a + (p.amount || 0), 0);
    const pendiente= pp.filter(p => p.status === "pendiente").reduce((a, p) => a + (p.amount || 0), 0);
    const atrasado = pp.filter(p => p.status === "atrasado").reduce((a, p) => a + (p.amount || 0), 0);
    const contrato = contracts.find(c => c.property_name === prop.name && c.status === "activo");
    const comision = contrato ? calcComision(contrato) : 0;
    return { prop, cobrado, pendiente, atrasado, comision };
  });

  const totalEntradas = cashMovements.filter(m => m.type === "entrada").reduce((a, m) => a + (m.amount || 0), 0);
  const totalSalidas  = cashMovements.filter(m => m.type === "salida").reduce((a, m) => a + (m.amount || 0), 0);
  const saldo         = totalEntradas - totalSalidas;

  const totalComisiones = contracts.filter(c => c.status === "activo").reduce((a, c) => a + calcComision(c), 0);

  const ticketsAbiertos  = tickets.filter(t => !["cerrado","cancelado","resuelto"].includes(t.status)).length;
  const ticketsCerrados  = tickets.filter(t => ["cerrado","resuelto"].includes(t.status)).length;
  const utilidadMant     = tickets.reduce((a, t) => a + ((t.charged_amount || 0) - (t.provider_cost || 0)), 0);

  const contrVencen30 = contracts.filter(c => {
    const dias = Math.ceil((new Date(c.end_date) - new Date()) / (1000 * 60 * 60 * 24));
    return dias >= 0 && dias <= 30;
  });

  const hoy = new Date();
  const pagosMes = payments.filter(p => {
    if (!p.due_date) return false;
    const d = new Date(p.due_date);
    return d.getMonth() === hoy.getMonth() && d.getFullYear() === hoy.getFullYear();
  });
  const cobradoMes  = pagosMes.filter(p => p.status === "pagado").reduce((a, p) => a + (p.amount || 0), 0);
  const pendienteMes= pagosMes.filter(p => p.status === "pendiente").reduce((a, p) => a + (p.amount || 0), 0);
  const atrasadoMes = pagosMes.filter(p => p.status === "atrasado").reduce((a, p) => a + (p.amount || 0), 0);
  const pctCobroMes = (cobradoMes + pendienteMes + atrasadoMes) > 0
    ? Math.round((cobradoMes / (cobradoMes + pendienteMes + atrasadoMes)) * 100) : 0;

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      <PageHeader title="Reportes" icon="📈"  />


      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 60 }}><p style={{ color: "#6b7280" }}>Cargando...</p></div>
        ) : (
          <>
            {/* ── RESUMEN GENERAL ── */}
            <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>Resumen general</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 28 }}>
              {[
                { label: "Saldo caja",        value: fmt(saldo),            color: saldo >= 0 ? "#065f46" : "#dc2626", bg: saldo >= 0 ? "#f0fdf4" : "#fff5f5" },
                { label: "Entradas total",     value: fmt(totalEntradas),    color: "#065f46", bg: "#f0fdf4" },
                { label: "Salidas total",      value: fmt(totalSalidas),     color: "#dc2626", bg: "#fff5f5" },
                { label: "Comisiones/mes",     value: fmt(totalComisiones),  color: "#7c3aed", bg: "#faf5ff" },
                { label: "Cobrado este mes",   value: fmt(cobradoMes),       color: "#065f46", bg: "#f0fdf4" },
                { label: "Pendiente este mes", value: fmt(pendienteMes),     color: "#92400e", bg: "#fffbeb" },
                { label: "Atrasado este mes",  value: fmt(atrasadoMes),      color: "#dc2626", bg: "#fff5f5" },
                { label: "% cobro este mes",   value: `${pctCobroMes}%`,     color: pctCobroMes >= 80 ? "#065f46" : pctCobroMes >= 50 ? "#d97706" : "#dc2626", bg: "#f9fafb" },
              ].map((s, i) => (
                <div key={i} style={{ background: s.bg, borderRadius: 14, padding: "14px 16px" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 10, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
                  <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* ── ALERTAS ── */}
            {contrVencen30.length > 0 && (
              <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 12, padding: "14px 18px", marginBottom: 20 }}>
                <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 800, color: "#c2410c" }}>⚠️ {contrVencen30.length} contrato{contrVencen30.length > 1 ? "s" : ""} vence{contrVencen30.length === 1 ? "" : "n"} en los próximos 30 días</p>
                {contrVencen30.map(c => {
                  const dias = Math.ceil((new Date(c.end_date) - new Date()) / (1000 * 60 * 60 * 24));
                  return (
                    <p key={c.id} style={{ margin: "2px 0", fontSize: 12, color: "#92400e" }}>
                      · {c.tenant_name} — {c.property_name} — vence en {dias} día{dias !== 1 ? "s" : ""} ({c.end_date})
                    </p>
                  );
                })}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>

              {/* ── COBROS POR MES ── */}
              <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 800, color: "#1a1a2e" }}>Cobros por mes — {anio}</h3>
                {cobrosPorMes.filter(m => m.total > 0).map((m, i) => (
                  <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#374151", width: 28 }}>{m.mes}</span>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "#065f46", fontWeight: 700 }}>{fmt(m.cobrado)}</span>
                        <span style={{ fontSize: 11, color: "#9ca3af" }}>/ {fmt(m.total)}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: m.pct >= 80 ? "#065f46" : m.pct >= 50 ? "#d97706" : "#dc2626" }}>{m.pct}%</span>
                      </div>
                    </div>
                    <div style={{ background: "#f3f4f6", borderRadius: 4, height: 6 }}>
                      <div style={{ width: `${m.pct}%`, height: "100%", background: m.pct >= 80 ? "#c8a96e" : m.pct >= 50 ? "#fbbf24" : "#f87171", borderRadius: 4, transition: "width 0.5s ease" }} />
                    </div>
                  </div>
                ))}
                {cobrosPorMes.every(m => m.total === 0) && <p style={{ color: "#9ca3af", fontSize: 13 }}>Sin datos aún</p>}
              </div>

              {/* ── ESTADO POR PROPIEDAD ── */}
              <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 800, color: "#1a1a2e" }}>Estado por propiedad</h3>
                {estadoPorPropiedad.map(({ prop, cobrado, pendiente, atrasado, comision }) => (
                  <div key={prop.id} style={{ padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
                    <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 13, color: "#1a1a2e" }}>{prop.name}</p>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {cobrado > 0 && <span style={{ fontSize: 11, color: "#065f46", background: "#d1fae5", padding: "2px 8px", borderRadius: 6 }}>Cobrado: {fmt(cobrado)}</span>}
                      {pendiente > 0 && <span style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", padding: "2px 8px", borderRadius: 6 }}>Pendiente: {fmt(pendiente)}</span>}
                      {atrasado > 0 && <span style={{ fontSize: 11, color: "#991b1b", background: "#fee2e2", padding: "2px 8px", borderRadius: 6 }}>Atrasado: {fmt(atrasado)}</span>}
                      {comision > 0 && <span style={{ fontSize: 11, color: "#7c3aed", background: "#ede9fe", padding: "2px 8px", borderRadius: 6 }}>Comisión: {fmt(comision)}/mes</span>}
                      {cobrado === 0 && pendiente === 0 && atrasado === 0 && <span style={{ fontSize: 11, color: "#9ca3af" }}>Sin cobros</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>

              {/* ── MANTENIMIENTO ── */}
              <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 800, color: "#1a1a2e" }}>Mantenimiento</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
                  {[
                    { label: "Abiertos", value: ticketsAbiertos, color: "#1e40af" },
                    { label: "Cerrados", value: ticketsCerrados, color: "#065f46" },
                    { label: "Utilidad",  value: fmt(utilidadMant), color: "#7c3aed" },
                  ].map((s, i) => (
                    <div key={i} style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                      <p style={{ margin: "0 0 4px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>{s.label}</p>
                      <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</p>
                    </div>
                  ))}
                </div>
                {tickets.filter(t => !["cerrado","cancelado","resuelto"].includes(t.status)).slice(0, 5).map(t => (
                  <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f9fafb" }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#374151" }}>{t.title}</p>
                      <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{t.property_name}</p>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: t.priority === "urgente" ? "#dc2626" : t.priority === "alta" ? "#d97706" : "#6b7280" }}>
                      {t.priority}
                    </span>
                  </div>
                ))}
              </div>

              {/* ── CONTRATOS ── */}
              <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 800, color: "#1a1a2e" }}>Contratos activos ({contracts.filter(c => c.status === "activo").length})</h3>
                {contracts.filter(c => c.status === "activo").map(c => {
                  const dias = Math.ceil((new Date(c.end_date) - new Date()) / (1000 * 60 * 60 * 24));
                  const comision = calcComision(c);
                  return (
                    <div key={c.id} style={{ padding: "8px 0", borderBottom: "1px solid #f9fafb" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#1a1a2e" }}>{c.tenant_name}</p>
                          <p style={{ margin: "1px 0 0", fontSize: 11, color: "#9ca3af" }}>{c.property_name}</p>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#1a1a2e" }}>{fmt(c.monthly_rent)}</p>
                          <p style={{ margin: "1px 0 0", fontSize: 11, fontWeight: 700, color: dias <= 30 ? "#dc2626" : dias <= 60 ? "#d97706" : "#9ca3af" }}>
                            {dias}d restantes
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {contracts.filter(c => c.status === "activo").length === 0 && (
                  <p style={{ color: "#9ca3af", fontSize: 13 }}>Sin contratos activos</p>
                )}
              </div>
            </div>

            {/* ── ÚLTIMOS MOVIMIENTOS CAJA ── */}
            <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 800, color: "#1a1a2e" }}>Últimos movimientos de caja</h3>
              {cashMovements.slice(0, 10).map(m => (
                <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f9fafb" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.description}</p>
                    <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{m.date} · {m.payment_method}</p>
                  </div>
                  <span style={{ fontWeight: 800, fontSize: 13, color: m.type === "entrada" ? "#065f46" : "#dc2626", marginLeft: 12, whiteSpace: "nowrap" }}>
                    {m.type === "entrada" ? "+" : "-"}{fmt(m.amount)}
                  </span>
                </div>
              ))}
              {cashMovements.length === 0 && <p style={{ color: "#9ca3af", fontSize: 13 }}>Sin movimientos</p>}
            </div>

          </>
        )}
      </div>
    </div>
  );
}
