import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";
import { PageHeader, brand } from "../components/Layout";

const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n || 0);

const STATUS_STYLE = {
  published: { bg: "#d1fae5", color: "#065f46", label: "Publicada" },
  reserved:  { bg: "#fef3c7", color: "#92400e", label: "Reservada" },
  sold:      { bg: "#fee2e2", color: "#991b1b", label: "Vendida" },
  leased:    { bg: "#fee2e2", color: "#991b1b", label: "Rentada" },
  draft:     { bg: "#f3f4f6", color: "#6b7280", label: "Borrador" },
};

const TIPOS = ["Casa", "Departamento", "Terreno", "Local comercial", "Oficina", "Edificio", "Bodega"];

const PROPIEDAD_VACIA = {
  titulo: "", descripcion: "",
  operacion: "sale", precio: "", moneda: "MXN", unidad_precio: "total",
  tipo: "Casa", recamaras: "", banos: "", estacionamientos: "",
  m2_construccion: "", m2_terreno: "",
  direccion: "", colonia: "", ciudad: "Puebla", estado: "Puebla",
  mostrar_ubicacion_exacta: false,
  fotos: [], amenidades: [],
  status: "published", notas_internas: "",
};

const Modal = ({ title, onClose, children, wide }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: wide ? 720 : 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{title}</h2>
        <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

const Campo = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 4 }}>{label}</label>
    {children}
  </div>
);

const inputStyle = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", fontFamily: "system-ui, sans-serif" };

