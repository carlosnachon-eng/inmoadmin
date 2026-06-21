import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";
import { PageHeader, brand } from "../components/Layout";
import { usePermiso, SinAcceso } from "../lib/permisos";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const calcComision = (c) => {
  if (!c.commission_value) return 0;
  if (c.commission_type === "porcentaje") return (c.monthly_rent * c.commission_value) / 100;
  return c.commission_value;
};

const generarPagos = (contrato) => {
  const pagos = [];
  const inicio = new Date(contrato.start_date);
  const fin = new Date(contrato.end_date);
  const diaCorte = parseInt(contrato.payment_day);
  const finMenosUnMes = new Date(fin);
  finMenosUnMes.setMonth(finMenosUnMes.getMonth() - 1);
  let fecha = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
  while (fecha <= finMenosUnMes) {
    const year = fecha.getFullYear();
    const month = fecha.getMonth() + 1;
    const diasEnMes = new Date(year, month, 0).getDate();
    const diaReal = Math.min(diaCorte, diasEnMes);
    const vencimiento = `${year}-${String(month).padStart(2, "0")}-${String(diaReal).padStart(2, "0")}`;
    pagos.push({
      contract_id: contrato.id, tenant_name: contrato.tenant_name,
      tenant_email: contrato.tenant_email || null, property_name: contrato.property_name,
      period_month: month, period_year: year, amount: contrato.monthly_rent,
      due_date: vencimiento, status: "pendiente"
    });
    fecha.setMonth(fecha.getMonth() + 1);
  }
  return pagos;
};

