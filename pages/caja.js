import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const categoryLabels = {
  renta_cobrada: "Renta cobrada", comision_cobrada: "Comisión cobrada",
  mantenimiento_cobrado: "Mantenimiento cobrado", anticipo_mantenimiento: "Anticipo mantenimiento",
  liquidacion_propietario: "Liquidación propietario", gasto_mantenimiento: "Gasto mantenimiento",
  gasto_operativo: "Gasto operativo", pago_proveedor: "Pago proveedor",
  material: "Material/Refacción", otro: "Otro",
};

const Modal = ({ title, onClose, children }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{title}</h2>
        <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>{label}</label>
    {children}
  </div>
);

const Input = (props) => (
  <input {...props} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", ...props.style }} />
);

const Sel = ({ children, ...props }) => (
  <select {...props} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff", boxSizing: "border-box" }}>
    {children}
  </select>
);

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

export default function Caja() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cashMovements, setCashMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterType, setFilterType] = useState("");
  const [filterMonth, setFilterMonth] = useState("");

  const emptyCash = {
    type: "entrada", category: "renta_cobrada", description: "",
    amount: "", payment_method: "transferencia",
    date: new Date().toISOString().split("T")[0], notes: ""
  };
  const [form, setForm] = useState(emptyCash);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };
  const isAdmin = profile?.role === "admin";
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
    const { data } = await supabase.from("cash_movements").select("*").order("date", { ascending: false });
    setCashMovements(data || []);
    setLoading(false);
  };

  useEffect(() => { if (session) loadData(); }, [session]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("cash_movements").insert([{
      ...form, amount: parseFloat(form.amount) || 0,
      created_by: profile?.email, created_at: new Date().toISOString()
    }]);
    setSaving(false);
    if (error) { showToast("Error: " + error.message, false); return; }
    showToast("Movimiento registrado");
    setShowModal(false);
    setForm(emptyCash);
    loadData();
  };

  const eliminar = async (id, desc) => {
    if (!isAdmin) { showToast("Solo el admin puede eliminar", false); return; }
    if (!confirm(`¿Eliminar: ${desc}?`)) return;
    await supabase.from("cash_movements").delete().eq("id", id);
    showToast("Eliminado");
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
  const totalEntradas   = cashMovements.filter(m => m.type === "entrada").reduce((a, m) => a + (m.amount || 0), 0);
  const totalSalidas    = cashMovements.filter(m => m.type === "salida").reduce((a, m) => a + (m.amount || 0), 0);
  const saldo           = totalEntradas - totalSalidas;
  const efectivo        = cashMovements.filter(m => m.type === "entrada" && m.payment_method === "efectivo").reduce((a, m) => a + (m.amount || 0), 0);
  const banco           = cashMovements.filter(m => m.type === "entrada" && m.payment_method === "transferencia").reduce((a, m) => a + (m.amount || 0), 0);

  const meses = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  const filtrados = cashMovements.filter(m => {
    if (filterType && m.type !== filterType) return false;
    if (filterMonth && new Date(m.date).getMonth() + 1 !== parseInt(filterMonth)) return false;
    return true;
  });

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
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#fff" }}>💵 Caja / Tesorería</h1>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn color="#065f46" onClick={() => { setForm({ ...emptyCash, type: "entrada" }); setShowModal(true); }}>+ Entrada</Btn>
          <Btn color="#dc2626" onClick={() => { setForm({ ...emptyCash, type: "salida" }); setShowModal(true); }}>− Salida</Btn>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {/* NOTA */}
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "10px 16px", marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 12, color: "#1e40af", fontWeight: 600 }}>
            Solo refleja dinero que entra y sale de Emporio. Las rentas que van directo al propietario NO aparecen aquí.
          </p>
        </div>

        {/* STATS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Saldo Emporio",  value: fmt(saldo),         color: saldo >= 0 ? "#065f46" : "#dc2626", bg: saldo >= 0 ? "#f0fdf4" : "#fff5f5" },
            { label: "Total entradas", value: fmt(totalEntradas), color: "#065f46", bg: "#f0fdf4" },
            { label: "Total salidas",  value: fmt(totalSalidas),  color: "#dc2626", bg: "#fff5f5" },
            { label: "Efectivo",       value: fmt(efectivo),      color: "#92400e", bg: "#fffbeb" },
            { label: "Banco",          value: fmt(banco),         color: "#1e40af", bg: "#eff6ff" },
          ].map((s, i) => (
            <div key={i} style={{ background: s.bg, borderRadius: 14, padding: "14px 16px" }}>
              <p style={{ margin: "0 0 4px", fontSize: 10, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* FILTROS */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Entradas y salidas</option>
            <option value="entrada">Solo entradas</option>
            <option value="salida">Solo salidas</option>
          </select>
          <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Todos los meses</option>
            {meses.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          {(filterType || filterMonth) && (
            <button onClick={() => { setFilterType(""); setFilterMonth(""); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Limpiar</button>
          )}
          <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: "auto" }}>{filtrados.length} movimientos</span>
        </div>

        {/* TABLA */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 48 }}><p style={{ color: "#6b7280" }}>Cargando...</p></div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            {filtrados.length === 0 ? (
              <div style={{ padding: 48, textAlign: "center" }}>
                <p style={{ color: "#6b7280" }}>Sin movimientos</p>
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 650 }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    {["Fecha", "Tipo", "Categoría", "Descripción", "Método", "Monto", "Por", ""].map(h => (
                      <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map(m => (
                    <tr key={m.id} style={{ borderTop: "1px solid #f3f4f6", background: m.type === "entrada" ? "#f9fffe" : "#fffafa" }}>
                      <td style={{ padding: "11px 14px", fontSize: 13, color: "#6b7280" }}>{m.date}</td>
                      <td style={{ padding: "11px 14px" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: m.type === "entrada" ? "#065f46" : "#dc2626", background: m.type === "entrada" ? "#d1fae5" : "#fee2e2", padding: "2px 8px", borderRadius: 99 }}>
                          {m.type === "entrada" ? "Entrada" : "Salida"}
                        </span>
                      </td>
                      <td style={{ padding: "11px 14px", fontSize: 13, color: "#6b7280" }}>{categoryLabels[m.category] || m.category}</td>
                      <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 600, color: "#1a1a2e" }}>{m.description}</td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: "#9ca3af" }}>{m.payment_method}</td>
                      <td style={{ padding: "11px 14px", fontWeight: 800, fontSize: 14, color: m.type === "entrada" ? "#065f46" : "#dc2626" }}>
                        {m.type === "entrada" ? "+" : "−"}{fmt(m.amount)}
                      </td>
                      <td style={{ padding: "11px 14px", fontSize: 11, color: "#9ca3af" }}>{m.created_by?.split("@")[0] || "sistema"}</td>
                      <td style={{ padding: "11px 14px" }}>
                        {isAdmin && <Btn small color="#dc2626" onClick={() => eliminar(m.id, m.description)}>X</Btn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* MODAL */}
      {showModal && (
        <Modal title={form.type === "entrada" ? "Registrar Entrada" : "Registrar Salida"} onClose={() => { setShowModal(false); setForm(emptyCash); }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            <button onClick={() => setForm({ ...form, type: "entrada" })} style={{ flex: 1, padding: 10, borderRadius: 8, border: `2px solid ${form.type === "entrada" ? "#065f46" : "#e5e7eb"}`, background: form.type === "entrada" ? "#f0fdf4" : "#fff", color: form.type === "entrada" ? "#065f46" : "#6b7280", fontWeight: 700, cursor: "pointer" }}>Entrada</button>
            <button onClick={() => setForm({ ...form, type: "salida" })} style={{ flex: 1, padding: 10, borderRadius: 8, border: `2px solid ${form.type === "salida" ? "#dc2626" : "#e5e7eb"}`, background: form.type === "salida" ? "#fff5f5" : "#fff", color: form.type === "salida" ? "#dc2626" : "#6b7280", fontWeight: 700, cursor: "pointer" }}>Salida</button>
          </div>
          <Field label="Categoría">
            <Sel value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {form.type === "entrada" ? (
                <><option value="renta_cobrada">Renta cobrada</option><option value="comision_cobrada">Comisión cobrada</option><option value="mantenimiento_cobrado">Mantenimiento cobrado</option><option value="anticipo_mantenimiento">Anticipo mantenimiento</option><option value="otro">Otro ingreso</option></>
              ) : (
                <><option value="liquidacion_propietario">Liquidación propietario</option><option value="pago_proveedor">Pago proveedor</option><option value="material">Material/Refacción</option><option value="gasto_operativo">Gasto operativo</option><option value="otro">Otro gasto</option></>
              )}
            </Sel>
          </Field>
          <Field label="Descripción"><Input placeholder="Describe el movimiento" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Monto"><Input type="number" placeholder="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Método">
              <Sel value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })}>
                <option value="transferencia">Transferencia</option>
                <option value="efectivo">Efectivo</option>
              </Sel>
            </Field>
            <Field label="Fecha"><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
          </div>
          <Field label="Notas"><Input placeholder="Observaciones" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={() => { setShowModal(false); setForm(emptyCash); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={save} color={form.type === "entrada" ? "#065f46" : "#dc2626"} disabled={saving || !form.description || !form.amount}>
              {saving ? "Guardando..." : "Registrar"}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
