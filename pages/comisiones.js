import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const calcComision = (c) => {
  if (!c.commission_value) return 0;
  if (c.commission_type === "porcentaje") return (c.monthly_rent * c.commission_value) / 100;
  return c.commission_value;
};

const StatusBadge = ({ status }) => {
  const map = {
    cobrada:        { bg: "#d1fae5", color: "#065f46", label: "Cobrada" },
    pendiente_cobro:{ bg: "#fef3c7", color: "#92400e", label: "Pendiente cobro" },
    inmobiliaria:   { bg: "#d1fae5", color: "#065f46", label: "A nosotros" },
    propietario:    { bg: "#e0e7ff", color: "#3730a3", label: "Al propietario" },
  };
  const s = map[status] || { bg: "#f3f4f6", color: "#374151", label: status };
  return <span style={{ background: s.bg, color: s.color, padding: "2px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{s.label}</span>;
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

export default function Comisiones() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

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
    const { data } = await supabase.from("contracts").select("*").order("created_at", { ascending: false });
    setContracts(data || []);
    setLoading(false);
  };

  useEffect(() => { if (session) loadData(); }, [session]);

  const marcarCobrada = async (c) => {
    const comision = calcComision(c);
    await supabase.from("contracts").update({ commission_status: "cobrada" }).eq("id", c.id);
    await supabase.from("cash_movements").insert([{
      type: "entrada", category: "comision_cobrada",
      description: `Comision de ${c.owner_name || c.property_name} - ${c.tenant_name}`,
      amount: comision, payment_method: "transferencia",
      date: today, created_by: profile?.email,
      created_at: new Date().toISOString()
    }]);
    showToast(`Comisión de ${fmt(comision)} registrada en caja`);
    loadData();
  };

  const marcarPendiente = async (id) => {
    await supabase.from("contracts").update({ commission_status: "pendiente_cobro" }).eq("id", id);
    showToast("Comisión marcada como pendiente");
    loadData();
  };

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#c8a96e", fontSize: 18, fontWeight: 700 }}>Cargando...</p>
    </div>
  );

  if (!session) {
    if (typeof window !== "undefined") window.location.href = "/";
    return null;
  }

  // ── CÁLCULOS ──
  const activos = contracts.filter(c => c.status === "activo");
  const totalComisiones = activos.reduce((a, c) => a + calcComision(c), 0);
  const comisionesPendientes = activos
    .filter(c => c.rent_receiver === "propietario" && (!c.commission_status || c.commission_status === "pendiente_cobro"))
    .reduce((a, c) => a + calcComision(c), 0);
  const comisionesCobradas = activos
    .filter(c => c.commission_status === "cobrada")
    .reduce((a, c) => a + calcComision(c), 0);

  const directos  = activos.filter(c => c.rent_receiver === "propietario");
  const emporio   = activos.filter(c => c.rent_receiver !== "propietario");

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "system-ui, sans-serif" }}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: 320 }}>
          {toast.msg}
        </div>
      )}

      {/* HEADER */}
      <div style={{ background: "#1a1a2e", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={() => router.push("/")} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8, padding: "8px 14px", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>← Panel</button>
          <div>
            <p style={{ margin: 0, fontSize: 11, color: "#c8a96e", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>InmoAdmin</p>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#fff" }}>💼 Comisiones</h1>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 20px" }}>

        {/* INFO */}
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 12, color: "#1e40af", fontWeight: 600 }}>
            Contratos donde la renta va a Emporio: la comisión se retiene automáticamente al liquidar al propietario.<br />
            Contratos donde la renta va al propietario: marca aquí cuando el propietario te pague la comisión para que entre a caja.
          </p>
        </div>

        {/* STATS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 24 }}>
          {[
            { label: "Comisión mensual total", value: fmt(totalComisiones),    color: "#7c3aed", bg: "#faf5ff" },
            { label: "Comisión anual est.",    value: fmt(totalComisiones*12), color: "#1a1a2e", bg: "#f9fafb" },
            { label: "Por cobrar",             value: fmt(comisionesPendientes), color: comisionesPendientes > 0 ? "#92400e" : "#065f46", bg: comisionesPendientes > 0 ? "#fffbeb" : "#f0fdf4" },
            { label: "Ya cobradas",            value: fmt(comisionesCobradas), color: "#065f46", bg: "#f0fdf4" },
            { label: "Contratos activos",      value: activos.length,          color: "#1e40af", bg: "#eff6ff" },
          ].map((s, i) => (
            <div key={i} style={{ background: s.bg, borderRadius: 14, padding: "14px 16px" }}>
              <p style={{ margin: "0 0 4px", fontSize: 10, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        {comisionesPendientes > 0 && (
          <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#92400e", fontWeight: 600 }}>
              Tienes {fmt(comisionesPendientes)} en comisiones pendientes de cobrar al propietario.
            </p>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: 48 }}><p style={{ color: "#6b7280" }}>Cargando...</p></div>
        ) : (
          <>
            {/* ── RENTA DIRECTA AL PROPIETARIO ── */}
            {directos.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>
                  Renta directa al propietario — cobras la comisión aparte
                </h2>
                <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 650 }}>
                    <thead>
                      <tr style={{ background: "#f9fafb" }}>
                        {["Inquilino", "Propietario", "Propiedad", "Renta", "Comisión %", "Monto/mes", "Estado", "Acción"].map(h => (
                          <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {directos.map(c => {
                        const comision  = calcComision(c);
                        const pendiente = !c.commission_status || c.commission_status === "pendiente_cobro";
                        return (
                          <tr key={c.id} style={{ borderTop: "1px solid #f3f4f6", background: pendiente ? "#fffdf0" : "#fff" }}>
                            <td style={{ padding: "11px 14px", fontWeight: 600, fontSize: 13 }}>
                              {c.tenant_name}
                              {c.co_responsable_nombre && <span style={{ display: "block", fontSize: 11, color: "#7c3aed" }}>{c.co_responsable_nombre}</span>}
                            </td>
                            <td style={{ padding: "11px 14px", fontSize: 13, color: "#6b7280" }}>{c.owner_name || "-"}</td>
                            <td style={{ padding: "11px 14px", fontSize: 13, color: "#6b7280" }}>{c.property_name}</td>
                            <td style={{ padding: "11px 14px", fontWeight: 700 }}>{fmt(c.monthly_rent)}</td>
                            <td style={{ padding: "11px 14px", fontSize: 13, color: "#7c3aed" }}>
                              {c.commission_type === "porcentaje" ? `${c.commission_value}%` : "Fijo"}
                            </td>
                            <td style={{ padding: "11px 14px", fontWeight: 700, color: "#7c3aed" }}>{fmt(comision)}</td>
                            <td style={{ padding: "11px 14px" }}>
                              <StatusBadge status={pendiente ? "pendiente_cobro" : "cobrada"} />
                            </td>
                            <td style={{ padding: "11px 14px" }}>
                              {pendiente
                                ? <Btn small color="#065f46" onClick={() => marcarCobrada(c)}>Recibí la comisión</Btn>
                                : <Btn small color="#6b7280" onClick={() => marcarPendiente(c.id)}>Revertir</Btn>
                              }
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── RENTA A EMPORIO ── */}
            {emporio.length > 0 && (
              <div>
                <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>
                  Renta a Emporio — comisión se retiene al liquidar
                </h2>
                <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                    <thead>
                      <tr style={{ background: "#f9fafb" }}>
                        {["Inquilino", "Propietario", "Propiedad", "Renta", "Comisión %", "Monto/mes", "Nota"].map(h => (
                          <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {emporio.map(c => {
                        const comision = calcComision(c);
                        return (
                          <tr key={c.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                            <td style={{ padding: "11px 14px", fontWeight: 600, fontSize: 13 }}>
                              {c.tenant_name}
                              {c.co_responsable_nombre && <span style={{ display: "block", fontSize: 11, color: "#7c3aed" }}>{c.co_responsable_nombre}</span>}
                            </td>
                            <td style={{ padding: "11px 14px", fontSize: 13, color: "#6b7280" }}>{c.owner_name || "-"}</td>
                            <td style={{ padding: "11px 14px", fontSize: 13, color: "#6b7280" }}>{c.property_name}</td>
                            <td style={{ padding: "11px 14px", fontWeight: 700 }}>{fmt(c.monthly_rent)}</td>
                            <td style={{ padding: "11px 14px", fontSize: 13, color: "#7c3aed" }}>
                              {c.commission_type === "porcentaje" ? `${c.commission_value}%` : "Fijo"}
                            </td>
                            <td style={{ padding: "11px 14px", fontWeight: 700, color: "#7c3aed" }}>{fmt(comision)}</td>
                            <td style={{ padding: "11px 14px", fontSize: 12, color: "#9ca3af" }}>Auto al liquidar</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activos.length === 0 && (
              <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center" }}>
                <p style={{ color: "#6b7280" }}>No hay contratos activos</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