const Modal = ({ title, onClose, children }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{title}</h2>
        <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

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

export default function Contratos() {
  const router = useRouter();
  const { cargando: permisoCargando, puedeVer, esAdmin } = usePermiso("contratos");
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [contracts, setContracts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("activo");

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };
  const isAdmin = esAdmin;

  const emptyForm = {
    tenant_name: "", tenant_email: "", tenant_phone: "",
    co_responsable_nombre: "", co_responsable_telefono: "",
    owner_name: "", property_name: "", monthly_rent: "",
    start_date: "", end_date: "", payment_day: "5", deposit_amount: "",
    commission_type: "porcentaje", commission_value: "",
    commission_who: "propietario_descuento", commission_status: "pendiente_cobro",
    rent_receiver: "inmobiliaria", notes: ""
  };
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
    const [c, pay, p] = await Promise.all([
      supabase.from("contracts").select("*").order("created_at", { ascending: false }),
      supabase.from("payments").select("*"),
      supabase.from("properties").select("*").order("name"),
    ]);
    setContracts(c.data || []);
    setPayments(pay.data || []);
    setProperties(p.data || []);
    setLoading(false);
  };

  useEffect(() => { if (session) loadData(); }, [session]);

  const openEdit = (c) => {
    setForm({
      tenant_name: c.tenant_name || "", tenant_email: c.tenant_email || "",
      tenant_phone: c.tenant_phone || "",
      co_responsable_nombre: c.co_responsable_nombre || "",
      co_responsable_telefono: c.co_responsable_telefono || "",
      owner_name: c.owner_name || "", property_name: c.property_name || "",
      monthly_rent: c.monthly_rent || "", start_date: c.start_date || "",
      end_date: c.end_date || "", payment_day: c.payment_day || "5",
      deposit_amount: c.deposit_amount || "",
      commission_type: c.commission_type || "porcentaje",
      commission_value: c.commission_value || "",
      commission_who: c.commission_who || "propietario_descuento",
      commission_status: c.commission_status || "pendiente_cobro",
      rent_receiver: c.rent_receiver || "inmobiliaria", notes: c.notes || ""
    });
    setEditing(c.id);
    setShowModal(true);
  };

  const save = async () => {
    setSaving(true);
    const data = {
      tenant_name: form.tenant_name, tenant_email: form.tenant_email,
      tenant_phone: form.tenant_phone,
      co_responsable_nombre: form.co_responsable_nombre || null,
      co_responsable_telefono: form.co_responsable_telefono || null,
      owner_name: form.owner_name, property_name: form.property_name,
      monthly_rent: parseFloat(form.monthly_rent) || 0,
      start_date: form.start_date, end_date: form.end_date,
      payment_day: parseInt(form.payment_day),
      deposit_amount: parseFloat(form.deposit_amount) || 0,
      commission_type: form.commission_type,
      commission_value: parseFloat(form.commission_value) || 0,
      commission_who: form.commission_who,
      commission_status: form.commission_status || "pendiente_cobro",
      rent_receiver: form.rent_receiver, notes: form.notes
    };

    if (editing) {
      const { error } = await supabase.from("contracts").update(data).eq("id", editing);
      setSaving(false);
      if (error) { showToast("Error: " + error.message, false); return; }
      showToast("Contrato actualizado");
    } else {
      const { data: newContract, error } = await supabase.from("contracts").insert([{ ...data, status: "activo" }]).select().single();
      if (error) { setSaving(false); showToast("Error: " + error.message, false); return; }
      const pagos = generarPagos(newContract);
      const { error: ep } = await supabase.from("payments").insert(pagos);
      setSaving(false);
      if (ep) { showToast("Contrato creado pero error en pagos: " + ep.message, false); return; }
      showToast(`Contrato creado con ${pagos.length} cobros generados`);
    }

    setShowModal(false);
    setEditing(null);
    setForm(emptyForm);
    loadData();
  };

  const eliminar = async (id, nombre) => {
    if (!isAdmin) { showToast("Solo el admin puede eliminar", false); return; }
    if (!confirm(`¿Eliminar contrato de ${nombre}? También se eliminarán sus cobros.`)) return;
    await supabase.from("payments").delete().eq("contract_id", id);
    await supabase.from("contracts").delete().eq("id", id);
    showToast("Contrato eliminado");
    loadData();
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

  if (permisoCargando) return null;
  if (!puedeVer) return <SinAcceso />;

  const contratosFiltrados = contracts.filter(c => {
    if (filterStatus && c.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(c.tenant_name || "").toLowerCase().includes(q) &&
          !(c.property_name || "").toLowerCase().includes(q) &&
          !(c.owner_name || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: 320 }}>
          {toast.msg}
        </div>
      )}
      <PageHeader title="Contratos" icon="📋" actions={<><Btn color={brand.red} onClick={() => { setForm(emptyForm); setEditing(null); setShowModal(true); }}>+ Nuevo contrato</Btn></>} />


      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {/* FILTROS */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <input placeholder="Buscar inquilino, propiedad o propietario..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200, padding: "7px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }} />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Todos</option>
            <option value="activo">Activos</option>
            <option value="vencido">Vencidos</option>
          </select>
          {(search || filterStatus !== "activo") && (
            <button onClick={() => { setSearch(""); setFilterStatus("activo"); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Limpiar</button>
          )}
          <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: "auto" }}>{contratosFiltrados.length} contratos</span>
        </div>

        {/* ALERTA VENCIMIENTOS */}
        {(() => {
          const vencen = contracts.filter(c => {
            const dias = Math.ceil((new Date(c.end_date) - new Date()) / (1000 * 60 * 60 * 24));
            return dias >= 0 && dias <= 30 && c.status === "activo";
          });
          if (vencen.length === 0) return null;
          return (
            <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 12, padding: "12px 16px", marginBottom: 16 }}>
              <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 800, color: "#c2410c" }}>⚠️ {vencen.length} contrato{vencen.length > 1 ? "s" : ""} vence{vencen.length === 1 ? "" : "n"} en los próximos 30 días</p>
              {vencen.map(c => {
                const dias = Math.ceil((new Date(c.end_date) - new Date()) / (1000 * 60 * 60 * 24));
                return <p key={c.id} style={{ margin: "2px 0", fontSize: 12, color: "#92400e" }}>· {c.tenant_name} — {c.property_name} — vence en {dias} día{dias !== 1 ? "s" : ""} ({c.end_date})</p>;
              })}
            </div>
          );
        })()}

        {/* TABLA */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 48 }}><p style={{ color: "#6b7280" }}>Cargando...</p></div>
        ) : contratosFiltrados.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center" }}>
            <p style={{ color: "#6b7280" }}>No hay contratos</p>
            <button onClick={() => { setForm(emptyForm); setEditing(null); setShowModal(true); }} style={{ marginTop: 12, background: "#c8a96e", color: "#fff", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 700 }}>+ Crear primer contrato</button>
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 14, overflowX: "auto", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["Inquilino", "Teléfono", "Propietario", "Propiedad", "Renta", "Comisión", "Renta a", "Vigencia", "Día", "Cobros", ""].map(h => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contratosFiltrados.map(c => {
                  const dias = Math.ceil((new Date(c.end_date) - new Date()) / (1000 * 60 * 60 * 24));
                  const cobrosContrato = payments.filter(p => p.contract_id === c.id);
                  const cobradoContrato = cobrosContrato.filter(p => p.status === "pagado").length;
                  return (
                    <tr key={c.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "11px 14px", fontSize: 14 }}>
                        <p style={{ margin: 0, fontWeight: 600 }}>{c.tenant_name}</p>
                        {c.co_responsable_nombre && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#7c3aed" }}>{c.co_responsable_nombre}</p>}
                      </td>
                      <td style={{ padding: "11px 14px", fontSize: 13, color: "#6b7280" }}>
                        {c.tenant_phone || "-"}
                        {c.co_responsable_telefono && <span style={{ display: "block", fontSize: 11, color: "#9ca3af" }}>{c.co_responsable_telefono}</span>}
                      </td>
                      <td style={{ padding: "11px 14px", fontSize: 13, color: "#6b7280" }}>{c.owner_name || "-"}</td>
                      <td style={{ padding: "11px 14px", fontSize: 13, color: "#6b7280" }}>{c.property_name}</td>
                      <td style={{ padding: "11px 14px", fontWeight: 700 }}>{fmt(c.monthly_rent)}</td>
                      <td style={{ padding: "11px 14px", fontSize: 13, color: "#7c3aed", fontWeight: 700 }}>{fmt(calcComision(c))}</td>
                      <td style={{ padding: "11px 14px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: c.rent_receiver === "propietario" ? "#3730a3" : "#065f46", background: c.rent_receiver === "propietario" ? "#e0e7ff" : "#d1fae5", padding: "2px 8px", borderRadius: 99 }}>
                          {c.rent_receiver === "propietario" ? "Propietario" : "Emporio"}
                        </span>
                      </td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: "#6b7280" }}>
                        {c.start_date} — {c.end_date}
                        <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: dias <= 0 ? "#dc2626" : dias <= 30 ? "#d97706" : "#9ca3af" }}>
                          {dias <= 0 ? "Vencido" : `${dias}d restantes`}
                        </span>
                      </td>
                      <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 700 }}>Día {c.payment_day}</td>
                      <td style={{ padding: "11px 14px", fontSize: 13, color: "#6b7280" }}>{cobradoContrato}/{cobrosContrato.length}</td>
                      <td style={{ padding: "11px 14px" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <Btn small color="#6b7280" onClick={() => openEdit(c)}>Editar</Btn>
                          {isAdmin && <Btn small color="#dc2626" onClick={() => eliminar(c.id, c.tenant_name)}>X</Btn>}
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

      {/* MODAL */}
      {showModal && (
        <Modal title={editing ? "Editar Contrato" : "Nuevo Contrato"} onClose={() => { setShowModal(false); setEditing(null); setForm(emptyForm); }}>
          <Field label="Inquilino (Titular)"><Input value={form.tenant_name} onChange={e => setForm({ ...form, tenant_name: e.target.value })} /></Field>
          <Field label="Email del inquilino"><Input type="email" value={form.tenant_email} onChange={e => setForm({ ...form, tenant_email: e.target.value })} /></Field>
          <Field label="Teléfono del inquilino" hint="10 dígitos"><Input type="tel" placeholder="2221234567" value={form.tenant_phone} onChange={e => setForm({ ...form, tenant_phone: e.target.value })} /></Field>
          <div style={{ background: "#f5f3ff", border: "1px solid #e9d5ff", borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>Responsable adicional (opcional)</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Nombre"><Input placeholder="Nombre completo" value={form.co_responsable_nombre} onChange={e => setForm({ ...form, co_responsable_nombre: e.target.value })} /></Field>
              <Field label="Teléfono"><Input type="tel" placeholder="2221234567" value={form.co_responsable_telefono} onChange={e => setForm({ ...form, co_responsable_telefono: e.target.value })} /></Field>
            </div>
          </div>
          <Field label="Propietario"><Input value={form.owner_name} onChange={e => setForm({ ...form, owner_name: e.target.value })} /></Field>
          <Field label="Propiedad">
            <Sel value={form.property_name} onChange={e => {
              const sel = properties.find(p => p.name === e.target.value);
              setForm({ ...form, property_name: e.target.value, monthly_rent: sel ? sel.rent_amount : form.monthly_rent });
            }}>
              <option value="">-- Selecciona --</option>
              {properties.map(p => <option key={p.id} value={p.name}>{p.name} · {fmt(p.rent_amount)}/mes</option>)}
            </Sel>
          </Field>
          <Field label="Renta mensual"><Input type="number" value={form.monthly_rent} onChange={e => setForm({ ...form, monthly_rent: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Inicio"><Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></Field>
            <Field label="Fin"><Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></Field>
          </div>
          <Field label="Día de pago" hint="Del 1 al 28"><Input type="number" min="1" max="28" value={form.payment_day} onChange={e => setForm({ ...form, payment_day: e.target.value })} /></Field>
          <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: "#0369a1" }}>¿A quién le paga la renta el inquilino?</p>
            <Sel value={form.rent_receiver} onChange={e => setForm({ ...form, rent_receiver: e.target.value })}>
              <option value="inmobiliaria">A Emporio — entra a nuestra caja y nosotros le pagamos al propietario</option>
              <option value="propietario">Directo al propietario — solo registramos y cobramos comisión</option>
            </Sel>
          </div>
          <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>Comisión de administración</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Tipo">
                <Sel value={form.commission_type} onChange={e => setForm({ ...form, commission_type: e.target.value })}>
                  <option value="porcentaje">Porcentaje (%)</option>
                  <option value="fijo">Monto fijo</option>
                </Sel>
              </Field>
              <Field label={form.commission_type === "porcentaje" ? "%" : "MXN"}>
                <Input type="number" value={form.commission_value} onChange={e => setForm({ ...form, commission_value: e.target.value })} />
              </Field>
            </div>
            {form.commission_value && form.monthly_rent && (
              <div style={{ background: "#fff", borderRadius: 8, padding: "10px 12px" }}>
                <p style={{ margin: 0, fontSize: 13, color: "#7c3aed", fontWeight: 700 }}>
                  Tu comisión: {fmt(form.commission_type === "porcentaje" ? (parseFloat(form.monthly_rent) * parseFloat(form.commission_value) / 100) : parseFloat(form.commission_value))} / mes
                </p>
                <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>
                  {form.rent_receiver === "inmobiliaria" ? "Se retiene automáticamente al liquidar al propietario" : "El propietario te la pagará aparte — márcala en Comisiones cuando la recibas"}
                </p>
              </div>
            )}
          </div>
          <Field label="Depósito"><Input type="number" value={form.deposit_amount} onChange={e => setForm({ ...form, deposit_amount: e.target.value })} /></Field>
          <Field label="Notas"><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={() => { setShowModal(false); setEditing(null); setForm(emptyForm); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={save} disabled={saving || !form.tenant_name || !form.property_name || !form.monthly_rent || !form.start_date || !form.end_date}>
              {saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear contrato"}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
