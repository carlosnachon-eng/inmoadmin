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
    activo: { bg: "#d1fae5", color: "#065f46", label: "Activo" },
    nuevo: { bg: "#fef3c7", color: "#92400e", label: "Nuevo" },
    en_proceso: { bg: "#dbeafe", color: "#1e40af", label: "En proceso" },
    resuelto: { bg: "#d1fae5", color: "#065f46", label: "Resuelto" },
    mantenimiento: { bg: "#fce7f3", color: "#9d174d", label: "Mantenimiento" },
  };
  const s = map[status] || { bg: "#f3f4f6", color: "#374151", label: status };
  return (
    <span style={{ background: s.bg, color: s.color, padding: "2px 10px",
      borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
      {s.label}
    </span>
  );
};

const Modal = ({ title, onClose, children }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{title}</h2>
        <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 16 }}>
    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>{label}</label>
    {children}
  </div>
);

const Input = (props) => (
  <input {...props} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", outline: "none", ...props.style }} />
);

const Select = ({ children, ...props }) => (
  <select {...props} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", background: "#fff", ...props.style }}>
    {children}
  </select>
);

const Btn = ({ children, onClick, color = "#1a1a2e", disabled }) => (
  <button onClick={onClick} disabled={disabled} style={{ background: color, color: "#fff", border: "none", borderRadius: 10, padding: "11px 20px", fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontSize: 14, opacity: disabled ? 0.6 : 1 }}>
    {children}
  </button>
);

