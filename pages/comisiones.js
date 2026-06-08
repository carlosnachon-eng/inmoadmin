import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";
import { PageHeader, brand } from "../components/Layout";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const calcComision = (c) => {
  if (!c.commission_value) return 0;
  if (c.commission_type === "porcentaje") return (c.monthly_rent * c.commission_value) / 100;
  return c.commission_value;
};

const periodoActual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const periodoLabel = (p) => {
  if (!p) return "—";
  const [y, m] = p.split("-");
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("es-MX", { month: "long", year: "numeric" });
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

const StatusBadge = ({ status, tipo }) => {
  if (status === "cobrada") return <span style={{ background: "#d1fae5", color: "#065f46", padding: "2px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>✅ Cobrada</span>;
  if (tipo === "automatica") return <span style={{ background: "#dbeafe", color: "#1e40af", padding: "2px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>⚙️ Auto al liquidar</span>;
  return <span style={{ background: "#fef3c7", color: "#92400e", padding: "2px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>⏳ Pendiente</span>;
};

export default function Comisiones() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [contracts, setContracts] = useState([]);
  const [comisiones, setComisiones] = useState([]);
  const [historialCash, setHistorialCash] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [periodo, setPeriodo] = useState(periodoActual());
  const [tab, setTab] = useState("mes");

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };
  const today = new Date().toISOString().split("T")[0];

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
    const [
      { data: contractsData },
      { data: comisionesData },
      { data: cashData },
    ] = await Promise.all([
      supabase.from("contracts").select("*").eq("status", "activo").order("property_name"),
      supabase.from("comisiones_admin").select("*, contracts(tenant_name, property_name, owner_name, monthly_rent, commission_type, commission_value, rent_receiver)").order("created_at", { ascending: false }),
      supabase.from("cash_movements").select("*").eq("category", "comision_cobrada").order("date", { ascending: false }),
    ]);
    setContracts(contractsData || []);
    setComisiones(comisionesData || []);
    setHistorialCash(cashData || []);
    setLoading(false);
  };

  useEffect(() => { if (session) loadData(); }, [session]);

  // ── Generar comisiones del periodo ────────────────────────────────────────
  const generarComisionesMes = async () => {
    if (!contracts.length) { showToast("No hay contratos activos", false); return; }

    // Ver cuáles ya tienen registro en este periodo
    const yaExisten = comisiones.filter(c => c.periodo === periodo).map(c => c.contract_id);
    const sinRegistro = contracts.filter(c => !yaExisten.includes(c.id));

    if (sinRegistro.length === 0) {
      showToast("Las comisiones de este periodo ya están generadas", false);
      return;
    }

    setSaving(true);
    const nuevas = sinRegistro.map(c => ({
      contract_id: c.id,
      periodo,
      monto: calcComision(c),
      tipo: c.rent_receiver === "inmobiliaria" ? "automatica" : "manual",
      status: "pendiente", // siempre pendiente al generar — se cobra al liquidar o manualmente
      fecha_cobro: null,
      notas: c.rent_receiver === "inmobiliaria"
        ? "Se retiene automáticamente al liquidar al propietario"
        : "Pendiente de cobro al propietario",
      created_by: profile?.email,
    }));

    const { error } = await supabase.from("comisiones_admin").insert(nuevas);
    setSaving(false);
    if (error) { showToast("Error: " + error.message, false); return; }
    showToast(`${nuevas.length} comisiones generadas para ${periodoLabel(periodo)}`);
    loadData();
  };

  // ── Marcar comisión como cobrada (manual) ─────────────────────────────────
  const marcarCobrada = async (com) => {
    setSaving(true);
    const { error } = await supabase.from("comisiones_admin").update({
      status: "cobrada",
      fecha_cobro: today,
    }).eq("id", com.id);

    if (!error) {
      // Registrar en caja
      await supabase.from("cash_movements").insert([{
        type: "entrada",
        category: "comision_cobrada",
        description: `Comisión admin ${periodoLabel(com.periodo)} — ${com.contracts?.property_name || ""}`,
        amount: com.monto,
        payment_method: "transferencia",
        date: today,
        created_by: profile?.email,
        created_at: new Date().toISOString(),
      }]);
    }

    setSaving(false);
    if (error) { showToast("Error: " + error.message, false); return; }
    showToast(`${fmt(com.monto)} registrados en caja`);
    loadData();
  };

  // ── Revertir a pendiente ──────────────────────────────────────────────────
  const revertirPendiente = async (id) => {
    await supabase.from("comisiones_admin").update({ status: "pendiente", fecha_cobro: null }).eq("id", id);
    showToast("Revertida a pendiente");
    loadData();
  };

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: brand.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} />
    </div>
  );
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }

  // ── Cálculos del periodo seleccionado ─────────────────────────────────────
  const comisionesPeriodo = comisiones.filter(c => c.periodo === periodo);
  const totalEsperado     = comisionesPeriodo.reduce((a, c) => a + (c.monto || 0), 0);
  const totalCobrado      = comisionesPeriodo.filter(c => c.status === "cobrada").reduce((a, c) => a + (c.monto || 0), 0);
  const totalPendiente    = comisionesPeriodo.filter(c => c.status === "pendiente").reduce((a, c) => a + (c.monto || 0), 0);
  const manualesPendientes = comisionesPeriodo.filter(c => c.tipo === "manual" && c.status === "pendiente");
  const generado          = comisionesPeriodo.length > 0;

  // ── Totales globales ──────────────────────────────────────────────────────
  const totalMensualContratos = contracts.reduce((a, c) => a + calcComision(c), 0);
  const periodos = [...new Set(comisiones.map(c => c.periodo))].sort().reverse();

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: 320 }}>
          {toast.msg}
        </div>
      )}

      <PageHeader title="Comisiones" icon="💼" />

      <div style={{ maxWidth: 1050, margin: "0 auto", padding: "24px 20px" }}>

        {/* Info */}
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 12, color: "#1e40af", fontWeight: 600 }}>
            Renta a Emporio → comisión se retiene automáticamente al liquidar al propietario.<br />
            Renta directa al propietario → marca aquí cuando el propietario te pague para que entre a caja.
          </p>
        </div>

        {/* KPIs globales */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 24 }}>
          {[
            { label: "Comisión mensual esperada", value: fmt(totalMensualContratos), color: "#7c3aed", bg: "#faf5ff" },
            { label: "Estimado anual",             value: fmt(totalMensualContratos * 12), color: "#1a1a2e", bg: "#f9fafb" },
            { label: "Contratos activos",          value: contracts.length, color: "#1e40af", bg: "#eff6ff" },
            { label: "Cobradas este periodo",      value: fmt(totalCobrado),    color: "#065f46", bg: "#f0fdf4" },
            { label: "Pendientes este periodo",    value: fmt(totalPendiente),  color: totalPendiente > 0 ? "#92400e" : "#065f46", bg: totalPendiente > 0 ? "#fffbeb" : "#f0fdf4" },
          ].map((s, i) => (
            <div key={i} style={{ background: s.bg, borderRadius: 14, padding: "14px 16px" }}>
              <p style={{ margin: "0 0 4px", fontSize: 10, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
          {[
            { id: "mes",      label: "📅 Por periodo" },
            { id: "contratos",label: "📋 Por contrato" },
            { id: "historial",label: "🕐 Historial" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "8px 16px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: tab === t.id ? "#fff" : "#e5e7eb", color: tab === t.id ? "#1a1a2e" : "#6b7280" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── TAB: POR PERIODO ── */}
        {tab === "mes" && (
          <div style={{ background: "#fff", borderRadius: "0 12px 12px 12px", padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            {/* Selector de periodo + generar */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
              <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff" }} />
              <Btn color="#065f46" onClick={generarComisionesMes} disabled={saving}>
                {saving ? "Generando…" : `📋 Generar comisiones de ${periodoLabel(periodo)}`}
              </Btn>
              {generado && (
                <span style={{ fontSize: 12, color: "#065f46", fontWeight: 600 }}>
                  ✓ {comisionesPeriodo.length} comisiones generadas
                </span>
              )}
            </div>

            {/* Alerta pendientes manuales */}
            {manualesPendientes.length > 0 && (
              <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
                <p style={{ margin: 0, fontSize: 13, color: "#92400e", fontWeight: 600 }}>
                  ⚠️ Tienes {manualesPendientes.length} comisión{manualesPendientes.length !== 1 ? "es" : ""} pendiente{manualesPendientes.length !== 1 ? "s" : ""} de cobrar al propietario — {fmt(totalPendiente)} en total
                </p>
              </div>
            )}

            {!generado ? (
              <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>
                <p style={{ fontSize: 24, margin: "0 0 8px" }}>📋</p>
                <p style={{ margin: 0 }}>No hay comisiones generadas para {periodoLabel(periodo)}</p>
                <p style={{ margin: "4px 0 0", fontSize: 12 }}>Usa el botón de arriba para generarlas</p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {["Propiedad", "Inquilino", "Propietario", "Comisión/mes", "Tipo", "Estatus", "Fecha cobro", "Acción"].map(h => (
                        <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comisionesPeriodo.map(com => (
                      <tr key={com.id} style={{ borderTop: "1px solid #f3f4f6", background: com.tipo === "manual" && com.status === "pendiente" ? "#fffdf0" : "#fff" }}>
                        <td style={{ padding: "10px 12px", fontWeight: 600, fontSize: 13 }}>{com.contracts?.property_name || "—"}</td>
                        <td style={{ padding: "10px 12px", fontSize: 13, color: "#6b7280" }}>{com.contracts?.tenant_name || "—"}</td>
                        <td style={{ padding: "10px 12px", fontSize: 13, color: "#6b7280" }}>{com.contracts?.owner_name || "—"}</td>
                        <td style={{ padding: "10px 12px", fontWeight: 800, color: "#7c3aed" }}>{fmt(com.monto)}</td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: com.tipo === "automatica" ? "#1e40af" : "#92400e", background: com.tipo === "automatica" ? "#dbeafe" : "#fef3c7", padding: "2px 8px", borderRadius: 99 }}>
                            {com.tipo === "automatica" ? "⚙️ Auto" : "✋ Manual"}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <StatusBadge status={com.status} tipo={com.tipo} />
                        </td>
                        <td style={{ padding: "10px 12px", fontSize: 12, color: "#6b7280" }}>{com.fecha_cobro || "—"}</td>
                        <td style={{ padding: "10px 12px" }}>
                          {com.tipo === "manual" && com.status === "pendiente" && (
                            <Btn small color="#065f46" onClick={() => marcarCobrada(com)} disabled={saving}>✓ Recibí</Btn>
                          )}
                          {com.tipo === "manual" && com.status === "cobrada" && (
                            <Btn small color="#6b7280" onClick={() => revertirPendiente(com.id)}>Revertir</Btn>
                          )}
                          {com.tipo === "automatica" && (
                            <span style={{ fontSize: 11, color: "#9ca3af" }}>Auto al liquidar</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totales del periodo */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 16, padding: "14px 0 0", borderTop: "2px solid #f3f4f6" }}>
                  {[
                    { label: "Total esperado",  value: fmt(totalEsperado),  color: "#1a1a2e" },
                    { label: "Total cobrado",   value: fmt(totalCobrado),   color: "#065f46" },
                    { label: "Total pendiente", value: fmt(totalPendiente), color: totalPendiente > 0 ? "#b45309" : "#065f46" },
                  ].map((s, i) => (
                    <div key={i} style={{ background: "#f9fafb", borderRadius: 8, padding: "10px 14px" }}>
                      <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>{s.label}</p>
                      <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: POR CONTRATO ── */}
        {tab === "contratos" && (
          <div style={{ background: "#fff", borderRadius: "0 12px 12px 12px", padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    {["Propiedad", "Inquilino", "Propietario", "Renta", "Comisión/mes", "Tipo comisión", "Renta va a", "Periodos cobrados"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contracts.map(c => {
                    const comisionMonto = calcComision(c);
                    const cobradas = comisiones.filter(com => com.contract_id === c.id && com.status === "cobrada").length;
                    const totalHistorico = comisiones.filter(com => com.contract_id === c.id && com.status === "cobrada").reduce((a, com) => a + (com.monto || 0), 0);
                    return (
                      <tr key={c.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "10px 12px", fontWeight: 600, fontSize: 13 }}>{c.property_name}</td>
                        <td style={{ padding: "10px 12px", fontSize: 13, color: "#6b7280" }}>{c.tenant_name}</td>
                        <td style={{ padding: "10px 12px", fontSize: 13, color: "#6b7280" }}>{c.owner_name || "—"}</td>
                        <td style={{ padding: "10px 12px", fontWeight: 700 }}>{fmt(c.monthly_rent)}</td>
                        <td style={{ padding: "10px 12px", fontWeight: 800, color: "#7c3aed" }}>{fmt(comisionMonto)}</td>
                        <td style={{ padding: "10px 12px", fontSize: 12, color: "#6b7280" }}>
                          {c.commission_type === "porcentaje" ? `${c.commission_value}%` : `Fijo ${fmt(c.commission_value)}`}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: c.rent_receiver === "propietario" ? "#3730a3" : "#065f46", background: c.rent_receiver === "propietario" ? "#e0e7ff" : "#d1fae5", padding: "2px 8px", borderRadius: 99 }}>
                            {c.rent_receiver === "propietario" ? "Propietario" : "Emporio"}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", fontSize: 13 }}>
                          <p style={{ margin: 0, fontWeight: 700, color: "#065f46" }}>{cobradas} mes{cobradas !== 1 ? "es" : ""}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>{fmt(totalHistorico)} total</p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB: HISTORIAL ── */}
        {tab === "historial" && (
          <div style={{ background: "#fff", borderRadius: "0 12px 12px 12px", padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>

            {/* Resumen por periodo */}
            <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 800, color: "#1a1a2e" }}>Resumen por periodo</h3>
            {periodos.length === 0 ? (
              <p style={{ color: "#9ca3af", fontSize: 13 }}>Sin historial aún — genera las comisiones del mes para empezar</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
                {periodos.map(p => {
                  const cs = comisiones.filter(c => c.periodo === p);
                  const cobrado = cs.filter(c => c.status === "cobrada").reduce((a, c) => a + (c.monto || 0), 0);
                  const pendiente = cs.filter(c => c.status === "pendiente").reduce((a, c) => a + (c.monto || 0), 0);
                  const total = cs.reduce((a, c) => a + (c.monto || 0), 0);
                  const pct = total > 0 ? Math.round((cobrado / total) * 100) : 0;
                  return (
                    <div key={p} style={{ background: "#f9fafb", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                      <div>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a1a2e" }}>{periodoLabel(p)}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>{cs.length} contratos</p>
                      </div>
                      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                        <div style={{ textAlign: "right" }}>
                          <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Cobrado</p>
                          <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: "#065f46" }}>{fmt(cobrado)}</p>
                        </div>
                        {pendiente > 0 && (
                          <div style={{ textAlign: "right" }}>
                            <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Pendiente</p>
                            <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: "#b45309" }}>{fmt(pendiente)}</p>
                          </div>
                        )}
                        <div style={{ textAlign: "center" }}>
                          <div style={{ background: "#e5e7eb", borderRadius: 99, height: 6, width: 60, overflow: "hidden" }}>
                            <div style={{ background: pct === 100 ? "#065f46" : "#b91c3c", height: "100%", width: `${pct}%`, borderRadius: 99 }} />
                          </div>
                          <p style={{ margin: "3px 0 0", fontSize: 10, color: pct === 100 ? "#065f46" : "#b45309", fontWeight: 700 }}>{pct}%</p>
                        </div>
                        <Btn small color="#1a1a2e" onClick={() => { setPeriodo(p); setTab("mes"); }}>Ver →</Btn>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Historial anterior (cash_movements) */}
            {historialCash.length > 0 && (
              <>
                <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 800, color: "#1a1a2e" }}>Historial anterior</h3>
                <p style={{ margin: "0 0 12px", fontSize: 12, color: "#9ca3af" }}>Comisiones registradas antes del nuevo sistema</p>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f9fafb" }}>
                        {["Descripción", "Monto", "Fecha", "Método"].map(h => (
                          <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {historialCash.map(m => (
                        <tr key={m.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                          <td style={{ padding: "8px 12px", color: "#374151" }}>{m.description}</td>
                          <td style={{ padding: "8px 12px", fontWeight: 700, color: "#065f46" }}>{fmt(m.amount)}</td>
                          <td style={{ padding: "8px 12px", color: "#9ca3af" }}>{m.date}</td>
                          <td style={{ padding: "8px 12px", color: "#9ca3af" }}>{m.payment_method || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
