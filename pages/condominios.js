import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";
import { PageHeader, brand } from "../components/Layout";
import DemoBadge from "../components/condominios/DemoBadge";
import { usePermiso, SinAcceso } from "../lib/permisos";
import { condominiosApi } from "../lib/condominiosApi";

const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n || 0);

const periodoActual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const periodoLabel = (p) => {
  if (!p) return "—";
  const [y, m] = p.split("-");
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
};

const CATEGORIAS = {
  agua:          { label: "Agua",          icon: "💧" },
  luz:           { label: "Luz",           icon: "⚡" },
  limpieza:      { label: "Limpieza",      icon: "🧹" },
  mantenimiento: { label: "Mantenimiento", icon: "🔧" },
  vigilancia:    { label: "Vigilancia",    icon: "👮" },
  jardineria:    { label: "Jardinería",    icon: "🌿" },
  otro:          { label: "Otro",          icon: "📦" },
};

const Modal = ({ title, onClose, children, wide }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: wide ? 640 : 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
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

const Btn = ({ children, onClick, color = "#1a1a2e", disabled, small, outline }) => (
  <button onClick={onClick} disabled={disabled} style={{
    background: outline ? "transparent" : color,
    color: outline ? color : "#fff",
    border: outline ? `2px solid ${color}` : "none",
    borderRadius: small ? 6 : 10,
    padding: small ? "5px 10px" : "11px 20px",
    fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
    fontSize: small ? 12 : 14, opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap"
  }}>
    {children}
  </button>
);

const StatusBadge = ({ status }) => {
  const map = {
    pagado:   { bg: "#d1fae5", color: "#065f46", label: "Pagado" },
    pendiente:{ bg: "#fef3c7", color: "#92400e", label: "Pendiente" },
    atrasado: { bg: "#fee2e2", color: "#991b1b", label: "Atrasado" },
  };
  const s = map[status] || { bg: "#f3f4f6", color: "#374151", label: status };
  return <span style={{ background: s.bg, color: s.color, padding: "2px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{s.label}</span>;
};

export default function Condominios() {
  const router = useRouter();
  const { cargando: permisoCargando, puedeVer, puedeEditar } = usePermiso("condominios");
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [condominios, setCondominios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);

  // Modales
  const [modalNuevo, setModalNuevo] = useState(false);
  const [modalImport, setModalImport] = useState(null); // condominio seleccionado
  const [importData, setImportData] = useState(null);
  const [importando, setImportando] = useState(false);
  const fileRef = useRef(null);

  const emptyForm = { nombre: "", direccion: "", total_unidades: "", cuota_mensual: "", honorarios_emporio: "", notas: "" };
  const [form, setForm] = useState(emptyForm);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

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

  const loadCondominios = async () => {
    setLoading(true);
    const { data: conds } = await supabase.from("condominios").select("*").eq("activo", true).order("created_at", { ascending: false });
    if (!conds || conds.length === 0) { setCondominios([]); setLoading(false); return; }

    const condIds = conds.map(c => c.id);
    const periodo = periodoActual();

    const [
      { data: unidades },
      { data: cuotas },
      { data: gastos },
    ] = await Promise.all([
      supabase.from("unidades_condominio").select("*").in("condominio_id", condIds).eq("activo", true),
      supabase.from("cuotas_condominio").select("*").in("condominio_id", condIds).eq("periodo", periodo),
      supabase.from("gastos_condominio").select("*").in("condominio_id", condIds),
    ]);

    const enriched = conds.map(c => {
      const us = (unidades || []).filter(u => u.condominio_id === c.id);
      const cs = (cuotas || []).filter(q => q.condominio_id === c.id);
      const gs = (gastos || []).filter(g => g.condominio_id === c.id);
      const cobrado = cs.filter(q => q.status === "pagado").reduce((a, q) => a + (q.monto || 0), 0);
      const pendiente = cs.filter(q => q.status !== "pagado").reduce((a, q) => a + (q.monto || 0), 0);
      const gastado = gs.reduce((a, g) => a + (g.monto || 0), 0);
      const fondo = cobrado - c.honorarios_emporio - gastado;
      const morosos = cs.filter(q => q.status === "atrasado").length;
      return { ...c, unidades: us, cuotasMes: cs, morosos, cobrado, pendiente, gastado, fondo };
    });

    setCondominios(enriched);
    setLoading(false);
  };

  useEffect(() => { if (session) loadCondominios(); }, [session]);

  // ── Crear condominio ──────────────────────────────────────────────────────
  const crearCondominio = async () => {
    if (!form.nombre.trim()) { showToast("El nombre es requerido", false); return; }
    setSaving(true);
    try {
      await condominiosApi("/api/condominios", { method: "POST", body: JSON.stringify(form) });
      setModalNuevo(false);
      setForm(emptyForm);
      showToast("Condominio creado. Agrega las unidades manualmente o mediante CSV.");
      await loadCondominios();
    } catch (error) {
      showToast(error.message, false);
    } finally {
      setSaving(false);
    }
  };

  // ── Importar CSV con vista previa validada ────────────────────────────────
  const handleFileImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast("El CSV debe pesar como máximo 2 MB", false); return; }
    setImportando(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const preview = await condominiosApi(`/api/condominios/${modalImport.id}/importacion`, {
          method: "POST",
          body: JSON.stringify({ action: "preview", csv: ev.target.result }),
        });
        setImportData(preview);
      } catch (error) {
        setImportData(null);
        showToast(error.message, false);
      } finally {
        setImportando(false);
      }
    };
    reader.onerror = () => { setImportando(false); showToast("No fue posible leer el CSV", false); };
    reader.readAsText(file);
  };

  const confirmarImport = async () => {
    if (!importData || !modalImport) return;
    setImportando(true);
    try {
      if (importData.errores?.length) throw new Error("Corrige los errores del CSV antes de confirmar");
      const result = await condominiosApi(`/api/condominios/${modalImport.id}/importacion`, {
        method: "POST",
        body: JSON.stringify({ action: "commit", batch_id: importData.id }),
      });
      if (result.resultado_csv) {
        const blob = new Blob([`\uFEFF${result.resultado_csv}`], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `resultado-importacion-${modalImport.id}.csv`;
        link.click();
        URL.revokeObjectURL(url);
      }
      setModalImport(null);
      setImportData(null);
      showToast(`${result.filas_aplicadas} unidades importadas sin borrar las existentes`);
      await loadCondominios();
    } catch (error) {
      showToast(error.message, false);
    } finally {
      setImportando(false);
    }
  };

  // ── Generar cuotas del mes ────────────────────────────────────────────────
  const generarCuotasMes = async (cond) => {
    const periodo = periodoActual();
    const hoy = new Date();
    const fechaVenc = new Date(hoy.getFullYear(), hoy.getMonth(), 10); // vence día 10
    try {
      const result = await condominiosApi(`/api/condominios/${cond.id}/operaciones`, {
        method: "POST",
        body: JSON.stringify({
          action: "generar_cuotas",
          periodo,
          monto: cond.cuota_mensual,
          fecha_vencimiento: fechaVenc.toISOString().split("T")[0],
        }),
      });
      showToast(`${result.creadas} cuotas generadas para ${periodoLabel(periodo)}`);
      await loadCondominios();
    } catch (error) {
      showToast(error.message, false);
    }
  };

  if (authLoading || permisoCargando) return (
    <div style={{ minHeight: "100vh", background: brand.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} />
    </div>
  );
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }
  if (!puedeVer) return <SinAcceso />;

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: 320 }}>
          {toast.msg}
        </div>
      )}

      <PageHeader
        title="Condominios"
        icon="🏢"
        actions={
          <>
            <DemoBadge />
            {puedeEditar ? <Btn color={brand.red} onClick={() => { setForm(emptyForm); setModalNuevo(true); }}>+ Nuevo condominio</Btn> : null}
          </>
        }
      />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {loading ? (
          <div style={{ textAlign: "center", padding: 48, color: "#9ca3af" }}>Cargando condominios…</div>
        ) : condominios.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: 16, padding: 56, textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <p style={{ fontSize: 40, margin: "0 0 12px" }}>🏢</p>
            <h3 style={{ margin: "0 0 8px", color: "#1a1a2e" }}>Sin condominios aún</h3>
            <p style={{ color: "#9ca3af", margin: "0 0 20px" }}>Registra tu primer condominio para empezar</p>
            {puedeEditar && <Btn color={brand.red} onClick={() => { setForm(emptyForm); setModalNuevo(true); }}>+ Nuevo condominio</Btn>}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {condominios.map(cond => (
              <div key={cond.id} style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                {/* Header de la tarjeta */}
                <div style={{ background: "#1a1a2e", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#fff" }}>{cond.nombre}</h3>
                    {cond.direccion && <p style={{ margin: "2px 0 0", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>📍 {cond.direccion}</p>}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {cond.morosos > 0 && (
                      <span style={{ background: "#fee2e2", color: "#991b1b", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99 }}>
                        ⚠️ {cond.morosos} moroso{cond.morosos !== 1 ? "s" : ""}
                      </span>
                    )}
                    <Btn small color="rgba(255,255,255,0.15)" onClick={() => router.push(`/condominio/${cond.id}`)}>Ver detalle →</Btn>
                  </div>
                </div>

                {/* KPIs */}
                <div style={{ padding: "16px 20px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 16 }}>
                    {[
                      { label: "Unidades",        value: cond.unidades?.length || 0,  color: "#1a1a2e", suffix: "" },
                      { label: "Cuota mensual",   value: fmt(cond.cuota_mensual),      color: "#1e40af", suffix: "" },
                      { label: "Cobrado este mes",value: fmt(cond.cobrado),            color: "#065f46", suffix: "" },
                      { label: "Por cobrar",      value: fmt(cond.pendiente),          color: cond.pendiente > 0 ? "#b45309" : "#065f46", suffix: "" },
                      { label: "Gastos totales",  value: fmt(cond.gastado),            color: "#7c3aed", suffix: "" },
                      { label: "Fondo disponible",value: fmt(Math.max(0, cond.fondo)), color: cond.fondo < 0 ? "#991b1b" : "#065f46", suffix: "" },
                    ].map((s, i) => (
                      <div key={i} style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 12px" }}>
                        <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase", fontWeight: 600 }}>{s.label}</p>
                        <p style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 800, color: s.color }}>{s.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Progreso de cobranza del mes */}
                  {cond.cuotasMes && cond.cuotasMes.length > 0 && (() => {
                    const total = cond.cuotasMes.length;
                    const pagados = cond.cuotasMes.filter(q => q.status === "pagado").length;
                    const pct = Math.round((pagados / total) * 100);
                    return (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Cobranza {periodoLabel(periodoActual())}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: pct === 100 ? "#065f46" : "#b45309" }}>{pagados}/{total} unidades · {pct}%</span>
                        </div>
                        <div style={{ background: "#e5e7eb", borderRadius: 99, height: 6, overflow: "hidden" }}>
                          <div style={{ background: pct === 100 ? "#065f46" : "#b91c3c", height: "100%", width: `${pct}%`, borderRadius: 99, transition: "width 0.5s" }} />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Acciones */}
                  {puedeEditar && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Btn small color="#065f46" onClick={() => generarCuotasMes(cond)}>📋 Generar cuotas del mes</Btn>
                    <Btn small color="#1e40af" onClick={() => { setModalImport(cond); setImportData(null); if (fileRef.current) fileRef.current.value = ""; }}>📥 Importar CSV</Btn>
                    <Btn small color="#1a1a2e" onClick={() => router.push(`/condominio/${cond.id}`)}>⚙️ Administrar</Btn>
                  </div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Modal nuevo condominio ── */}
      {modalNuevo && puedeEditar && (
        <Modal title="Nuevo condominio" onClose={() => setModalNuevo(false)}>
          <Field label="Nombre del condominio *">
            <Input placeholder="Ej: Residencial Ángelus, Edificio Central…" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
          </Field>
          <Field label="Dirección">
            <Input placeholder="Calle, colonia, ciudad" value={form.direccion} onChange={e => setForm({ ...form, direccion: e.target.value })} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Total unidades">
              <Input type="number" value={form.total_unidades} onChange={e => setForm({ ...form, total_unidades: e.target.value })} />
            </Field>
            <Field label="Cuota mensual">
              <Input type="number" placeholder="800" value={form.cuota_mensual} onChange={e => setForm({ ...form, cuota_mensual: e.target.value })} />
            </Field>
            <Field label="Honorarios Emporio">
              <Input type="number" placeholder="1500" value={form.honorarios_emporio} onChange={e => setForm({ ...form, honorarios_emporio: e.target.value })} />
            </Field>
          </div>
          <Field label="Notas">
            <Input placeholder="Observaciones generales" value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} />
          </Field>
          <div style={{ background: "#eff6ff", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 12, color: "#1e40af" }}>El total declarado será <strong>{form.total_unidades || 0}</strong>. Las unidades se agregan después, manualmente o mediante CSV; no se crearán propietarios ficticios.</p>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => setModalNuevo(false)} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={crearCondominio} disabled={saving || !form.nombre.trim()} color={brand.red}>
              {saving ? "Creando…" : "Crear condominio"}
            </Btn>
          </div>
        </Modal>
      )}

      {/* ── Modal importar CSV ── */}
      {modalImport && puedeEditar && (
        <Modal title={`Importar unidades — ${modalImport.nombre}`} onClose={() => { setModalImport(null); setImportData(null); }} wide>
          <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
            <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "#92400e" }}>Formato del CSV</p>
            <p style={{ margin: 0, fontSize: 12, color: "#92400e", fontFamily: "monospace" }}>
              numero,piso,propietario_nombre,propietario_email,propietario_telefono,residente_nombre,residente_email,residente_telefono,residente_es_propietario,notas
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "#92400e" }}>Exporta tu Excel como CSV (UTF-8) antes de subir. La primera fila debe ser el encabezado.</p>
          </div>

          <div style={{ border: "2px dashed #d1d5db", borderRadius: 10, padding: 24, textAlign: "center", marginBottom: 16, background: "#fafafa" }}>
            <input ref={fileRef} type="file" accept=".csv" onChange={handleFileImport} style={{ display: "none" }} id="csv-input" />
            <label htmlFor="csv-input" style={{ cursor: "pointer" }}>
              {importData ? (
                <div>
                  <p style={{ margin: 0, fontSize: 24 }}>✅</p>
                  <p style={{ margin: "6px 0 0", fontWeight: 700, color: importData.errores?.length ? "#991b1b" : "#065f46" }}>{importData.filas?.length || 0} filas · {importData.errores?.length || 0} errores</p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>Clic para cambiar el archivo</p>
                </div>
              ) : (
                <div>
                  <p style={{ margin: 0, fontSize: 36 }}>📥</p>
                  <p style={{ margin: "8px 0 0", fontWeight: 600, color: "#374151" }}>Selecciona tu archivo CSV</p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca3af" }}>Exportado desde Excel</p>
                </div>
              )}
            </label>
          </div>

          {importData?.filas?.length > 0 && (
            <div style={{ background: "#f9fafb", borderRadius: 8, padding: 12, marginBottom: 16, maxHeight: 200, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f3f4f6" }}>
                    <th style={{ padding: "6px 8px", textAlign: "left", color: "#6b7280" }}>Unidad</th>
                    <th style={{ padding: "6px 8px", textAlign: "left", color: "#6b7280" }}>Propietario</th>
                    <th style={{ padding: "6px 8px", textAlign: "left", color: "#6b7280" }}>Email</th>
                    <th style={{ padding: "6px 8px", textAlign: "left", color: "#6b7280" }}>Teléfono</th>
                  </tr>
                </thead>
                <tbody>
                  {importData.filas.map((row, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #e5e7eb" }}>
                      <td style={{ padding: "6px 8px", fontWeight: 700 }}>{row.numero}</td>
                      <td style={{ padding: "6px 8px" }}>{row.propietario_nombre || "—"}</td>
                      <td style={{ padding: "6px 8px", color: "#6b7280" }}>{row.propietario_email || "—"}</td>
                      <td style={{ padding: "6px 8px", color: "#6b7280" }}>{row.propietario_telefono || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {importData?.errores?.length > 0 && <div style={{ background: "#fff5f5", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
            <p style={{ margin: "0 0 6px", fontSize: 12, color: "#dc2626", fontWeight: 700 }}>El archivo no puede confirmarse:</p>
            {importData.errores.slice(0, 20).map((error, index) => <p key={index} style={{ margin: "3px 0", fontSize: 12, color: "#991b1b" }}>Fila {error.fila}: {error.campo} — {error.mensaje}</p>)}
          </div>}
          {importData && !importData.errores?.length && <div style={{ background: "#ecfdf5", border: "1px solid #6ee7b7", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 12, color: "#065f46", fontWeight: 600 }}>La confirmación hará upsert por número de unidad y conservará las unidades no incluidas.</p>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#065f46" }}>
              Altas: {importData.resumen?.altas || 0} · Cambios: {importData.resumen?.cambios || 0} · Sin cambios: {importData.resumen?.sin_cambios || 0} · Omitidas y conservadas: {importData.resumen?.omisiones || 0}
            </p>
          </div>}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => { setModalImport(null); setImportData(null); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <Btn onClick={confirmarImport} disabled={!importData || importData.errores?.length > 0 || importando} color="#1e40af">
              {importando ? "Procesando…" : `Confirmar ${importData?.filas?.length || 0} unidades`}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
