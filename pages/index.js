import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import Layout, { brand, nav } from "../components/Layout";
import { useModulosPermitidos } from "../lib/permisos";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
}).format(Number(n) || 0);

const inicioMes = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
};

const finMes = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString();
};

const Field = ({ label, hint, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>{label}</label>
    {hint && <p style={{ margin: "0 0 4px", fontSize: 11, color: "#9ca3af" }}>{hint}</p>}
    {children}
  </div>
);

const Input = (props) => (
  <input {...props} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", ...props.style }} />
);

const LoginScreen = ({ onLogin }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    setLoading(true);
    setError("");
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (loginError) setError("Email o contraseña incorrectos");
    else onLogin();
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 40, width: "100%", maxWidth: 400, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio Inmobiliario" style={{ height: 64, objectFit: "contain", marginBottom: 12 }} />
          <p style={{ margin: 0, fontSize: 13, color: brand.grayLight, fontWeight: 500 }}>Sistema de Gestión Interno</p>
        </div>
        {error && <div style={{ background: "#fee2e2", color: "#991b1b", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 14, fontWeight: 600 }}>{error}</div>}
        <Field label="Email"><Input type="email" placeholder="tu@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} /></Field>
        <Field label="Contraseña"><Input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} /></Field>
        <button onClick={handleLogin} disabled={loading || !email || !password} style={{ width: "100%", background: brand.red, color: "#fff", border: "none", borderRadius: 10, padding: 14, fontWeight: 800, cursor: loading ? "not-allowed" : "pointer", fontSize: 16, marginTop: 8, opacity: loading ? 0.7 : 1 }}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </div>
    </div>
  );
};

const MetricCard = ({ icon, label, value, detail, tone = "neutral", pending, locked }) => {
  const tones = {
    green: { color: "#065f46", bg: "#ecfdf5", border: "#a7f3d0" },
    red: { color: "#991b1b", bg: "#fef2f2", border: "#fecaca" },
    amber: { color: "#92400e", bg: "#fffbeb", border: "#fde68a" },
    blue: { color: "#1e40af", bg: "#eff6ff", border: "#bfdbfe" },
    purple: { color: "#6d28d9", bg: "#f5f3ff", border: "#ddd6fe" },
    neutral: { color: "#374151", bg: "#f9fafb", border: "#e5e7eb" },
  };
  const t = tones[tone] || tones.neutral;

  return (
    <div style={{ background: "#fff", border: `1px solid ${locked ? "#e5e7eb" : t.border}`, borderRadius: 14, padding: 18, minHeight: 118, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</p>
          <p style={{ margin: 0, fontSize: pending || locked ? 14 : 25, lineHeight: 1.1, fontWeight: 900, color: locked ? "#9ca3af" : t.color }}>
            {locked ? "Solo dirección" : pending ? "Pendiente de conectar" : value}
          </p>
        </div>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: locked ? "#f3f4f6" : t.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, flexShrink: 0 }}>
          {locked ? "🔒" : icon}
        </div>
      </div>
      <p style={{ margin: "9px 0 0", fontSize: 11, color: "#9ca3af", lineHeight: 1.4 }}>
        {locked ? "Tu perfil solo muestra actividad propia." : pending ? "La consulta no está disponible con el esquema o permisos actuales." : detail}
      </p>
    </div>
  );
};

const Ranking = ({ title, icon, rows, empty, pending }) => (
  <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 18, boxShadow: "0 1px 3px rgba(0,0,0,0.04)", minHeight: 210 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
      <span style={{ fontSize: 20 }}>{icon}</span>
      <h3 style={{ margin: 0, fontSize: 14, color: brand.gray }}>{title}</h3>
    </div>
    {pending ? (
      <p style={{ padding: "30px 0", textAlign: "center", fontSize: 13, color: "#9ca3af" }}>Pendiente de conectar</p>
    ) : rows.length === 0 ? (
      <p style={{ padding: "30px 0", textAlign: "center", fontSize: 13, color: "#9ca3af" }}>{empty}</p>
    ) : rows.map((row, index) => (
      <div key={row.id || row.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: index ? "1px solid #f3f4f6" : "none" }}>
        <div style={{ width: 24, height: 24, borderRadius: 8, background: index === 0 ? brand.redLight : "#f3f4f6", color: index === 0 ? brand.red : "#6b7280", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900 }}>
          {index + 1}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</p>
          {row.detail && <p style={{ margin: "2px 0 0", fontSize: 10, color: "#9ca3af" }}>{row.detail}</p>}
        </div>
        <span style={{ fontSize: 13, fontWeight: 800, color: brand.red }}>{row.value}</span>
      </div>
    ))}
  </div>
);

