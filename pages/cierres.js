import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const VENDEDORES = ["Carlos", "Ivonne", "Rubi", "Miguel", "Ari", "Andrea",
  "Guillermo", "Rosario", "Angelica", "Fabiola", "Majo", "Oficina", "Direccion", "Otro"];

const META_GERENTE = 380000;
const PCT_ALTO = 0.05;
const PCT_BAJO = 0.03;
const PCT_VENDEDOR_DEFAULT = 20;

// Renovaciones: no aplica gerente y no cuentan para la meta mensual
const esRenovacion = (propiedad) => (propiedad || "").toLowerCase().startsWith("renov");

export default function Cierres() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cierres, setCierres] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [editando, setEditando] = useState(null);

  const [filtroAnio, setFiltroAnio] = useState(new Date().getFullYear());
  const [filtroMes, setFiltroMes] = useState(0);
  const [filtroOp, setFiltroOp] = useState("");
  const [filtroVendedor, setFiltroVendedor] = useState("Todos");
  const [busqueda, setBusqueda] = useState("");
  const [filtroPendiente, setFiltroPendiente] = useState(false);

  const emptyForm = {
    propiedad: "", fecha_cierre: new Date().toISOString().split("T")[0],
    operacion: "RENTA", precio: "", comision: "", cobrado: "", pendiente: "0",
    vendedor: "Carlos", pct_vendedor: PCT_VENDEDOR_DEFAULT.toString(),
    com_vendedor: "", pag_vendedor: "0", pend_vend: "0",
    comision_inmobiliaria: "0", monto_gerente: "0", gerente_pagado_monto: "0",
    notas: "", anio: new Date().getFullYear(),
    mes: new Date().getMonth() + 1,
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
    const { data } = await supabase.from("cierres").select("*").order("fecha_cierre", { ascending: false });
    setCierres(data || []);
    setLoading(false);
  };

  // Calcula % gerente excluyendo renovaciones
  const getPctGerente = (anio, mes, allCierres) => {
    const totalMes = allCierres
      .filter(c => c.anio === anio && c.mes === mes && !esRenovacion(c.propiedad))
      .reduce((a, c) => a + (c.comision_inmobiliaria || 0), 0);
    return totalMes >= META_GERENTE ? PCT_ALTO : PCT_BAJO;
  };

  // Monto gerente por cierre — 0 si es renovacion
  const getMontoGerente = (c, allCierres) => {
    if (esRenovacion(c.propiedad)) return 0;
    if (c.monto_gerente > 0) return c.monto_gerente;
    const pct = getPctGerente(c.anio, c.mes, allCierres);
    return (c.comision || 0) * pct;
  };

  const saveCierre = async () => {
    setSaving(true);
    const comision = parseFloat(form.comision) || 0;
    const cobrado = parseFloat(form.cobrado) || 0;
    const comVend = parseFloat(form.com_vendedor) || 0;
    const pagVend = parseFloat(form.pag_vendedor) || 0;
    const comInmob = Math.max(0, comision - comVend);
    const pendiente = Math.max(0, comision - cobrado);
    const pendVend = Math.max(0, comVend - pagVend);
    const montoGer = esRenovacion(form.propiedad) ? 0 : (parseFloat(form.monto_gerente) || 0);
    const gerPagado = parseFloat(form.gerente_pagado_monto) || 0;

    const data = {
      propiedad: form.propiedad, fecha_cierre: form.fecha_cierre || null,
      operacion: form.operacion, precio: parseFloat(form.precio) || 0,
      comision, cobrado, pendiente, vendedor: form.vendedor,
      com_vendedor: comVend, pag_vendedor: pagVend, pend_vend: pendVend,
      comision_inmobiliaria: comInmob, monto_gerente: montoGer,
      gerente_pagado_monto: gerPagado,
      cobrado_bool: cobrado >= comision && comision > 0,
      vendedor_pagado: pagVend >= comVend && comVend > 0,
      gerente_pagado: gerPagado >= montoGer && montoGer > 0,
      notas: form.notas, anio: parseInt(form.anio),
      mes: parseInt(form.mes), mes_nombre: MESES[parseInt(form.mes)],
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
    setShowModal(false); setEditando(null); setForm(emptyForm); loadCierres();
  };

  const deleteCierre = async (id, nombre) => {
    if (!confirm(`Eliminar cierre de "${nombre}"?`)) return;
    await supabase.from("cierres").delete().eq("id", id);
    showToast("Eliminado"); loadCierres();
  };

  const calcGerenteParaForm = (comInmob, propiedad, anio, mes) => {
    if (esRenovacion(propiedad)) return "0";
    const pct = getPctGerente(anio, mes, cierres);
    return ((parseFloat(form.comision) || 0) * pct).toFixed(2);
  };

  const openEdit = (c) => {
    const montoGer = getMontoGerente(c, cierres);
    const comVend = c.com_vendedor || 0;
    const comision = c.comision || 0;
    const pctVend = comision > 0 && comVend > 0 ? ((comVend / comision) * 100).toFixed(0) : PCT_VENDEDOR_DEFAULT.toString();
    setEditando(c.id);
    setForm({
      propiedad: c.propiedad || "", fecha_cierre: c.fecha_cierre || "",
      operacion: c.operacion || "RENTA", precio: c.precio || "",
      comision: c.comision || "", cobrado: c.cobrado || "",
      pendiente: c.pendiente || "0", vendedor: c.vendedor || "Carlos",
      pct_vendedor: pctVend,
      com_vendedor: c.com_vendedor || "", pag_vendedor: c.pag_vendedor || "0",
      pend_vend: c.pend_vend || "0", comision_inmobiliaria: c.comision_inmobiliaria || "0",
      monto_gerente: esRenovacion(c.propiedad) ? "0" : ((c.comision || 0) * getPctGerente(c.anio, c.mes, cierres)).toFixed(2),
      gerente_pagado_monto: c.gerente_pagado_monto || "0",
      notas: c.notas || "", anio: c.anio || new Date().getFullYear(),
      mes: c.mes || new Date().getMonth() + 1, mes_nombre: c.mes_nombre || "",
    });
    setShowModal(true);
  };

  const handleFechaChange = (v) => {
    set("fecha_cierre", v);
    if (v) {
      const d = new Date(v + "T12:00:00");
      const anio = d.getFullYear();
      const mes = d.getMonth() + 1;
      set("anio", anio); set("mes", mes); set("mes_nombre", MESES[mes]);
      // Recalcular gerente con nuevo mes
      const comInmob = parseFloat(form.comision_inmobiliaria) || 0;
      set("monto_gerente", calcGerenteParaForm(comInmob, form.propiedad, anio, mes));
    }
  };

  const handlePropiedadChange = (v) => {
    const comInmob = parseFloat(form.comision_inmobiliaria) || 0;
    const comVend = esRenovacion(v) ? form.com_vendedor : ((parseFloat(form.comision) || 0) * (parseFloat(form.pct_vendedor) || PCT_VENDEDOR_DEFAULT) / 100).toFixed(2);
    const newComInmob = Math.max(0, (parseFloat(form.comision) || 0) - (parseFloat(comVend) || 0));
    setForm(f => ({
      ...f,
      propiedad: v,
      monto_gerente: calcGerenteParaForm(newComInmob, v, f.anio, f.mes),
    }));
  };

  const handleComisionChange = (v) => {
    const com = parseFloat(v) || 0;
    const pct = parseFloat(form.pct_vendedor) || PCT_VENDEDOR_DEFAULT;
    const comVend = esRenovacion(form.propiedad) ? (parseFloat(form.com_vendedor) || 0) : com * pct / 100;
    const cobrado = parseFloat(form.cobrado) || 0;
    const comInmob = Math.max(0, com - comVend);
    setForm(f => ({
      ...f, comision: v,
      com_vendedor: esRenovacion(form.propiedad) ? f.com_vendedor : comVend.toFixed(2),
      comision_inmobiliaria: comInmob.toFixed(2),
      pendiente: Math.max(0, com - cobrado).toFixed(2),
      pend_vend: Math.max(0, comVend - (parseFloat(f.pag_vendedor) || 0)).toFixed(2),
      monto_gerente: calcGerenteParaForm(comInmob, f.propiedad, f.anio, f.mes),
    }));
  };

  const handlePctVendedorChange = (v) => {
    const pct = parseFloat(v) || 0;
    const com = parseFloat(form.comision) || 0;
    const comVend = com * pct / 100;
    const comInmob = Math.max(0, com - comVend);
    setForm(f => ({
      ...f, pct_vendedor: v,
      com_vendedor: comVend.toFixed(2),
      comision_inmobiliaria: comInmob.toFixed(2),
      pend_vend: Math.max(0, comVend - (parseFloat(f.pag_vendedor) || 0)).toFixed(2),
      monto_gerente: calcGerenteParaForm(comInmob, f.propiedad, f.anio, f.mes),
    }));
  };

  const handleComVendedorChange = (v) => {
    const comVend = parseFloat(v) || 0;
    const com = parseFloat(form.comision) || 0;
    const pagVend = parseFloat(form.pag_vendedor) || 0;
    const comInmob = Math.max(0, com - comVend);
    setForm(f => ({
      ...f, com_vendedor: v,
      comision_inmobiliaria: comInmob.toFixed(2),
      pend_vend: Math.max(0, comVend - pagVend).toFixed(2),
      monto_gerente: calcGerenteParaForm(comInmob, f.propiedad, f.anio, f.mes),
    }));
  };

  const handleCobradoChange = (v) => {
    const cob = parseFloat(v) || 0;
    const com = parseFloat(form.comision) || 0;
    setForm(f => ({ ...f, cobrado: v, pendiente: Math.max(0, com - cob).toFixed(2) }));
  };

  const handlePagVendedorChange = (v) => {
    const pagVend = parseFloat(v) || 0;
    const comVend = parseFloat(form.com_vendedor) || 0;
    setForm(f => ({ ...f, pag_vendedor: v, pend_vend: Math.max(0, comVend - pagVend).toFixed(2) }));
  };

  // Filtrado
  const cieresFiltrados = cierres.filter(c => {
    if (filtroAnio && c.anio !== filtroAnio) return false;
    if (filtroMes && c.mes !== filtroMes) return false;
    if (filtroOp && c.operacion !== filtroOp) return false;
    if (filtroVendedor !== "Todos" && (c.vendedor || "").toLowerCase() !== filtroVendedor.toLowerCase()) return false;
    if (busqueda && !(c.propiedad || "").toLowerCase().includes(busqueda.toLowerCase())) return false;
    if (filtroPendiente && c.pendiente <= 0) return false;
    return true;
  });

  // Totales
  const totalComision = cieresFiltrados.reduce((a, c) => a + (c.comision || 0), 0);
  const totalCobrado = cieresFiltrados.reduce((a, c) => a + (c.cobrado || 0), 0);
  const totalPendiente = cieresFiltrados.reduce((a, c) => a + (c.pendiente || 0), 0);
  const totalComInmob = cieresFiltrados.reduce((a, c) => a + (c.comision_inmobiliaria || 0), 0);
  const totalPrecio = cieresFiltrados.reduce((a, c) => a + (c.precio || 0), 0);
  const totalVentas = cieresFiltrados.filter(c => c.operacion === "VENTA").length;
  const totalRentas = cieresFiltrados.filter(c => c.operacion === "RENTA").length;
  const totalComVend = cieresFiltrados.reduce((a, c) => a + (c.com_vendedor || 0), 0);
  const totalPagVend = cieresFiltrados.reduce((a, c) => a + (c.pag_vendedor || 0), 0);
  const totalPendVend = cieresFiltrados.reduce((a, c) => a + (c.pend_vend || 0), 0);
  const totalMontoGerente = cieresFiltrados.reduce((a, c) => a + getMontoGerente(c, cierres), 0);
  const totalGerentePagado = cieresFiltrados.reduce((a, c) => a + (c.gerente_pagado_monto || 0), 0);
  const totalGerentePendiente = totalMontoGerente - totalGerentePagado;
  const totalEmporio = totalComInmob - totalMontoGerente;

  const aniosDisponibles = [...new Set(cierres.map(c => c.anio))].sort((a, b) => b - a);

  // Info mes para gerente — excluye renovaciones
  const getMesInfo = (anio, mes) => {
    const total = cierres
      .filter(c => c.anio === anio && c.mes === mes && !esRenovacion(c.propiedad))
      .reduce((a, c) => a + (c.comision_inmobiliaria || 0), 0);
    return { total, pct: total >= META_GERENTE ? PCT_ALTO : PCT_BAJO, alcanzaMeta: total >= META_GERENTE };
  };
  const mesInfo = filtroMes ? getMesInfo(filtroAnio, filtroMes) : null;

  const porVendedor = {};
  cieresFiltrados.forEach(c => {
    const v = c.vendedor || "Sin asignar";
    if (!porVendedor[v]) porVendedor[v] = { cierres: 0, comision: 0, pendiente: 0 };
    porVendedor[v].cierres++;
    porVendedor[v].comision += c.com_vendedor || 0;
    porVendedor[v].pendiente += c.pend_vend || 0;
  });
  const vendedoresRanking = Object.entries(porVendedor).sort((a, b) => b[1].cierres - a[1].cierres).slice(0, 8);

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

  const comInmobForm = parseFloat(form.comision_inmobiliaria) || 0;
  const montoGerenteForm = parseFloat(form.monto_gerente) || 0;
  const gerentePagadoForm = parseFloat(form.gerente_pagado_monto) || 0;
  const emporioPuroForm = comInmobForm - montoGerenteForm;
  const esRenov = esRenovacion(form.propiedad);

  const inp = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" };
  const inpGreen = { ...inp, border: "1.5px solid #86efac" };
  const inpRO = { ...inp, background: "#f9fafb" };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "system-ui, sans-serif" }}>
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000 }}>{toast.msg}</div>}

      {/* Header */}
      <div style={{ background: "#1a1a2e", padding: "16px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, color: "#C8102E", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Emporio Inmobiliario</p>
          <h1 style={{ margin: "2px 0 0", fontSize: 20, fontWeight: 800, color: "#fff" }}>📊 Cierres de Ventas y Rentas</h1>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a href="/" style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>← Panel</a>
          <button onClick={() => { setEditando(null); setForm(emptyForm); setShowModal(true); }} style={{ background: "#C8102E", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>+ Nuevo cierre</button>
        </div>
      </div>

      <div style={{ maxWidth: 1500, margin: "0 auto", padding: "20px" }}>

        {/* Filtros */}
        <div style={{ background: "#fff", borderRadius: 14, padding: "14px 18px", marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select value={filtroAnio} onChange={e => setFiltroAnio(parseInt(e.target.value))} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, fontWeight: 700 }}>
            {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filtroMes} onChange={e => setFiltroMes(parseInt(e.target.value))} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14 }}>
            <option value={0}>Todos los meses</option>
            {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select value={filtroOp} onChange={e => setFiltroOp(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14 }}>
            <option value="">Renta + Venta</option>
            <option value="RENTA">Solo Renta</option>
            <option value="VENTA">Solo Venta</option>
          </select>
          <select value={filtroVendedor} onChange={e => setFiltroVendedor(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14 }}>
            <option value="Todos">Todos los vendedores</option>
            {VENDEDORES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <input placeholder="Buscar propiedad..." value={busqueda} onChange={e => setBusqueda(e.target.value)} style={{ flex: 1, minWidth: 160, padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14 }} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#92400e", cursor: "pointer" }}>
            <input type="checkbox" checked={filtroPendiente} onChange={e => setFiltroPendiente(e.target.checked)} /> Solo pendientes
          </label>
          {(filtroMes || filtroOp || filtroVendedor !== "Todos" || busqueda || filtroPendiente) && (
            <button onClick={() => { setFiltroMes(0); setFiltroOp(""); setFiltroVendedor("Todos"); setBusqueda(""); setFiltroPendiente(false); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Limpiar</button>
          )}
          <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{cieresFiltrados.length} registros</span>
        </div>

        {/* Banner gerente del mes — excluye renovaciones */}
        {mesInfo && (
          <div style={{ background: mesInfo.alcanzaMeta ? "#f0fdf4" : "#fffbeb", border: `1px solid ${mesInfo.alcanzaMeta ? "#86efac" : "#fcd34d"}`, borderRadius: 12, padding: "12px 18px", marginBottom: 14, display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: mesInfo.alcanzaMeta ? "#065f46" : "#92400e", textTransform: "uppercase" }}>
                Gerente (Guillermo) — {MESES[filtroMes]} {filtroAnio}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800, color: mesInfo.alcanzaMeta ? "#065f46" : "#92400e" }}>
                {mesInfo.pct * 100}% {mesInfo.alcanzaMeta ? "✅ Meta alcanzada" : `— Faltan ${fmt(META_GERENTE - mesInfo.total)} para el 5%`}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>Solo cierres nuevos (sin renovaciones)</p>
            </div>
            {[
              { label: "Com. inmob. mes (sin renov)", value: fmt(mesInfo.total) },
              { label: "Total gerente", value: fmt(totalMontoGerente), color: "#7c3aed" },
              { label: "Pagado gerente", value: fmt(totalGerentePagado), color: "#065f46" },
              { label: "Pendiente gerente", value: fmt(totalGerentePendiente), color: totalGerentePendiente > 0 ? "#dc2626" : "#9ca3af" },
            ].map(s => (
              <div key={s.label}>
                <p style={{ margin: 0, fontSize: 10, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: s.color || "#1a1a2e" }}>{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 14 }}>
          {[
            { label: "Comision total", value: fmt(totalComision), color: "#1a1a2e" },
            { label: "Cobrado", value: fmt(totalCobrado), color: "#065f46" },
            { label: "Pend. cobro", value: fmt(totalPendiente), color: totalPendiente > 0 ? "#dc2626" : "#9ca3af" },
            { label: "Com. inmobiliaria", value: fmt(totalComInmob), color: "#1e40af" },
            { label: "Com. vendedores", value: fmt(totalComVend), color: "#7c3aed" },
            { label: "Pend. vendedores", value: fmt(totalPendVend), color: totalPendVend > 0 ? "#dc2626" : "#9ca3af" },
            { label: "Gerente total", value: fmt(totalMontoGerente), color: "#0369a1" },
            { label: "Pend. gerente", value: fmt(totalGerentePendiente), color: totalGerentePendiente > 0 ? "#dc2626" : "#9ca3af" },
            { label: "Emporio neto", value: fmt(totalEmporio), color: "#065f46", highlight: true },
            { label: "Rentas", value: totalRentas, color: "#065f46" },
            { label: "Ventas", value: totalVentas, color: "#C8102E" },
            { label: "Volumen", value: fmt(totalPrecio), color: "#374151" },
          ].map((s, i) => (
            <div key={i} style={{ background: s.highlight ? "#f0fdf4" : "#fff", borderRadius: 12, padding: "12px 14px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", border: s.highlight ? "1px solid #86efac" : "none" }}>
              <p style={{ margin: "0 0 4px", fontSize: 10, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 800, color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 250px", gap: 16 }}>

          {/* Tabla */}
          <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            {loading ? (
              <div style={{ padding: 48, textAlign: "center", color: "#6b7280" }}>Cargando...</div>
            ) : cieresFiltrados.length === 0 ? (
              <div style={{ padding: 48, textAlign: "center", color: "#6b7280" }}>No hay registros</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {["Fecha", "Propiedad", "Tipo", "Comision", "Cobrado", "Pend.cobro", "Vendedor", "Com.Vend", "Pag.Vend", "Pend.Vend", "Gerente", "Pag.Ger", "Emporio neto", ""].map(h => (
                        <th key={h} style={{ padding: "10px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cieresFiltrados.map(c => {
                      const montoGer = getMontoGerente(c, cierres);
                      const gerPagado = c.gerente_pagado_monto || 0;
                      const gerPend = Math.max(0, montoGer - gerPagado);
                      const empNeto = (c.comision_inmobiliaria || 0) - montoGer;
                      const hayPend = c.pendiente > 0 || c.pend_vend > 0 || gerPend > 0;
                      const esRenov = esRenovacion(c.propiedad);
                      return (
                        <tr key={c.id} style={{ borderTop: "1px solid #f3f4f6", background: hayPend ? "#fffdf5" : "#fff" }}>
                          <td style={{ padding: "9px 10px", fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>{c.fecha_cierre || "-"}</td>
                          <td style={{ padding: "9px 10px", fontWeight: 600, fontSize: 12, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.propiedad}
                            {esRenov && <span style={{ display: "block", fontSize: 9, color: "#9ca3af", fontWeight: 400 }}>renovacion</span>}
                          </td>
                          <td style={{ padding: "9px 10px" }}>
                            <span style={{ background: c.operacion === "VENTA" ? "#fff0f2" : "#f0fdf4", color: c.operacion === "VENTA" ? "#C8102E" : "#065f46", padding: "2px 6px", borderRadius: 99, fontSize: 10, fontWeight: 700 }}>{c.operacion}</span>
                          </td>
                          <td style={{ padding: "9px 10px", fontWeight: 700, fontSize: 12 }}>{fmt(c.comision)}</td>
                          <td style={{ padding: "9px 10px", fontSize: 12, color: "#065f46" }}>{fmt(c.cobrado)}</td>
                          <td style={{ padding: "9px 10px", fontSize: 12, color: c.pendiente > 0 ? "#dc2626" : "#9ca3af", fontWeight: c.pendiente > 0 ? 700 : 400 }}>{fmt(c.pendiente)}</td>
                          <td style={{ padding: "9px 10px", fontSize: 11 }}>{c.vendedor || "-"}</td>
                          <td style={{ padding: "9px 10px", fontSize: 12, color: "#7c3aed" }}>{fmt(c.com_vendedor)}</td>
                          <td style={{ padding: "9px 10px", fontSize: 12, color: "#065f46" }}>{fmt(c.pag_vendedor)}</td>
                          <td style={{ padding: "9px 10px", fontSize: 12, color: c.pend_vend > 0 ? "#dc2626" : "#9ca3af", fontWeight: c.pend_vend > 0 ? 700 : 400 }}>{fmt(c.pend_vend)}</td>
                          <td style={{ padding: "9px 10px", fontSize: 12, color: esRenov ? "#9ca3af" : "#0369a1" }}>{esRenov ? "—" : fmt(montoGer)}</td>
                          <td style={{ padding: "9px 10px", fontSize: 12 }}>
                            {esRenov ? <span style={{ color: "#9ca3af" }}>—</span> : (
                              <>
                                <span style={{ color: gerPend > 0 ? "#dc2626" : "#065f46", fontWeight: 600 }}>{fmt(gerPagado)}</span>
                                {gerPend > 0 && <span style={{ fontSize: 9, color: "#dc2626", display: "block" }}>Pend: {fmt(gerPend)}</span>}
                              </>
                            )}
                          </td>
                          <td style={{ padding: "9px 10px", fontSize: 12, fontWeight: 800, color: "#065f46" }}>{fmt(empNeto)}</td>
                          <td style={{ padding: "9px 10px" }}>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button onClick={() => openEdit(c)} style={{ background: "#f3f4f6", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>Editar</button>
                              <button onClick={() => deleteCierre(c.id, c.propiedad)} style={{ background: "#fee2e2", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#991b1b" }}>X</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#f9fafb", borderTop: "2px solid #e5e7eb" }}>
                      <td colSpan={3} style={{ padding: "10px", fontWeight: 800, fontSize: 11 }}>TOTALES</td>
                      <td style={{ padding: "10px", fontWeight: 700, fontSize: 12 }}>{fmt(totalComision)}</td>
                      <td style={{ padding: "10px", fontWeight: 700, fontSize: 12, color: "#065f46" }}>{fmt(totalCobrado)}</td>
                      <td style={{ padding: "10px", fontWeight: 700, fontSize: 12, color: "#dc2626" }}>{fmt(totalPendiente)}</td>
                      <td style={{ padding: "10px" }}></td>
                      <td style={{ padding: "10px", fontWeight: 700, fontSize: 12, color: "#7c3aed" }}>{fmt(totalComVend)}</td>
                      <td style={{ padding: "10px", fontWeight: 700, fontSize: 12, color: "#065f46" }}>{fmt(totalPagVend)}</td>
                      <td style={{ padding: "10px", fontWeight: 700, fontSize: 12, color: "#dc2626" }}>{fmt(totalPendVend)}</td>
                      <td style={{ padding: "10px", fontWeight: 700, fontSize: 12, color: "#0369a1" }}>{fmt(totalMontoGerente)}</td>
                      <td style={{ padding: "10px", fontWeight: 700, fontSize: 12, color: "#065f46" }}>{fmt(totalGerentePagado)}</td>
                      <td style={{ padding: "10px", fontWeight: 800, fontSize: 13, color: "#065f46" }}>{fmt(totalEmporio)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div>
            <div style={{ background: "#fff", borderRadius: 14, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", marginBottom: 12 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700 }}>Ranking Vendedores</h3>
              {vendedoresRanking.map(([vendedor, data], i) => (
                <div key={vendedor} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 20, height: 20, borderRadius: "50%", background: i === 0 ? "#fef3c7" : "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: i === 0 ? "#92400e" : "#6b7280" }}>{i + 1}</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{vendedor}</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 700 }}>{data.cierres} cierres</p>
                    {data.pendiente > 0 && <p style={{ margin: 0, fontSize: 10, color: "#dc2626" }}>Pend: {fmt(data.pendiente)}</p>}
                  </div>
                </div>
              ))}
            </div>

            {!filtroMes && (
              <div style={{ background: "#fff", borderRadius: 14, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700 }}>Por mes — {filtroAnio}</h3>
                {MESES.slice(1).map((mes, i) => {
                  const mesNum = i + 1;
                  const cm = cieresFiltrados.filter(c => c.mes === mesNum);
                  if (cm.length === 0) return null;
                  const totalMes = cm.reduce((a, c) => a + (c.comision_inmobiliaria || 0), 0);
                  const totalMesSinRenov = cm.filter(c => !esRenovacion(c.propiedad)).reduce((a, c) => a + (c.comision_inmobiliaria || 0), 0);
                  const pct = totalMesSinRenov >= META_GERENTE ? PCT_ALTO : PCT_BAJO;
                  return (
                    <div key={mes} style={{ padding: "6px 0", borderBottom: "1px solid #f3f4f6" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{mes}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#065f46" }}>{fmt(totalMes)}</span>
                      </div>
                      <div style={{ fontSize: 10, color: totalMesSinRenov >= META_GERENTE ? "#065f46" : "#92400e", fontWeight: 600 }}>
                        Ger {pct * 100}% = {fmt(totalMesSinRenov * pct)} · {cm.length} cierres
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 640, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{editando ? "Editar cierre" : "Nuevo cierre"}</h2>
              <button onClick={() => { setShowModal(false); setEditando(null); setForm(emptyForm); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>

            {/* Tipo */}
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              {["RENTA", "VENTA"].map(op => (
                <button key={op} onClick={() => set("operacion", op)} style={{
                  flex: 1, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14,
                  border: `2px solid ${form.operacion === op ? (op === "VENTA" ? "#C8102E" : "#065f46") : "#e5e7eb"}`,
                  background: form.operacion === op ? (op === "VENTA" ? "#fff0f2" : "#f0fdf4") : "#fafafa",
                  color: form.operacion === op ? (op === "VENTA" ? "#C8102E" : "#065f46") : "#9ca3af",
                }}>{op === "VENTA" ? "🏠 Venta" : "🔑 Renta"}</button>
              ))}
            </div>

            {/* Info basica */}
            <div style={{ background: "#f9fafb", borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 800, color: "#6b7280", textTransform: "uppercase" }}>Informacion del cierre</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 3, textTransform: "uppercase" }}>Propiedad *</label>
                  <input value={form.propiedad} onChange={e => handlePropiedadChange(e.target.value)} placeholder="Nombre de la propiedad (Renov... para renovacion)" style={inp} />
                  {esRenov && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#0369a1", fontWeight: 600 }}>Renovacion — gerente no aplica</p>}
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 3, textTransform: "uppercase" }}>Fecha de cierre</label>
                  <input type="date" value={form.fecha_cierre} onChange={e => handleFechaChange(e.target.value)} style={inp} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 3, textTransform: "uppercase" }}>Vendedor</label>
                  <select value={form.vendedor} onChange={e => set("vendedor", e.target.value)} style={{ ...inp, background: "#fff", cursor: "pointer" }}>
                    {VENDEDORES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 3, textTransform: "uppercase" }}>Precio operacion</label>
                  <input type="number" value={form.precio} onChange={e => set("precio", e.target.value)} placeholder="0" style={inp} />
                </div>
              </div>
            </div>

            {/* Comision y cobros */}
            <div style={{ background: "#f9fafb", borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 800, color: "#6b7280", textTransform: "uppercase" }}>Comision y cobros</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 3, textTransform: "uppercase" }}>Comision total</label>
                  <input type="number" value={form.comision} onChange={e => handleComisionChange(e.target.value)} placeholder="0" style={inp} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#065f46", marginBottom: 3, textTransform: "uppercase" }}>Ya cobrado</label>
                  <input type="number" value={form.cobrado} onChange={e => handleCobradoChange(e.target.value)} placeholder="0" style={inpGreen} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#92400e", marginBottom: 3, textTransform: "uppercase" }}>Pendiente</label>
                  <input type="number" value={form.pendiente} readOnly style={{ ...inpRO, color: parseFloat(form.pendiente) > 0 ? "#92400e" : "#9ca3af", fontWeight: 700 }} />
                </div>
              </div>
            </div>

            {/* Vendedor */}
            <div style={{ background: "#faf5ff", borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 800, color: "#7c3aed", textTransform: "uppercase" }}>
                Comision vendedor — {form.vendedor}
                {esRenov && <span style={{ marginLeft: 8, fontWeight: 400, color: "#9ca3af" }}>(administracion 10%)</span>}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                {!esRenov && (
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 3, textTransform: "uppercase" }}>% comision</label>
                    <input type="number" value={form.pct_vendedor} onChange={e => handlePctVendedorChange(e.target.value)} placeholder="20" style={inp} />
                  </div>
                )}
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 3, textTransform: "uppercase" }}>Monto</label>
                  <input type="number" value={form.com_vendedor} onChange={e => handleComVendedorChange(e.target.value)} placeholder="0" style={inp} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#065f46", marginBottom: 3, textTransform: "uppercase" }}>Ya pagado</label>
                  <input type="number" value={form.pag_vendedor} onChange={e => handlePagVendedorChange(e.target.value)} placeholder="0" style={inpGreen} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#92400e", marginBottom: 3, textTransform: "uppercase" }}>Pendiente</label>
                  <input type="number" value={form.pend_vend} readOnly style={{ ...inpRO, color: parseFloat(form.pend_vend) > 0 ? "#92400e" : "#9ca3af", fontWeight: 700 }} />
                </div>
              </div>
            </div>

            {/* Gerente — solo si NO es renovacion */}
            {!esRenov && (
              <div style={{ background: "#eff6ff", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 800, color: "#1e40af", textTransform: "uppercase" }}>Gerente — Guillermo</p>
                <p style={{ margin: "0 0 10px", fontSize: 11, color: "#6b7280" }}>
                  {getPctGerente(form.anio, form.mes, cierres) * 100}% segun meta del mes.
                  Com. inmob. de este cierre: <strong>{fmt(comInmobForm)}</strong>
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 3, textTransform: "uppercase" }}>Monto gerente</label>
                    <input type="number" value={form.monto_gerente} onChange={e => set("monto_gerente", e.target.value)} style={{ ...inp, border: "1px solid #bfdbfe" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#065f46", marginBottom: 3, textTransform: "uppercase" }}>Ya pagado</label>
                    <input type="number" value={form.gerente_pagado_monto} onChange={e => set("gerente_pagado_monto", e.target.value)} placeholder="0" style={inpGreen} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#92400e", marginBottom: 3, textTransform: "uppercase" }}>Pendiente</label>
                    <input type="number" value={Math.max(0, montoGerenteForm - gerentePagadoForm).toFixed(2)} readOnly style={{ ...inpRO, color: montoGerenteForm - gerentePagadoForm > 0 ? "#92400e" : "#9ca3af", fontWeight: 700 }} />
                  </div>
                </div>
              </div>
            )}

            {/* Resumen Emporio */}
            <div style={{ background: "#f0fdf4", borderRadius: 10, padding: 14, marginBottom: 14, border: "1px solid #86efac" }}>
              <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 800, color: "#065f46", textTransform: "uppercase" }}>Resumen Emporio</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {[
                  { label: "Com. inmobiliaria", value: fmt(comInmobForm), color: "#1a1a2e" },
                  { label: esRenov ? "Gerente (N/A)" : "- Gerente", value: esRenov ? "—" : fmt(montoGerenteForm), color: "#0369a1" },
                  { label: "= Emporio neto", value: fmt(emporioPuroForm), color: "#065f46", big: true },
                ].map(s => (
                  <div key={s.label}>
                    <p style={{ margin: 0, fontSize: 10, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
                    <p style={{ margin: 0, fontSize: s.big ? 20 : 15, fontWeight: 800, color: s.color }}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Notas */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Notas</label>
              <textarea value={form.notas} onChange={e => set("notas", e.target.value)} placeholder="Observaciones..." style={{ ...inp, minHeight: 55, resize: "vertical" }} />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
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
