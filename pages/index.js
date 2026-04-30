import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const StatusBadge = ({ status }) => {
  const map = {
    pagado: { bg: "#d1fae5", color: "#065f46", label: "Pagado" },
    pagado_parcial: { bg: "#dbeafe", color: "#1e40af", label: "Pagado parcial" },
    atrasado: { bg: "#fee2e2", color: "#991b1b", label: "Atrasado" },
    pendiente: { bg: "#fef3c7", color: "#92400e", label: "Pendiente" },
    en_revision: { bg: "#dbeafe", color: "#1e40af", label: "En revisión" },
    ocupada: { bg: "#d1fae5", color: "#065f46", label: "Ocupada" },
    disponible: { bg: "#e0e7ff", color: "#3730a3", label: "Disponible" },
    activo: { bg: "#d1fae5", color: "#065f46", label: "Activo" },
    vencido: { bg: "#fee2e2", color: "#991b1b", label: "Vencido" },
    nuevo: { bg: "#fef3c7", color: "#92400e", label: "Nuevo" },
    en_proceso: { bg: "#dbeafe", color: "#1e40af", label: "En proceso" },
    resuelto: { bg: "#d1fae5", color: "#065f46", label: "Resuelto" },
    mantenimiento: { bg: "#fce7f3", color: "#9d174d", label: "Mantenimiento" },
    entrada: { bg: "#d1fae5", color: "#065f46", label: "Entrada" },
    salida: { bg: "#fee2e2", color: "#991b1b", label: "Salida" },
    inmobiliaria: { bg: "#d1fae5", color: "#065f46", label: "A nosotros" },
    propietario: { bg: "#e0e7ff", color: "#3730a3", label: "Al propietario" },
    cobrada: { bg: "#d1fae5", color: "#065f46", label: "Cobrada" },
    pendiente_cobro: { bg: "#fef3c7", color: "#92400e", label: "Pendiente cobro" },
  };
  const s = map[status] || { bg: "#f3f4f6", color: "#374151", label: status };
  return <span style={{ background: s.bg, color: s.color, padding: "2px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{s.label}</span>;
};

const Modal = ({ title, onClose, children }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{title}</h2>
        <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

const ConfirmModal = ({ message, onConfirm, onCancel }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <p style={{ fontSize: 16, fontWeight: 700, color: "#1a1a2e", margin: "0 0 8px" }}>¿Estás seguro?</p>
      <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 24px" }}>{message}</p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
        <button onClick={onConfirm} style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 700 }}>Sí, eliminar</button>
      </div>
    </div>
  </div>
);

const Field = ({ label, hint, children }) => (
  <div style={{ marginBottom: 16 }}>
    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>{label}</label>
    {hint && <p style={{ margin: "0 0 6px", fontSize: 11, color: "#9ca3af" }}>{hint}</p>}
    {children}
  </div>
);

const Input = (props) => (
  <input {...props} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", ...props.style }} />
);

const Sel = ({ children, ...props }) => (
  <select {...props} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", background: "#fff", ...props.style }}>
    {children}
  </select>
);

const Btn = ({ children, onClick, color = "#1a1a2e", disabled, small }) => (
  <button onClick={onClick} disabled={disabled} style={{
    background: color, color: "#fff", border: "none", borderRadius: small ? 6 : 10,
    padding: small ? "5px 10px" : "11px 20px", fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer", fontSize: small ? 12 : 14,
    opacity: disabled ? 0.6 : 1
  }}>
    {children}
  </button>
);

const calcComision = (contrato) => {
  if (!contrato.commission_value) return 0;
  if (contrato.commission_type === "porcentaje") return (contrato.monthly_rent * contrato.commission_value) / 100;
  return contrato.commission_value;
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
    pagos.push({ contract_id: contrato.id, tenant_name: contrato.tenant_name, tenant_email: contrato.tenant_email || null, property_name: contrato.property_name, period_month: month, period_year: year, amount: contrato.monthly_rent, due_date: vencimiento, status: "pendiente" });
    fecha.setMonth(fecha.getMonth() + 1);
  }
  return pagos;
};

const addCashMovement = async (data) => {
  await supabase.from("cash_movements").insert([{ ...data, created_at: new Date().toISOString() }]);
};

const expenseCategoryLabels = {
  condominio: "🏢 Condominio",
  predial: "🏛️ Predial",
  agua: "💧 Agua",
  luz: "⚡ Luz",
  gas: "🔥 Gas",
  seguro: "🛡️ Seguro",
  mantenimiento_comun: "🔧 Mantenimiento común",
  otro: "📌 Otro",
};

const LoginScreen = ({ onLogin }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const handleLogin = async () => {
    setLoading(true); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError("Email o contraseña incorrectos");
    else onLogin();
  };
  return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 48, width: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏢</div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#1a1a2e" }}>InmoAdmin</h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "#6b7280" }}>Emporio Inmobiliario</p>
        </div>
        {error && <div style={{ background: "#fee2e2", color: "#991b1b", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 14, fontWeight: 600 }}>{error}</div>}
        <Field label="Email"><Input type="email" placeholder="tu@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} /></Field>
        <Field label="Contraseña"><Input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} /></Field>
        <button onClick={handleLogin} disabled={loading || !email || !password} style={{ width: "100%", background: "#c8a96e", color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontWeight: 800, cursor: loading ? "not-allowed" : "pointer", fontSize: 16, marginTop: 8, opacity: loading ? 0.7 : 1 }}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </div>
    </div>
  );
};

const categoryLabels = {
  renta_cobrada: "💰 Renta cobrada",
  comision_cobrada: "💼 Comisión cobrada",
  mantenimiento_cobrado: "🔧 Mantenimiento cobrado",
  anticipo_mantenimiento: "🔧 Anticipo mantenimiento",
  liquidacion_propietario: "🏦 Liquidación propietario",
  gasto_mantenimiento: "🔨 Gasto mantenimiento",
  gasto_operativo: "📋 Gasto operativo",
  pago_proveedor: "🛠️ Pago proveedor",
  material: "📦 Material/Refacción",
  otro: "📌 Otro",
};