export default function Home() {
  const [view, setView] = useState("dashboard");
  const [properties, setProperties] = useState([]);
  const [payments, setPayments] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Formularios
  const [propForm, setPropForm] = useState({ name: "", address: "", property_type: "depto", rent_amount: "", status: "disponible", notes: "" });
  const [payForm, setPayForm] = useState({ tenant_name: "", property_name: "", amount: "", due_date: "", status: "pendiente", payment_method: "transferencia", notes: "" });
  const [ticketForm, setTicketForm] = useState({ property_name: "", tenant_name: "", title: "", description: "", category: "otro", priority: "media", status: "nuevo" });

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = async () => {
    setLoading(true);
    const [p, pay, t] = await Promise.all([
      supabase.from("properties").select("*").order("created_at", { ascending: false }),
      supabase.from("payments").select("*").order("created_at", { ascending: false }),
      supabase.from("maintenance_tickets").select("*").order("created_at", { ascending: false }),
    ]);
    setProperties(p.data || []);
    setPayments(pay.data || []);
    setTickets(t.data || []);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const saveProperty = async () => {
    setSaving(true);
    const { error } = await supabase.from("properties").insert([{ ...propForm, rent_amount: parseFloat(propForm.rent_amount) || 0 }]);
    setSaving(false);
    if (error) { showToast("Error: " + error.message, false); return; }
    showToast("Propiedad guardada ✅");
    setShowModal(null);
    setPropForm({ name: "", address: "", property_type: "depto", rent_amount: "", status: "disponible", notes: "" });
    loadData();
  };

  const savePayment = async () => {
    setSaving(true);
    const { error } = await supabase.from("payments").insert([{ ...payForm, amount: parseFloat(payForm.amount) || 0 }]);
    setSaving(false);
    if (error) { showToast("Error: " + error.message, false); return; }
    showToast("Pago registrado ✅");
    setShowModal(null);
    setPayForm({ tenant_name: "", property_name: "", amount: "", due_date: "", status: "pendiente", payment_method: "transferencia", notes: "" });
    loadData();
  };

  const saveTicket = async () => {
    setSaving(true);
    const { error } = await supabase.from("maintenance_tickets").insert([{ ...ticketForm }]);
    setSaving(false);
    if (error) { showToast("Error: " + error.message, false); return; }
    showToast("Ticket creado ✅");
    setShowModal(null);
    setTicketForm({ property_name: "", tenant_name: "", title: "", description: "", category: "otro", priority: "media", status: "nuevo" });
    loadData();
  };

  const updatePaymentStatus = async (id, status) => {
    await supabase.from("payments").update({ status }).eq("id", id);
    showToast("Pago actualizado ✅");
    loadData();
  };

  const updateTicketStatus = async (id, status) => {
    await supabase.from("maintenance_tickets").update({ status }).eq("id", id);
    showToast("Ticket actualizado ✅");
    loadData();
  };

  const totalRent = properties.filter(p => p.status === "ocupada").reduce((a, p) => a + (p.rent_amount || 0), 0);
  const paid = payments.filter(p => p.status === "pagado").reduce((a, p) => a + (p.amount || 0), 0);
  const overdue = payments.filter(p => p.status === "atrasado").reduce((a, p) => a + (p.amount || 0), 0);
  const pending = payments.filter(p => p.status === "pendiente").reduce((a, p) => a + (p.amount || 0), 0);

  const nav = [
    { id: "dashboard", label: "📊 Panel" },
    { id: "properties", label: "🏠 Propiedades" },
    { id: "payments", label: "💰 Cobranza" },
    { id: "tickets", label: "🔧 Mantenimiento" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif", background: "#f4f5f7" }}>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 24, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 2000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}>
          {toast.msg}
        </div>
      )}

      {/* Sidebar */}
      <div style={{ width: 220, background: "#1a1a2e", display: "flex", flexDirection: "column", flexShrink: 0 }}>
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
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200 }}>
            <p style={{ color: "#6b7280", fontSize: 16 }}>Cargando datos...</p>
          </div>
        )}

        {!loading && view === "dashboard" && (
          <div>
            <h1 style={{ margin: "0 0 24px", fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>Panel de Control</h1>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 28 }}>
              {[
                { label: "Renta mensual total", value: fmt(totalRent), color: "#1a1a2e" },
                { label: "Cobrado", value: fmt(paid), color: "#065f46" },
                { label: "Pendiente", value: fmt(pending), color: "#92400e" },
                { label: "Atrasado", value: fmt(overdue), color: "#991b1b" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
                  <p style={{ margin: 0, fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div style={{ background: "#fff", borderRadius: 14, padding: 22, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Últimos pagos</h3>
                {payments.slice(0, 5).map(p => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{p.tenant_name || "—"}</p>
                      <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{p.property_name || "—"}</p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{fmt(p.amount)}</span>
                      <StatusBadge status={p.status} />
                    </div>
                  </div>
                ))}
                {payments.length === 0 && <p style={{ color: "#9ca3af", fontSize: 13 }}>No hay pagos registrados aún</p>}
              </div>
              <div style={{ background: "#fff", borderRadius: 14, padding: 22, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Resumen de propiedades</h3>
                {[
                  { label: "Ocupadas", count: properties.filter(p => p.status === "ocupada").length, color: "#065f46" },
                  { label: "Disponibles", count: properties.filter(p => p.status === "disponible").length, color: "#3730a3" },
                  { label: "En mantenimiento", count: properties.filter(p => p.status === "mantenimiento").length, color: "#9d174d" },
                  { label: "Total", count: properties.length, color: "#1a1a2e" },
                ].map((s, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
                    <span style={{ fontSize: 14, color: "#374151" }}>{s.label}</span>
                    <span style={{ fontWeight: 800, fontSize: 16, color: s.color }}>{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {!loading && view === "properties" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>Propiedades ({properties.length})</h1>
              <Btn color="#c8a96e" onClick={() => setShowModal("property")}>+ Nueva propiedad</Btn>
            </div>
            {properties.length === 0 && (
              <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center" }}>
                <p style={{ fontSize: 32, margin: "0 0 12px" }}>🏠</p>
                <p style={{ color: "#6b7280", fontSize: 16, margin: 0 }}>No tienes propiedades aún. ¡Agrega la primera!</p>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
              {properties.map(p => (
                <div key={p.id} style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <div style={{ background: "linear-gradient(135deg, #1a1a2e, #2d2d5e)", height: 70, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>
                    {p.property_type === "casa" ? "🏠" : p.property_type === "depto" ? "🏢" : p.property_type === "local" ? "🏪" : p.property_type === "bodega" ? "🏭" : "💼"}
                  </div>
                  <div style={{ padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{p.name}</h3>
                      <StatusBadge status={p.status} />
                    </div>
                    <p style={{ margin: "0 0 10px", fontSize: 12, color: "#6b7280" }}>📍 {p.address || "Sin dirección"}</p>
                    <div style={{ paddingTop: 10, borderTop: "1px solid #f3f4f6" }}>
                      <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Renta mensual</p>
                      <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#1a1a2e" }}>{fmt(p.rent_amount)}</p>
                    </div>
                    {p.notes && <p style={{ margin: "8px 0 0", fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>{p.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && view === "payments" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>Cobranza ({payments.length})</h1>
              <Btn color="#c8a96e" onClick={() => setShowModal("payment")}>+ Registrar pago</Btn>
            </div>
            {payments.length === 0 && (
              <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center" }}>
                <p style={{ fontSize: 32, margin: "0 0 12px" }}>💰</p>
                <p style={{ color: "#6b7280", fontSize: 16, margin: 0 }}>No hay pagos registrados aún.</p>
              </div>
            )}
            <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              {payments.length > 0 && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {["Arrendatario", "Propiedad", "Monto", "Vencimiento", "Método", "Estado", "Acciones"].map(h => (
                        <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14 }}>{p.tenant_name || "—"}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{p.property_name || "—"}</td>
                        <td style={{ padding: "12px 16px", fontWeight: 700 }}>{fmt(p.amount)}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{p.due_date || "—"}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{p.payment_method || "—"}</td>
                        <td style={{ padding: "12px 16px" }}><StatusBadge status={p.status} /></td>
                        <td style={{ padding: "12px 16px" }}>
                          <select onChange={e => updatePaymentStatus(p.id, e.target.value)} value={p.status}
                            style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12, cursor: "pointer" }}>
                            <option value="pendiente">Pendiente</option>
                            <option value="en_revision">En revisión</option>
                            <option value="pagado">Pagado</option>
                            <option value="atrasado">Atrasado</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {!loading && view === "tickets" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>Mantenimiento ({tickets.length})</h1>
              <Btn color="#c8a96e" onClick={() => setShowModal("ticket")}>+ Nuevo ticket</Btn>
            </div>
            {tickets.length === 0 && (
              <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center" }}>
                <p style={{ fontSize: 32, margin: "0 0 12px" }}>🔧</p>
                <p style={{ color: "#6b7280", fontSize: 16, margin: 0 }}>No hay tickets de mantenimiento aún.</p>
              </div>
            )}
            <div style={{ display: "grid", gap: 12 }}>
              {tickets.map(t => (
                <div key={t.id} style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>{t.title}</h3>
                      <p style={{ margin: "0 0 8px", fontSize: 13, color: "#6b7280" }}>
                        📍 {t.property_name || "—"} · 👤 {t.tenant_name || "—"}
                      </p>
                      {t.description && <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>{t.description}</p>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", marginLeft: 16 }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <StatusBadge status={t.priority} />
                        <StatusBadge status={t.status} />
                      </div>
                      <select onChange={e => updateTicketStatus(t.id, e.target.value)} value={t.status}
                        style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12, cursor: "pointer" }}>
                        <option value="nuevo">Nuevo</option>
                        <option value="en_proceso">En proceso</option>
                        <option value="resuelto">Resuelto</option>
                        <option value="cancelado">Cancelado</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modal: Nueva Propiedad */}
      {showModal === "property" && (
        <Modal title="Nueva Propiedad" onClose={() => setShowModal(null)}>
          <Field label="Nombre de la propiedad *">
            <Input placeholder="Ej: Depto 3B Torre Esmeralda" value={propForm.name} onChange={e => setPropForm({ ...propForm, name: e.target.value })} />
          </Field>
          <Field label="Dirección">
            <Input placeholder="Ej: Av. Insurgentes Sur 1234, CDMX" value={propForm.address} onChange={e => setPropForm({ ...propForm, address: e.target.value })} />
          </Field>
          <Field label="Tipo de propiedad">
            <Select value={propForm.property_type} onChange={e => setPropForm({ ...propForm, property_type: e.target.value })}>
              <option value="depto">Departamento</option>
              <option value="casa">Casa</option>
              <option value="local">Local comercial</option>
              <option value="bodega">Bodega</option>
              <option value="oficina">Oficina</option>
            </Select>
          </Field>
          <Field label="Renta mensual (MXN)">
            <Input type="number" placeholder="Ej: 12500" value={propForm.rent_amount} onChange={e => setPropForm({ ...propForm, rent_amount: e.target.value })} />
          </Field>
          <Field label="Estado">
            <Select value={propForm.status} onChange={e => setPropForm({ ...propForm, status: e.target.value })}>
              <option value="disponible">Disponible</option>
              <option value="ocupada">Ocupada</option>
              <option value="mantenimiento">En mantenimiento</option>
            </Select>
          </Field>
          <Field label="Notas (opcional)">
            <Input placeholder="Cualquier nota relevante" value={propForm.notes} onChange={e => setPropForm({ ...propForm, notes: e.target.value })} />
          </Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={() => setShowModal(null)} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={saveProperty} disabled={saving || !propForm.name}>{saving ? "Guardando..." : "Guardar propiedad"}</Btn>
          </div>
        </Modal>
      )}

      {/* Modal: Registrar Pago */}
      {showModal === "payment" && (
        <Modal title="Registrar Pago" onClose={() => setShowModal(null)}>
          <Field label="Nombre del arrendatario *">
            <Input placeholder="Ej: Ana García" value={payForm.tenant_name} onChange={e => setPayForm({ ...payForm, tenant_name: e.target.value })} />
          </Field>
          <Field label="Propiedad">
            <Input placeholder="Ej: Depto 3B Torre Esmeralda" value={payForm.property_name} onChange={e => setPayForm({ ...payForm, property_name: e.target.value })} />
          </Field>
          <Field label="Monto (MXN) *">
            <Input type="number" placeholder="Ej: 12500" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} />
          </Field>
          <Field label="Fecha de vencimiento">
            <Input type="date" value={payForm.due_date} onChange={e => setPayForm({ ...payForm, due_date: e.target.value })} />
          </Field>
          <Field label="Método de pago">
            <Select value={payForm.payment_method} onChange={e => setPayForm({ ...payForm, payment_method: e.target.value })}>
              <option value="transferencia">Transferencia</option>
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="cheque">Cheque</option>
            </Select>
          </Field>
          <Field label="Estado">
            <Select value={payForm.status} onChange={e => setPayForm({ ...payForm, status: e.target.value })}>
              <option value="pendiente">Pendiente</option>
              <option value="pagado">Pagado</option>
              <option value="atrasado">Atrasado</option>
              <option value="en_revision">En revisión</option>
            </Select>
          </Field>
          <Field label="Notas (opcional)">
            <Input placeholder="Cualquier nota" value={payForm.notes} onChange={e => setPayForm({ ...payForm, notes: e.target.value })} />
          </Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={() => setShowModal(null)} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={savePayment} disabled={saving || !payForm.tenant_name || !payForm.amount}>{saving ? "Guardando..." : "Registrar pago"}</Btn>
          </div>
        </Modal>
      )}

      {/* Modal: Nuevo Ticket */}
      {showModal === "ticket" && (
        <Modal title="Nuevo Ticket de Mantenimiento" onClose={() => setShowModal(null)}>
          <Field label="Título del problema *">
            <Input placeholder="Ej: Fuga de agua en baño" value={ticketForm.title} onChange={e => setTicketForm({ ...ticketForm, title: e.target.value })} />
          </Field>
          <Field label="Propiedad">
            <Input placeholder="Ej: Casa Satélite Oriente" value={ticketForm.property_name} onChange={e => setTicketForm({ ...ticketForm, property_name: e.target.value })} />
          </Field>
          <Field label="Arrendatario">
            <Input placeholder="Ej: Roberto Silva" value={ticketForm.tenant_name} onChange={e => setTicketForm({ ...ticketForm, tenant_name: e.target.value })} />
          </Field>
          <Field label="Descripción">
            <Input placeholder="Describe el problema con detalle" value={ticketForm.description} onChange={e => setTicketForm({ ...ticketForm, description: e.target.value })} />
          </Field>
          <Field label="Categoría">
            <Select value={ticketForm.category} onChange={e => setTicketForm({ ...ticketForm, category: e.target.value })}>
              <option value="plomería">Plomería</option>
              <option value="electricidad">Electricidad</option>
              <option value="pintura">Pintura</option>
              <option value="carpintería">Carpintería</option>
              <option value="otro">Otro</option>
            </Select>
          </Field>
          <Field label="Prioridad">
            <Select value={ticketForm.priority} onChange={e => setTicketForm({ ...ticketForm, priority: e.target.value })}>
              <option value="baja">Baja</option>
              <option value="media">Media</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
            </Select>
          </Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={() => setShowModal(null)} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={saveTicket} disabled={saving || !ticketForm.title}>{saving ? "Guardando..." : "Crear ticket"}</Btn>
          </div>
        </Modal>
      )}

    </div>
  );
}
