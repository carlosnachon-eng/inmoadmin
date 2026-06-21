import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import Layout, { brand, Btn } from "../components/Layout";
import { usePermiso, SinAcceso } from "../lib/permisos";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const StatusBadge = ({ status }) => {
  const map = {
    ocupada:       { bg: "#d1fae5", color: "#065f46", label: "Ocupada" },
    disponible:    { bg: "#e0e7ff", color: "#3730a3", label: "Disponible" },
    mantenimiento: { bg: "#fce7f3", color: "#9d174d", label: "Mantenimiento" },
  };
  const s = map[status] || { bg: "#f3f4f6", color: "#374151", label: status };
  return <span style={{ background: s.bg, color: s.color, padding: "2px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{s.label}</span>;
};

const Modal = ({ title, onClose, children }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: brand.gray }}>{title}</h2>
        <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

const ConfirmModal = ({ message, onConfirm, onCancel }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: "100%", maxWidth: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <p style={{ fontSize: 16, fontWeight: 700, color: brand.gray, margin: "0 0 8px" }}>¿Estás seguro?</p>
      <p style={{ fontSize: 14, color: brand.grayLight, margin: "0 0 24px" }}>{message}</p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
        <button onClick={onConfirm} style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 700 }}>Sí, eliminar</button>
      </div>
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
  <select {...props} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", background: "#fff", ...props.style }}>
    {children}
  </select>
);

const expenseCategoryLabels = {
  condominio: "Condominio", predial: "Predial", agua: "Agua", luz: "Luz",
  gas: "Gas", seguro: "Seguro", mantenimiento_comun: "Mantenimiento común", otro: "Otro",
};

// Mapeo tipo de servicio -> categoría de property_expenses
const servicioToExpenseCategory = {
  luz: "luz",
  agua: "agua",
  gas_mensual: "gas",
  gas_recarga: "gas",
  mantenimiento: "mantenimiento_comun",
  internet: "otro",
  predial: "predial",
};

const SERVICIOS_CONFIG = [
  { tipo: "luz",           label: "⚡ Luz (CFE)",       periodicidad: "bimestral" },
  { tipo: "agua",          label: "💧 Agua",            periodicidad: "mensual"   },
  { tipo: "gas_mensual",   label: "🔥 Gas (mensual)",   periodicidad: "mensual"   },
  { tipo: "gas_recarga",   label: "🔥 Gas (recarga)",   periodicidad: "recarga"   },
  { tipo: "mantenimiento", label: "🏢 Mantenimiento",   periodicidad: "mensual"   },
  { tipo: "internet",      label: "🌐 Internet",        periodicidad: "mensual"   },
  { tipo: "predial",       label: "🏛️ Predial/Limpia",  periodicidad: "anual", propietario: true },
];

