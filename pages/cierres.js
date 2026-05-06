import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const VENDEDORES = ["Todos", "Carlos", "Ivonne", "Rubi", "Miguel", "Ari", "Andrea",
  "Guillermo", "Rosario", "Angelica", "Fabiola", "Majo", "Oficina", "Dirección"];

export default function Cierres() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cierres, setCierres] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [editando, setEditando] = useState(null);

  // Filtros
  const [filtroAnio, setFiltroAnio] = useState(new Date().getFullYear());
  const [filtroMes, setFiltroMes] = useState(0); // 0 = todos
  const [filtroOp, setFiltroOp] = useState(""); // RENTA, VENTA, ""
  const [filtroVendedor, setFiltroVendedor] = useState("Todos");
  const [busqueda, setBusqueda] = useState("");

  const emptyForm = {
    propiedad: "", fecha_cierre: new Date().toISOString().split("T")[0],
    operacion: "RENTA", precio: "", comision: "", cobrado: "", pendiente: "",
    vendedor: "Carlos", com_vendedor: "", pag_vendedor: "", pend_vend: "",
    comision_inmobiliaria: "", notas: "",
    anio: new Date().getFullYear(), mes: new Date().getMonth() + 1,
    mes_nombre: MESES[new Date().getMonth() + 1],
  };
  const [form, setForm] = useState(emptyForm);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadCierres();
      else setLoading(false);
    });
  }, []);

  const loadCierres = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("cierres")
      .select("*")
      .order("fecha_cierre", { ascending: false });
    setCierres(data || []);
    setLoading(false);
  };

  const saveCierre = async () => {
    setSaving(true);
    const data = {
      propiedad: form.propiedad,
      fecha_cierre: form.fecha_cierre || null,
      operacion: form.operacion,
      precio: parseFloat(form.precio) || 0,
      comision: parseFloat(form.comision) || 0,
      cobrado: parseFloat(form.cobrado) || 0,
      pendiente: parseFloat(form.pendiente) || 0,
      vendedor: form.vendedor,
      com_vendedor: parseFloat(form.com_vendedor) || 0,
      pag_vendedor: parseFloat(form.pag_vendedor) || 0,
      pend_vend: parseFloat(form.pend_vend) || 0,
      comision_inmobiliaria: parseFloat(form.comision_inmobiliaria) || 0,
      notas: form.notas,
      anio: parseInt(form.anio),
      mes: parseInt(form.mes),
      mes_nombre: MESES[parseInt(form.mes)],
      updated_at: new Date().toISOString(),
    };

    let error;
    if (editando) {
      ({ error } = await supabase.from("cierres").update(data).eq("id", editando));
    } else {
      ({ error } = await supabase.from("cierres").insert([data]));
    }

    setSaving(false);
    if (error) { showToast("Error: " + error.message, false); return; }
    showToast(editando ? "Cierre actualizado" : "Cierre registrado");
    setShowModal(false);
    setEditando(null);
    setForm(emptyForm);
    loadCierres();
  };

  const deleteCierre = async (id, nombre) => {
    if (!confirm(`¿Eliminar cierre de "${nombre}"?`)) return;
    await supabase.from("cierres").delete().eq("id", id);
    showToast("Eliminado");
    loadCierres();
  };

  const openEdit = (c) => {
    setEditando(c.id);
    setForm({
      propiedad: c.propiedad || "",
      fecha_cierre: c.fecha_cierre || "",
      operacion: c.operacion || "RENTA",
      precio: c.precio || "",
      comision: c.comision || "",
      cobrado: c.cobrado || "",
      pendiente: c.pendiente || "",
      vendedor: c.vendedor || "Carlos",
      com_vendedor: c.com_vendedor || "",
      pag_vendedor: c.pag_vendedor || "",
      pend_vend: c.pend_vend || "",
      comision_inmobiliaria: c.comision_inmobiliaria || "",
      notas: c.notas || "",
      anio: c.anio || new Date().getFullYear(),
      mes: c.mes || new Date().getMonth() + 1,
      mes_nombre: c.mes_nombre || "",
    });
    setShowModal(true);
  };

  // Calculos automaticos
  const handleComisionChange = (v) => {
    set("comision", v);
    const com = parseFloat(v) || 0;
    const cob = parseFloat(form.cobrado) || 0;
    set("comision_inmobiliaria", (com - (parseFloat(form.com_vendedor) || 0)).toFixed(2));
    set("pendiente", Math.max(0, com - cob).toFixed(2));
  };

  const handleCobradoChange = (v) => {
    set("cobrado", v);
    const cob = parseFloat(v) || 0;
    const com = parseFloat(form.comision) || 0;
    set("pendiente", Math.max(0, com - cob).toFixed(2));
  };

  const handleComVendedorChange = (v) => {
    set("com_vendedor", v);
    const comVend = parseFloat(v) || 0;
    const com = parseFloat(form.comision) || 0;
    set("comision_inmobiliaria", Math.max(0, com - comVend).toFixed(2));
  };

  const handleFechaChange = (v) => {
    set("fecha_cierre", v);
    if (v) {
      const d = new Date(v + "T12:00:00");
      set("anio", d.getFullYear());
      set("mes", d.getMonth() + 1);
      set("mes_nombre", MESES[d.getMonth() + 1]);
    }
  };

  // Filtrado
  const cieresFiltrados = cierres.filter(c => {
    if (filtroAnio && c.anio !== filtroAnio) return false;
    if (filtroMes && c.mes !== filtroMes) return false;
    if (filtroOp && c.operacion !== filtroOp) return false;
    if (filtroVendedor !== "Todos" && (c.vendedor || "").toLowerCase() !== filtroVendedor.toLowerCase()) return false;
    if (busqueda && !(c.propiedad || "").toLowerCase().includes(busqueda.toLowerCase())) return false;
    return true;
  });

  // Totales del filtro actual
  const totalComision = cieresFiltrados.reduce((a, c) => a + (c.comision || 0), 0);
  const totalCobrado = cieresFiltrados.reduce((a, c) => a + (c.cobrado || 0), 0);
  const totalPendiente = cieresFiltrados.reduce((a, c) => a + (c.pendiente || 0), 0);
  const totalComInmob = cieresFiltrados.reduce((a, c) => a + (c.comision_inmobiliaria || 0), 0);
  const totalPrecio = cieresFiltrados.reduce((a, c) => a + (c.precio || 0), 0);
  const totalVentas = cieresFiltrados.filter(c => c.operacion === "VENTA").length;
  const totalRentas = cieresFiltrados.filter(c => c.operacion === "RENTA").length;

  // Años disponibles
  const aniosDisponibles = [...new Set(cierres.map(c => c.anio))].sort((a, b) => b - a);

  // Resumen por vendedor
  const porVendedor = {};
  cieresFiltrados.forEach(c => {
    const v = c.vendedor || "Sin asignar";
    if (!porVendedor[v]) porVendedor[v] = { cierres: 0, comision: 0 };
    porVendedor[v].cierres++;
    porVendedor[v].comision += c.com_vendedor || 0;
  });
  const vendedoresRanking = Object.entries(porVendedor)
    .sort((a, b) => b[1].cierres - a[1].cierres)
    .slice(0, 8);

  if (!session) {
    return (
      <div style={{ minHeight: "100vh", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 40, textAlign: "center" }}>
          <p style={{ fontSize: 32, margin: "0 0 16px" }}>🔒</p>
          <p style={{ color: "#6b7280" }}>Acceso restringido</p>
          <a href="/" style={{ color: "#C8102E", fontWeight: 700 }}>← Ir al panel</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "system-ui, sans-serif" }}>
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background: "#1a1a2e", padding: "16px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, color: "#C8102E", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Emporio Inmobiliario</p>
          <h1 style={{ margin: "2px 0 0", fontSize: 20, fontWeight: 800, color: "#fff" }}>📊 Cierres de Ventas y Rentas</h1>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a href="/" style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>← Panel</a>
          <button onClick={() => { setEditando(null); setForm(emptyForm); setShowModal(true); }} style={{ background: "#C8102E", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
            + Nuevo cierre
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 20px" }}>

        {/* Filtros */}
        <div style={{ background: "#fff", borderRadius: 14, padding: "16px 20px", marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <select value={filtroAnio} onChange={e => setFiltroAnio(parseInt(e.target.value))} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff", fontWeight: 700 }}>
            {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filtroMes} onChange={e => setFiltroMes(parseInt(e.target.value))} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff" }}>
            <option value={0}>Todos los meses</option>
            {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select value={filtroOp} onChange={e => setFiltroOp(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff" }}>
            <option value="">Renta + Venta</option>
            <option value="RENTA">Solo Renta</option>
            <option value="VENTA">Solo Venta</option>
          </select>
          <select value={filtroVendedor} onChange={e => setFiltroVendedor(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff" }}>
            {VENDEDORES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <input placeholder="Buscar propiedad..." value={busqueda} onChange={e => setBusqueda(e.target.value)} style={{ flex: 1, minWidth: 180, padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14 }} />
          {(filtroMes || filtroOp || filtroVendedor !== "Todos" || busqueda) && (
            <button onClick={() => { setFiltroMes(0); setFiltroOp(""); setFiltroVendedor("Todos"); setBusqueda(""); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#6b7280" }}>Limpiar</button>
          )}
          <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>{cieresFiltrados.length} registros</span>
        </div>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
          {[
            { label: "Comisión total", value: fmt(totalComision), color: "#1a1a2e" },
            { label: "Cobrado", value: fmt(totalCobrado), color: "#065f46" },
            { label: "Pendiente", value: fmt(totalPendiente), color: "#92400e" },
            { label: "Comisión Emporio", value: fmt(totalComInmob), color: "#7c3aed" },
            { label: "Volumen operado", value: fmt(totalPrecio), color: "#1e40af" },
            { label: "Rentas cerradas", value: totalRentas, color: "#065f46" },
            { label: "Ventas cerradas", value: totalVentas, color: "#C8102E" },
          ].map((s, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 14, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              <p style={{ margin: "0 0 4px", fontSize: 10, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 20 }}>

          {/* Tabla */}
          <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            {loading ? (
              <div style={{ padding: 48, textAlign: "center", color: "#6b7280" }}>Cargando...</div>
            ) : cieresFiltrados.length === 0 ? (
              <div style={{ padding: 48, textAlign: "center", color: "#6b7280" }}>No hay registros</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {["Fecha", "Propiedad", "Tipo", "Precio", "Comisión", "Cobrado", "Pendiente", "Vendedor", "Com. Vendedor", "Com. Emporio", ""].map(h => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cieresFiltrados.map(c => (
                      <tr key={c.id} style={{ borderTop: "1px solid #f3f4f6", background: c.pendiente > 0 ? "#fffdf5" : "#fff" }}>
                        <td style={{ padding: "10px 14px", fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>{c.fecha_cierre || "-"}</td>
                        <td style={{ padding: "10px 14px", fontWeight: 600, fontSize: 13 }}>{c.propiedad}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ background: c.operacion === "VENTA" ? "#fff0f2" : "#f0fdf4", color: c.operacion === "VENTA" ? "#C8102E" : "#065f46", padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                            {c.operacion}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", fontSize: 13, color: "#374151" }}>{fmt(c.precio)}</td>
                        <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13 }}>{fmt(c.comision)}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13, color: "#065f46", fontWeight: 600 }}>{fmt(c.cobrado)}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13, color: c.pendiente > 0 ? "#92400e" : "#9ca3af", fontWeight: c.pendiente > 0 ? 700 : 400 }}>{fmt(c.pendiente)}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13, color: "#374151" }}>{c.vendedor || "-"}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13, color: "#7c3aed" }}>{fmt(c.com_vendedor)}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>{fmt(c.comision_inmobiliaria)}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button onClick={() => openEdit(c)} style={{ background: "#f3f4f6", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#374151" }}>Editar</button>
                            <button onClick={() => deleteCierre(c.id, c.propiedad)} style={{ background: "#fee2e2", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#991b1b" }}>X</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#f9fafb", borderTop: "2px solid #e5e7eb" }}>
                      <td colSpan={3} style={{ padding: "10px 14px", fontWeight: 800, fontSize: 12 }}>TOTALES</td>
                      <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13 }}>{fmt(totalPrecio)}</td>
                      <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13 }}>{fmt(totalComision)}</td>
                      <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13, color: "#065f46" }}>{fmt(totalCobrado)}</td>
                      <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13, color: "#92400e" }}>{fmt(totalPendiente)}</td>
                      <td colSpan={2} style={{ padding: "10px 14px" }}></td>
                      <td style={{ padding: "10px 14px", fontWeight: 800, fontSize: 13, color: "#1a1a2e" }}>{fmt(totalComInmob)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Sidebar ranking vendedores */}
          <div>
            <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", marginBottom: 16 }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>Ranking Vendedores</h3>
              {vendedoresRanking.map(([vendedor, data], i) => (
                <div key={vendedor} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 22, height: 22, borderRadius: "50%", background: i === 0 ? "#fef3c7" : i === 1 ? "#f3f4f6" : i === 2 ? "#fce7f3" : "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: i === 0 ? "#92400e" : "#6b7280" }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{vendedor}</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>{data.cierres} cierres</p>
                    <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{fmt(data.comision)}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Resumen por mes si filtro es anual */}
            {!filtroMes && (
              <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>Por mes — {filtroAnio}</h3>
                {MESES.slice(1).map((mes, i) => {
                  const mesNum = i + 1;
                  const cierresMes = cieresFiltrados.filter(c => c.mes === mesNum);
                  if (cierresMes.length === 0) return null;
                  const totalMes = cierresMes.reduce((a, c) => a + (c.comision_inmobiliaria || 0), 0);
                  return (
                    <div key={mes} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f3f4f6" }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{mes}</span>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#065f46" }}>{fmt(totalMes)}</span>
                        <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 6 }}>{cierresMes.length} cierres</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal nuevo/editar cierre */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 580, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{editando ? "Editar cierre" : "Nuevo cierre"}</h2>
              <button onClick={() => { setShowModal(false); setEditando(null); setForm(emptyForm); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>

            {/* Tipo */}
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              {["RENTA", "VENTA"].map(op => (
                <button key={op} onClick={() => set("operacion", op)} style={{
                  flex: 1, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14,
                  border: `2px solid ${form.operacion === op ? (op === "VENTA" ? "#C8102E" : "#065f46") : "#e5e7eb"}`,
                  background: form.operacion === op ? (op === "VENTA" ? "#fff0f2" : "#f0fdf4") : "#fafafa",
                  color: form.operacion === op ? (op === "VENTA" ? "#C8102E" : "#065f46") : "#9ca3af",
                }}>{op === "VENTA" ? "🏠 Venta" : "🔑 Renta"}</button>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Propiedad *</label>
                <input value={form.propiedad} onChange={e => set("propiedad", e.target.value)} placeholder="Nombre de la propiedad" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }} />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Fecha de cierre</label>
                <input type="date" value={form.fecha_cierre} onChange={e => handleFechaChange(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }} />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Vendedor</label>
                <select value={form.vendedor} onChange={e => set("vendedor", e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", background: "#fff" }}>
                  {VENDEDORES.filter(v => v !== "Todos").map(v => <option key={v} value={v}>{v}</option>)}
                  <option value="Otro">Otro</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Precio de operación</label>
                <input type="number" value={form.precio} onChange={e => set("precio", e.target.value)} placeholder="0" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }} />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Comisión total</label>
                <input type="number" value={form.comision} onChange={e => handleComisionChange(e.target.value)} placeholder="0" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }} />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Cobrado</label>
                <input type="number" value={form.cobrado} onChange={e => handleCobradoChange(e.target.value)} placeholder="0" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }} />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Pendiente</label>
                <input type="number" value={form.pendiente} onChange={e => set("pendiente", e.target.value)} placeholder="0" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", background: "#f9fafb" }} readOnly />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Com. vendedor</label>
                <input type="number" value={form.com_vendedor} onChange={e => handleComVendedorChange(e.target.value)} placeholder="0" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }} />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Pagado al vendedor</label>
                <input type="number" value={form.pag_vendedor} onChange={e => { set("pag_vendedor", e.target.value); set("pend_vend", Math.max(0, (parseFloat(form.com_vendedor) || 0) - (parseFloat(e.target.value) || 0)).toFixed(2)); }} placeholder="0" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }} />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Pend. vendedor</label>
                <input type="number" value={form.pend_vend} readOnly style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", background: "#f9fafb" }} />
              </div>

              <div style={{ gridColumn: "1 / -1", background: "#f0fdf4", borderRadius: 10, padding: "12px 16px" }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#065f46", marginBottom: 4, textTransform: "uppercase" }}>Comisión Emporio (automático)</label>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#065f46" }}>{fmt(parseFloat(form.comision_inmobiliaria) || 0)}</p>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Notas</label>
                <textarea value={form.notas} onChange={e => set("notas", e.target.value)} placeholder="Observaciones..." style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", minHeight: 60, resize: "vertical" }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
              <button onClick={() => { setShowModal(false); setEditando(null); setForm(emptyForm); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
              <button onClick={saveCierre} disabled={saving || !form.propiedad} style={{ background: "#C8102E", color: "#fff", border: "none", borderRadius: 10, padding: "11px 24px", cursor: saving ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
                {saving ? "Guardando..." : editando ? "Guardar cambios" : "Registrar cierre"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
