import { useState } from "react";

const fmt = (n) => new Intl.NumberFormat("es-MX", { 
  style: "currency", currency: "MXN", minimumFractionDigits: 0 
}).format(n);

const StatusBadge = ({ status }) => {
  const map = {
    pagado: { bg: "#d1fae5", color: "#065f46", label: "Pagado" },
    atrasado: { bg: "#fee2e2", color: "#991b1b", label: "Atrasado" },
    pendiente: { bg: "#fef3c7", color: "#92400e", label: "Pendiente" },
    en_revision: { bg: "#dbeafe", color: "#1e40af", label: "En revisión" },
    ocupada: { bg: "#d1fae5", color: "#065f46", label: "Ocupada" },
    disponible: { bg: "#e0e7ff", color: "#3730a3", label: "Disponible" },
    activo: { bg: "#d1fae5", color: "#065f46", label: "Activo" },
    nuevo: { bg: "#fef3c7", color: "#92400e", label: "Nuevo" },
    en_proceso: { bg: "#dbeafe", color: "#1e40af", label: "En proceso" },
    resuelto: { bg: "#d1fae5", color: "#065f46", label: "Resuelto" },
  };
  const s = map[status] || { bg: "#f3f4f6", color: "#374151", label: status };
  return (
    <span style={{ background: s.bg, color: s.color, padding: "2px 10px", 
      borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
      {s.label}
    </span>
  );
};

const properties = [
  { id: 1, name: "Depto 3B Torre Esmeralda", address: "Av. Insurgentes Sur 1234", type: "depto", owner: "Carlos Mendoza", tenant: "Ana García", rent: 12500, status: "ocupada", paymentStatus: "pagado" },
  { id: 2, name: "Casa Satélite Oriente", address: "Blvd. Manuel Ávila Camacho 88", type: "casa", owner: "Patricia Ruiz", tenant: "Roberto Silva", rent: 18000, status: "ocupada", paymentStatus: "atrasado" },
  { id: 3, name: "Local Comercial Centro", address: "5 de Mayo 45, Toluca", type: "local", owner: "Carlos Mendoza", tenant: "Ferretería López", rent: 9500, status: "ocupada", paymentStatus: "pendiente" },
  { id: 4, name: "Depto 8A Polanco", address: "Emilio Castelar 175, CDMX", type: "depto", owner: "Inversiones GR", tenant: null, rent: 22000, status: "disponible", paymentStatus: null },
];

const payments = [
  { id: 1, tenant: "Ana García", property: "Depto 3B Torre Esmeralda", amount: 12500, due: "2025-01-05", status: "pagado" },
  { id: 2, tenant: "Roberto Silva", property: "Casa Satélite Oriente", amount: 18000, due: "2025-01-05", status: "atrasado" },
  { id: 3, tenant: "Ferretería López", property: "Local Comercial Centro", amount: 9500, due: "2025-01-10", status: "pendiente" },
];

const tickets = [
  { id: 1, property: "Casa Satélite Oriente", tenant: "Roberto Silva", title: "Fuga de agua en baño", priority: "alta", status: "en_proceso" },
  { id: 2, property: "Depto 3B Torre Esmeralda", tenant: "Ana García", title: "Fallo en aire acondicionado", priority: "media", status: "nuevo" },
];

export default function Home() {
  const [view, setView] = useState("dashboard");

  const totalRent = properties.filter(p => p.status === "ocupada").reduce((a, p) => a + p.rent, 0);
  const paid = payments.filter(p => p.status === "pagado").reduce((a, p) => a + p.amount, 0);
  const overdue = payments.filter(p => p.status === "atrasado").reduce((a, p) => a + p.amount, 0);

  const nav = [
    { id: "dashboard", label: "Panel" },
    { id: "properties", label: "Propiedades" },
    { id: "payments", label: "Cobranza" },
    { id: "tickets", label: "Mantenimiento" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif", background: "#f4f5f7" }}>
      {/* Sidebar */}
      <div style={{ width: 220, background: "#1a1a2e", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "24px 20px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <span style={{ color: "#c8a96e", fontWeight: 800, fontSize: 18 }}>🏢 InmoAdmin</span>
        </div>
        <nav style={{ padding: "16px 12px", flex: 1 }}>
          {nav.map(n => (
            <button key={n.id} onClick={() => setView(n.id)} style={{
              width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 8,
              border: "none", cursor: "pointer", marginBottom: 4, fontSize: 14, fontWeight: 600,
              background: view === n.id ? "rgba(200,169,110,0.15)" : "transparent",
              color: view === n.id ? "#c8a96e" : "rgba(255,255,255,0.6)"
            }}>
              {n.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: 16, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <p style={{ margin: 0, color: "rgba(255,255,255,0.4)", fontSize: 12 }}>Admin · Tu Inmobiliaria</p>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: 32, overflowY: "auto" }}>

        {view === "dashboard" && (
          <div>
            <h1 style={{ margin: "0 0 24px", fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>Panel de Control</h1>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 28 }}>
              {[
                { label: "Renta mensual total", value: fmt(totalRent), color: "#1a1a2e" },
                { label: "Cobrado este mes", value: fmt(paid), color: "#065f46" },
                { label: "Vencido / atrasado", value: fmt(overdue), color: "#991b1b" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 12, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
                  <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>
            <div style={{ background: "#fff", borderRadius: 14, padding: 22, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Pagos del mes</h3>
              {payments.map(p => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #f3f4f6" }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{p.tenant}</p>
                    <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>{p.property}</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontWeight: 700 }}>{fmt(p.amount)}</span>
                    <StatusBadge status={p.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === "properties" && (
          <div>
            <h1 style={{ margin: "0 0 24px", fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>Propiedades</h1>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
              {properties.map(p => (
                <div key={p.id} style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <div style={{ background: "linear-gradient(135deg, #1a1a2e, #2d2d5e)", height: 80, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>
                    {p.type === "casa" ? "🏠" : p.type === "depto" ? "🏢" : p.type === "local" ? "🏪" : "🏭"}
                  </div>
                  <div style={{ padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{p.name}</h3>
                      <StatusBadge status={p.status} />
                    </div>
                    <p style={{ margin: "0 0 12px", fontSize: 12, color: "#6b7280" }}>📍 {p.address}</p>
                    <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: "1px solid #f3f4f6" }}>
                      <div>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Renta</p>
                        <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{fmt(p.rent)}</p>
                      </div>
                      {p.paymentStatus && <StatusBadge status={p.paymentStatus} />}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === "payments" && (
          <div>
            <h1 style={{ margin: "0 0 24px", fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>Cobranza</h1>
            <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    {["Arrendatario", "Propiedad", "Monto", "Vence", "Estado"].map(h => (
                      <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "14px 16px", fontWeight: 600 }}>{p.tenant}</td>
                      <td style={{ padding: "14px 16px", fontSize: 13, color: "#6b7280" }}>{p.property}</td>
                      <td style={{ padding: "14px 16px", fontWeight: 700 }}>{fmt(p.amount)}</td>
                      <td style={{ padding: "14px 16px", fontSize: 13, color: "#6b7280" }}>{p.due}</td>
                      <td style={{ padding: "14px 16px" }}><StatusBadge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view === "tickets" && (
          <div>
            <h1 style={{ margin: "0 0 24px", fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>Mantenimiento</h1>
            <div style={{ display: "grid", gap: 12 }}>
              {tickets.map(t => (
                <div key={t.id} style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>{t.title}</h3>
                    <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>📍 {t.property} · 👤 {t.tenant}</p>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <StatusBadge status={t.priority} />
                    <StatusBadge status={t.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