export default function PropiedadesAdmin() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [propiedades, setPropiedades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState("");
  const [filtroOperacion, setFiltroOperacion] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  const [modalForm, setModalForm] = useState(null); // null | "nueva" | objeto propiedad a editar
  const [form, setForm] = useState(PROPIEDAD_VACIA);
  const [saving, setSaving] = useState(false);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [modalEliminar, setModalEliminar] = useState(null);
  const [migrando, setMigrando] = useState(false);
  const [resultadoMigracion, setResultadoMigracion] = useState(null);
  const [isMobile, setIsMobile] = useState(false);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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

  const loadPropiedades = async () => {
    setLoading(true);
    const { data } = await supabase.from("propiedades").select("*").order("created_at", { ascending: false });
    setPropiedades(data || []);
    setLoading(false);
  };

  useEffect(() => { if (session) loadPropiedades(); }, [session]);

  const filtered = propiedades.filter(p => {
    const matchSearch = !search ||
      p.titulo?.toLowerCase().includes(search.toLowerCase()) ||
      p.direccion?.toLowerCase().includes(search.toLowerCase()) ||
      p.colonia?.toLowerCase().includes(search.toLowerCase()) ||
      p.public_id?.toLowerCase().includes(search.toLowerCase());
    const matchOp = !filtroOperacion || p.operacion === filtroOperacion;
    const matchStatus = !filtroStatus || p.status === filtroStatus;
    return matchSearch && matchOp && matchStatus;
  });

  const abrirNueva = () => { setForm(PROPIEDAD_VACIA); setModalForm("nueva"); };
  const abrirEditar = (p) => {
    setForm({
      ...PROPIEDAD_VACIA,
      ...p,
      precio: p.precio || "",
      recamaras: p.recamaras || "",
      banos: p.banos || "",
      estacionamientos: p.estacionamientos || "",
      m2_construccion: p.m2_construccion || "",
      m2_terreno: p.m2_terreno || "",
      fotos: Array.isArray(p.fotos) ? p.fotos : [],
      amenidades: Array.isArray(p.amenidades) ? p.amenidades : [],
    });
    setModalForm(p);
  };

  const subirFoto = async (file) => {
    setSubiendoFoto(true);
    try {
      const ext = file.name.split(".").pop();
      const carpeta = form.public_id || `nueva_${Date.now()}`;
      const fileName = `${carpeta}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const { error } = await supabase.storage.from("propiedades-fotos").upload(fileName, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("propiedades-fotos").getPublicUrl(fileName);
      setForm(f => ({ ...f, fotos: [...f.fotos, { url: data.publicUrl, orden: f.fotos.length }] }));
      showToast("Foto agregada ✅");
    } catch (e) { showToast("Error al subir foto: " + e.message, false); }
    setSubiendoFoto(false);
  };

  const quitarFoto = (idx) => {
    setForm(f => ({ ...f, fotos: f.fotos.filter((_, i) => i !== idx) }));
  };

  const moverFoto = (idx, dir) => {
    setForm(f => {
      const nuevas = [...f.fotos];
      const j = idx + dir;
      if (j < 0 || j >= nuevas.length) return f;
      [nuevas[idx], nuevas[j]] = [nuevas[j], nuevas[idx]];
      return { ...f, fotos: nuevas.map((foto, i) => ({ ...foto, orden: i })) };
    });
  };

  const agregarAmenidad = (texto) => {
    if (!texto.trim()) return;
    setForm(f => ({ ...f, amenidades: [...f.amenidades, texto.trim()] }));
  };
  const quitarAmenidad = (idx) => {
    setForm(f => ({ ...f, amenidades: f.amenidades.filter((_, i) => i !== idx) }));
  };

  const guardarPropiedad = async () => {
    if (!form.titulo.trim()) { showToast("Falta el título de la propiedad", false); return; }
    if (!form.precio) { showToast("Falta el precio", false); return; }

    setSaving(true);
    const payload = {
      ...form,
      precio: Number(form.precio) || 0,
      recamaras: Number(form.recamaras) || 0,
      banos: Number(form.banos) || 0,
      estacionamientos: Number(form.estacionamientos) || 0,
      m2_construccion: Number(form.m2_construccion) || 0,
      m2_terreno: Number(form.m2_terreno) || 0,
    };
    delete payload.id;
    delete payload.created_at;
    delete payload.updated_at;

    let error;
    if (modalForm === "nueva") {
      payload.public_id = payload.public_id || `EMP-${Date.now().toString(36).toUpperCase()}`;
      payload.origen = "manual";
      ({ error } = await supabase.from("propiedades").insert(payload));
    } else {
      ({ error } = await supabase.from("propiedades").update(payload).eq("id", modalForm.id));
    }
    setSaving(false);
    if (error) { showToast("Error al guardar: " + error.message, false); return; }
    showToast(modalForm === "nueva" ? "Propiedad creada ✅" : "Propiedad actualizada ✅");
    setModalForm(null);
    loadPropiedades();
  };

  const confirmarEliminar = async () => {
    setSaving(true);
    // Borrado lógico: la quitamos del catálogo público pero no se destruye el historial
    const { error } = await supabase.from("propiedades").update({ status: "draft" }).eq("id", modalEliminar.id);
    setSaving(false);
    setModalEliminar(null);
    if (error) { showToast("Error al archivar", false); return; }
    showToast("Propiedad archivada (ya no se muestra en el sitio)");
    loadPropiedades();
  };

  const cambiarStatus = async (p, nuevoStatus) => {
    const { error } = await supabase.from("propiedades").update({ status: nuevoStatus }).eq("id", p.id);
    if (error) { showToast("Error al actualizar estatus", false); return; }
    showToast("Estatus actualizado");
    loadPropiedades();
  };

  const correrMigracion = async () => {
    if (!confirm("Esto va a traer todas tus propiedades activas de EasyBroker y guardarlas aquí. Si una propiedad ya existe, se actualiza (no se duplica). ¿Continuar?")) return;
    setMigrando(true);
    setResultadoMigracion(null);
    try {
      const res = await fetch("/api/migrar-propiedades", { method: "POST" });
      const data = await res.json();
      setResultadoMigracion(data);
      if (res.ok) {
        showToast(`Migración completa: ${data.creadas} creadas, ${data.actualizadas} actualizadas`);
        loadPropiedades();
      } else {
        showToast("Error en la migración: " + (data.error || "desconocido"), false);
      }
    } catch (e) {
      showToast("Error de red al migrar: " + e.message, false);
    }
    setMigrando(false);
  };

  if (authLoading) return null;
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: 320 }}>
          {toast.msg}
        </div>
      )}

      <PageHeader
        title="Propiedades"
        icon="🏠"
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={correrMigracion} disabled={migrando} style={{ background: "#fff", color: brand.red, border: `1.5px solid ${brand.red}`, borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: migrando ? "not-allowed" : "pointer", fontSize: 13, opacity: migrando ? 0.6 : 1 }}>
              {migrando ? "Importando…" : "⬇️ Importar de EasyBroker"}
            </button>
            <button onClick={abrirNueva} style={{ background: brand.red, color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
              + Nueva propiedad
            </button>
          </div>
        }
      />

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px" }}>

        {resultadoMigracion && (
          <div style={{ background: resultadoMigracion.error ? "#fee2e2" : "#f0fdf4", border: `1px solid ${resultadoMigracion.error ? "#fca5a5" : "#86efac"}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
            {resultadoMigracion.error ? (
              <p style={{ margin: 0, fontSize: 13, color: "#991b1b" }}>❌ {resultadoMigracion.error}</p>
            ) : (
              <>
                <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "#065f46" }}>
                  ✅ Migración completa: {resultadoMigracion.procesadas} propiedades procesadas ({resultadoMigracion.creadas} nuevas, {resultadoMigracion.actualizadas} actualizadas)
                </p>
                {resultadoMigracion.errores?.length > 0 && (
                  <p style={{ margin: 0, fontSize: 12, color: "#92400e" }}>⚠️ {resultadoMigracion.errores.length} propiedades tuvieron error y no se importaron — revisa la consola del servidor en Vercel para más detalle.</p>
                )}
              </>
            )}
            <button onClick={() => setResultadoMigracion(null)} style={{ marginTop: 8, background: "none", border: "none", color: "#6b7280", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>Cerrar aviso</button>
          </div>
        )}

        {/* Filtros */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <input
            placeholder="Buscar por título, dirección o ID…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }}
          />
          <select value={filtroOperacion} onChange={e => setFiltroOperacion(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Venta y renta</option>
            <option value="sale">Solo venta</option>
            <option value="rental">Solo renta</option>
          </select>
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Todos los estatus</option>
            <option value="published">Publicada</option>
            <option value="reserved">Reservada</option>
            <option value="sold">Vendida</option>
            <option value="leased">Rentada</option>
            <option value="draft">Borrador / Archivada</option>
          </select>
          <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: "auto" }}>{filtered.length} propiedades</span>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 48, color: "#9ca3af" }}>Cargando propiedades…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: "#9ca3af" }}>
            {propiedades.length === 0 ? (
              <>No tienes propiedades todavía. Usa "Importar de EasyBroker" para traer tu catálogo actual, o agrega una nueva.</>
            ) : (
              <>No se encontraron propiedades con esos filtros.</>
            )}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {filtered.map(p => {
              const st = STATUS_STYLE[p.status] || STATUS_STYLE.published;
              const foto = Array.isArray(p.fotos) && p.fotos[0]?.url;
              return (
                <div key={p.id} style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                  <div style={{ height: 150, background: "#f3f4f6", position: "relative" }}>
                    {foto ? (
                      <img src={foto} alt={p.titulo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>🏠</div>
                    )}
                    <span style={{ position: "absolute", top: 8, left: 8, background: p.operacion === "sale" ? "#1a1a2e" : brand.red, color: "#fff", padding: "3px 10px", borderRadius: 99, fontSize: 10, fontWeight: 800 }}>
                      {p.operacion === "sale" ? "VENTA" : "RENTA"}
                    </span>
                    <span style={{ position: "absolute", top: 8, right: 8, background: st.bg, color: st.color, padding: "3px 10px", borderRadius: 99, fontSize: 10, fontWeight: 700 }}>
                      {st.label}
                    </span>
                  </div>
                  <div style={{ padding: 14 }}>
                    <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: "#1a1a2e", lineHeight: 1.3 }}>{p.titulo}</p>
                    <p style={{ margin: "0 0 8px", fontSize: 12, color: "#6b7280" }}>📍 {[p.colonia, p.ciudad].filter(Boolean).join(", ")}</p>
                    <p style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 900, color: brand.red }}>{fmt(p.precio)}</p>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, fontSize: 11, color: "#374151" }}>
                      {p.recamaras > 0 && <span>🛏 {p.recamaras}</span>}
                      {p.banos > 0 && <span>🚿 {p.banos}</span>}
                      {p.m2_construccion > 0 && <span>📐 {p.m2_construccion} m²</span>}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => abrirEditar(p)} style={{ flex: 1, background: "#f3f4f6", border: "none", borderRadius: 8, padding: "8px", fontWeight: 700, fontSize: 12, cursor: "pointer", color: "#374151" }}>
                        ✏️ Editar
                      </button>
                      {p.status !== "draft" ? (
                        <button onClick={() => setModalEliminar(p)} style={{ background: "#fee2e2", border: "none", borderRadius: 8, padding: "8px 10px", fontWeight: 700, fontSize: 12, cursor: "pointer", color: "#991b1b" }}>
                          🗄️
                        </button>
                      ) : (
                        <button onClick={() => cambiarStatus(p, "published")} style={{ background: "#d1fae5", border: "none", borderRadius: 8, padding: "8px 10px", fontWeight: 700, fontSize: 12, cursor: "pointer", color: "#065f46" }}>
                          ↩️ Reactivar
                        </button>
                      )}
                    </div>
                    <p style={{ margin: "8px 0 0", fontSize: 10, color: "#9ca3af" }}>ID: {p.public_id}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modalEliminar && (
        <Modal title="Archivar propiedad" onClose={() => setModalEliminar(null)}>
          <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.6 }}>
            "{modalEliminar.titulo}" dejará de mostrarse en tu sitio público. No se borra del sistema — puedes reactivarla cuando quieras.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={() => setModalEliminar(null)} style={{ flex: 1, background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
            <button onClick={confirmarEliminar} disabled={saving} style={{ flex: 1, background: "#991b1b", color: "#fff", border: "none", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer" }}>
              {saving ? "Archivando…" : "Sí, archivar"}
            </button>
          </div>
        </Modal>
      )}

      {modalForm && (
        <Modal title={modalForm === "nueva" ? "Nueva propiedad" : "Editar propiedad"} onClose={() => setModalForm(null)} wide>

          <Campo label="Título *">
            <input style={inputStyle} value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Casa en privada, Lomas de Angelópolis" />
          </Campo>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Campo label="Operación">
              <select style={inputStyle} value={form.operacion} onChange={e => setForm(f => ({ ...f, operacion: e.target.value }))}>
                <option value="sale">Venta</option>
                <option value="rental">Renta</option>
              </select>
            </Campo>
            <Campo label="Tipo de propiedad">
              <select style={inputStyle} value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Campo>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Campo label="Precio *">
              <input type="number" style={inputStyle} value={form.precio} onChange={e => setForm(f => ({ ...f, precio: e.target.value }))} placeholder="2500000" />
            </Campo>
            <Campo label="Unidad de precio">
              <select style={inputStyle} value={form.unidad_precio} onChange={e => setForm(f => ({ ...f, unidad_precio: e.target.value }))}>
                <option value="total">Total</option>
                <option value="mensual">Mensual</option>
              </select>
            </Campo>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            <Campo label="Recámaras">
              <input type="number" style={inputStyle} value={form.recamaras} onChange={e => setForm(f => ({ ...f, recamaras: e.target.value }))} />
            </Campo>
            <Campo label="Baños">
              <input type="number" step="0.5" style={inputStyle} value={form.banos} onChange={e => setForm(f => ({ ...f, banos: e.target.value }))} />
            </Campo>
            <Campo label="Estac.">
              <input type="number" style={inputStyle} value={form.estacionamientos} onChange={e => setForm(f => ({ ...f, estacionamientos: e.target.value }))} />
            </Campo>
            <Campo label="m² constr.">
              <input type="number" style={inputStyle} value={form.m2_construccion} onChange={e => setForm(f => ({ ...f, m2_construccion: e.target.value }))} />
            </Campo>
          </div>

          <Campo label="m² terreno (opcional)">
            <input type="number" style={inputStyle} value={form.m2_terreno} onChange={e => setForm(f => ({ ...f, m2_terreno: e.target.value }))} />
          </Campo>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Campo label="Dirección / Calle">
              <input style={inputStyle} value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} />
            </Campo>
            <Campo label="Colonia / Fraccionamiento">
              <input style={inputStyle} value={form.colonia} onChange={e => setForm(f => ({ ...f, colonia: e.target.value }))} />
            </Campo>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Campo label="Ciudad">
              <input style={inputStyle} value={form.ciudad} onChange={e => setForm(f => ({ ...f, ciudad: e.target.value }))} />
            </Campo>
            <Campo label="Estado">
              <input style={inputStyle} value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))} />
            </Campo>
          </div>

          <Campo label="Descripción">
            <textarea style={{ ...inputStyle, minHeight: 90, resize: "vertical" }} value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          </Campo>

          <Campo label="Estatus">
            <select style={inputStyle} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="published">Publicada</option>
              <option value="reserved">Reservada</option>
              <option value="sold">Vendida</option>
              <option value="leased">Rentada</option>
              <option value="draft">Borrador (no se muestra en el sitio)</option>
            </select>
          </Campo>

          {/* Fotos */}
          <Campo label={`Fotos (${form.fotos.length})`}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {form.fotos.map((foto, idx) => (
                <div key={idx} style={{ position: "relative", width: 84, height: 64 }}>
                  <img src={foto.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8, border: "1px solid #e5e7eb" }} />
                  <button onClick={() => quitarFoto(idx)} style={{ position: "absolute", top: -6, right: -6, background: "#991b1b", color: "#fff", border: "none", borderRadius: "50%", width: 20, height: 20, fontSize: 11, cursor: "pointer", lineHeight: 1 }}>✕</button>
                  <div style={{ position: "absolute", bottom: -6, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 2 }}>
                    <button onClick={() => moverFoto(idx, -1)} disabled={idx === 0} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 4, fontSize: 9, width: 16, height: 16, cursor: idx === 0 ? "default" : "pointer", opacity: idx === 0 ? 0.4 : 1 }}>←</button>
                    <button onClick={() => moverFoto(idx, 1)} disabled={idx === form.fotos.length - 1} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 4, fontSize: 9, width: 16, height: 16, cursor: idx === form.fotos.length - 1 ? "default" : "pointer", opacity: idx === form.fotos.length - 1 ? 0.4 : 1 }}>→</button>
                  </div>
                </div>
              ))}
            </div>
            <label style={{ display: "inline-block", background: subiendoFoto ? "#f3f4f6" : brand.redLight, color: brand.red, padding: "8px 16px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: subiendoFoto ? "default" : "pointer" }}>
              {subiendoFoto ? "Subiendo…" : "+ Agregar foto"}
              <input type="file" accept="image/*" disabled={subiendoFoto} onChange={e => e.target.files[0] && subirFoto(e.target.files[0])} style={{ display: "none" }} />
            </label>
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "#9ca3af" }}>La primera foto es la que se usa como portada en el listado.</p>
          </Campo>

          {/* Amenidades */}
          <Campo label="Amenidades">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {form.amenidades.map((a, idx) => (
                <span key={idx} style={{ background: "#f0fdf4", color: "#065f46", padding: "4px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  {a}
                  <button onClick={() => quitarAmenidad(idx)} style={{ background: "none", border: "none", color: "#065f46", cursor: "pointer", fontSize: 11, padding: 0 }}>✕</button>
                </span>
              ))}
            </div>
            <input
              style={inputStyle}
              placeholder="Escribe una amenidad y presiona Enter (ej. Alberca)"
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  agregarAmenidad(e.target.value);
                  e.target.value = "";
                }
              }}
            />
          </Campo>

          <Campo label="Notas internas (no se muestran en el sitio)">
            <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.notas_internas || ""} onChange={e => setForm(f => ({ ...f, notas_internas: e.target.value }))} placeholder="Ej. propietario pide discreción, llaves con el portero, etc." />
          </Campo>

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={() => setModalForm(null)} style={{ flex: 1, background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
            <button onClick={guardarPropiedad} disabled={saving} style={{ flex: 1, background: brand.red, color: "#fff", border: "none", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer" }}>
              {saving ? "Guardando…" : "Guardar propiedad"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
