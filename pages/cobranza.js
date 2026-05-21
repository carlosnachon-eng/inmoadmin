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
    pagado:     { bg: "#d1fae5", color: "#065f46", label: "Pagado" },
    atrasado:   { bg: "#fee2e2", color: "#991b1b", label: "Atrasado" },
    pendiente:  { bg: "#fef3c7", color: "#92400e", label: "Pendiente" },
    en_revision:{ bg: "#dbeafe", color: "#1e40af", label: "En revisión" },
  };
  const s = map[status] || { bg: "#f3f4f6", color: "#374151", label: status };
  return <span style={{ background: s.bg, color: s.color, padding: "2px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{s.label}</span>;
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

export default function Cobranza() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterMonth, setFilterMonth] = useState("");

  const today = new Date().toISOString().split("T")[0];
  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };
  const isAdmin = profile?.role === "admin";

  const emptyForm = { tenant_name: "", tenant_email: "", property_name: "", amount: "", due_date: "", status: "pendiente", payment_method: "transferencia", notes: "" };
  const [form, setForm] = useState(emptyForm);

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
    const [pay, c, p] = await Promise.all([
      supabase.from("payments").select("*").order("due_date", { ascending: true }),
      supabase.from("contracts").select("*"),
      supabase.from("properties").select("*").order("name"),
    ]);
    setPayments(pay.data || []);
    setContracts(c.data || []);
    setProperties(p.data || []);
    setLoading(false);
  };

  useEffect(() => { if (session) loadData(); }, [session]);

  const updateStatus = async (id, status) => {
    const pago = payments.find(p => p.id === id);
    const contrato = pago ? contracts.find(c => c.id === pago.contract_id) : null;
    await supabase.from("payments").update({ status }).eq("id", id);
    if (status === "pagado" && pago) {
      const rentReceiver = contrato?.rent_receiver || "inmobiliaria";
      if (rentReceiver === "inmobiliaria") {
        const comision = contrato ? calcComision(contrato) : 0;
        await supabase.from("cash_movements").insert([{
          type: "entrada", category: "renta_cobrada",
          description: `Renta ${pago.tenant_name} - ${pago.property_name}`,
          amount: pago.amount, payment_method: "transferencia", date: today,
          notes: comision > 0 ? `Comisión incluida: ${fmt(comision)} (se retiene al liquidar)` : "",
          created_by: profile?.email, created_at: new Date().toISOString()
        }]);
      }
    }
    showToast("Actualizado");
    loadData();
  };

  const saveManual = async () => {
    setSaving(true);
    const { error } = await supabase.from("payments").insert([{ ...form, amount: parseFloat(form.amount) || 0 }]);
    setSaving(false);
    if (error) { showToast("Error: " + error.message, false); return; }
    showToast("Pago registrado");
    setShowModal(false);
    setForm(emptyForm);
    loadData();
  };

  const eliminar = async (id, nombre) => {
    if (!isAdmin) { showToast("Solo el admin puede eliminar", false); return; }
    if (!confirm(`¿Eliminar cobro de ${nombre}?`)) return;
    await supabase.from("payments").delete().eq("id", id);
    showToast("Eliminado"); loadData();
  };

  const sendWhatsApp = (p) => {
    const contrato = contracts.find(c => c.id === p.contract_id);
    const phone = contrato?.tenant_phone || "";
    if (!phone) { showToast("Sin teléfono — edita el contrato para agregarlo", false); return; }
    const phoneClean = phone.replace(/\D/g, "");
    const msg = encodeURIComponent(`Hola ${p.tenant_name}, te recordamos que tienes un pago pendiente de ${fmt(p.amount)} correspondiente a ${p.property_name} con fecha límite ${p.due_date}. Por favor regulariza tu pago. Gracias, Emporio Inmobiliario.`);
    window.open(`https://wa.me/52${phoneClean}?text=${msg}`, "_blank");
  };

  const sendEmail = async (p) => {
    if (!p.tenant_email) { showToast("Sin email — edita el contrato para agregarlo", false); return; }
    try {
      const res = await fetch("/api/send-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: p.tenant_email,
          subject: `Recordatorio de pago - ${p.property_name}`,
          html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;"><h2 style="color:#1a1a2e;">Recordatorio de pago de renta</h2><p>Hola <strong>${p.tenant_name}</strong>,</p><p>Te recordamos que tienes un pago pendiente:</p><div style="background:#f9fafb;border-radius:12px;padding:20px;margin:20px 0;"><p style="margin:0 0 8px;"><strong>Propiedad:</strong> ${p.property_name}</p><p style="margin:0 0 8px;"><strong>Monto:</strong> ${fmt(p.amount)}</p><p style="margin:0;"><strong>Fecha límite:</strong> ${p.due_date}</p></div><p>Por favor realiza tu pago a tiempo.</p></div>`
        })
      });
      const data = await res.json();
      if (data.success) showToast("Recordatorio enviado");
      else showToast("Error: " + data.error, false);
    } catch (e) { showToast("Error: " + e.message, false); }
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

  // ── STATS ──
  const hoy = new Date();
  const pagosMes = payments.filter(p => {
    if (!p.due_date) return false;
    const d = new Date(p.due_date);
    return d.getMonth() === hoy.getMonth() && d.getFullYear() === hoy.getFullYear();
  });
  const cobradoMes  = pagosMes.filter(p => p.status === "pagado").reduce((a, p) => a + (p.amount || 0), 0);
  const pendienteMes= pagosMes.filter(p => p.status === "pendiente").reduce((a, p) => a + (p.amount || 0), 0);
  const atrasadoTotal = payments.filter(p => p.status === "atrasado").reduce((a, p) => a + (p.amount || 0), 0);
  const enRevision  = payments.filter(p => p.status === "en_revision").length;

  const meses = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  const filtrados = payments.filter(p => {
    const matchSearch = !search || (p.tenant_name || "").toLowerCase().includes(search.toLowerCase()) || (p.property_name || "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = !filterStatus || p.status === filterStatus;
    const matchMonth  = !filterMonth || (p.due_date && new Date(p.due_date).getMonth() + 1 === parseInt(filterMonth));
    return matchSearch && matchStatus && matchMonth;
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
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#fff" }}>💰 Cobranza ({payments.length})</h1>
          </div>
        </div>
        <Btn color="#c8a96e" onClick={() => { setForm(emptyForm); setShowModal(true); }}>+ Manual</Btn>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {/* STATS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Cobrado este mes",   value: fmt(cobradoMes),   color: "#065f46", bg: "#f0fdf4" },
            { label: "Pendiente este mes", value: fmt(pendienteMes), color: "#92400e", bg: "#fffbeb" },
            { label: "Total atrasado",     value: fmt(atrasadoTotal),color: atrasadoTotal > 0 ? "#dc2626" : "#065f46", bg: atrasadoTotal > 0 ? "#fff5f5" : "#f0fdf4" },
            { label: "En revisión",        value: enRevision,        color: "#1e40af", bg: "#eff6ff" },
          ].map((s, i) => (
            <div key={i} style={{ background: s.bg, borderRadius: 14, padding: "14px 16px" }}>
              <p style={{ margin: "0 0 4px", fontSize: 10, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* FILTROS */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <input placeholder="Buscar inquilino o propiedad..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 160, padding: "7px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }} />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="en_revision">En revisión</option>
            <option value="pagado">Pagado</option>
            <option value="atrasado">Atrasado</option>
          </select>
          <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Todos los meses</option>
            {meses.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          {(search || filterStatus || filterMonth) && (
            <button onClick={() => { setSearch(""); setFilterStatus(""); setFilterMonth(""); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Limpiar</button>
          )}
          <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: "auto" }}>{filtrados.length} resultados</span>
        </div>

        {/* TABLA */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 48 }}><p style={{ color: "#6b7280" }}>Cargando...</p></div>
        ) : filtrados.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center" }}>
            <p style={{ color: "#6b7280" }}>No hay resultados</p>
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 14, overflowX: "auto", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 750 }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["Inquilino", "Propiedad", "Monto", "Vencimiento", "Estado", "Comprobante", "Actualizar", "Acciones"].map(h => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtrados.map(p => {
                  const contrato = contracts.find(c => c.id === p.contract_id);
                  return (
                    <tr key={p.id} style={{ borderTop: "1px solid #f3f4f6", background: p.status === "atrasado" ? "#fff5f5" : "#fff" }}>
                      <td style={{ padding: "11px 14px", fontWeight: 600, fontSize: 14 }}>{p.tenant_name || "-"}</td>
                      <td style={{ padding: "11px 14px", fontSize: 13, color: "#6b7280" }}>
                        {p.property_name || "-"}
                        {contrato && <span style={{ display: "block", fontSize: 10, color: contrato.rent_receiver === "propietario" ? "#3730a3" : "#065f46" }}>{contrato.rent_receiver === "propietario" ? "al propietario" : "a Emporio"}</span>}
                      </td>
                      <td style={{ padding: "11px 14px", fontWeight: 700 }}>{fmt(p.amount)}</td>
                      <td style={{ padding: "11px 14px", fontSize: 13, color: "#6b7280" }}>{p.due_date || "-"}</td>
                      <td style={{ padding: "11px 14px" }}><StatusBadge status={p.status} /></td>
                      <td style={{ padding: "11px 14px" }}>
                        {p.receipt_url
                          ? <a href={p.receipt_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#065f46", textDecoration: "none", background: "#d1fae5", padding: "4px 10px", borderRadius: 6, fontWeight: 600 }}>📄 Ver</a>
                          : <span style={{ fontSize: 12, color: "#d1d5db" }}>—</span>}
                      </td>
                      <td style={{ padding: "11px 14px" }}>
                        <select key={p.status} onChange={e => updateStatus(p.id, e.target.value)} value={p.status}
                          style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12, cursor: "pointer" }}>
                          <option value="pendiente">Pendiente</option>
                          <option value="en_revision">En revisión</option>
                          <option value="pagado">Pagado</option>
                          <option value="atrasado">Atrasado</option>
                        </select>
                      </td>
                      <td style={{ padding: "11px 14px" }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {["pendiente", "atrasado"].includes(p.status) && <Btn small color="#1e40af" onClick={() => sendEmail(p)}>Email</Btn>}
                          {["pendiente", "atrasado"].includes(p.status) && <Btn small color="#25d366" onClick={() => sendWhatsApp(p)}>WA</Btn>}
                          {isAdmin && <Btn small color="#dc2626" onClick={() => eliminar(p.id, p.tenant_name)}>X</Btn>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL MANUAL */}
      {showModal && (
        <Modal title="Registrar Pago Manual" onClose={() => { setShowModal(false); setForm(emptyForm); }}>
          <Field label="Inquilino"><Input value={form.tenant_name} onChange={e => setForm({ ...form, tenant_name: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={form.tenant_email} onChange={e => setForm({ ...form, tenant_email: e.target.value })} /></Field>
          <Field label="Propiedad">
            <Sel value={form.property_name} onChange={e => setForm({ ...form, property_name: e.target.value })}>
              <option value="">-- Selecciona --</option>
              {properties.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </Sel>
          </Field>
          <Field label="Monto"><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="Vencimiento"><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></Field>
          <Field label="Método">
            <Sel value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })}>
              <option value="transferencia">Transferencia</option>
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
            </Sel>
          </Field>
          <Field label="Estado">
            <Sel value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="pendiente">Pendiente</option>
              <option value="pagado">Pagado</option>
              <option value="atrasado">Atrasado</option>
            </Sel>
          </Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={() => { setShowModal(false); setForm(emptyForm); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={saveManual} disabled={saving || !form.tenant_name || !form.amount}>{saving ? "Guardando..." : "Registrar"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