function ModalServicios({ property, onClose, showToast, profile }) {
  const [servicios, setServicios] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tabServ, setTabServ] = useState("estado");
  const [saving, setSaving] = useState(false);
  const [modalPago, setModalPago] = useState(null);
  const [pagoForm, setPagoForm] = useState({ monto: "", notas: "", fecha_limite: "", lo_pago_emporio: true });
  const [uploadingComp, setUploadingComp] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [filtroPeriodo, setFiltroPeriodo] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");

  const periodoActual = () => {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
  };

  const loadServicios = async () => {
    setLoading(true);
    const { data: servData } = await supabase.from("servicios_inmueble").select("*").eq("property_name", property.name);
    const { data: pagosData } = await supabase.from("pagos_servicios").select("*").eq("property_name", property.name).order("created_at", { ascending: false });
    setServicios(servData || []);
    setPagos(pagosData || []);
    setLoading(false);
  };

  useEffect(() => { loadServicios(); }, []);

  const toggleServicio = async (tipo, periodicidad) => {
    const existe = servicios.find(s => s.tipo === tipo);
    if (existe) {
      await supabase.from("servicios_inmueble").delete().eq("id", existe.id);
    } else {
      await supabase.from("servicios_inmueble").insert({ property_name: property.name, tipo, periodicidad, aplica: true, quien_paga: "inquilino" });
    }
    loadServicios();
  };

  const registrarPago = async (servicio) => {
    setSaving(true);
    const config = SERVICIOS_CONFIG.find(c => c.tipo === servicio.tipo);
    const monto = parseFloat(pagoForm.monto) || null;
    const esCargoPropietario = (servicio.quien_paga || "inquilino") === "propietario";
    const loPagoEmporio = esCargoPropietario && pagoForm.lo_pago_emporio;

    // Si lo pagó Emporio a cuenta del propietario: crear el gasto que se descontará
    // en la liquidación, y registrar la salida real de caja (mismo día, mismo monto —
    // dinero que Emporio ya manejaba en su caja por cuenta del propietario, no se
    // "repone" después; la liquidación solo lo descuenta contablemente).
    let gastoId = null;
    if (loPagoEmporio) {
      if (!monto) {
        showToast("Captura el monto para poder descontarlo de la liquidación", false);
        setSaving(false);
        return;
      }
      const { data: gastoData, error: gastoError } = await supabase.from("property_expenses").insert([{
        property_name: property.name,
        category: servicioToExpenseCategory[servicio.tipo] || "otro",
        description: `${config?.label || servicio.tipo} — periodo ${periodoActual()}`,
        amount: monto,
        paid_by: "propietario",
        payment_method: "transferencia",
        date: new Date().toISOString().split("T")[0],
        notes: pagoForm.notas || "",
        created_by: profile?.email,
      }]).select().single();

      if (gastoError) {
        showToast("Error al registrar gasto: " + gastoError.message, false);
        setSaving(false);
        return;
      }
      gastoId = gastoData?.id || null;

      await supabase.from("cash_movements").insert([{
        type: "salida",
        category: "gasto_operativo",
        description: `${config?.label || servicio.tipo}: ${property.name} (pagado por Emporio, a cuenta del propietario)`,
        amount: monto,
        payment_method: "transferencia",
        date: new Date().toISOString().split("T")[0],
        created_by: profile?.email,
        created_at: new Date().toISOString(),
      }]);
    }

    const { error } = await supabase.from("pagos_servicios").insert({
      property_name: property.name,
      tipo: servicio.tipo,
      periodo: periodoActual(),
      status: "pagado",
      monto,
      notas: pagoForm.notas,
      fecha_limite: pagoForm.fecha_limite || null,
      subido_por: "admin",
      gasto_id: gastoId,
    });
    setSaving(false);
    if (error) { showToast("Error: " + error.message, false); return; }
    showToast(loPagoEmporio ? "Pago registrado y descontado de la liquidación del propietario" : "Pago registrado");
    setModalPago(null);
    setPagoForm({ monto: "", notas: "", fecha_limite: "", lo_pago_emporio: true });
    loadServicios();
  };

  const subirComprobanteAdmin = async (servicio, file) => {
    setUploadingComp(servicio.tipo);
    try {
      const ext = file.name.split(".").pop();
      const fileName = `servicios/admin_${property.name}_${servicio.tipo}_${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("receipts").upload(fileName, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("receipts").getPublicUrl(fileName);
      const periodo = periodoActual();
      const pagoExistente = pagos.find(p => p.tipo === servicio.tipo && p.periodo === periodo);
      if (pagoExistente) {
        await supabase.from("pagos_servicios").update({ comprobante_url: publicUrl, status: "en_revision" }).eq("id", pagoExistente.id);
      } else {
        await supabase.from("pagos_servicios").insert({ property_name: property.name, tipo: servicio.tipo, periodo, status: "en_revision", comprobante_url: publicUrl, subido_por: "admin" });
      }
      showToast("Comprobante subido");
      loadServicios();
    } catch (e) { showToast("Error: " + e.message, false); }
    setUploadingComp(null);
  };

  const pagoDelPeriodo = (tipo) => {
    const periodo = periodoActual();
    return pagos.find(p => p.tipo === tipo && p.periodo === periodo);
  };

  const semaforo = (status) => {
    if (status === "pagado")      return { color: "#065f46", bg: "#d1fae5", label: "✅ Pagado" };
    if (status === "en_revision") return { color: "#1e40af", bg: "#dbeafe", label: "🔍 En revisión" };
    if (status === "atrasado")    return { color: "#991b1b", bg: "#fee2e2", label: "🔴 Atrasado" };
    return { color: "#92400e", bg: "#fef3c7", label: "⏳ Pendiente" };
  };

  const serviciosActivos = servicios.filter(s => s.aplica);
  const periodosDisponibles = [...new Set(pagos.map(p => p.periodo))].sort((a, b) => b.localeCompare(a));
  const pagosFiltrados = pagos.filter(p => {
    if (filtroTipo !== "todos" && p.tipo !== filtroTipo) return false;
    if (filtroPeriodo && p.periodo !== filtroPeriodo) return false;
    if (filtroStatus !== "todos" && p.status !== filtroStatus) return false;
    return true;
  });
  const pagosAgrupados = SERVICIOS_CONFIG.reduce((acc, config) => {
    const pagosDelServicio = pagosFiltrados.filter(p => p.tipo === config.tipo);
    if (pagosDelServicio.length > 0) acc[config.tipo] = pagosDelServicio;
    return acc;
  }, {});

  const servicioModalEsPropietario = modalPago && (modalPago.quien_paga || "inquilino") === "propietario";

  return (
    <Modal title={`Servicios — ${property.name}`} onClose={onClose}>
      <div style={{ display: "flex", gap: 6, marginBottom: 18, borderBottom: "1px solid #f0f0f0" }}>
        {[{ id: "estado", label: "Estado actual" }, { id: "historial", label: "Historial" }].map(t => (
          <button key={t.id} onClick={() => setTabServ(t.id)} style={{
            background: "none", border: "none", padding: "8px 4px", marginRight: 14,
            fontSize: 13, fontWeight: tabServ === t.id ? 700 : 500,
            color: tabServ === t.id ? brand.red : brand.grayLight,
            borderBottom: tabServ === t.id ? `2px solid ${brand.red}` : "2px solid transparent",
            cursor: "pointer",
          }}>{t.label}</button>
        ))}
      </div>

      {loading ? <p style={{ color: brand.grayLight, fontSize: 13 }}>Cargando...</p> : tabServ === "estado" ? (
        <div>
          <p style={{ fontSize: 12, color: brand.grayLight, margin: "0 0 14px" }}>
            Marca los servicios que aplican a esta propiedad y registra los pagos del período actual.
          </p>
          {SERVICIOS_CONFIG.map(config => {
            const activo = serviciosActivos.find(s => s.tipo === config.tipo);
            const pago = pagoDelPeriodo(config.tipo);
            const sc = semaforo(pago?.status);
            return (
              <div key={config.tipo} style={{ border: "1px solid #f0f0f0", borderRadius: 10, padding: 12, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!activo} onChange={() => toggleServicio(config.tipo, config.periodicidad)} />
                    {config.label}
                  </label>
                  {activo && (
                    <span style={{ background: sc.bg, color: sc.color, padding: "2px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600 }}>{sc.label}</span>
                  )}
                </div>
                {activo && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <Btn small variant="secondary" onClick={() => { setModalPago(activo); setPagoForm({ monto: "", notas: "", fecha_limite: "", lo_pago_emporio: true }); }}>
                      Registrar pago
                    </Btn>
                    <label style={{ cursor: "pointer" }}>
                      <input type="file" style={{ display: "none" }} onChange={e => subirComprobanteAdmin(activo, e.target.files[0])} />
                      <span style={{ background: "#f0f9ff", color: "#0369a1", border: "1px solid #bae6fd", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, display: "inline-block" }}>
                        {uploadingComp === config.tipo ? "Subiendo..." : "📎 Comprobante"}
                      </span>
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            <Sel value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={{ width: "auto" }}>
              <option value="todos">Todos los servicios</option>
              {SERVICIOS_CONFIG.map(c => <option key={c.tipo} value={c.tipo}>{c.label}</option>)}
            </Sel>
            <Sel value={filtroPeriodo} onChange={e => setFiltroPeriodo(e.target.value)} style={{ width: "auto" }}>
              <option value="">Todos los períodos</option>
              {periodosDisponibles.map(p => <option key={p} value={p}>{p}</option>)}
            </Sel>
            <Sel value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} style={{ width: "auto" }}>
              <option value="todos">Todos los estados</option>
              <option value="pagado">Pagado</option>
              <option value="en_revision">En revisión</option>
              <option value="atrasado">Atrasado</option>
            </Sel>
          </div>
          {Object.keys(pagosAgrupados).length === 0 && (
            <p style={{ color: brand.grayLight, fontSize: 13, textAlign: "center", padding: 20 }}>Sin pagos registrados con esos filtros</p>
          )}
          {Object.entries(pagosAgrupados).map(([tipo, lista]) => (
            <div key={tipo} style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: brand.gray, margin: "0 0 6px" }}>
                {SERVICIOS_CONFIG.find(c => c.tipo === tipo)?.label || tipo}
              </p>
              {lista.map(p => {
                const sc = semaforo(p.status);
                return (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>
                    <span style={{ color: brand.grayLight }}>{p.periodo}</span>
                    <span>{p.monto ? fmt(p.monto) : "—"}</span>
                    <span style={{ background: sc.bg, color: sc.color, padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>{sc.label}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {modalPago && (
        <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid #f0f0f0" }}>
          <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>
            Registrar pago — {SERVICIOS_CONFIG.find(c => c.tipo === modalPago.tipo)?.label}
          </p>
          <Field label="Monto"><Input type="number" value={pagoForm.monto} onChange={e => setPagoForm({ ...pagoForm, monto: e.target.value })} /></Field>
          <Field label="Notas"><Input value={pagoForm.notas} onChange={e => setPagoForm({ ...pagoForm, notas: e.target.value })} /></Field>
          {servicioModalEsPropietario && (
            <Field label="">
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={pagoForm.lo_pago_emporio} onChange={e => setPagoForm({ ...pagoForm, lo_pago_emporio: e.target.checked })} />
                Emporio pagó este servicio a cuenta del propietario (se descontará de su liquidación)
              </label>
            </Field>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="secondary" onClick={() => setModalPago(null)}>Cancelar</Btn>
            <Btn onClick={() => registrarPago(modalPago)} disabled={saving}>{saving ? "Guardando..." : "Registrar"}</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Propiedades() {
  const { cargando: permisoCargando, puedeVer, puedeEditar, esAdmin } = usePermiso("propiedades");

  const [properties, setProperties] = useState([]);
  const [propertyExpenses, setPropertyExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [uploadingContrato, setUploadingContrato] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [serviciosProperty, setServiciosProperty] = useState(null);
  const [serviciosResumen, setServiciosResumen] = useState({});
  const [profile, setProfile] = useState(null);

  const [busquedaProp, setBusquedaProp] = useState("");
  const [filtroStatusProp, setFiltroStatusProp] = useState("");
  const [filtroServicios, setFiltroServicios] = useState(false);

  const emptyProp = { name: "", address: "", property_type: "depto", rent_amount: "", status: "disponible", notes: "", owner_email: "", owner_phone: "" };
  const emptyExpense = { property_name: "", category: "condominio", description: "", amount: "", paid_by: "propietario", payment_method: "transferencia", date: new Date().toISOString().split("T")[0], notes: "" };
  const [propForm, setPropForm] = useState(emptyProp);
  const [expenseForm, setExpenseForm] = useState(emptyExpense);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };
  const logout = async () => { await supabase.auth.signOut(); window.location.href = "/"; };

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        if (typeof window !== "undefined") window.location.href = "/";
        return;
      }
      supabase.from("profiles").select("*").eq("id", session.user.id).single()
        .then(({ data }) => setProfile(data));
    });
  }, []);

  useEffect(() => {
    if (!permisoCargando && puedeVer) loadData();
  }, [permisoCargando, puedeVer]);

  const loadData = async () => {
    setLoading(true);
    const [p, pe] = await Promise.all([
      supabase.from("properties").select("*").order("created_at", { ascending: false }),
      supabase.from("property_expenses").select("*").order("date", { ascending: false }),
    ]);
    setProperties(p.data || []);
    setPropertyExpenses(pe.data || []);
    setLoading(false);
    loadServiciosResumen(p.data || []);
  };

  const loadServiciosResumen = async (props) => {
    if (!props.length) return;
    const hoy = new Date();
    const periodo = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
    const { data: servData } = await supabase.from("servicios_inmueble").select("*").in("property_name", props.map(p => p.name));
    const { data: pagosData } = await supabase.from("pagos_servicios").select("*").eq("periodo", periodo).in("property_name", props.map(p => p.name));
    const resumen = {};
    props.forEach(p => {
      const servs = (servData || []).filter(s => s.property_name === p.name && s.aplica);
      const pagos = (pagosData || []).filter(pg => pg.property_name === p.name);
      if (servs.length === 0) { resumen[p.name] = null; return; }
      const atrasado = servs.some(s => { const pg = pagos.find(pg => pg.tipo === s.tipo); return !pg || pg.status === "atrasado"; });
      const revision = !atrasado && servs.some(s => { const pg = pagos.find(pg => pg.tipo === s.tipo); return pg?.status === "en_revision"; });
      const todos = servs.every(s => { const pg = pagos.find(pg => pg.tipo === s.tipo); return pg?.status === "pagado"; });
      resumen[p.name] = atrasado ? "atrasado" : revision ? "revision" : todos ? "ok" : "pendiente";
    });
    setServiciosResumen(resumen);
  };

  const closeModal = () => {
    setShowModal(null); setEditing(null);
    setPropForm(emptyProp); setExpenseForm(emptyExpense);
  };

  const saveProperty = async () => {
    setSaving(true);
    const data = { ...propForm, rent_amount: parseFloat(propForm.rent_amount) || 0 };
    const { error } = editing?.type === "property"
      ? await supabase.from("properties").update(data).eq("id", editing.id)
      : await supabase.from("properties").insert([data]);
    setSaving(false);
    if (error) { showToast("Error: " + error.message, false); return; }
    showToast(editing ? "Propiedad actualizada" : "Propiedad guardada");
    closeModal(); loadData();
  };

  const saveExpense = async () => {
    setSaving(true);
    const amount = parseFloat(expenseForm.amount) || 0;
    const data = { ...expenseForm, amount, created_by: profile?.email };
    const { error } = await supabase.from("property_expenses").insert([data]);
    if (error) { setSaving(false); showToast("Error: " + error.message, false); return; }
    if (expenseForm.paid_by === "inmobiliaria") {
      await supabase.from("cash_movements").insert([{
        type: "salida", category: "gasto_operativo",
        description: `${expenseCategoryLabels[expenseForm.category]}: ${expenseForm.description} - ${expenseForm.property_name}`,
        amount, payment_method: expenseForm.payment_method, date: expenseForm.date,
        created_by: profile?.email, created_at: new Date().toISOString()
      }]);
    }
    setSaving(false);
    showToast("Gasto registrado"); closeModal(); loadData();
  };

  const subirContrato = async (propertyId, propertyName, file) => {
    if (!file) return;
    if (file.type !== "application/pdf") { showToast("Solo se permiten archivos PDF", false); return; }
    if (file.size > 10 * 1024 * 1024) { showToast("El archivo es muy grande (max 10MB)", false); return; }
    setUploadingContrato(propertyId);
    try {
      const fileName = `${propertyId}_${Date.now()}.pdf`;
      const { error: uploadError } = await supabase.storage.from("contratos").upload(fileName, file, { upsert: true, contentType: "application/pdf" });
      if (uploadError) throw uploadError;
      await supabase.from("properties").update({ contrato_url: fileName }).eq("id", propertyId);
      showToast(`Contrato subido para ${propertyName}`);
      loadData();
    } catch (e) { showToast("Error al subir: " + e.message, false); }
    setUploadingContrato(null);
  };

  const verContrato = async (contratoUrl) => {
    try {
      const { data, error } = await supabase.storage.from("contratos").createSignedUrl(contratoUrl, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank");
    } catch (e) { showToast("Error al abrir contrato: " + e.message, false); }
  };

  const eliminarContrato = async (propertyId, contratoUrl) => {
    try {
      await supabase.storage.from("contratos").remove([contratoUrl]);
      await supabase.from("properties").update({ contrato_url: null }).eq("id", propertyId);
      showToast("Contrato eliminado"); loadData();
    } catch (e) { showToast("Error: " + e.message, false); }
  };

  const deleteItem = (type, id, msg) => {
    if (!puedeEditar) { showToast("No tienes permiso para eliminar", false); return; }
    setConfirm({
      message: msg,
      onConfirm: async () => {
        setConfirm(null);
        if (type === "property") await supabase.from("properties").delete().eq("id", id);
        if (type === "expense") await supabase.from("property_expenses").delete().eq("id", id);
        showToast("Eliminado"); loadData();
      }
    });
  };

  if (permisoCargando) return null;
  if (!puedeVer) return <SinAcceso />;

  const propiedadesFiltradas = properties.filter(p => {
    if (busquedaProp) {
      const q = busquedaProp.toLowerCase();
      const enNombre = (p.name || "").toLowerCase().includes(q);
      const enDireccion = (p.address || "").toLowerCase().includes(q);
      const enCorreo = (p.owner_email || "").toLowerCase().includes(q);
      if (!enNombre && !enDireccion && !enCorreo) return false;
    }
    if (filtroStatusProp && p.status !== filtroStatusProp) return false;
    if (filtroServicios) {
      const ss = serviciosResumen[p.name];
      if (ss !== "atrasado" && ss !== "pendiente") return false;
    }
    return true;
  });

  return (
    <Layout view="propiedades" profile={profile} onLogout={logout}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: 300 }}>
          {toast.msg}
        </div>
      )}
      {confirm && <ConfirmModal message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}

      <div style={{ padding: isMobile ? 14 : 28 }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200 }}>
            <p style={{ color: brand.grayLight }}>Cargando...</p>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 800, color: brand.gray }}>
                Propiedades ({propiedadesFiltradas.length}{propiedadesFiltradas.length !== properties.length ? ` de ${properties.length}` : ""})
              </h2>
              {puedeEditar && <Btn onClick={() => { setEditing(null); setShowModal("property"); }}>+ Nueva propiedad</Btn>}
            </div>

            <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 18, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #f0f0f0" }}>
              <input
                type="text"
                placeholder="🔍 Buscar por nombre, dirección o correo..."
                value={busquedaProp}
                onChange={e => setBusquedaProp(e.target.value)}
                style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, boxSizing: "border-box" }}
              />
              <select value={filtroStatusProp} onChange={e => setFiltroStatusProp(e.target.value)}
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
                <option value="">Todos los estados</option>
                <option value="ocupada">Ocupada</option>
                <option value="disponible">Disponible</option>
                <option value="mantenimiento">En mantenimiento</option>
              </select>
              <button onClick={() => setFiltroServicios(!filtroServicios)}
                style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${filtroServicios ? "#dc2626" : "#e5e7eb"}`, background: filtroServicios ? "#fff5f5" : "#fff", color: filtroServicios ? "#dc2626" : "#6b7280", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                🔴 Servicios pendientes
              </button>
              {(busquedaProp || filtroStatusProp || filtroServicios) && (
                <button onClick={() => { setBusquedaProp(""); setFiltroStatusProp(""); setFiltroServicios(false); }}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "#f3f4f6", color: "#6b7280", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  ✕ Limpiar
                </button>
              )}
            </div>

            {propiedadesFiltradas.length === 0 && (
              <div style={{ background: "#fff", borderRadius: 14, padding: 40, textAlign: "center", border: "1px solid #f0f0f0" }}>
                <p style={{ fontSize: 32, margin: "0 0 8px" }}>🔍</p>
                <p style={{ color: "#9ca3af", fontSize: 14 }}>No hay propiedades con esos filtros</p>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
              {propiedadesFiltradas.map(p => {
                const gastosPropiedad = propertyExpenses.filter(e => e.property_name === p.name);
                const totalGastos = gastosPropiedad.reduce((a, e) => a + (e.amount || 0), 0);
                const servStatus = serviciosResumen[p.name];
                const servColor = servStatus === "ok" ? "#065f46" : servStatus === "revision" ? "#1e40af" : servStatus === "atrasado" ? "#991b1b" : servStatus === "pendiente" ? "#92400e" : "#9ca3af";
                const servBg    = servStatus === "ok" ? "#d1fae5" : servStatus === "revision" ? "#dbeafe" : servStatus === "atrasado" ? "#fee2e2" : servStatus === "pendiente" ? "#fef3c7" : "#f3f4f6";
                const servLabel = servStatus === "ok" ? "✅ Servicios al día" : servStatus === "revision" ? "🔍 En revisión" : servStatus === "atrasado" ? "🔴 Servicios pendientes" : servStatus === "pendiente" ? "⏳ Servicios pendientes" : "🔌 Sin configurar";
                return (
                  <div key={p.id} style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #f0f0f0" }}>
                    <div style={{ background: `linear-gradient(135deg, ${brand.redDark}, ${brand.red})`, height: 56, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                      {p.property_type === "casa" ? "🏠" : p.property_type === "depto" ? "🏢" : p.property_type === "local" ? "🏪" : p.property_type === "bodega" ? "🏭" : "💼"}
                    </div>
                    <div style={{ padding: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: brand.gray }}>{p.name}</h3>
                        <StatusBadge status={p.status} />
                      </div>
                      <p style={{ margin: "0 0 4px", fontSize: 11, color: brand.grayLight }}>📍 {p.address || "Sin dirección"}</p>
                      {p.owner_email && <p style={{ margin: "0 0 8px", fontSize: 11, color: brand.grayLight }}>{p.owner_email}</p>}
                      <div style={{ paddingTop: 8, borderTop: "1px solid #f3f4f6", marginBottom: 8 }}>
                        <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: brand.gray }}>{fmt(p.rent_amount)}</p>
                        {totalGastos > 0 && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#dc2626" }}>Gastos: {fmt(totalGastos)}</p>}
                      </div>

                      <div style={{ marginBottom: 10 }}>
                        <span style={{ background: servBg, color: servColor, padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600 }}>
                          {servLabel}
                        </span>
                      </div>

                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {puedeEditar && (
                          <Btn small variant="secondary" onClick={() => {
                            setEditing({ type: "property", id: p.id });
                            setPropForm({ name: p.name || "", address: p.address || "", property_type: p.property_type || "depto", rent_amount: p.rent_amount || "", status: p.status || "disponible", notes: p.notes || "", owner_email: p.owner_email || "", owner_phone: p.owner_phone || "" });
                            setShowModal("property");
                          }}>Editar</Btn>
                        )}
                        {puedeEditar && (
                          <Btn small variant="secondary" onClick={() => { setExpenseForm({ ...emptyExpense, property_name: p.name }); setShowModal("expense"); }}>+ Gasto</Btn>
                        )}
                        <button onClick={() => setServiciosProperty(p)}
                          style={{ background: "#f0f9ff", color: "#0369a1", border: "1px solid #bae6fd", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                          🔌 Servicios
                        </button>
                        {esAdmin && <Btn small variant="danger" onClick={() => deleteItem("property", p.id, `Eliminar "${p.name}"`)}>X</Btn>}
                      </div>

                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f3f4f6" }}>
                        {p.contrato_url ? (
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ fontSize: 11, color: "#065f46", fontWeight: 600 }}>✅ Contrato subido</span>
                            <Btn small variant="secondary" onClick={() => verContrato(p.contrato_url)}>Ver</Btn>
                            {puedeEditar && (
                              <label style={{ cursor: "pointer" }}>
                                <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => subirContrato(p.id, p.name, e.target.files[0])} />
                                <span style={{ background: "#fffbeb", color: "#92400e", border: "1px solid #fcd34d", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                  {uploadingContrato === p.id ? "Subiendo..." : "Actualizar"}
                                </span>
                              </label>
                            )}
                            {esAdmin && <Btn small variant="danger" onClick={() => eliminarContrato(p.id, p.contrato_url)}>X</Btn>}
                          </div>
                        ) : puedeEditar ? (
                          <label style={{ cursor: "pointer", display: "inline-block" }}>
                            <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => subirContrato(p.id, p.name, e.target.files[0])} />
                            <span style={{ background: brand.redLight, color: brand.red, borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                              {uploadingContrato === p.id ? "Subiendo..." : "📎 Subir contrato PDF"}
                            </span>
                          </label>
                        ) : null}
                      </div>

                      {gastosPropiedad.length > 0 && (
                        <div style={{ marginTop: 8, borderTop: "1px solid #f3f4f6", paddingTop: 8 }}>
                          {gastosPropiedad.slice(0, 3).map(e => (
                            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: brand.grayLight, padding: "2px 0" }}>
                              <span>{expenseCategoryLabels[e.category]} · {e.description}</span>
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ color: "#dc2626", fontWeight: 600 }}>{fmt(e.amount)}</span>
                                {esAdmin && <button onClick={() => deleteItem("expense", e.id, "Eliminar gasto")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, padding: "0 2px", color: "#dc2626" }}>X</button>}
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
      </div>

      {serviciosProperty && (
        <ModalServicios
          property={serviciosProperty}
          onClose={() => { setServiciosProperty(null); loadData(); }}
          showToast={showToast}
          profile={profile}
        />
      )}

      {showModal === "property" && puedeEditar && (
        <Modal title={editing ? "Editar Propiedad" : "Nueva Propiedad"} onClose={closeModal}>
          <Field label="Nombre"><Input value={propForm.name} onChange={e => setPropForm({ ...propForm, name: e.target.value })} /></Field>
          <Field label="Dirección"><Input value={propForm.address} onChange={e => setPropForm({ ...propForm, address: e.target.value })} /></Field>
          <Field label="Tipo">
            <Sel value={propForm.property_type} onChange={e => setPropForm({ ...propForm, property_type: e.target.value })}>
              <option value="depto">Departamento</option>
              <option value="casa">Casa</option>
              <option value="local">Local comercial</option>
              <option value="bodega">Bodega</option>
              <option value="oficina">Oficina</option>
            </Sel>
          </Field>
          <Field label="Renta mensual"><Input type="number" value={propForm.rent_amount} onChange={e => setPropForm({ ...propForm, rent_amount: e.target.value })} /></Field>
          <Field label="Estado">
            <Sel value={propForm.status} onChange={e => setPropForm({ ...propForm, status: e.target.value })}>
              <option value="disponible">Disponible</option>
              <option value="ocupada">Ocupada</option>
              <option value="mantenimiento">En mantenimiento</option>
            </Sel>
          </Field>
          <Field label="Email propietario"><Input type="email" value={propForm.owner_email} onChange={e => setPropForm({ ...propForm, owner_email: e.target.value })} /></Field>
          <Field label="Teléfono propietario"><Input value={propForm.owner_phone} onChange={e => setPropForm({ ...propForm, owner_phone: e.target.value })} /></Field>
          <Field label="Notas"><Input value={propForm.notes} onChange={e => setPropForm({ ...propForm, notes: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
            <Btn variant="secondary" onClick={closeModal}>Cancelar</Btn>
            <Btn onClick={saveProperty} disabled={saving || !propForm.name}>{saving ? "Guardando..." : editing ? "Guardar cambios" : "Guardar"}</Btn>
          </div>
        </Modal>
      )}

      {showModal === "expense" && puedeEditar && (
        <Modal title="Registrar Gasto Operativo" onClose={closeModal}>
          <Field label="Propiedad">
            <Sel value={expenseForm.property_name} onChange={e => setExpenseForm({ ...expenseForm, property_name: e.target.value })}>
              <option value="">-- Selecciona --</option>
              {properties.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </Sel>
          </Field>
          <Field label="Concepto">
            <Sel value={expenseForm.category} onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value })}>
              <option value="condominio">Condominio</option>
              <option value="predial">Predial</option>
              <option value="agua">Agua</option>
              <option value="luz">Luz</option>
              <option value="gas">Gas</option>
              <option value="seguro">Seguro</option>
              <option value="mantenimiento_comun">Mantenimiento común</option>
              <option value="otro">Otro</option>
            </Sel>
          </Field>
          <Field label="Descripción"><Input placeholder="Ej: Cuota condominio enero 2026" value={expenseForm.description} onChange={e => setExpenseForm({ ...expenseForm, description: e.target.value })} /></Field>
          <Field label="Monto"><Input type="number" placeholder="0" value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} /></Field>
          <Field label="¿Quién paga?">
            <Sel value={expenseForm.paid_by} onChange={e => setExpenseForm({ ...expenseForm, paid_by: e.target.value })}>
              <option value="propietario">El propietario (se descuenta de su liquidación)</option>
              <option value="inmobiliaria">Nosotros (sale de nuestra caja)</option>
            </Sel>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Método">
              <Sel value={expenseForm.payment_method} onChange={e => setExpenseForm({ ...expenseForm, payment_method: e.target.value })}>
                <option value="transferencia">Transferencia</option>
                <option value="efectivo">Efectivo</option>
              </Sel>
            </Field>
            <Field label="Fecha"><Input type="date" value={expenseForm.date} onChange={e => setExpenseForm({ ...expenseForm, date: e.target.value })} /></Field>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
            <Btn variant="secondary" onClick={closeModal}>Cancelar</Btn>
            <Btn onClick={saveExpense} disabled={saving || !expenseForm.description || !expenseForm.amount || !expenseForm.property_name}>
              {saving ? "Guardando..." : "Registrar gasto"}
            </Btn>
          </div>
        </Modal>
      )}
    </Layout>
  );
}