const ModuleSummary = ({ href, icon, title, stats, pending }) => (
  <a href={href} style={{ textDecoration: "none", color: "inherit" }}>
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 18, boxShadow: "0 1px 3px rgba(0,0,0,0.04)", height: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 22 }}>{icon}</span>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: brand.gray }}>{title}</h3>
        </div>
        <span style={{ color: brand.red, fontSize: 12, fontWeight: 800 }}>Ver módulo →</span>
      </div>
      {pending ? (
        <p style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "#9ca3af" }}>Pendiente de conectar</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))`, gap: 8 }}>
          {stats.map(stat => (
            <div key={stat.label} style={{ background: stat.bg || "#f9fafb", borderRadius: 10, padding: "11px 9px", minWidth: 0 }}>
              <p style={{ margin: "0 0 4px", fontSize: 9, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", lineHeight: 1.25 }}>{stat.label}</p>
              <p style={{ margin: 0, fontSize: stat.compact ? 16 : 20, fontWeight: 900, color: stat.color || "#374151", overflow: "hidden", textOverflow: "ellipsis" }}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  </a>
);

const LoadingDashboard = () => (
  <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 32, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
    Cargando indicadores de Emporio...
  </div>
);

export default function Home() {
  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboard, setDashboard] = useState(null);
  const { cargando: permisosCargando, modulosPermitidos, esAdmin, perfil } = useModulosPermitidos();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setCheckingSession(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || permisosCargando || !perfil?.id || !esAdmin) {
      setDashboardLoading(false);
      return;
    }
    let activo = true;

    const cargarDashboard = async () => {
      setDashboardLoading(true);
      const ahora = new Date();
      const ahoraIso = ahora.toISOString();
      const mesInicio = inicioMes();
      const mesFin = finMes();
      const en30Dias = new Date(ahora.getTime() + 30 * 86400000).toISOString();
      const en7Dias = new Date(ahora.getTime() + 7 * 86400000).toISOString();
      const errores = {};

      const safe = async (key, query) => {
        const result = await query;
        if (result.error) errores[key] = true;
        return result.data || [];
      };

      const citasBase = supabase
        .from("citas")
        .select("id, fecha_hora, estado, asesor_id, propiedad_id, profiles:asesor_id(full_name, email), propiedades(titulo)")
        .gte("fecha_hora", mesInicio)
        .lt("fecha_hora", mesFin);

      const enviosBase = supabase
        .from("envios")
        .select("id, asesor_id, created_at, profiles:asesor_id(full_name, email)")
        .gte("created_at", mesInicio)
        .lt("created_at", mesFin);

      const consultas = [
        safe("comisiones", supabase.from("comisiones_admin").select("monto, fecha_cobro").eq("status", "cobrada").gte("fecha_cobro", mesInicio.slice(0, 10)).lt("fecha_cobro", mesFin.slice(0, 10))),
        safe("payments", supabase.from("payments").select("amount, status, due_date")),
        safe("maintenance", supabase.from("maintenance_tickets").select("id, status").not("status", "in", '("cerrado","cancelado","resuelto")')),
        safe("renewals", supabase.from("contracts").select("id, end_date").eq("status", "activo").gte("end_date", ahoraIso.slice(0, 10)).lte("end_date", en30Dias.slice(0, 10))),
        safe("upcoming", (() => {
          return supabase.from("citas").select("id, fecha_hora").eq("estado", "agendada").gte("fecha_hora", ahoraIso).lte("fecha_hora", en7Dias);
        })()),
        safe("overdue", (() => {
          return supabase.from("citas").select("id, fecha_hora").eq("estado", "agendada").lt("fecha_hora", ahoraIso);
        })()),
        safe("monthAppointments", citasBase),
        safe("monthSends", enviosBase),
        safe("sendProperties", supabase.from("envios_propiedades").select("envio_id, propiedad_id")),
        safe("properties", supabase.from("propiedades").select("id, titulo, direccion")),
        safe("visits", supabase.from("visitas_propiedad").select("id, propiedad_id, created_at").gte("created_at", mesInicio).lt("created_at", mesFin)),
        safe("contacts", supabase.from("solicitudes_contacto_propiedad").select("id, propiedad_id, created_at").gte("created_at", mesInicio).lt("created_at", mesFin)),
        safe("closings", supabase.from("cierres").select("id, anio, mes, comision, pendiente")),
        safe("closingPayments", supabase.from("cierre_pagos").select("id, monto, fecha").gte("fecha", mesInicio.slice(0, 10)).lt("fecha", mesFin.slice(0, 10))),
        safe("policies", supabase.from("poliza_expedientes").select("id, status, fecha_vigencia")),
        safe("policyRequests", supabase.from("solicitudes_inquilino").select("id, status")),
        safe("policyCash", supabase.from("poliza_caja").select("id, fecha, monto, tipo").eq("tipo", "ingreso").gte("fecha", mesInicio.slice(0, 10)).lt("fecha", mesFin.slice(0, 10))),
        safe("signatures", supabase.from("firmas").select("id, status, updated_at, firma_etapas(status)")),
        safe("signatureAppointments", supabase.from("firmas_citas").select("id, fecha").gte("fecha", ahoraIso.slice(0, 10)).lte("fecha", en7Dias.slice(0, 10))),
      ];

      const [
        comisiones,
        payments,
        maintenance,
        renewals,
        upcoming,
        overdue,
        monthAppointments,
        monthSends,
        sendProperties,
        properties,
        visits,
        contacts,
        closings,
        closingPayments,
        policies,
        policyRequests,
        policyCash,
        signatures,
        signatureAppointments,
      ] = await Promise.all(consultas);

      // Las cifras de cobranza replican exactamente las reglas de pages/cobranza.js.
      const hoyLocal = new Date();
      const paymentsMonth = payments.filter(p => {
        if (!p.due_date) return false;
        const d = new Date(p.due_date + "T12:00:00");
        return d.getMonth() === hoyLocal.getMonth() && d.getFullYear() === hoyLocal.getFullYear();
      });
      const pendingMonth = paymentsMonth.filter(p => p.status === "pendiente");
      const overdueAll = payments.filter(p => p.status === "atrasado");

      const currentYear = hoyLocal.getFullYear();
      const currentMonth = hoyLocal.getMonth() + 1;
      const closingsMonth = closings.filter(c => c.anio === currentYear && c.mes === currentMonth);
      const closingGenerated = closingsMonth.reduce((sum, c) => sum + (Number(c.comision) || 0), 0);
      const closingCollected = closingPayments.reduce((sum, p) => sum + (Number(p.monto) || 0), 0);
      const closingPending = closings.reduce((sum, c) => sum + (Number(c.pendiente) || 0), 0);

      const policiesActive = policies.filter(p => p.status === "activo").length;
      const policiesExpired = policies.filter(p => p.status === "vencido").length;
      const policiesExpiring = policies.filter(p => {
        if (!p.fecha_vigencia) return false;
        const days = Math.ceil((new Date(p.fecha_vigencia + "T12:00:00") - hoyLocal) / 86400000);
        return days >= 0 && days <= 60;
      }).length;
      const policyPendingRequests = policyRequests.filter(r => r.status === "pendiente").length;
      const policyIncome = policyCash.reduce((sum, p) => sum + (Number(p.monto) || 0), 0);

      const signaturesActive = signatures.filter(f => f.status === "activo");
      const signaturesStalled = signaturesActive.filter(f => {
        const currentStage = (f.firma_etapas || []).find(e => e.status === "pendiente" || e.status === "en_proceso");
        if (!currentStage || !f.updated_at) return false;
        return (Date.now() - new Date(f.updated_at).getTime()) / 3600000 > 24;
      }).length;

      const sendIds = new Set(monthSends.map(e => e.id));
      const relevantSendProperties = sendProperties.filter(ep => sendIds.has(ep.envio_id));
      const propertyMap = Object.fromEntries(properties.map(p => [p.id, p]));
      const propertyActivity = {};
      const addPropertyActivity = (propertyId, type) => {
        if (!propertyId) return;
        if (!propertyActivity[propertyId]) propertyActivity[propertyId] = { total: 0, citas: 0, envios: 0, visitas: 0, contactos: 0 };
        propertyActivity[propertyId].total += 1;
        propertyActivity[propertyId][type] += 1;
      };

      monthAppointments.forEach(c => addPropertyActivity(c.propiedad_id, "citas"));
      relevantSendProperties.forEach(e => addPropertyActivity(e.propiedad_id, "envios"));
      visits.forEach(v => addPropertyActivity(v.propiedad_id, "visitas"));
      contacts.forEach(c => addPropertyActivity(c.propiedad_id, "contactos"));

      const propiedadesRanking = Object.entries(propertyActivity)
        .map(([id, activity]) => {
          const p = propertyMap[id];
          return {
            id,
            label: p?.titulo || p?.direccion || "Propiedad sin nombre",
            value: `${activity.total} acciones`,
            detail: [
              activity.visitas && `${activity.visitas} visitas`,
              activity.contactos && `${activity.contactos} contactos`,
              activity.citas && `${activity.citas} citas`,
              activity.envios && `${activity.envios} envíos`,
            ].filter(Boolean).join(" · "),
            total: activity.total,
          };
        })
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      const advisorActivity = {};
      const addAdvisorActivity = (row, type) => {
        const id = row.asesor_id;
        if (!id) return;
        if (!advisorActivity[id]) {
          advisorActivity[id] = {
            label: row.profiles?.full_name || row.profiles?.email || (id === perfil.id ? perfil.full_name || perfil.email : "Asesor"),
            citas: 0,
            envios: 0,
          };
        }
        advisorActivity[id][type] += 1;
      };
      monthAppointments.forEach(c => addAdvisorActivity(c, "citas"));
      monthSends.forEach(e => addAdvisorActivity(e, "envios"));

      const asesoresRanking = Object.entries(advisorActivity)
        .map(([id, activity]) => ({
          id,
          label: activity.label,
          value: `${activity.citas + activity.envios} acciones`,
          detail: `${activity.citas} citas · ${activity.envios} envíos`,
          total: activity.citas + activity.envios,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      if (!activo) return;
      setDashboard({
        comision: comisiones.reduce((sum, c) => sum + (Number(c.monto) || 0), 0),
        pendienteMesMonto: pendingMonth.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
        pendienteMesCantidad: pendingMonth.length,
        atrasadoMonto: overdueAll.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
        atrasadoCantidad: overdueAll.length,
        mantenimientos: maintenance.length,
        renovaciones: renewals.length,
        citasProximas: upcoming.length,
        citasVencidas: overdue.length,
        cierres: {
          generados: closingGenerated,
          cobrados: closingCollected,
          pendientes: closingPending,
          cantidad: closingsMonth.length,
        },
        polizas: {
          activas: policiesActive,
          porVencer: policiesExpiring,
          vencidas: policiesExpired,
          solicitudesPendientes: policyPendingRequests,
          ingresoMes: policyIncome,
        },
        firmas: {
          activas: signaturesActive.length,
          detenidas: signaturesStalled,
          citasProximas: signatureAppointments.length,
        },
        propiedadesRanking,
        asesoresRanking,
        errores,
      });
      setDashboardLoading(false);
    };

    cargarDashboard();
    return () => { activo = false; };
  }, [session, permisosCargando, perfil?.id, esAdmin]);

  const logout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  if (checkingSession || (session && permisosCargando)) {
    return (
      <div style={{ minHeight: "100vh", background: "#f4f5f7", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 60, opacity: 0.5 }} />
      </div>
    );
  }

  if (!session) return <LoginScreen onLogin={() => {}} />;

  const navConModulo = nav.filter(n => n.modulo);
  const navAccesible = esAdmin ? navConModulo : navConModulo.filter(n => modulosPermitidos.includes(n.modulo));
  const nombre = perfil?.full_name || perfil?.email?.split("@")[0] || "";
  const horaDelDia = new Date().getHours();
  const saludo = horaDelDia < 12 ? "Buenos días" : horaDelDia < 19 ? "Buenas tardes" : "Buenas noches";
  const errores = dashboard?.errores || {};

  return (
    <Layout
      view="bienvenida"
      profile={perfil}
      onLogout={logout}
      modulosPermitidos={modulosPermitidos}
      esAdmin={esAdmin}
      permisosCargando={permisosCargando}
    >
      <div style={{ padding: "28px 22px 40px", maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: 25, fontWeight: 900, color: brand.gray }}>
              {saludo}{nombre ? `, ${nombre}` : ""}
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: brand.grayLight }}>
              {new Date().toLocaleDateString("es-MX", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
          {esAdmin && (
            <div style={{ background: brand.redLight, color: brand.red, padding: "7px 12px", borderRadius: 99, fontSize: 11, fontWeight: 800 }}>
              Vista de dirección
            </div>
          )}
        </div>

        {esAdmin && <section style={{ marginBottom: 34 }}>
          <div style={{ marginBottom: 14 }}>
            <p style={{ margin: "0 0 3px", fontSize: 11, fontWeight: 900, color: brand.red, textTransform: "uppercase", letterSpacing: 1 }}>Panel de Dirección</p>
            <h3 style={{ margin: 0, fontSize: 18, color: brand.gray }}>Emporio de un vistazo</h3>
          </div>

          {dashboardLoading || !dashboard ? <LoadingDashboard /> : (
            <>
              <div style={{ marginBottom: 18 }}>
                <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 900, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.8 }}>Prioridades del negocio</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 12 }}>
                  <ModuleSummary
                    href="/cierres"
                    icon="🏠"
                    title="Cierres"
                    pending={errores.closings || errores.closingPayments}
                    stats={[
                      { label: "Generado mes", value: fmt(dashboard.cierres.generados), compact: true },
                      { label: "Cobrado mes", value: fmt(dashboard.cierres.cobrados), color: "#065f46", bg: "#f0fdf4", compact: true },
                      { label: "Por cobrar global", value: fmt(dashboard.cierres.pendientes), color: dashboard.cierres.pendientes ? "#dc2626" : "#065f46", bg: dashboard.cierres.pendientes ? "#fff5f5" : "#f0fdf4", compact: true },
                    ]}
                  />
                  <ModuleSummary
                    href="/poliza"
                    icon="⚖️"
                    title="Pólizas"
                    pending={errores.policies || errores.policyRequests || errores.policyCash}
                    stats={[
                      { label: "Activas", value: dashboard.polizas.activas, color: "#065f46", bg: "#f0fdf4" },
                      { label: "Por vencer 60 días", value: dashboard.polizas.porVencer, color: dashboard.polizas.porVencer ? "#92400e" : "#065f46", bg: dashboard.polizas.porVencer ? "#fffbeb" : "#f0fdf4" },
                      { label: "Ingreso del mes", value: fmt(dashboard.polizas.ingresoMes), color: "#7c3aed", bg: "#faf5ff", compact: true },
                    ]}
                  />
                  <ModuleSummary
                    href="/firmas"
                    icon="📝"
                    title="Firmas"
                    pending={errores.signatures || errores.signatureAppointments}
                    stats={[
                      { label: "En proceso", value: dashboard.firmas.activas, color: "#1e40af", bg: "#eff6ff" },
                      { label: "Sin movimiento +24 h", value: dashboard.firmas.detenidas, color: dashboard.firmas.detenidas ? "#dc2626" : "#065f46", bg: dashboard.firmas.detenidas ? "#fff5f5" : "#f0fdf4" },
                      { label: "Citas próximos 7 días", value: dashboard.firmas.citasProximas, color: "#7c3aed", bg: "#faf5ff" },
                    ]}
                  />
                </div>
                {(dashboard.polizas.vencidas > 0 || dashboard.polizas.solicitudesPendientes > 0) && (
                  <p style={{ margin: "9px 0 0", fontSize: 11, color: "#92400e" }}>
                    Atención jurídica: {dashboard.polizas.vencidas} póliza{dashboard.polizas.vencidas === 1 ? "" : "s"} vencida{dashboard.polizas.vencidas === 1 ? "" : "s"} · {dashboard.polizas.solicitudesPendientes} solicitud{dashboard.polizas.solicitudesPendientes === 1 ? "" : "es"} pendiente{dashboard.polizas.solicitudesPendientes === 1 ? "" : "s"}.
                  </p>
                )}
              </div>

              <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 900, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.8 }}>Operación y cobranza</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: 12, marginBottom: 12 }}>
                <MetricCard icon="💼" label="Comisión cobrada del mes" value={fmt(dashboard.comision)} detail="Comisiones administrativas cobradas este mes." tone="green" pending={errores.comisiones} />
                <MetricCard icon="⏳" label="Pendiente este mes" value={fmt(dashboard.pendienteMesMonto)} detail={`${dashboard.pendienteMesCantidad} renta${dashboard.pendienteMesCantidad === 1 ? "" : "s"} con estado pendiente en el mes actual.`} tone={dashboard.pendienteMesCantidad ? "amber" : "green"} pending={errores.payments} />
                <MetricCard icon="💰" label="Total atrasado" value={fmt(dashboard.atrasadoMonto)} detail={`${dashboard.atrasadoCantidad} renta${dashboard.atrasadoCantidad === 1 ? "" : "s"} marcada${dashboard.atrasadoCantidad === 1 ? "" : "s"} como atrasada${dashboard.atrasadoCantidad === 1 ? "" : "s"}, igual que en Cobranza.`} tone={dashboard.atrasadoCantidad ? "red" : "green"} pending={errores.payments} />
                <MetricCard icon="🔧" label="Mantenimientos abiertos" value={dashboard.mantenimientos} detail="Tickets sin cerrar, cancelar o resolver." tone={dashboard.mantenimientos ? "amber" : "green"} pending={errores.maintenance} />
                <MetricCard icon="📋" label="Renovaciones en 30 días" value={dashboard.renovaciones} detail="Contratos activos próximos a vencer." tone={dashboard.renovaciones ? "purple" : "green"} pending={errores.renewals} />
                <MetricCard icon="📅" label="Citas próximas" value={dashboard.citasProximas} detail="Agendadas en los próximos 7 días." tone="blue" pending={errores.upcoming} />
                <MetricCard icon="⏰" label="Citas vencidas sin actualizar" value={dashboard.citasVencidas} detail="Siguen como agendadas después de su hora." tone={dashboard.citasVencidas ? "red" : "green"} pending={errores.overdue} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 12 }}>
                <Ranking title="Propiedades con más actividad del mes" icon="🏠" rows={dashboard.propiedadesRanking} empty="Sin actividad registrada este mes." pending={errores.monthAppointments || errores.monthSends || errores.sendProperties || errores.properties || errores.visits || errores.contacts} />
                <Ranking title="Asesores con más actividad del mes" icon="🏆" rows={dashboard.asesoresRanking} empty="Sin citas o envíos registrados este mes." pending={errores.monthAppointments || errores.monthSends} />
              </div>
            </>
          )}
        </section>}

        <section>
          <div style={{ marginBottom: 14 }}>
            <p style={{ margin: "0 0 3px", fontSize: 11, fontWeight: 900, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>Navegación</p>
            <h3 style={{ margin: 0, fontSize: 18, color: brand.gray }}>Módulos disponibles</h3>
          </div>

          {navAccesible.length === 0 ? (
            <div style={{ background: "#fff", borderRadius: 14, padding: 40, textAlign: "center", border: "1px solid #f0f0f0" }}>
              <p style={{ fontSize: 32, margin: "0 0 8px" }}>🔒</p>
              <p style={{ color: "#9ca3af", fontSize: 14 }}>
                Tu cuenta todavía no tiene módulos asignados. Contacta a Carlos para que te dé acceso.
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
              {navAccesible.map(n => (
                <a key={n.id} href={n.link} style={{ textDecoration: "none" }}>
                  <div style={{ background: "#fff", borderRadius: 14, padding: "22px 18px", border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", transition: "transform 0.15s, box-shadow 0.15s", cursor: "pointer" }}>
                    <span style={{ fontSize: 30 }}>{n.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: brand.gray }}>{n.label}</span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
