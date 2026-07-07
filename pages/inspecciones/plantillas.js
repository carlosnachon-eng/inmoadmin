import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabase";
import { PageHeader, Btn } from "../../components/Layout";
import { usePermiso, SinAcceso } from "../../lib/permisos";
import { TIPOS_INMUEBLE } from "../../lib/inspecciones";

const card = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 8px 24px rgba(15,23,42,.06)" };
const input = { width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box", background: "#fff" };

export default function PlantillasInspeccion() {
  const router = useRouter();
  const { cargando: permisoCargando, puedeVer, puedeEditar, perfil } = usePermiso("inspecciones");
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [plantillas, setPlantillas] = useState([]);
  const [secciones, setSecciones] = useState([]);
  const [elementos, setElementos] = useState([]);
  const [plantillaId, setPlantillaId] = useState("");
  const [nuevaPlantilla, setNuevaPlantilla] = useState({ nombre: "", tipo_inmueble: "casa" });
  const [nuevaSeccion, setNuevaSeccion] = useState({ nombre: "", orden: 1 });
  const [nuevoElemento, setNuevoElemento] = useState({});

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };
  const puedeAdministrar = puedeEditar && perfil?.role_id === "admin";

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadData(); }, [session]);

  async function loadData() {
    setLoading(true);
    const [p, s, e] = await Promise.all([
      supabase.from("plantillas_inspeccion").select("*").order("tipo_inmueble"),
      supabase.from("plantilla_inspeccion_secciones").select("*").order("orden"),
      supabase.from("plantilla_inspeccion_elementos").select("*").order("orden"),
    ]);
    setPlantillas(p.data || []);
    setSecciones(s.data || []);
    setElementos(e.data || []);
    setPlantillaId((prev) => prev || p.data?.[0]?.id || "");
    setLoading(false);
  }

  async function crearPlantilla() {
    if (!nuevaPlantilla.nombre.trim()) return showToast("Captura nombre de plantilla", false);
    const { error } = await supabase.from("plantillas_inspeccion").insert({ ...nuevaPlantilla, activo: true });
    if (error) showToast(error.message, false);
    else { setNuevaPlantilla({ nombre: "", tipo_inmueble: "casa" }); showToast("Plantilla creada"); loadData(); }
  }

  async function togglePlantilla(p) {
    const { error } = await supabase.from("plantillas_inspeccion").update({ activo: !p.activo }).eq("id", p.id);
    if (error) showToast(error.message, false);
    else { showToast("Plantilla actualizada"); loadData(); }
  }

  async function agregarSeccion() {
    if (!plantillaId || !nuevaSeccion.nombre.trim()) return;
    const { error } = await supabase.from("plantilla_inspeccion_secciones").insert({ plantilla_id: plantillaId, ...nuevaSeccion, orden: Number(nuevaSeccion.orden || 1) });
    if (error) showToast(error.message, false);
    else { setNuevaSeccion({ nombre: "", orden: 1 }); showToast("Sección agregada"); loadData(); }
  }

  async function agregarElemento(seccionId) {
    const form = nuevoElemento[seccionId] || {};
    if (!form.nombre?.trim()) return showToast("Captura el elemento", false);
    const { error } = await supabase.from("plantilla_inspeccion_elementos").insert({
      seccion_id: seccionId,
      nombre: form.nombre,
      orden: Number(form.orden || 1),
      requiere_foto: !!form.requiere_foto,
      requiere_observacion: !!form.requiere_observacion,
    });
    if (error) showToast(error.message, false);
    else {
      setNuevoElemento((prev) => ({ ...prev, [seccionId]: {} }));
      showToast("Elemento agregado");
      loadData();
    }
  }

  async function borrarElemento(id) {
    if (!confirm("¿Eliminar este elemento de la plantilla?")) return;
    const { error } = await supabase.from("plantilla_inspeccion_elementos").delete().eq("id", id);
    if (error) showToast(error.message, false);
    else { showToast("Elemento eliminado"); loadData(); }
  }

  if (authLoading || permisoCargando) return <div style={{ padding: 40, fontFamily: "system-ui" }}>Cargando...</div>;
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }
  if (!puedeVer || perfil?.role_id !== "admin") return <SinAcceso />;

  const plantilla = plantillas.find((p) => p.id === plantillaId);
  const seccionesPlantilla = secciones.filter((s) => s.plantilla_id === plantillaId);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "system-ui, sans-serif" }}>
      <PageHeader title="Plantillas de inspección" icon="🧩" actions={<Btn variant="secondary" onClick={() => router.push("/inspecciones")}>← Inspecciones</Btn>} />
      {toast && <div style={{ position: "fixed", right: 18, top: 18, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 16px", borderRadius: 12, zIndex: 1200, fontWeight: 800 }}>{toast.msg}</div>}

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: 24, display: "grid", gridTemplateColumns: "320px 1fr", gap: 18 }}>
        <aside style={{ ...card, padding: 18, alignSelf: "start" }}>
          <h2 style={{ margin: "0 0 14px", fontSize: 18 }}>Plantillas</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {loading && <p>Cargando...</p>}
            {plantillas.map((p) => (
              <button key={p.id} onClick={() => setPlantillaId(p.id)} style={{ textAlign: "left", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, cursor: "pointer", background: plantillaId === p.id ? "#fff1f2" : "#fff" }}>
                <p style={{ margin: 0, fontWeight: 900, color: "#111827" }}>{p.nombre}</p>
                <p style={{ margin: "3px 0 0", color: p.activo ? "#065f46" : "#991b1b", fontSize: 12, fontWeight: 800 }}>{p.tipo_inmueble} · {p.activo ? "Activa" : "Inactiva"}</p>
              </button>
            ))}
          </div>

          {puedeAdministrar && (
            <div style={{ borderTop: "1px solid #e5e7eb", marginTop: 16, paddingTop: 16 }}>
              <h3 style={{ marginTop: 0, fontSize: 14 }}>Nueva plantilla</h3>
              <input value={nuevaPlantilla.nombre} onChange={(e) => setNuevaPlantilla({ ...nuevaPlantilla, nombre: e.target.value })} placeholder="Nombre" style={input} />
              <select value={nuevaPlantilla.tipo_inmueble} onChange={(e) => setNuevaPlantilla({ ...nuevaPlantilla, tipo_inmueble: e.target.value })} style={{ ...input, marginTop: 8 }}>
                {TIPOS_INMUEBLE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <div style={{ marginTop: 10 }}><Btn small onClick={crearPlantilla}>Crear</Btn></div>
            </div>
          )}
        </aside>

        <section style={{ ...card, padding: 20 }}>
          {!plantilla && <p style={{ color: "#9ca3af" }}>Selecciona una plantilla.</p>}
          {plantilla && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
                <div>
                  <p style={{ margin: "0 0 4px", color: "#9ca3af", textTransform: "uppercase", fontSize: 12, fontWeight: 900 }}>{plantilla.tipo_inmueble}</p>
                  <h1 style={{ margin: 0, fontSize: 24, color: "#111827" }}>{plantilla.nombre}</h1>
                </div>
                {puedeAdministrar && <Btn variant={plantilla.activo ? "danger" : "success"} onClick={() => togglePlantilla(plantilla)}>{plantilla.activo ? "Desactivar" : "Activar"}</Btn>}
              </div>

              {puedeAdministrar && (
                <div style={{ background: "#f9fafb", borderRadius: 12, padding: 14, marginBottom: 16 }}>
                  <p style={{ margin: "0 0 10px", fontWeight: 900 }}>Agregar sección</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 100px auto", gap: 8 }}>
                    <input value={nuevaSeccion.nombre} onChange={(e) => setNuevaSeccion({ ...nuevaSeccion, nombre: e.target.value })} placeholder="Nombre de sección" style={input} />
                    <input type="number" value={nuevaSeccion.orden} onChange={(e) => setNuevaSeccion({ ...nuevaSeccion, orden: e.target.value })} style={input} />
                    <Btn small onClick={agregarSeccion}>Agregar</Btn>
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gap: 14 }}>
                {seccionesPlantilla.map((s) => {
                  const items = elementos.filter((e) => e.seccion_id === s.id);
                  const form = nuevoElemento[s.id] || {};
                  return (
                    <div key={s.id} style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}>
                      <h3 style={{ margin: "0 0 10px", color: "#111827" }}>{s.orden}. {s.nombre}</h3>
                      <div style={{ display: "grid", gap: 8 }}>
                        {items.map((e) => (
                          <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", background: "#f9fafb", borderRadius: 10, padding: 10 }}>
                            <div>
                              <p style={{ margin: 0, fontWeight: 800 }}>{e.orden}. {e.nombre}</p>
                              <p style={{ margin: "3px 0 0", color: "#9ca3af", fontSize: 12 }}>{e.requiere_foto ? "Foto requerida/sugerida" : "Foto opcional"} · {e.requiere_observacion ? "Observación requerida" : "Observación opcional"}</p>
                            </div>
                            {puedeAdministrar && <button onClick={() => borrarElemento(e.id)} style={{ border: "none", background: "#fee2e2", color: "#991b1b", borderRadius: 8, padding: "6px 9px", fontWeight: 900, cursor: "pointer" }}>Eliminar</button>}
                          </div>
                        ))}
                      </div>
                      {puedeAdministrar && (
                        <div style={{ borderTop: "1px solid #e5e7eb", marginTop: 12, paddingTop: 12 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 8 }}>
                            <input value={form.nombre || ""} onChange={(e) => setNuevoElemento({ ...nuevoElemento, [s.id]: { ...form, nombre: e.target.value } })} placeholder="Nuevo elemento" style={input} />
                            <input type="number" value={form.orden || ""} onChange={(e) => setNuevoElemento({ ...nuevoElemento, [s.id]: { ...form, orden: e.target.value } })} placeholder="Orden" style={input} />
                          </div>
                          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                            <label><input type="checkbox" checked={!!form.requiere_foto} onChange={(e) => setNuevoElemento({ ...nuevoElemento, [s.id]: { ...form, requiere_foto: e.target.checked } })} /> Requiere foto</label>
                            <label><input type="checkbox" checked={!!form.requiere_observacion} onChange={(e) => setNuevoElemento({ ...nuevoElemento, [s.id]: { ...form, requiere_observacion: e.target.checked } })} /> Requiere observación</label>
                            <Btn small onClick={() => agregarElemento(s.id)}>Agregar elemento</Btn>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </main>

      <style jsx>{`
        @media (max-width: 820px) {
          main { grid-template-columns: 1fr !important; padding: 14px !important; }
          div[style*="grid-template-columns"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