export default function Home() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  const [properties, setProperties] = useState([]);
  const [payments, setPayments] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [ownerPayments, setOwnerPayments] = useState([]);
  const [cashMovements, setCashMovements] = useState([]);
  const [propertyExpenses, setPropertyExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [searchPago, setSearchPago] = useState("");
  const [filterEstatus, setFilterEstatus] = useState("");
  const [filterMes, setFilterMes] = useState("");

  // ── CAMBIO 1: emptyContract con co-responsable y commission_status ──────────
  const emptyProp = { name: "", address: "", property_type: "depto", rent_amount: "", status: "disponible", notes: "", owner_email: "", owner_phone: "" };
  const emptyContract = {
    tenant_name: "", tenant_email: "", tenant_phone: "",
    co_responsable_nombre: "", co_responsable_telefono: "", // NUEVO
    owner_name: "", property_name: "", monthly_rent: "",
    start_date: "", end_date: "", payment_day: "5", deposit_amount: "",
    commission_type: "porcentaje", commission_value: "",
    commission_who: "propietario_descuento", commission_status: "pendiente_cobro", // NUEVO
    rent_receiver: "inmobiliaria", notes: ""
  };
  const emptyPayment = { tenant_name: "", tenant_email: "", property_name: "", amount: "", due_date: "", status: "pendiente", payment_method: "transferencia", notes: "" };
  const emptyTicket = { property_name: "", tenant_name: "", title: "", description: "", category: "otro", priority: "media", payer: "propietario", provider_cost: "", charged_amount: "", advance_amount: "", advance_paid: false };
  const emptyOwnerPayment = { owner_name: "", owner_email: "", period_description: "", total_rent: "", total_commission: "", total_liquid: "", amount_paid: "", payment_method: "transferencia", payment_date: "", status: "pagado", notes: "" };
  const emptyCash = { type: "entrada", category: "renta_cobrada", description: "", amount: "", payment_method: "transferencia", date: new Date().toISOString().split("T")[0], notes: "" };
  const emptyExpense = { property_name: "", category: "condominio", description: "", amount: "", paid_by: "propietario", payment_method: "transferencia", date: new Date().toISOString().split("T")[0], notes: "" };

  const [propForm, setPropForm] = useState(emptyProp);
  const [contractForm, setContractForm] = useState(emptyContract);
  const [payForm, setPayForm] = useState(emptyPayment);
  const [ticketForm, setTicketForm] = useState(emptyTicket);
  const [ownerPayForm, setOwnerPayForm] = useState(emptyOwnerPayment);
  const [cashForm, setCashForm] = useState(emptyCash);
  const [expenseForm, setExpenseForm] = useState(emptyExpense);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };
  const isAdmin = profile?.role === "admin";
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); if (session) loadProfile(session.user.id); else setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session); if (session) loadProfile(session.user.id); else { setProfile(null); setAuthLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (userId) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    setProfile(data); setAuthLoading(false);
  };

  const logout = async () => { await supabase.auth.signOut(); setSession(null); setProfile(null); };

  const loadData = async () => {
    setLoading(true);
    const [p, pay, t, c, op, cm, pe] = await Promise.all([
      supabase.from("properties").select("*").order("created_at", { ascending: false }),
      supabase.from("payments").select("*").order("due_date", { ascending: true }),
      supabase.from("maintenance_tickets").select("*").order("created_at", { ascending: false }),
      supabase.from("contracts").select("*").order("created_at", { ascending: false }),
      supabase.from("owner_payments").select("*").order("created_at", { ascending: false }),
      supabase.from("cash_movements").select("*").order("date", { ascending: false }),
      supabase.from("property_expenses").select("*").order("date", { ascending: false }),
    ]);
    setProperties(p.data || []); setPayments(pay.data || []); setTickets(t.data || []);
    setContracts(c.data || []); setOwnerPayments(op.data || []); setCashMovements(cm.data || []);
    setPropertyExpenses(pe.data || []);
    setLoading(false);
  };

  useEffect(() => { if (session) loadData(); }, [session]);

  // ── CAMBIO 2: openEdit con co-responsable y commission_status ───────────────
  const openEdit = (type, item) => {
    setEditing({ type, id: item.id });
    if (type === "property") { setPropForm({ name: item.name || "", address: item.address || "", property_type: item.property_type || "depto", rent_amount: item.rent_amount || "", status: item.status || "disponible", notes: item.notes || "", owner_email: item.owner_email || "", owner_phone: item.owner_phone || "" }); setShowModal("property"); }
    if (type === "contract") {
      setContractForm({
        tenant_name: item.tenant_name || "", tenant_email: item.tenant_email || "",
        tenant_phone: item.tenant_phone || "",
        co_responsable_nombre: item.co_responsable_nombre || "", // NUEVO
        co_responsable_telefono: item.co_responsable_telefono || "", // NUEVO
        owner_name: item.owner_name || "", property_name: item.property_name || "",
        monthly_rent: item.monthly_rent || "", start_date: item.start_date || "",
        end_date: item.end_date || "", payment_day: item.payment_day || "5",
        deposit_amount: item.deposit_amount || "", commission_type: item.commission_type || "porcentaje",
        commission_value: item.commission_value || "", commission_who: item.commission_who || "propietario_descuento",
        commission_status: item.commission_status || "pendiente_cobro", // NUEVO
        rent_receiver: item.rent_receiver || "inmobiliaria", notes: item.notes || ""
      });
      setShowModal("contract");
    }
    if (type === "ticket") { setTicketForm({ property_name: item.property_name || "", tenant_name: item.tenant_name || "", title: item.title || "", description: item.description || "", category: item.category || "otro", priority: item.priority || "media", payer: item.payer || "propietario", provider_cost: item.provider_cost || "", charged_amount: item.charged_amount || "", advance_amount: item.advance_amount || "", advance_paid: item.advance_paid || false }); setShowModal("ticket"); }
  };

  const closeModal = () => { setShowModal(null); setEditing(null); setPropForm(emptyProp); setContractForm(emptyContract); setPayForm(emptyPayment); setTicketForm(emptyTicket); setOwnerPayForm(emptyOwnerPayment); setCashForm(emptyCash); setExpenseForm(emptyExpense); };

  const saveProperty = async () => {
    setSaving(true);
    const data = { ...propForm, rent_amount: parseFloat(propForm.rent_amount) || 0 };
    const { error } = editing?.type === "property" ? await supabase.from("properties").update(data).eq("id", editing.id) : await supabase.from("properties").insert([data]);
    setSaving(false);
    if (error) { showToast("Error: " + error.message, false); return; }
    showToast(editing ? "Propiedad actualizada ✅" : "Propiedad guardada ✅");
    closeModal(); loadData();
  };

  // ── CAMBIO 3: saveContract con co-responsable y commission_status ───────────
  const saveContract = async () => {
    setSaving(true);
    const contractData = {
      tenant_name: contractForm.tenant_name, tenant_email: contractForm.tenant_email,
      tenant_phone: contractForm.tenant_phone,
      co_responsable_nombre: contractForm.co_responsable_nombre || null, // NUEVO
      co_responsable_telefono: contractForm.co_responsable_telefono || null, // NUEVO
      owner_name: contractForm.owner_name, property_name: contractForm.property_name,
      monthly_rent: parseFloat(contractForm.monthly_rent) || 0,
      start_date: contractForm.start_date, end_date: contractForm.end_date,
      payment_day: parseInt(contractForm.payment_day),
      deposit_amount: parseFloat(contractForm.deposit_amount) || 0,
      commission_type: contractForm.commission_type,
      commission_value: parseFloat(contractForm.commission_value) || 0,
      commission_who: contractForm.commission_who,
      commission_status: contractForm.commission_status || "pendiente_cobro", // NUEVO
      rent_receiver: contractForm.rent_receiver, notes: contractForm.notes
    };
    if (editing?.type === "contract") {
      const { error } = await supabase.from("contracts").update(contractData).eq("id", editing.id);
      setSaving(false);
      if (error) { showToast("Error: " + error.message, false); return; }
      showToast("Contrato actualizado ✅"); closeModal(); loadData(); return;
    }
    const { data: newContract, error } = await supabase.from("contracts").insert([{ ...contractData, status: "activo" }]).select().single();
    if (error) { setSaving(false); showToast("Error: " + error.message, false); return; }
    const pagos = generarPagos(newContract);
    const { error: ep } = await supabase.from("payments").insert(pagos);
    setSaving(false);
    if (ep) { showToast("Contrato creado pero error en pagos: " + ep.message, false); return; }
    showToast(`✅ Contrato creado con ${pagos.length} cobros generados`);
    closeModal(); loadData();
  };

  const savePayment = async () => {
    setSaving(true);
    const { error } = await supabase.from("payments").insert([{ ...payForm, amount: parseFloat(payForm.amount) || 0 }]);
    setSaving(false);
    if (error) { showToast("Error: " + error.message, false); return; }
    showToast("Pago registrado ✅"); closeModal(); loadData();
  };

  const saveTicket = async () => {
    setSaving(true);
    const ticketData = { ...ticketForm, status: editing ? ticketForm.status || "nuevo" : "nuevo", provider_cost: parseFloat(ticketForm.provider_cost) || 0, charged_amount: parseFloat(ticketForm.charged_amount) || 0, advance_amount: parseFloat(ticketForm.advance_amount) || 0 };
    const { error } = editing?.type === "ticket"
      ? await supabase.from("maintenance_tickets").update(ticketData).eq("id", editing.id)
      : await supabase.from("maintenance_tickets").insert([ticketData]);
    if (error) { setSaving(false); showToast("Error: " + error.message, false); return; }
    if (!editing && ticketData.advance_amount > 0 && ticketData.advance_paid) {
      await addCashMovement({ type: "entrada", category: "anticipo_mantenimiento", description: `Anticipo: ${ticketData.title} — ${ticketData.property_name}`, amount: ticketData.advance_amount, payment_method: "transferencia", date: today, created_by: profile?.email });
    }
    setSaving(false);
    showToast(editing ? "Ticket actualizado ✅" : "Ticket creado ✅"); closeModal(); loadData();
  };

  const saveOwnerPayment = async () => {
    setSaving(true);
    const data = { ...ownerPayForm, total_rent: parseFloat(ownerPayForm.total_rent) || 0, total_commission: parseFloat(ownerPayForm.total_commission) || 0, total_liquid: parseFloat(ownerPayForm.total_liquid) || 0, amount_paid: parseFloat(ownerPayForm.amount_paid) || 0 };
    const { error } = await supabase.from("owner_payments").insert([data]);
    if (error) { setSaving(false); showToast("Error: " + error.message, false); return; }
    await addCashMovement({ type: "salida", category: "liquidacion_propietario", description: `Liquidación ${ownerPayForm.owner_name} — ${ownerPayForm.period_description}`, amount: parseFloat(ownerPayForm.amount_paid) || 0, payment_method: ownerPayForm.payment_method, date: ownerPayForm.payment_date || today, notes: ownerPayForm.notes, created_by: profile?.email });
    setSaving(false);
    showToast("Liquidación registrada ✅"); closeModal(); loadData();
  };

  const saveCashMovement = async () => {
    setSaving(true);
    const data = { ...cashForm, amount: parseFloat(cashForm.amount) || 0, created_by: profile?.email };
    const { error } = await supabase.from("cash_movements").insert([data]);
    setSaving(false);
    if (error) { showToast("Error: " + error.message, false); return; }
    showToast("Movimiento registrado ✅"); closeModal(); loadData();
  };

  const saveExpense = async () => {
    setSaving(true);
    const amount = parseFloat(expenseForm.amount) || 0;
    const data = { ...expenseForm, amount, created_by: profile?.email };
    const { error } = await supabase.from("property_expenses").insert([data]);
    if (error) { setSaving(false); showToast("Error: " + error.message, false); return; }
    if (expenseForm.paid_by === "inmobiliaria") {
      await addCashMovement({ type: "salida", category: "gasto_operativo", description: `${expenseCategoryLabels[expenseForm.category] || expenseForm.category}: ${expenseForm.description} — ${expenseForm.property_name}`, amount, payment_method: expenseForm.payment_method, date: expenseForm.date, created_by: profile?.email });
    }
    setSaving(false);
    showToast("Gasto registrado ✅"); closeModal(); loadData();
  };

  const openExpenseModal = (propertyName) => {
    setExpenseForm({ ...emptyExpense, property_name: propertyName });
    setShowModal("expense");
  };

  // ── CAMBIO 4: updatePaymentStatus — comisión va a caja SOLO si ya está cobrada ─
  const updatePaymentStatus = async (id, status) => {
    const pago = payments.find(p => p.id === id);
    const contrato = pago ? contracts.find(c => c.id === pago.contract_id) : null;
    await supabase.from("payments").update({ status }).eq("id", id);
    if (status === "pagado" && pago) {
      const rentReceiver = contrato?.rent_receiver || "inmobiliaria";
      const comision = contrato ? calcComision(contrato) : 0;
      if (rentReceiver === "inmobiliaria") {
        await addCashMovement({ type: "entrada", category: "renta_cobrada", description: `Renta ${pago.tenant_name} — ${pago.property_name}`, amount: pago.amount, payment_method: "transferencia", date: today, notes: comision > 0 ? `Incluye comisión de ${fmt(comision)}` : "", created_by: profile?.email });
      } else {
        // Renta directa al propietario: la comisión solo entra a caja si ya está marcada como cobrada
        if (comision > 0 && contrato?.commission_who === "propietario_aparte" && contrato?.commission_status === "cobrada") {
          await addCashMovement({ type: "entrada", category: "comision_cobrada", description: `Comisión ${contrato?.owner_name || pago.property_name} (renta directa)`, amount: comision, payment_method: "transferencia", date: today, created_by: profile?.email });
        }
        // Si está pendiente, solo se registra el pago de renta pero la comisión queda pendiente
      }
    }
    showToast("Actualizado ✅"); loadData();
  };

  // ── CAMBIO 5: Nueva función para marcar comisión como cobrada ───────────────
  const marcarComisionCobrada = async (contrato) => {
    const comision = calcComision(contrato);
    await supabase.from("contracts").update({ commission_status: "cobrada" }).eq("id", contrato.id);
    await addCashMovement({
      type: "entrada", category: "comision_cobrada",
      description: `Comisión ${contrato.owner_name || contrato.property_name} — ${contrato.tenant_name}`,
      amount: comision, payment_method: "transferencia", date: today, created_by: profile?.email
    });
    showToast(`✅ Comisión de ${fmt(comision)} registrada en caja`);
    loadData();
  };

  const marcarComisionPendiente = async (contratoId) => {
    await supabase.from("contracts").update({ commission_status: "pendiente_cobro" }).eq("id", contratoId);
    showToast("Comisión marcada como pendiente");
    loadData();
  };

  const updateTicketStatus = async (id, status) => {
    await supabase.from("maintenance_tickets").update({ status }).eq("id", id);
    if (status === "resuelto") {
      const ticket = tickets.find(t => t.id === id);
      if (ticket && ticket.provider_cost > 0) {
        await addCashMovement({ type: "salida", category: "pago_proveedor", description: `Proveedor: ${ticket.title} — ${ticket.property_name}`, amount: ticket.provider_cost, payment_method: "transferencia", date: today, created_by: profile?.email });
      }
      if (ticket && ticket.charged_amount > 0 && ticket.payer !== "inmobiliaria") {
        await addCashMovement({ type: "entrada", category: "mantenimiento_cobrado", description: `Cobro mant: ${ticket.title} — ${ticket.property_name}`, amount: ticket.charged_amount, payment_method: "transferencia", date: today, created_by: profile?.email });
      }
    }
    showToast("Actualizado ✅"); loadData();
  };

  const sendReminder = async (payment) => {
    if (!payment.tenant_email) { showToast("Sin email — edita el contrato para agregarlo", false); return; }
    try {
      const res = await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: payment.tenant_email, subject: `Recordatorio de pago — ${payment.property_name}`, html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;"><h2 style="color:#1a1a2e;">Recordatorio de pago de renta</h2><p>Hola <strong>${payment.tenant_name}</strong>,</p><p>Te recordamos que tienes un pago pendiente:</p><div style="background:#f9fafb;border-radius:12px;padding:20px;margin:20px 0;"><p style="margin:0 0 8px;"><strong>Propiedad:</strong> ${payment.property_name}</p><p style="margin:0 0 8px;"><strong>Monto:</strong> ${Number(payment.amount).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}</p><p style="margin:0;"><strong>Fecha límite:</strong> ${payment.due_date}</p></div><p>Por favor realiza tu pago a tiempo.</p></div>` }) });
      const data = await res.json();
      if (data.success) showToast("📧 Recordatorio enviado ✅");
      else showToast("Error: " + data.error, false);
    } catch (e) { showToast("Error: " + e.message, false); }
  };

  const sendWhatsApp = (payment) => {
    const contrato = contracts.find(c => c.id === payment.contract_id);
    const phone = contrato?.tenant_phone || "";
    if (!phone) { showToast("Sin teléfono — edita el contrato para agregarlo", false); return; }
    const phoneClean = phone.replace(/\D/g, "");
    const msg = encodeURIComponent(`Hola ${payment.tenant_name}, te recordamos que tienes un pago pendiente de ${fmt(payment.amount)} correspondiente a ${payment.property_name} con fecha límite ${payment.due_date}. Por favor regulariza tu pago. Gracias, Emporio Inmobiliario.`);
    window.open(`https://wa.me/52${phoneClean}?text=${msg}`, "_blank");
  };

  const openOwnerPayment = (ownerName, ownerEmail) => {
    const propsPropietario = properties.filter(p => p.owner_email === ownerEmail);
    const contratosPropietario = contracts.filter(c => propsPropietario.some(p => p.name === c.property_name) && c.status === "activo");
    const totalRent = contratosPropietario.reduce((a, c) => a + (c.monthly_rent || 0), 0);
    const totalComision = contratosPropietario.reduce((a, c) => a + calcComision(c), 0);
    const totalLiquido = totalRent - totalComision;
    const propNames = propsPropietario.map(p => p.name).join(", ");
    setOwnerPayForm({ owner_name: ownerName, owner_email: ownerEmail, period_description: `${new Date().toLocaleDateString("es-MX", { month: "long", year: "numeric" })}`, total_rent: totalRent.toString(), total_commission: totalComision.toString(), total_liquid: totalLiquido.toString(), amount_paid: totalLiquido.toString(), payment_method: "transferencia", payment_date: today, status: "pagado", notes: `Propiedades: ${propNames}` });
    setShowModal("owner_payment");
  };

  const descargarPDFPropietario = async (ownerName, ownerEmail) => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    const hoy = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
    const mes = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long" });
    const propsProp = properties.filter(p => p.owner_email === ownerEmail);
    const contratosProp = contracts.filter(c => propsProp.some(p => p.name === c.property_name) && c.status === "activo");
    const contractIds = contratosProp.map(c => c.id);
    const pagosProp = payments.filter(p => contractIds.includes(p.contract_id));
    const { data: liqProp } = await supabase.from("owner_payments").select("*").eq("owner_email", ownerEmail).order("created_at", { ascending: false });
    const { data: ticketsProp } = await supabase.from("maintenance_tickets").select("*").in("property_name", propsProp.map(p => p.name)).order("created_at", { ascending: false });
    const gastosProp = propertyExpenses.filter(e => propsProp.some(p => p.name === e.property_name) && e.paid_by === "propietario");
    const totalRentaProp = contratosProp.reduce((a, c) => a + (c.monthly_rent || 0), 0);
    const totalComProp = contratosProp.reduce((a, c) => a + calcComision(c), 0);
    const costoMantProp = (ticketsProp || []).filter(t => t.payer === "propietario" && t.charged_amount > 0).reduce((a, t) => a + (t.charged_amount || 0), 0);
    const gastosOpProp = gastosProp.reduce((a, e) => a + (e.amount || 0), 0);
    const totalLiqProp = totalRentaProp - totalComProp - costoMantProp - gastosOpProp;
    const totalPagadoProp = (liqProp || []).filter(l => l.status === "pagado").reduce((a, l) => a + (l.amount_paid || 0), 0);

    doc.setFillColor(26, 26, 46); doc.rect(0, 0, 210, 40, "F");
    doc.setTextColor(200, 169, 110); doc.setFontSize(20); doc.setFont("helvetica", "bold");
    doc.text("Emporio Inmobiliario", 20, 18);
    doc.setFontSize(11); doc.setTextColor(200, 200, 200);
    doc.text("Reporte de Propietario", 20, 28); doc.text(`Generado: ${hoy}`, 20, 35);
    doc.setTextColor(26, 26, 46); doc.setFontSize(16); doc.setFont("helvetica", "bold");
    doc.text(ownerName, 20, 55);
    doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.setTextColor(100, 100, 100);
    doc.text(`Periodo: ${mes}`, 20, 63);

    let y = 75;
    const extraLines = (costoMantProp > 0 ? 1 : 0) + (gastosOpProp > 0 ? 1 : 0);
    const boxH = 38 + extraLines * 7;
    doc.setFillColor(240, 253, 244); doc.rect(15, y, 180, boxH, "F");
    doc.setDrawColor(200, 169, 110); doc.rect(15, y, 180, boxH, "S");
    doc.setTextColor(26, 26, 46); doc.setFontSize(10); doc.setFont("helvetica", "bold");
    doc.text("RESUMEN FINANCIERO", 20, y + 8);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(`Renta mensual total: ${fmt(totalRentaProp)}`, 20, y + 16);
    doc.text(`Comisión administración: -${fmt(totalComProp)}`, 20, y + 23);
    doc.setTextColor(30, 64, 175);
    doc.text(`Total liquidado: ${fmt(totalPagadoProp)}`, 110, y + 16);
    let lineY = y + 30;
    if (costoMantProp > 0) { doc.setTextColor(153, 27, 27); doc.text(`Mantenimiento: -${fmt(costoMantProp)}`, 20, lineY); lineY += 7; }
    if (gastosOpProp > 0) { doc.setTextColor(153, 27, 27); doc.text(`Gastos operativos: -${fmt(gastosOpProp)}`, 20, lineY); lineY += 7; }
    doc.setFont("helvetica", "bold"); doc.setTextColor(6, 95, 70);
    doc.text(`Líquido a recibir: ${fmt(totalLiqProp)}`, 20, lineY);
    y += boxH + 10;

    doc.setTextColor(26, 26, 46); doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text("Propiedades", 20, y); y += 6;
    autoTable(doc, { startY: y, head: [["Propiedad", "Inquilino", "Renta", "Comisión", "Líquido", "Día pago"]], body: propsProp.map(prop => { const c = contratosProp.find(c => c.property_name === prop.name); const com = c ? calcComision(c) : 0; return [prop.name, c?.tenant_name || "—", fmt(prop.rent_amount), fmt(com), fmt((prop.rent_amount || 0) - com), c ? `Día ${c.payment_day}` : "—"]; }), styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [26, 26, 46], textColor: [200, 169, 110], fontStyle: "bold" }, alternateRowStyles: { fillColor: [249, 250, 251] }, margin: { left: 15, right: 15 } });
    y = doc.lastAutoTable.finalY + 12; if (y > 220) { doc.addPage(); y = 20; }

    doc.setTextColor(26, 26, 46); doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text("Pagos del Mes", 20, y); y += 6;
    const pagosMes = pagosProp.filter(p => { if (!p.due_date) return false; const d = new Date(p.due_date); const h = new Date(); return d.getMonth() === h.getMonth() && d.getFullYear() === h.getFullYear(); });
    autoTable(doc, { startY: y, head: [["Inquilino", "Propiedad", "Monto", "Vencimiento", "Estado"]], body: pagosMes.length > 0 ? pagosMes.map(p => [p.tenant_name || "—", p.property_name || "—", fmt(p.amount), p.due_date || "—", p.status === "pagado" ? "Pagado" : p.status === "atrasado" ? "Atrasado" : "Pendiente"]) : [["Sin pagos este mes", "", "", "", ""]], styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [26, 26, 46], textColor: [200, 169, 110], fontStyle: "bold" }, alternateRowStyles: { fillColor: [249, 250, 251] }, margin: { left: 15, right: 15 } });
    y = doc.lastAutoTable.finalY + 12; if (y > 220) { doc.addPage(); y = 20; }

    if (gastosProp.length > 0) {
      doc.setTextColor(26, 26, 46); doc.setFontSize(13); doc.setFont("helvetica", "bold");
      doc.text("Gastos Operativos", 20, y); y += 6;
      autoTable(doc, { startY: y, head: [["Propiedad", "Concepto", "Descripción", "Monto", "Fecha"]], body: gastosProp.map(e => [e.property_name, expenseCategoryLabels[e.category] || e.category, e.description, fmt(e.amount), e.date]), styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [26, 26, 46], textColor: [200, 169, 110], fontStyle: "bold" }, alternateRowStyles: { fillColor: [249, 250, 251] }, margin: { left: 15, right: 15 } });
      y = doc.lastAutoTable.finalY + 12; if (y > 220) { doc.addPage(); y = 20; }
    }

    doc.setTextColor(26, 26, 46); doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text("Liquidaciones", 20, y); y += 6;
    autoTable(doc, { startY: y, head: [["Periodo", "Renta", "Comisión", "Te pagamos", "Fecha", "Estado"]], body: (liqProp || []).length > 0 ? (liqProp || []).map(l => [l.period_description || "—", fmt(l.total_rent), fmt(l.total_commission), fmt(l.amount_paid), l.payment_date || "—", l.status === "pagado" ? "Pagado" : "Pendiente"]) : [["Sin liquidaciones", "", "", "", "", ""]], styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [26, 26, 46], textColor: [200, 169, 110], fontStyle: "bold" }, alternateRowStyles: { fillColor: [249, 250, 251] }, margin: { left: 15, right: 15 } });
    y = doc.lastAutoTable.finalY + 12; if (y > 220) { doc.addPage(); y = 20; }

    doc.setTextColor(26, 26, 46); doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text("Mantenimiento", 20, y); y += 6;
    autoTable(doc, { startY: y, head: [["Título", "Propiedad", "¿Quién paga?", "Costo", "Estado", "Fecha"]], body: (ticketsProp || []).length > 0 ? (ticketsProp || []).map(t => [t.title || "—", t.property_name || "—", t.payer === "propietario" ? "Propietario" : t.payer === "inquilino" ? "Inquilino" : "Inmobiliaria", t.payer === "propietario" && t.charged_amount > 0 ? fmt(t.charged_amount) : "—", t.status === "resuelto" ? "Resuelto" : t.status === "en_proceso" ? "En proceso" : "Nuevo", new Date(t.created_at).toLocaleDateString("es-MX")]) : [["Sin mantenimiento", "", "", "", "", ""]], styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [26, 26, 46], textColor: [200, 169, 110], fontStyle: "bold" }, alternateRowStyles: { fillColor: [249, 250, 251] }, margin: { left: 15, right: 15 } });

    const totalPaginas = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPaginas; i++) { doc.setPage(i); doc.setFillColor(26, 26, 46); doc.rect(0, 285, 210, 15, "F"); doc.setTextColor(200, 169, 110); doc.setFontSize(8); doc.text("Emporio Inmobiliario — app.emporioinmobiliario.com.mx", 20, 293); doc.setTextColor(150, 150, 150); doc.text(`Página ${i} de ${totalPaginas}`, 175, 293); }
    doc.save(`Reporte_${ownerName.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`);
  };

  const deleteItem = (type, id, msg) => {
    if (!isAdmin) { showToast("Solo el admin puede eliminar", false); return; }
    setConfirm({
      message: msg,
      onConfirm: async () => {
        setConfirm(null);
        if (type === "property") await supabase.from("properties").delete().eq("id", id);
        if (type === "contract") { await supabase.from("payments").delete().eq("contract_id", id); await supabase.from("contracts").delete().eq("id", id); }
        if (type === "payment") await supabase.from("payments").delete().eq("id", id);
        if (type === "ticket") await supabase.from("maintenance_tickets").delete().eq("id", id);
        if (type === "owner_payment") await supabase.from("owner_payments").delete().eq("id", id);
        if (type === "cash") await supabase.from("cash_movements").delete().eq("id", id);
        if (type === "expense") await supabase.from("property_expenses").delete().eq("id", id);
        showToast("Eliminado ✅"); loadData();
      }
    });
  };

  const totalEntradas = cashMovements.filter(m => m.type === "entrada").reduce((a, m) => a + (m.amount || 0), 0);
  const totalSalidas = cashMovements.filter(m => m.type === "salida").reduce((a, m) => a + (m.amount || 0), 0);
  const saldoCaja = totalEntradas - totalSalidas;
  const entradasEfectivo = cashMovements.filter(m => m.type === "entrada" && m.payment_method === "efectivo").reduce((a, m) => a + (m.amount || 0), 0);
  const entradasBanco = cashMovements.filter(m => m.type === "entrada" && m.payment_method === "transferencia").reduce((a, m) => a + (m.amount || 0), 0);
  const totalRent = properties.filter(p => p.status === "ocupada").reduce((a, p) => a + (p.rent_amount || 0), 0);
  const paid = payments.filter(p => p.status === "pagado").reduce((a, p) => a + (p.amount || 0), 0);
  const overdue = payments.filter(p => p.status === "atrasado").reduce((a, p) => a + (p.amount || 0), 0);
  const pending = payments.filter(p => p.status === "pendiente").reduce((a, p) => a + (p.amount || 0), 0);
  const totalComisiones = contracts.filter(c => c.status === "activo").reduce((a, c) => a + calcComision(c), 0);
  const comisionesPendientes = contracts.filter(c => c.status === "activo" && (c.commission_status === "pendiente_cobro" || !c.commission_status)).reduce((a, c) => a + calcComision(c), 0);
  const hoy = new Date();
  const pagosMes = payments.filter(p => { if (!p.due_date) return false; const d = new Date(p.due_date); return d.getMonth() === hoy.getMonth() && d.getFullYear() === hoy.getFullYear(); });
  const propietariosUnicos = [...new Map(properties.filter(p => p.owner_email).map(p => [p.owner_email, { name: contracts.find(c => c.property_name === p.name)?.owner_name || p.owner_email.split("@")[0], email: p.owner_email }])).values()];

  const pagosFiltrados = payments.filter(p => {
    const matchSearch = !searchPago || (p.tenant_name || "").toLowerCase().includes(searchPago.toLowerCase()) || (p.property_name || "").toLowerCase().includes(searchPago.toLowerCase());
    const matchEstatus = !filterEstatus || p.status === filterEstatus;
    const matchMes = !filterMes || (p.due_date && new Date(p.due_date).getMonth() + 1 === parseInt(filterMes));
    return matchSearch && matchEstatus && matchMes;
  });

  const nav = [
    { id: "dashboard", label: "📊 Panel" },
    { id: "caja", label: "💵 Caja" },
    { id: "contracts", label: "📋 Contratos" },
    { id: "properties", label: "🏠 Propiedades" },
    { id: "payments", label: "💰 Cobranza" },
    { id: "owner_payments", label: "🏦 Liquidaciones" },
    { id: "tickets", label: "🔧 Mantenimiento" },
    { id: "reports", label: "📈 Reportes" },
    { id: "commissions", label: "💼 Comisiones" },
  ];

  if (authLoading) return <div style={{ minHeight: "100vh", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "#c8a96e", fontSize: 18, fontWeight: 700 }}>Cargando...</p></div>;
  if (!session) return <LoginScreen onLogin={() => loadData()} />;

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif", background: "#f4f5f7" }}>
      {toast && <div style={{ position: "fixed", top: 24, right: 24, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 2000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: 320 }}>{toast.msg}</div>}
      {confirm && <ConfirmModal message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}

      <div style={{ width: 220, background: "#1a1a2e", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "24px 20px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <span style={{ color: "#c8a96e", fontWeight: 800, fontSize: 18 }}>🏢 InmoAdmin</span>
        </div>
        <nav style={{ padding: "16px 12px", flex: 1 }}>
          {nav.map(n => (
            <button key={n.id} onClick={() => setView(n.id)} style={{ width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer", marginBottom: 4, fontSize: 14, fontWeight: 600, background: view === n.id ? "rgba(200,169,110,0.15)" : "transparent", color: view === n.id ? "#c8a96e" : "rgba(255,255,255,0.6)" }}>
              {n.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: 16, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <p style={{ margin: "0 0 4px", color: "#fff", fontSize: 13, fontWeight: 600 }}>{profile?.email?.split("@")[0]}</p>
          <p style={{ margin: "0 0 10px", color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase" }}>{profile?.role === "admin" ? "👑 Admin" : "👤 Staff"}</p>
          <button onClick={logout} style={{ width: "100%", background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)", border: "none", borderRadius: 8, padding: "8px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Cerrar sesión</button>
        </div>
      </div>

      <div style={{ flex: 1, padding: 32, overflowY: "auto" }}>
        {loading && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200 }}><p style={{ color: "#6b7280" }}>Cargando...</p></div>}

        {!loading && view === "dashboard" && (
          <div>
            <h1 style={{ margin: "0 0 24px", fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>Panel de Control</h1>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 28 }}>
              {[
                { label: "Renta mensual", value: fmt(totalRent), color: "#1a1a2e" },
                { label: "Cobrado", value: fmt(paid), color: "#065f46" },
                { label: "Pendiente", value: fmt(pending), color: "#92400e" },
                { label: "Atrasado", value: fmt(overdue), color: "#991b1b" },
                { label: "Comisiones/mes", value: fmt(totalComisiones), color: "#7c3aed" },
                { label: "Comisiones pendientes", value: fmt(comisionesPendientes), color: "#92400e" },
                { label: "Saldo caja", value: fmt(saldoCaja), color: saldoCaja >= 0 ? "#065f46" : "#dc2626" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
                  <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div style={{ background: "#fff", borderRadius: 14, padding: 22, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Cobros de este mes ({pagosMes.length})</h3>
                {pagosMes.length === 0 && <p style={{ color: "#9ca3af", fontSize: 13 }}>No hay cobros este mes</p>}
                {pagosMes.map(p => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{p.tenant_name || "—"}</p>
                      <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{p.property_name} · Vence {p.due_date}</p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{fmt(p.amount)}</span>
                      <StatusBadge status={p.status} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ background: "#fff", borderRadius: 14, padding: 22, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Últimos movimientos de caja</h3>
                {cashMovements.slice(0, 6).map(m => (
                  <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{m.description}</p>
                      <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{categoryLabels[m.category]} · {m.date}</p>
                    </div>
                    <span style={{ fontWeight: 700, fontSize: 14, color: m.type === "entrada" ? "#065f46" : "#dc2626" }}>
                      {m.type === "entrada" ? "+" : "-"}{fmt(m.amount)}
                    </span>
                  </div>
                ))}
                {cashMovements.length === 0 && <p style={{ color: "#9ca3af", fontSize: 13 }}>No hay movimientos aún</p>}
              </div>
            </div>
          </div>
        )}

        {!loading && view === "caja" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>💵 Caja / Tesorería</h1>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>Los movimientos se generan automáticamente</p>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <Btn color="#065f46" onClick={() => { setCashForm({ ...emptyCash, type: "entrada" }); setShowModal("cash"); }}>+ Entrada manual</Btn>
                <Btn color="#dc2626" onClick={() => { setCashForm({ ...emptyCash, type: "salida" }); setShowModal("cash"); }}>- Salida manual</Btn>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
              {[
                { label: "Saldo total", value: fmt(saldoCaja), color: saldoCaja >= 0 ? "#065f46" : "#dc2626", bg: saldoCaja >= 0 ? "#f0fdf4" : "#fff5f5" },
                { label: "Total entradas", value: fmt(totalEntradas), color: "#065f46", bg: "#f0fdf4" },
                { label: "Total salidas", value: fmt(totalSalidas), color: "#dc2626", bg: "#fff5f5" },
                { label: "Entradas efectivo", value: fmt(entradasEfectivo), color: "#92400e", bg: "#fffbeb" },
                { label: "Entradas banco", value: fmt(entradasBanco), color: "#1e40af", bg: "#eff6ff" },
              ].map((s, i) => (
                <div key={i} style={{ background: s.bg, borderRadius: 14, padding: "18px 20px" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
                  <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>
            <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    {["Fecha", "Tipo", "Categoría", "Descripción", "Método", "Monto", "Por", ""].map(h => (
                      <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cashMovements.map(m => (
                    <tr key={m.id} style={{ borderTop: "1px solid #f3f4f6", background: m.type === "entrada" ? "#f9fffe" : "#fffafa" }}>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{m.date}</td>
                      <td style={{ padding: "12px 16px" }}><StatusBadge status={m.type} /></td>
                      <td style={{ padding: "12px 16px", fontSize: 13 }}>{categoryLabels[m.category] || m.category}</td>
                      <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600 }}>{m.description}</td>
                      <td style={{ padding: "12px 16px", fontSize: 12, color: "#6b7280" }}>{m.payment_method}</td>
                      <td style={{ padding: "12px 16px", fontWeight: 800, fontSize: 15, color: m.type === "entrada" ? "#065f46" : "#dc2626" }}>
                        {m.type === "entrada" ? "+" : "-"}{fmt(m.amount)}
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 11, color: "#9ca3af" }}>{m.created_by?.split("@")[0] || "sistema"}</td>
                      <td style={{ padding: "12px 16px" }}>
                        {isAdmin && <Btn small color="#dc2626" onClick={() => deleteItem("cash", m.id, `Eliminar: ${m.description}`)}>🗑️</Btn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cashMovements.length === 0 && <div style={{ padding: 48, textAlign: "center" }}><p style={{ fontSize: 32, margin: "0 0 12px" }}>💵</p><p style={{ color: "#6b7280" }}>Los movimientos aparecerán automáticamente aquí</p></div>}
            </div>
          </div>
        )}

        {!loading && view === "owner_payments" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>🏦 Liquidaciones</h1>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>Al liquidar se registra automáticamente la salida en caja</p>
              </div>
              <Btn color="#c8a96e" onClick={() => setShowModal("owner_payment")}>+ Nueva liquidación</Btn>
            </div>
            {propietariosUnicos.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>Propietarios activos</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                  {propietariosUnicos.map((owner, i) => {
                    const propsProp = properties.filter(p => p.owner_email === owner.email);
                    const contratosProp = contracts.filter(c => propsProp.some(p => p.name === c.property_name) && c.status === "activo");
                    const liquidoProp = contratosProp.reduce((a, c) => a + (c.monthly_rent || 0) - calcComision(c), 0);
                    const totalPagado = ownerPayments.filter(op => op.owner_email === owner.email).reduce((a, op) => a + (op.amount_paid || 0), 0);
                    return (
                      <div key={i} style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                          <div>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{owner.name}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>{propsProp.length} propiedad{propsProp.length !== 1 ? "es" : ""}</p>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <Btn small color="#065f46" onClick={() => openOwnerPayment(owner.name, owner.email)}>💸 Liquidar</Btn>
                            <Btn small color="#1e40af" onClick={() => descargarPDFPropietario(owner.name, owner.email)}>📄 PDF</Btn>
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <div style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 12px" }}>
                            <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Líquido/mes</p>
                            <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#065f46" }}>{fmt(liquidoProp)}</p>
                          </div>
                          <div style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 12px" }}>
                            <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Total pagado</p>
                            <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#1e40af" }}>{fmt(totalPagado)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>Historial</h3>
            {ownerPayments.length === 0 && <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center" }}><p style={{ fontSize: 32, margin: "0 0 12px" }}>🏦</p><p style={{ color: "#6b7280" }}>No hay liquidaciones aún</p></div>}
            {ownerPayments.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {["Propietario", "Periodo", "Renta", "Comisión", "Líquido", "Pagado", "Fecha", "Estado", ""].map(h => (
                        <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ownerPayments.map(op => (
                      <tr key={op.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14 }}>{op.owner_name}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{op.period_description}</td>
                        <td style={{ padding: "12px 16px", fontWeight: 700 }}>{fmt(op.total_rent)}</td>
                        <td style={{ padding: "12px 16px", color: "#7c3aed" }}>{fmt(op.total_commission)}</td>
                        <td style={{ padding: "12px 16px", fontWeight: 700, color: "#065f46" }}>{fmt(op.total_liquid)}</td>
                        <td style={{ padding: "12px 16px", fontWeight: 700, color: "#1e40af" }}>{fmt(op.amount_paid)}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{op.payment_date}</td>
                        <td style={{ padding: "12px 16px" }}><StatusBadge status={op.status} /></td>
                        <td style={{ padding: "12px 16px" }}>{isAdmin && <Btn small color="#dc2626" onClick={() => deleteItem("owner_payment", op.id, `Eliminar liquidación de ${op.owner_name}`)}>🗑️</Btn>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {!loading && view === "contracts" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>Contratos ({contracts.length})</h1>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>Define si la renta llega a ti o directo al propietario</p>
              </div>
              <Btn color="#c8a96e" onClick={() => { setEditing(null); setShowModal("contract"); }}>+ Nuevo contrato</Btn>
            </div>
            {contracts.length === 0 && <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center" }}><Btn color="#c8a96e" onClick={() => setShowModal("contract")}>+ Crear primer contrato</Btn></div>}
            {contracts.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {["Inquilino / Co-resp.", "Teléfono", "Propietario", "Propiedad", "Renta", "Comisión", "Renta a", "Vigencia", "Día", "Cobros", ""].map(h => (
                        <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {contracts.map(c => {
                      const diasRestantes = Math.ceil((new Date(c.end_date) - new Date()) / (1000 * 60 * 60 * 24));
                      const cobrosContrato = payments.filter(p => p.contract_id === c.id);
                      const cobradoContrato = cobrosContrato.filter(p => p.status === "pagado").length;
                      return (
                        <tr key={c.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                          <td style={{ padding: "12px 16px", fontSize: 14 }}>
                            <p style={{ margin: 0, fontWeight: 600 }}>{c.tenant_name}</p>
                            {c.co_responsable_nombre && (
                              <p style={{ margin: "2px 0 0", fontSize: 11, color: "#7c3aed", fontWeight: 600 }}>
                                👥 {c.co_responsable_nombre}
                              </p>
                            )}
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>
                            {c.tenant_phone || "—"}
                            {c.co_responsable_telefono && <span style={{ display: "block", fontSize: 11, color: "#9ca3af" }}>{c.co_responsable_telefono}</span>}
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{c.owner_name || "—"}</td>
                          <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{c.property_name}</td>
                          <td style={{ padding: "12px 16px", fontWeight: 700 }}>{fmt(c.monthly_rent)}</td>
                          <td style={{ padding: "12px 16px", fontSize: 13, color: "#7c3aed", fontWeight: 700 }}>{fmt(calcComision(c))}</td>
                          <td style={{ padding: "12px 16px" }}><StatusBadge status={c.rent_receiver || "inmobiliaria"} /></td>
                          <td style={{ padding: "12px 16px", fontSize: 12, color: "#6b7280" }}>{c.start_date} → {c.end_date} <span style={{ fontSize: 11, fontWeight: 700, color: diasRestantes <= 30 ? "#dc2626" : "#9ca3af" }}>({diasRestantes}d)</span></td>
                          <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 700 }}>Día {c.payment_day}</td>
                          <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{cobradoContrato}/{cobrosContrato.length}</td>
                          <td style={{ padding: "12px 16px" }}>
                            <div style={{ display: "flex", gap: 6 }}>
                              <Btn small color="#6b7280" onClick={() => openEdit("contract", c)}>✏️</Btn>
                              {isAdmin && <Btn small color="#dc2626" onClick={() => deleteItem("contract", c.id, `Eliminar contrato de ${c.tenant_name}`)}>🗑️</Btn>}
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
        )}

        {!loading && view === "properties" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>Propiedades ({properties.length})</h1>
              <Btn color="#c8a96e" onClick={() => { setEditing(null); setShowModal("property"); }}>+ Nueva propiedad</Btn>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
              {properties.map(p => {
                const gastosPropiedad = propertyExpenses.filter(e => e.property_name === p.name);
                const totalGastos = gastosPropiedad.reduce((a, e) => a + (e.amount || 0), 0);
                return (
                  <div key={p.id} style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                    <div style={{ background: "linear-gradient(135deg, #1a1a2e, #2d2d5e)", height: 70, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>
                      {p.property_type === "casa" ? "🏠" : p.property_type === "depto" ? "🏢" : p.property_type === "local" ? "🏪" : p.property_type === "bodega" ? "🏭" : "💼"}
                    </div>
                    <div style={{ padding: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{p.name}</h3>
                        <StatusBadge status={p.status} />
                      </div>
                      <p style={{ margin: "0 0 4px", fontSize: 12, color: "#6b7280" }}>📍 {p.address || "Sin dirección"}</p>
                      {p.owner_email && <p style={{ margin: "0 0 10px", fontSize: 11, color: "#9ca3af" }}>👤 {p.owner_email}</p>}
                      <div style={{ paddingTop: 10, borderTop: "1px solid #f3f4f6", marginBottom: 12 }}>
                        <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#1a1a2e" }}>{fmt(p.rent_amount)}</p>
                        {totalGastos > 0 && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#dc2626" }}>Gastos registrados: {fmt(totalGastos)}</p>}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Btn small color="#6b7280" onClick={() => openEdit("property", p)}>✏️</Btn>
                        <Btn small color="#f59e0b" onClick={() => openExpenseModal(p.name)}>💸 Gasto</Btn>
                        {isAdmin && <Btn small color="#dc2626" onClick={() => deleteItem("property", p.id, `Eliminar "${p.name}"`)}>🗑️</Btn>}
                      </div>
                      {gastosPropiedad.length > 0 && (
                        <div style={{ marginTop: 10, borderTop: "1px solid #f3f4f6", paddingTop: 8 }}>
                          {gastosPropiedad.slice(0, 3).map(e => (
                            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "#6b7280", padding: "2px 0" }}>
                              <span>{expenseCategoryLabels[e.category]} · {e.description}</span>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ color: "#dc2626", fontWeight: 600 }}>{fmt(e.amount)}</span>
                                {isAdmin && <button onClick={() => deleteItem("expense", e.id, `Eliminar gasto: ${e.description}`)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, padding: "0 2px", color: "#dc2626" }}>🗑️</button>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!loading && view === "payments" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>Cobranza ({payments.length})</h1>
              <Btn color="#c8a96e" onClick={() => setShowModal("payment")}>+ Registrar pago manual</Btn>
            </div>
            <div style={{ background: "#fff", borderRadius: 14, padding: "16px 20px", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <input placeholder="🔍 Buscar inquilino o propiedad..." value={searchPago} onChange={e => setSearchPago(e.target.value)} style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14 }} />
              <select value={filterEstatus} onChange={e => setFilterEstatus(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff" }}>
                <option value="">Todos los estatus</option>
                <option value="pendiente">Pendiente</option>
                <option value="en_revision">En revisión</option>
                <option value="pagado">Pagado</option>
                <option value="atrasado">Atrasado</option>
              </select>
              <select value={filterMes} onChange={e => setFilterMes(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff" }}>
                <option value="">Todos los meses</option>
                {["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"].map((m, i) => (
                  <option key={i} value={i + 1}>{m} {new Date().getFullYear()}</option>
                ))}
              </select>
              {(searchPago || filterEstatus || filterMes) && (
                <button onClick={() => { setSearchPago(""); setFilterEstatus(""); setFilterMes(""); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#6b7280" }}>✕ Limpiar</button>
              )}
              <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>{pagosFiltrados.length} resultado{pagosFiltrados.length !== 1 ? "s" : ""}</span>
            </div>
            {pagosFiltrados.length === 0 && <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center" }}><p style={{ fontSize: 32, margin: "0 0 12px" }}>🔍</p><p style={{ color: "#6b7280" }}>No hay resultados</p></div>}
            {pagosFiltrados.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {["Inquilino", "Propiedad", "Monto", "Vencimiento", "Estado", "Actualizar", "Acciones"].map(h => (
                        <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagosFiltrados.map(p => {
                      const contrato = contracts.find(c => c.id === p.contract_id);
                      return (
                        <tr key={p.id} style={{ borderTop: "1px solid #f3f4f6", background: p.status === "atrasado" ? "#fff5f5" : "#fff" }}>
                          <td style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14 }}>{p.tenant_name || "—"}</td>
                          <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>
                            {p.property_name || "—"}
                            {contrato && <span style={{ display: "block", fontSize: 10, color: contrato.rent_receiver === "propietario" ? "#3730a3" : "#065f46" }}>{contrato.rent_receiver === "propietario" ? "→ propietario" : "→ nosotros"}</span>}
                          </td>
                          <td style={{ padding: "12px 16px", fontWeight: 700 }}>{fmt(p.amount)}</td>
                          <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{p.due_date || "—"}</td>
                          <td style={{ padding: "12px 16px" }}><StatusBadge status={p.status} /></td>
                          <td style={{ padding: "12px 16px" }}>
                            <select onChange={e => updatePaymentStatus(p.id, e.target.value)} value={p.status} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12, cursor: "pointer" }}>
                              <option value="pendiente">Pendiente</option>
                              <option value="en_revision">En revisión</option>
                              <option value="pagado">Pagado</option>
                              <option value="atrasado">Atrasado</option>
                            </select>
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              {p.status === "en_revision" && p.receipt_url && (
                                <a href={p.receipt_url} target="_blank" rel="noreferrer" style={{ background: "#7c3aed", color: "#fff", padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, textDecoration: "none" }}>🧾 Ver</a>
                              )}
                              {["pendiente", "atrasado"].includes(p.status) && <Btn small color="#1e40af" onClick={() => sendReminder(p)}>📧</Btn>}
                              {["pendiente", "atrasado"].includes(p.status) && <Btn small color="#25d366" onClick={() => sendWhatsApp(p)}>💬</Btn>}
                              {isAdmin && <Btn small color="#dc2626" onClick={() => deleteItem("payment", p.id, `Eliminar cobro de ${p.tenant_name}`)}>🗑️</Btn>}
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
        )}

        {!loading && view === "tickets" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>Mantenimiento ({tickets.length})</h1>
              <Btn color="#c8a96e" onClick={() => { setEditing(null); setShowModal("ticket"); }}>+ Nuevo ticket</Btn>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {tickets.map(t => (
                <div key={t.id} style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>{t.title}</h3>
                      <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>📍 {t.property_name || "—"} · 👤 {t.tenant_name || "—"}</p>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <StatusBadge status={t.priority} />
                      <select onChange={e => updateTicketStatus(t.id, e.target.value)} value={t.status} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12, cursor: "pointer" }}>
                        <option value="nuevo">Nuevo</option>
                        <option value="en_proceso">En proceso</option>
                        <option value="resuelto">Resuelto ✅</option>
                        <option value="cancelado">Cancelado</option>
                      </select>
                      <Btn small color="#6b7280" onClick={() => openEdit("ticket", t)}>✏️</Btn>
                      {isAdmin && <Btn small color="#dc2626" onClick={() => deleteItem("ticket", t.id, `Eliminar "${t.title}"`)}>🗑️</Btn>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {t.payer && <span style={{ fontSize: 12, color: "#374151", background: "#f3f4f6", padding: "3px 8px", borderRadius: 6 }}>Paga: {t.payer}</span>}
                    {t.provider_cost > 0 && <span style={{ fontSize: 12, color: "#dc2626", background: "#fff5f5", padding: "3px 8px", borderRadius: 6 }}>Costo: {fmt(t.provider_cost)}</span>}
                    {t.charged_amount > 0 && <span style={{ fontSize: 12, color: "#065f46", background: "#f0fdf4", padding: "3px 8px", borderRadius: 6 }}>Cobrado: {fmt(t.charged_amount)}</span>}
                    {t.advance_amount > 0 && <span style={{ fontSize: 12, color: "#1e40af", background: "#eff6ff", padding: "3px 8px", borderRadius: 6 }}>Anticipo: {fmt(t.advance_amount)} {t.advance_paid ? "✅" : "⏳"}</span>}
                    {t.provider_cost > 0 && t.charged_amount > 0 && <span style={{ fontSize: 12, color: "#7c3aed", background: "#faf5ff", padding: "3px 8px", borderRadius: 6, fontWeight: 700 }}>Utilidad: {fmt(t.charged_amount - t.provider_cost)}</span>}
                  </div>
                </div>
              ))}
              {tickets.length === 0 && <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center" }}><p style={{ fontSize: 32, margin: "0 0 12px" }}>🔧</p><p style={{ color: "#6b7280" }}>No hay tickets aún</p></div>}
            </div>
          </div>
        )}

        {!loading && view === "reports" && (
          <div>
            <h1 style={{ margin: "0 0 24px", fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>Reportes</h1>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div style={{ background: "#fff", borderRadius: 14, padding: 22, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Cobros por mes — {new Date().getFullYear()}</h3>
                {Array.from({ length: 12 }, (_, i) => {
                  const mes = i + 1; const año = new Date().getFullYear();
                  const pm = payments.filter(p => p.period_month === mes && p.period_year === año);
                  const cobrado = pm.filter(p => p.status === "pagado").reduce((a, p) => a + (p.amount || 0), 0);
                  const total = pm.reduce((a, p) => a + (p.amount || 0), 0);
                  if (total === 0) return null;
                  const meses = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
                  const pct = Math.round((cobrado / total) * 100);
                  return (
                    <div key={mes} style={{ padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{meses[i]} {año}</span>
                        <div style={{ display: "flex", gap: 8 }}>
                          <span style={{ fontSize: 13, color: "#065f46", fontWeight: 700 }}>{fmt(cobrado)}</span>
                          <span style={{ fontSize: 11, color: "#9ca3af" }}>/ {fmt(total)}</span>
                        </div>
                      </div>
                      <div style={{ background: "#f3f4f6", borderRadius: 4, height: 6 }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: "#c8a96e", borderRadius: 4 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ background: "#fff", borderRadius: 14, padding: 22, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Estado por propiedad</h3>
                {properties.map(prop => {
                  const pp = payments.filter(p => p.property_name === prop.name);
                  const cobrado = pp.filter(p => p.status === "pagado").reduce((a, p) => a + (p.amount || 0), 0);
                  const pend = pp.filter(p => p.status === "pendiente").reduce((a, p) => a + (p.amount || 0), 0);
                  const atr = pp.filter(p => p.status === "atrasado").reduce((a, p) => a + (p.amount || 0), 0);
                  const contrato = contracts.find(c => c.property_name === prop.name && c.status === "activo");
                  const comision = contrato ? calcComision(contrato) : 0;
                  return (
                    <div key={prop.id} style={{ padding: "12px 0", borderBottom: "1px solid #f3f4f6" }}>
                      <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 13 }}>{prop.name}</p>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, color: "#065f46", background: "#d1fae5", padding: "2px 8px", borderRadius: 6 }}>✅ {fmt(cobrado)}</span>
                        {pend > 0 && <span style={{ fontSize: 12, color: "#92400e", background: "#fef3c7", padding: "2px 8px", borderRadius: 6 }}>⏳ {fmt(pend)}</span>}
                        {atr > 0 && <span style={{ fontSize: 12, color: "#991b1b", background: "#fee2e2", padding: "2px 8px", borderRadius: 6 }}>🔴 {fmt(atr)}</span>}
                        {comision > 0 && <span style={{ fontSize: 12, color: "#7c3aed", background: "#ede9fe", padding: "2px 8px", borderRadius: 6 }}>💼 {fmt(comision)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── CAMBIO 6: Vista Comisiones con estado cobrado/pendiente ─────────── */}
        {!loading && view === "commissions" && (
          <div>
            <h1 style={{ margin: "0 0 24px", fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>💼 Mis Comisiones</h1>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 28 }}>
              {[
                { label: "Comisión mensual total", value: fmt(totalComisiones), color: "#7c3aed" },
                { label: "Comisión anual estimada", value: fmt(totalComisiones * 12), color: "#1a1a2e" },
                { label: "Pendientes de cobro", value: fmt(comisionesPendientes), color: "#92400e" },
                { label: "Contratos activos", value: contracts.filter(c => c.status === "activo").length, color: "#1e40af" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
                  <p style={{ margin: 0, fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Aviso de pendientes */}
            {comisionesPendientes > 0 && (
              <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <p style={{ margin: 0, fontSize: 14, color: "#92400e", fontWeight: 600 }}>
                  Tienes {fmt(comisionesPendientes)} en comisiones pendientes de cobro. Márcalas como cobradas cuando el propietario te pague para que entren a caja.
                </p>
              </div>
            )}

            <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    {["Inquilino", "Propietario", "Propiedad", "Renta", "Comisión", "Monto/mes", "Renta va a", "Cobro", "Acción"].map(h => (
                      <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contracts.map(c => {
                    const comision = calcComision(c);
                    const esPendiente = !c.commission_status || c.commission_status === "pendiente_cobro";
                    return (
                      <tr key={c.id} style={{ borderTop: "1px solid #f3f4f6", background: esPendiente ? "#fffdf0" : "#fff" }}>
                        <td style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14 }}>
                          {c.tenant_name}
                          {c.co_responsable_nombre && <span style={{ display: "block", fontSize: 11, color: "#7c3aed" }}>👥 {c.co_responsable_nombre}</span>}
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{c.owner_name || "—"}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{c.property_name}</td>
                        <td style={{ padding: "12px 16px", fontWeight: 700 }}>{fmt(c.monthly_rent)}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#7c3aed" }}>{c.commission_type === "porcentaje" ? `${c.commission_value}%` : "Fijo"}</td>
                        <td style={{ padding: "12px 16px", fontWeight: 700, color: "#7c3aed" }}>{fmt(comision)}</td>
                        <td style={{ padding: "12px 16px" }}><StatusBadge status={c.rent_receiver || "inmobiliaria"} /></td>
                        <td style={{ padding: "12px 16px" }}>
                          {c.rent_receiver === "propietario"
                            ? <StatusBadge status={esPendiente ? "pendiente_cobro" : "cobrada"} />
                            : <span style={{ fontSize: 11, color: "#9ca3af" }}>—</span>
                          }
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          {c.rent_receiver === "propietario" ? (
                            esPendiente ? (
                              <Btn small color="#065f46" onClick={() => marcarComisionCobrada(c)}>
                                ✓ Marcar cobrada
                              </Btn>
                            ) : (
                              <Btn small color="#6b7280" onClick={() => marcarComisionPendiente(c.id)}>
                                ↩ Revertir
                              </Btn>
                            )
                          ) : (
                            <span style={{ fontSize: 11, color: "#9ca3af" }}>Auto — incluida en renta</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showModal === "expense" && (
        <Modal title="💸 Registrar Gasto Operativo" onClose={closeModal}>
          <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#92400e", fontWeight: 600 }}>📋 Gastos como condominio, predial, seguros, etc.</p>
          </div>
          <Field label="Propiedad">
            <Sel value={expenseForm.property_name} onChange={e => setExpenseForm({ ...expenseForm, property_name: e.target.value })}>
              <option value="">-- Selecciona --</option>
              {properties.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </Sel>
          </Field>
          <Field label="Concepto">
            <Sel value={expenseForm.category} onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value })}>
              <option value="condominio">🏢 Condominio</option>
              <option value="predial">🏛️ Predial</option>
              <option value="agua">💧 Agua</option>
              <option value="luz">⚡ Luz</option>
              <option value="gas">🔥 Gas</option>
              <option value="seguro">🛡️ Seguro</option>
              <option value="mantenimiento_comun">🔧 Mantenimiento común</option>
              <option value="otro">📌 Otro</option>
            </Sel>
          </Field>
          <Field label="Descripción *"><Input placeholder="Ej: Cuota condominio enero 2026" value={expenseForm.description} onChange={e => setExpenseForm({ ...expenseForm, description: e.target.value })} /></Field>
          <Field label="Monto *"><Input type="number" placeholder="0" value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} /></Field>
          <Field label="¿Quién paga?">
            <Sel value={expenseForm.paid_by} onChange={e => setExpenseForm({ ...expenseForm, paid_by: e.target.value })}>
              <option value="propietario">El propietario (se descuenta de su liquidación)</option>
              <option value="inmobiliaria">Nosotros (sale de nuestra caja)</option>
            </Sel>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Método"><Sel value={expenseForm.payment_method} onChange={e => setExpenseForm({ ...expenseForm, payment_method: e.target.value })}><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option></Sel></Field>
            <Field label="Fecha"><Input type="date" value={expenseForm.date} onChange={e => setExpenseForm({ ...expenseForm, date: e.target.value })} /></Field>
          </div>
          <Field label="Notas"><Input placeholder="Observaciones" value={expenseForm.notes} onChange={e => setExpenseForm({ ...expenseForm, notes: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={closeModal} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={saveExpense} color="#f59e0b" disabled={saving || !expenseForm.description || !expenseForm.amount || !expenseForm.property_name}>{saving ? "Guardando..." : "Registrar gasto"}</Btn>
          </div>
        </Modal>
      )}

      {showModal === "cash" && (
        <Modal title={cashForm.type === "entrada" ? "💚 Entrada Manual" : "🔴 Salida Manual"} onClose={closeModal}>
          <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#92400e", fontWeight: 600 }}>⚡ La mayoría de movimientos se registran automáticamente.</p>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <button onClick={() => setCashForm({ ...cashForm, type: "entrada" })} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `2px solid ${cashForm.type === "entrada" ? "#065f46" : "#e5e7eb"}`, background: cashForm.type === "entrada" ? "#f0fdf4" : "#fff", color: cashForm.type === "entrada" ? "#065f46" : "#6b7280", fontWeight: 700, cursor: "pointer" }}>✅ Entrada</button>
            <button onClick={() => setCashForm({ ...cashForm, type: "salida" })} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `2px solid ${cashForm.type === "salida" ? "#dc2626" : "#e5e7eb"}`, background: cashForm.type === "salida" ? "#fff5f5" : "#fff", color: cashForm.type === "salida" ? "#dc2626" : "#6b7280", fontWeight: 700, cursor: "pointer" }}>🔴 Salida</button>
          </div>
          <Field label="Categoría">
            <Sel value={cashForm.category} onChange={e => setCashForm({ ...cashForm, category: e.target.value })}>
              {cashForm.type === "entrada" ? (
                <><option value="renta_cobrada">💰 Renta cobrada</option><option value="comision_cobrada">💼 Comisión cobrada</option><option value="mantenimiento_cobrado">🔧 Mantenimiento cobrado</option><option value="anticipo_mantenimiento">🔧 Anticipo mantenimiento</option><option value="otro">📌 Otro ingreso</option></>
              ) : (
                <><option value="liquidacion_propietario">🏦 Liquidación propietario</option><option value="pago_proveedor">🛠️ Pago proveedor</option><option value="material">📦 Material/Refacción</option><option value="gasto_operativo">📋 Gasto operativo</option><option value="otro">📌 Otro gasto</option></>
              )}
            </Sel>
          </Field>
          <Field label="Descripción *"><Input placeholder="Describe el movimiento" value={cashForm.description} onChange={e => setCashForm({ ...cashForm, description: e.target.value })} /></Field>
          <Field label="Monto *"><Input type="number" placeholder="0" value={cashForm.amount} onChange={e => setCashForm({ ...cashForm, amount: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Método"><Sel value={cashForm.payment_method} onChange={e => setCashForm({ ...cashForm, payment_method: e.target.value })}><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option></Sel></Field>
            <Field label="Fecha"><Input type="date" value={cashForm.date} onChange={e => setCashForm({ ...cashForm, date: e.target.value })} /></Field>
          </div>
          <Field label="Notas"><Input placeholder="Observaciones" value={cashForm.notes} onChange={e => setCashForm({ ...cashForm, notes: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={closeModal} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={saveCashMovement} color={cashForm.type === "entrada" ? "#065f46" : "#dc2626"} disabled={saving || !cashForm.description || !cashForm.amount}>{saving ? "Guardando..." : "Registrar"}</Btn>
          </div>
        </Modal>
      )}

      {showModal === "owner_payment" && (
        <Modal title="🏦 Registrar Liquidación" onClose={closeModal}>
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 14px", marginBottom: 20 }}><p style={{ margin: 0, fontSize: 13, color: "#065f46", fontWeight: 600 }}>✅ Al guardar se registra automáticamente la salida en caja</p></div>
          <Field label="Propietario *"><Input value={ownerPayForm.owner_name} onChange={e => setOwnerPayForm({ ...ownerPayForm, owner_name: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={ownerPayForm.owner_email} onChange={e => setOwnerPayForm({ ...ownerPayForm, owner_email: e.target.value })} /></Field>
          <Field label="Periodo"><Input placeholder="Ej: Abril 2026" value={ownerPayForm.period_description} onChange={e => setOwnerPayForm({ ...ownerPayForm, period_description: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Renta total"><Input type="number" value={ownerPayForm.total_rent} onChange={e => { const r = parseFloat(e.target.value) || 0; const com = parseFloat(ownerPayForm.total_commission) || 0; setOwnerPayForm({ ...ownerPayForm, total_rent: e.target.value, total_liquid: (r - com).toString(), amount_paid: (r - com).toString() }); }} /></Field>
            <Field label="Comisión"><Input type="number" value={ownerPayForm.total_commission} onChange={e => { const com = parseFloat(e.target.value) || 0; const r = parseFloat(ownerPayForm.total_rent) || 0; setOwnerPayForm({ ...ownerPayForm, total_commission: e.target.value, total_liquid: (r - com).toString(), amount_paid: (r - com).toString() }); }} /></Field>
            <Field label="Líquido"><Input type="number" value={ownerPayForm.total_liquid} readOnly style={{ background: "#f9fafb" }} /></Field>
          </div>
          <Field label="Monto pagado *"><Input type="number" value={ownerPayForm.amount_paid} onChange={e => setOwnerPayForm({ ...ownerPayForm, amount_paid: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Fecha"><Input type="date" value={ownerPayForm.payment_date} onChange={e => setOwnerPayForm({ ...ownerPayForm, payment_date: e.target.value })} /></Field>
            <Field label="Método"><Sel value={ownerPayForm.payment_method} onChange={e => setOwnerPayForm({ ...ownerPayForm, payment_method: e.target.value })}><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option></Sel></Field>
          </div>
          <Field label="Estado"><Sel value={ownerPayForm.status} onChange={e => setOwnerPayForm({ ...ownerPayForm, status: e.target.value })}><option value="pagado">Pagado completo</option><option value="pagado_parcial">Pagado parcial</option><option value="pendiente">Pendiente</option></Sel></Field>
          <Field label="Notas"><Input value={ownerPayForm.notes} onChange={e => setOwnerPayForm({ ...ownerPayForm, notes: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={closeModal} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={saveOwnerPayment} disabled={saving || !ownerPayForm.owner_name || !ownerPayForm.amount_paid}>{saving ? "Guardando..." : "Registrar liquidación"}</Btn>
          </div>
        </Modal>
      )}

      {/* ── CAMBIO 7: Modal contrato con co-responsable ─────────────────────── */}
      {showModal === "contract" && (
        <Modal title={editing ? "✏️ Editar Contrato" : "📋 Nuevo Contrato"} onClose={closeModal}>
          {!editing && <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 14px", marginBottom: 20 }}><p style={{ margin: 0, fontSize: 13, color: "#065f46", fontWeight: 600 }}>✨ Al guardar se generan todos los cobros automáticamente</p></div>}

          {/* Titular */}
          <Field label="Inquilino (Titular) *"><Input value={contractForm.tenant_name} onChange={e => setContractForm({ ...contractForm, tenant_name: e.target.value })} /></Field>
          <Field label="Email del inquilino"><Input type="email" value={contractForm.tenant_email} onChange={e => setContractForm({ ...contractForm, tenant_email: e.target.value })} /></Field>
          <Field label="Teléfono del inquilino" hint="10 dígitos, ej: 2221234567"><Input type="tel" placeholder="2221234567" value={contractForm.tenant_phone} onChange={e => setContractForm({ ...contractForm, tenant_phone: e.target.value })} /></Field>

          {/* Co-responsable — NUEVO */}
          <div style={{ background: "#f5f3ff", border: "1px solid #e9d5ff", borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <p style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>👥 Responsable de pago adicional (opcional)</p>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "#9ca3af" }}>Co-responsable, aval o familiar que también responde por el contrato</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Nombre"><Input placeholder="Nombre completo" value={contractForm.co_responsable_nombre} onChange={e => setContractForm({ ...contractForm, co_responsable_nombre: e.target.value })} /></Field>
              <Field label="Teléfono"><Input type="tel" placeholder="2221234567" value={contractForm.co_responsable_telefono} onChange={e => setContractForm({ ...contractForm, co_responsable_telefono: e.target.value })} /></Field>
            </div>
          </div>

          <Field label="Propietario"><Input value={contractForm.owner_name} onChange={e => setContractForm({ ...contractForm, owner_name: e.target.value })} /></Field>
          <Field label="Propiedad *">
            <Sel value={contractForm.property_name} onChange={e => { const sel = properties.find(p => p.name === e.target.value); setContractForm({ ...contractForm, property_name: e.target.value, monthly_rent: sel ? sel.rent_amount : contractForm.monthly_rent }); }}>
              <option value="">-- Selecciona --</option>
              {properties.map(p => <option key={p.id} value={p.name}>{p.name} · {fmt(p.rent_amount)}/mes</option>)}
            </Sel>
          </Field>
          <Field label="Renta mensual *"><Input type="number" value={contractForm.monthly_rent} onChange={e => setContractForm({ ...contractForm, monthly_rent: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Inicio *"><Input type="date" value={contractForm.start_date} onChange={e => setContractForm({ ...contractForm, start_date: e.target.value })} /></Field>
            <Field label="Fin *"><Input type="date" value={contractForm.end_date} onChange={e => setContractForm({ ...contractForm, end_date: e.target.value })} /></Field>
          </div>
          <Field label="Día de pago *" hint="Del 1 al 28"><Input type="number" min="1" max="28" value={contractForm.payment_day} onChange={e => setContractForm({ ...contractForm, payment_day: e.target.value })} /></Field>
          <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <p style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "#0369a1" }}>💰 ¿A quién le paga la renta el inquilino?</p>
            <Sel value={contractForm.rent_receiver} onChange={e => setContractForm({ ...contractForm, rent_receiver: e.target.value })}>
              <option value="inmobiliaria">A nosotros — entra a nuestra caja</option>
              <option value="propietario">Directo al propietario — solo registramos comisión</option>
            </Sel>
          </div>
          <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <p style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>💼 Comisión de administración</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Tipo"><Sel value={contractForm.commission_type} onChange={e => setContractForm({ ...contractForm, commission_type: e.target.value })}><option value="porcentaje">Porcentaje (%)</option><option value="fijo">Monto fijo</option></Sel></Field>
              <Field label={contractForm.commission_type === "porcentaje" ? "%" : "MXN"}><Input type="number" value={contractForm.commission_value} onChange={e => setContractForm({ ...contractForm, commission_value: e.target.value })} /></Field>
            </div>
            <Field label="¿Quién paga la comisión?"><Sel value={contractForm.commission_who} onChange={e => setContractForm({ ...contractForm, commission_who: e.target.value })}><option value="propietario_descuento">Se descuenta al propietario</option><option value="propietario_aparte">Propietario paga aparte</option><option value="inquilino">El inquilino</option></Sel></Field>
            {contractForm.commission_value && contractForm.monthly_rent && (
              <div style={{ background: "#fff", borderRadius: 8, padding: "10px 14px" }}>
                <p style={{ margin: 0, fontSize: 13, color: "#7c3aed", fontWeight: 700 }}>Tu comisión: {fmt(contractForm.commission_type === "porcentaje" ? (parseFloat(contractForm.monthly_rent) * parseFloat(contractForm.commission_value) / 100) : parseFloat(contractForm.commission_value))} / mes</p>
              </div>
            )}
          </div>
          <Field label="Depósito"><Input type="number" value={contractForm.deposit_amount} onChange={e => setContractForm({ ...contractForm, deposit_amount: e.target.value })} /></Field>
          <Field label="Notas"><Input value={contractForm.notes} onChange={e => setContractForm({ ...contractForm, notes: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={closeModal} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={saveContract} disabled={saving || !contractForm.tenant_name || !contractForm.property_name || !contractForm.monthly_rent || !contractForm.start_date || !contractForm.end_date}>{saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear contrato"}</Btn>
          </div>
        </Modal>
      )}

      {showModal === "property" && (
        <Modal title={editing ? "✏️ Editar Propiedad" : "🏠 Nueva Propiedad"} onClose={closeModal}>
          <Field label="Nombre *"><Input value={propForm.name} onChange={e => setPropForm({ ...propForm, name: e.target.value })} /></Field>
          <Field label="Dirección"><Input value={propForm.address} onChange={e => setPropForm({ ...propForm, address: e.target.value })} /></Field>
          <Field label="Tipo"><Sel value={propForm.property_type} onChange={e => setPropForm({ ...propForm, property_type: e.target.value })}><option value="depto">Departamento</option><option value="casa">Casa</option><option value="local">Local comercial</option><option value="bodega">Bodega</option><option value="oficina">Oficina</option></Sel></Field>
          <Field label="Renta mensual"><Input type="number" value={propForm.rent_amount} onChange={e => setPropForm({ ...propForm, rent_amount: e.target.value })} /></Field>
          <Field label="Estado"><Sel value={propForm.status} onChange={e => setPropForm({ ...propForm, status: e.target.value })}><option value="disponible">Disponible</option><option value="ocupada">Ocupada</option><option value="mantenimiento">En mantenimiento</option></Sel></Field>
          <Field label="Email propietario" hint="Para portal del propietario"><Input type="email" value={propForm.owner_email} onChange={e => setPropForm({ ...propForm, owner_email: e.target.value })} /></Field>
          <Field label="Teléfono propietario"><Input value={propForm.owner_phone} onChange={e => setPropForm({ ...propForm, owner_phone: e.target.value })} /></Field>
          <Field label="Notas"><Input value={propForm.notes} onChange={e => setPropForm({ ...propForm, notes: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={closeModal} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={saveProperty} disabled={saving || !propForm.name}>{saving ? "Guardando..." : editing ? "Guardar cambios" : "Guardar"}</Btn>
          </div>
        </Modal>
      )}

      {showModal === "payment" && (
        <Modal title="💰 Registrar Pago Manual" onClose={closeModal}>
          <Field label="Inquilino *"><Input value={payForm.tenant_name} onChange={e => setPayForm({ ...payForm, tenant_name: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={payForm.tenant_email} onChange={e => setPayForm({ ...payForm, tenant_email: e.target.value })} /></Field>
          <Field label="Propiedad"><Sel value={payForm.property_name} onChange={e => setPayForm({ ...payForm, property_name: e.target.value })}><option value="">-- Selecciona --</option>{properties.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}</Sel></Field>
          <Field label="Monto *"><Input type="number" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} /></Field>
          <Field label="Vencimiento"><Input type="date" value={payForm.due_date} onChange={e => setPayForm({ ...payForm, due_date: e.target.value })} /></Field>
          <Field label="Método"><Sel value={payForm.payment_method} onChange={e => setPayForm({ ...payForm, payment_method: e.target.value })}><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="cheque">Cheque</option></Sel></Field>
          <Field label="Estado"><Sel value={payForm.status} onChange={e => setPayForm({ ...payForm, status: e.target.value })}><option value="pendiente">Pendiente</option><option value="pagado">Pagado</option><option value="atrasado">Atrasado</option></Sel></Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={closeModal} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={savePayment} disabled={saving || !payForm.tenant_name || !payForm.amount}>{saving ? "Guardando..." : "Registrar"}</Btn>
          </div>
        </Modal>
      )}

      {showModal === "ticket" && (
        <Modal title={editing ? "✏️ Editar Ticket" : "🔧 Nuevo Ticket"} onClose={closeModal}>
          <Field label="Título *"><Input value={ticketForm.title} onChange={e => setTicketForm({ ...ticketForm, title: e.target.value })} /></Field>
          <Field label="Propiedad"><Sel value={ticketForm.property_name} onChange={e => setTicketForm({ ...ticketForm, property_name: e.target.value })}><option value="">-- Selecciona --</option>{properties.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}</Sel></Field>
          <Field label="Inquilino"><Input value={ticketForm.tenant_name} onChange={e => setTicketForm({ ...ticketForm, tenant_name: e.target.value })} /></Field>
          <Field label="Descripción"><Input value={ticketForm.description} onChange={e => setTicketForm({ ...ticketForm, description: e.target.value })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Categoría"><Sel value={ticketForm.category} onChange={e => setTicketForm({ ...ticketForm, category: e.target.value })}><option value="plomería">Plomería</option><option value="electricidad">Electricidad</option><option value="pintura">Pintura</option><option value="carpintería">Carpintería</option><option value="otro">Otro</option></Sel></Field>
            <Field label="Prioridad"><Sel value={ticketForm.priority} onChange={e => setTicketForm({ ...ticketForm, priority: e.target.value })}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option><option value="urgente">Urgente</option></Sel></Field>
          </div>
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, marginBottom: 4 }}>
            <p style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "#374151" }}>💰 Costos y pagos</p>
            <Field label="¿Quién paga?"><Sel value={ticketForm.payer} onChange={e => setTicketForm({ ...ticketForm, payer: e.target.value })}><option value="propietario">El propietario</option><option value="inquilino">El inquilino</option><option value="inmobiliaria">Nosotros</option></Sel></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Costo proveedor"><Input type="number" placeholder="0" value={ticketForm.provider_cost} onChange={e => setTicketForm({ ...ticketForm, provider_cost: e.target.value })} /></Field>
              <Field label="Lo que cobramos"><Input type="number" placeholder="0" value={ticketForm.charged_amount} onChange={e => setTicketForm({ ...ticketForm, charged_amount: e.target.value })} /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Anticipo cobrado"><Input type="number" placeholder="0" value={ticketForm.advance_amount} onChange={e => setTicketForm({ ...ticketForm, advance_amount: e.target.value })} /></Field>
              <Field label="¿Ya recibiste el anticipo?"><Sel value={ticketForm.advance_paid ? "si" : "no"} onChange={e => setTicketForm({ ...ticketForm, advance_paid: e.target.value === "si" })}><option value="no">No todavía</option><option value="si">Sí, ya lo tengo</option></Sel></Field>
            </div>
            {ticketForm.provider_cost > 0 && ticketForm.charged_amount > 0 && (
              <div style={{ background: "#fff", borderRadius: 8, padding: "10px 14px", marginTop: 4 }}>
                <p style={{ margin: 0, fontSize: 13, color: "#7c3aed", fontWeight: 700 }}>Utilidad: {fmt((parseFloat(ticketForm.charged_amount) || 0) - (parseFloat(ticketForm.provider_cost) || 0))}</p>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={closeModal} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={saveTicket} disabled={saving || !ticketForm.title}>{saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear ticket"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
