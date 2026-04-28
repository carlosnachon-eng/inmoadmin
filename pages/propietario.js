import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const StatusBadge = ({ status }) => {
  const map = {
    pagado: { bg: "#d1fae5", color: "#065f46", label: "Pagado" },
    atrasado: { bg: "#fee2e2", color: "#991b1b", label: "Atrasado" },
    pendiente: { bg: "#fef3c7", color: "#92400e", label: "Pendiente" },
    en_revision: { bg: "#dbeafe", color: "#1e40af", label: "En revisión" },
    ocupada: { bg: "#d1fae5", color: "#065f46", label: "Ocupada" },
    disponible: { bg: "#e0e7ff", color: "#3730a3", label: "Disponible" },
    nuevo: { bg: "#fef3c7", color: "#92400e", label: "Nuevo" },
    en_proceso: { bg: "#dbeafe", color: "#1e40af", label: "En proceso" },
    resuelto: { bg: "#d1fae5", color: "#065f46", label: "Resuelto" },
    mantenimiento: { bg: "#fce7f3", color: "#9d174d", label: "Mantenimiento" },
  };
  const s = map[status] || { bg: "#f3f4f6", color: "#374151", label: status };
  return <span style={{ background: s.bg, color: s.color, padding: "2px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{s.label}</span>;
};

const OwnerLogin = ({ onLogin }) => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const sendMagicLink = async () => {
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: "https://app.emporioinmobiliario.com.mx/propietario" }
    });
    setLoading(false);
    if (error) { setError("Error: " + error.message); return; }
    setSent(true);
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #1a1a2e, #2d2d5e)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: 40, width: "100%", maxWidth: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏠</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#1a1a2e" }}>Portal Propietario</h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "#6b7280" }}>Emporio Inmobiliario</p>
        </div>
        {error && <div style={{ background: "#fee2e2", color: "#991b1b", padding: "12px 16px", borderRadius: 10, marginBottom: 20, fontSize: 14, fontWeight: 600 }}>{error}</div>}
        {!sent ? (
          <>
            <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 20px", textAlign: "center" }}>Ingresa tu email para acceder a tu portal</p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Tu email</label>
              <input type="email" placeholder="tu@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMagicLink()} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 15, boxSizing: "border-box" }} />
            </div>
            <button onClick={sendMagicLink} disabled={loading || !email} style={{ width: "100%", background: "#c8a96e", color: "#fff", border: "none", borderRadius: 12, padding: "13px", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontSize: 15, opacity: loading ? 0.6 : 1 }}>
              {loading ? "Enviando..." : "Enviar enlace de acceso →"}
            </button>
          </>
        ) : (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>📧</div>
            <h3 style={{ margin: "0 0 12px", color: "#1a1a2e", fontSize: 18, fontWeight: 800 }}>¡Revisa tu email!</h3>
            <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 8px" }}>Enviamos un enlace a:</p>
            <p style={{ color: "#1a1a2e", fontWeight: 700, fontSize: 15, margin: "0 0 20px" }}>{email}</p>
            <p style={{ color: "#9ca3af", fontSize: 13 }}>Revisa también tu carpeta de spam</p>
            <button onClick={() => { setSent(false); setEmail(""); }} style={{ background: "transparent", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 14, textDecoration: "underline", marginTop: 12 }}>
              Usar otro email
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const calcComision = (contrato) => {
  if (!contrato?.commission_value) return 0;
  if (contrato.commission_type === "porcentaje") return (contrato.monthly_rent * contrato.commission_value) / 100;
  return contrato.commission_value;
};

export default function PropietarioPortal() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState("inicio");
  const [properties, setProperties] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [ownerName, setOwnerName] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadOwnerData(); }, [session]);

  const loadOwnerData = async () => {
    setLoading(true);
    const email = session.user.email;

    // Buscar propiedades por owner_email
    const { data: propsData } = await supabase
      .from("properties")
      .select("*")
      .eq("owner_email", email);

    if (propsData && propsData.length > 0) {
      setProperties(propsData);

      // Buscar contratos de esas propiedades
      const propNames = propsData.map(p => p.name);
      const { data: contractsData } = await supabase
        .from("contracts")
        .select("*")
        .in("property_name", propNames)
        .eq("status", "activo");
      setContracts(contractsData || []);

      // Buscar pagos
      if (contractsData && contractsData.length > 0) {
        const contractIds = contractsData.map(c => c.id);
        const { data: paymentsData } = await supabase
          .from("payments")
          .select("*")
          .in("contract_id", contractIds)
          .order("due_date", { ascending: false });
        setPayments(paymentsData || []);
      }

      // Buscar tickets de mantenimiento
      const { data: ticketsData } = await supabase
        .from("maintenance_tickets")
        .select("*")
        .in("property_name", propNames)
        .order("created_at", { ascending: false });
      setTickets(ticketsData || []);

      // Nombre del propietario desde contratos
      if (contractsData && contractsData.length > 0) {
        setOwnerName(contractsData[0].owner_name || email.split("@")[0]);
      } else {
        setOwnerName(email.split("@")[0]);
      }
    }
    setLoading(false);
  };

  const logout = async () => { await supabase.auth.signOut(); setSession(null); };

  // Calcular totales
  const totalRenta = contracts.reduce((a, c) => a + (c.monthly_rent || 0), 0);
  const totalComisiones = contracts.reduce((a, c) => a + calcComision(c), 0);
  const totalLiquido = totalRenta - totalComisiones;
  const totalCobrado = payments.filter(p => p.status === "pagado").reduce((a, p) => a + (p.amount || 0), 0);
  const totalPendiente = payments.filter(p => ["pendiente", "atrasado"].includes(p.status)).reduce((a, p) => a + (p.amount || 0), 0);

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#c8a96e", fontSize: 18, fontWeight: 700 }}>Cargando...</p>
    </div>
  );

  if (!session) return <OwnerLogin onLogin={() => loadOwnerData()} />;

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#6b7280" }}>Cargando tu información...</p>
    </div>
  );

  if (properties.length === 0) return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", padding: 40 }}>
        <p style={{ fontSize: 48, margin: "0 0 16px" }}>🔍</p>
        <h2 style={{ color: "#1a1a2e", margin: "0 0 8px" }}>No encontramos tus propiedades</h2>
        <p style={{ color: "#6b7280", margin: "0 0 20px" }}>Asegúrate de usar el email registrado con tu inmobiliaria</p>
        <button onClick={logout} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 600 }}>Cerrar sesión</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1a1a2e, #2d2d5e)", padding: "24px 20px 0" }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: "#c8a96e", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>Portal Propietario</p>
              <h2 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: "#fff" }}>Hola, {ownerName} 👋</h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.6)" }}>{properties.length} propiedad{properties.length !== 1 ? "es" : ""} administrada{properties.length !== 1 ? "s" : ""}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Líquido mensual</p>
              <p style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 800, color: "#c8a96e" }}>{fmt(totalLiquido)}</p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>después de comisiones</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {[
              { id: "inicio", label: "📊 Resumen" },
              { id: "propiedades", label: "🏠 Propiedades" },
              { id: "pagos", label: "💰 Pagos" },
              { id: "mantenimiento", label: "🔧 Mantenimiento" },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "8px 16px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: tab === t.id ? "#fff" : "rgba(255,255,255,0.1)", color: tab === t.id ? "#1a1a2e" : "rgba(255,255,255,0.7)" }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 20px" }}>

        {/* RESUMEN */}
        {tab === "inicio" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Renta total mensual", value: fmt(totalRenta), color: "#1a1a2e" },
                { label: "Líquido (sin comisión)", value: fmt(totalLiquido), color: "#065f46" },
                { label: "Cobrado total", value: fmt(totalCobrado), color: "#1e40af" },
                { label: "Por cobrar", value: fmt(totalPendiente), color: "#92400e" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <p style={{ margin: "0 0 6px", fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
                  <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Estado de cada propiedad */}
            <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>Estado de tus propiedades</h3>
            {properties.map(prop => {
              const contrato = contracts.find(c => c.property_name === prop.name);
              const pagosProp = payments.filter(p => p.property_name === prop.name);
              const hoy = new Date();
              const pagoMes = pagosProp.find(p => {
                if (!p.due_date) return false;
                const d = new Date(p.due_date);
                return d.getMonth() === hoy.getMonth() && d.getFullYear() === hoy.getFullYear();
              });
              const comision = contrato ? calcComision(contrato) : 0;
              const liquido = contrato ? (contrato.monthly_rent - comision) : 0;

              return (
                <div key={prop.id} style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>{prop.name}</h4>
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>📍 {prop.address || "Sin dirección"}</p>
                    </div>
                    <StatusBadge status={prop.status} />
                  </div>
                  {contrato && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, padding: "12px 0", borderTop: "1px solid #f3f4f6" }}>
                      <div>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Inquilino</p>
                        <p style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 600, color: "#374151" }}>{contrato.tenant_name}</p>
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Renta</p>
                        <p style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>{fmt(contrato.monthly_rent)}</p>
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Tu líquido</p>
                        <p style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 700, color: "#065f46" }}>{fmt(liquido)}</p>
                      </div>
                    </div>
                  )}
                  {pagoMes && (
                    <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: pagoMes.status === "pagado" ? "#f0fdf4" : pagoMes.status === "atrasado" ? "#fff5f5" : "#fffbeb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: "#374151" }}>Pago de este mes</span>
                      <StatusBadge status={pagoMes.status} />
                    </div>
                  )}
                  {!contrato && (
                    <div style={{ padding: "10px 0", borderTop: "1px solid #f3f4f6" }}>
                      <p style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}>Sin contrato activo</p>
                    </div>
                  )}
                </div>
              );
            })}
            <button onClick={logout} style={{ width: "100%", background: "#f3f4f6", border: "none", borderRadius: 10, padding: "12px", cursor: "pointer", fontSize: 14, color: "#6b7280", fontWeight: 600, marginTop: 8 }}>
              Cerrar sesión
            </button>
          </div>
        )}

        {/* PROPIEDADES */}
        {tab === "propiedades" && (
          <div>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#1a1a2e" }}>Mis propiedades</h3>
            {properties.map(prop => {
              const contrato = contracts.find(c => c.property_name === prop.name);
              const comision = contrato ? calcComision(contrato) : 0;
              return (
                <div key={prop.id} style={{ background: "#fff", borderRadius: 14, overflow: "hidden", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <div style={{ background: "linear-gradient(135deg, #1a1a2e, #2d2d5e)", height: 60, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                    {prop.property_type === "casa" ? "🏠" : prop.property_type === "depto" ? "🏢" : prop.property_type === "local" ? "🏪" : prop.property_type === "bodega" ? "🏭" : "💼"}
                  </div>
                  <div style={{ padding: "16px 18px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{prop.name}</h4>
                      <StatusBadge status={prop.status} />
                    </div>
                    <p style={{ margin: "0 0 12px", fontSize: 12, color: "#6b7280" }}>📍 {prop.address || "Sin dirección"}</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, paddingTop: 12, borderTop: "1px solid #f3f4f6" }}>
                      <div>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Renta</p>
                        <p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 800, color: "#1a1a2e" }}>{fmt(prop.rent_amount)}</p>
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Comisión admin</p>
                        <p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 800, color: "#7c3aed" }}>{fmt(comision)}</p>
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Tu líquido</p>
                        <p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 800, color: "#065f46" }}>{fmt((prop.rent_amount || 0) - comision)}</p>
                      </div>
                    </div>
                    {contrato && (
                      <div style={{ marginTop: 12, background: "#f9fafb", borderRadius: 8, padding: "10px 14px" }}>
                        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                          👤 <strong>{contrato.tenant_name}</strong> · Paga el día {contrato.payment_day} · Contrato hasta {contrato.end_date}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* PAGOS */}
        {tab === "pagos" && (
          <div>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#1a1a2e" }}>Historial de pagos</h3>
            {payments.length === 0 && <p style={{ color: "#9ca3af", fontSize: 14 }}>No hay pagos registrados aún</p>}
            {payments.map(p => (
              <div key={p.id} style={{ background: "#fff", borderRadius: 14, padding: "14px 18px", marginBottom: 10, border: p.status === "atrasado" ? "2px solid #fca5a5" : "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a1a2e" }}>{fmt(p.amount)}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>{p.property_name} · Vence {p.due_date}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>👤 {p.tenant_name}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* MANTENIMIENTO */}
        {tab === "mantenimiento" && (
          <div>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#1a1a2e" }}>Historial de mantenimiento</h3>
            {tickets.length === 0 && (
              <div style={{ background: "#fff", borderRadius: 14, padding: 40, textAlign: "center" }}>
                <p style={{ fontSize: 32, margin: "0 0 8px" }}>✅</p>
                <p style={{ color: "#6b7280", fontSize: 14, margin: 0 }}>No hay reportes de mantenimiento</p>
              </div>
            )}
            {tickets.map(t => (
              <div key={t.id} style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>{t.title}</h4>
                  <StatusBadge status={t.status} />
                </div>
                <p style={{ margin: "0 0 4px", fontSize: 12, color: "#6b7280" }}>📍 {t.property_name}</p>
                {t.description && <p style={{ margin: "0 0 4px", fontSize: 13, color: "#374151" }}>{t.description}</p>}
                <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>{t.category}</span>
                  {t.cost > 0 && <span style={{ fontSize: 12, color: "#7c3aed", fontWeight: 700 }}>Costo: {fmt(t.cost)}</span>}
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>{new Date(t.created_at).toLocaleDateString("es-MX")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
